import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  certExamAnswers,
  certExamAttempts,
  certExamItems,
  certExams,
  certItems,
  certItemAnswerKeys,
  courses,
  staffUsers,
  teachers,
  students,
} from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import {
  latestCalibrationByItem,
  latestRun,
  responseCountByItem,
  runCalibration,
} from "../lib/calibration.js";
import { calibrationState, fitBand, MIN_RESPONSES_PROVISIONAL } from "../lib/rasch.js";
import { buildOverview } from "../lib/raschOverview.js";
import { equateScore, type EquatedResult } from "../lib/equating.js";
import { loadEquatingContext, type EquatingContext } from "../lib/equatingContext.js";
import { accessibleCourseIds, loadAccessibleCourse } from "../lib/access.js";
import { Conflict, NotFound, Unprocessable } from "../lib/errors.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";
import { fetchTelegramFile } from "../telegram/client.js";
import {
  AUTO_MAX_POINTS,
  DEAD_DISTRACTOR_SHARE,
  DISCRIMINATION_GROUP_SHARE,
  KEY_TASK_NUMBERS,
  MAX_ANSWER_PARTS,
  MIN_ATTEMPTS_FOR_DISCRIMINATION,
  PHOTO_TASK_NUMBERS,
  RECOMMENDED_ANCHOR_COUNT,
  TEST_HALF_TASK_COUNT,
  TOTAL_MAX_POINTS,
  discriminationBand,
  estimateCertScore,
  isClosedTask,
  itemCode,
  maxPartsFor,
  maxPointsFor,
  optionsFor,
  splitHalves,
  splitPoints,
  taskTypeFor,
  topicFor,
} from "../lib/certExam.js";

const createSchema = z.object({
  title: z.string().min(1),
  deadline_at: z.coerce.date(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  deadline_at: z.coerce.date().optional(),
});

/**
 * The whole key in one request rather than 35 PATCHes: a half-entered key is
 * useless (the variant can't be published), so there's no meaningful partial
 * state worth persisting one task at a time.
 */
const answerKeySchema = z.object({
  answers: z
    .array(
      z.object({
        task_number: z.number().int().min(1).max(35),
        correct_option: z.string().min(1).max(1),
        // Optional citation ("Spectrum 2026, вариант 1, №5"). Two variants
        // citing the same source resolve to one bank item, so statistics
        // add up instead of splitting across duplicates.
        source_ref: z.string().min(1).max(200).optional(),
      }),
    )
    .min(1),
});

const updateItemSchema = z.object({
  correct_option: z.string().min(1).max(1).optional(),
  source_ref: z.string().min(1).max(200).nullable().optional(),
  topic: z.string().min(1).max(40).optional(),
  stem_text: z.string().max(4000).nullable().optional(),
  author: z.string().max(200).nullable().optional(),
  cognitive_level: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  status: z.enum(["active", "retired"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Открытые задания: режим проверки и ключ. Ключ — это список частей, у
  // каждой несколько допустимых написаний («митохондрия», «митохондрии»).
  grading_mode: z.enum(["manual", "typed"]).optional(),
  answer_key: z
    .array(z.array(z.string().trim().min(1).max(200)).min(1).max(8))
    .min(1)
    .max(MAX_ANSWER_PARTS)
    .nullable()
    .optional(),
});

const reviewSchema = z.object({
  points: z
    .array(
      z.object({
        task_number: z.number().int().min(36).max(43),
        awarded_points: z.number().int().min(0),
      }),
    )
    .default([]),
  comment_text: z.string().min(1).optional(),
});

/** Loads an exam and enforces tenant + course access. */
async function loadAccessibleExam(auth: ReturnType<typeof requireAuth>, examId: number) {
  const [exam] = await db.select().from(certExams).where(eq(certExams.id, examId)).limit(1);
  if (!exam || exam.teacherId !== auth.teacherId) throw NotFound("Exam not found");
  await loadAccessibleCourse(auth, exam.courseId);
  return exam;
}

async function keyCountFor(examId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(certExamItems)
    .innerJoin(certItems, eq(certItems.id, certExamItems.itemId))
    .where(and(eq(certExamItems.examId, examId), sql`${certItems.correctOption} IS NOT NULL`));
  return row?.n ?? 0;
}

/** The exam's key, resolved through the item bank. */
async function keyMapFor(examId: number): Promise<Map<number, string>> {
  const rows = await db
    .select({ taskNumber: certExamItems.taskNumber, option: certItems.correctOption })
    .from(certExamItems)
    .innerJoin(certItems, eq(certItems.id, certExamItems.itemId))
    .where(eq(certExamItems.examId, examId));
  return new Map(
    rows.filter((r) => r.option !== null).map((r) => [r.taskNumber, r.option as string]),
  );
}

/**
 * Questions this variant shares with another one. Those are what link the
 * two variants onto a single scale, so the teacher needs to see the number
 * while composing, not after the fact.
 */
async function anchorCountFor(examId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(certExamItems)
    .where(
      and(
        eq(certExamItems.examId, examId),
        sql`(SELECT count(*) FROM cert_exam_items o WHERE o.item_id = ${certExamItems.itemId}) > 1`,
      ),
    );
  return row?.n ?? 0;
}


/**
 * Discrimination per item, computed inside each variant and then pooled.
 *
 * Ranking has to happen within one variant: totals from different variants
 * are not comparable until their scales are linked by anchors, so pooling
 * the raw scores first would rank a weak student on an easy variant above a
 * strong one on a hard variant and corrupt every D at once.
 */
async function discriminationByItem(teacherId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({
      itemId: certExamAnswers.itemId,
      attemptId: certExamAnswers.attemptId,
      examId: certExamAttempts.examId,
      autoScore: certExamAttempts.autoScore,
      isCorrect: certExamAnswers.isCorrect,
      awardedPoints: certExamAnswers.awardedPoints,
      taskNumber: certExamAnswers.taskNumber,
    })
    .from(certExamAnswers)
    .innerJoin(certExamAttempts, eq(certExamAttempts.id, certExamAnswers.attemptId))
    .innerJoin(certItems, eq(certItems.id, certExamAnswers.itemId))
    .where(
      and(
        eq(certItems.teacherId, teacherId),
        sql`${certExamAttempts.status} IN ('submitted','reviewed')`,
        sql`${certExamAnswers.itemId} IS NOT NULL`,
      ),
    );

  // exam -> attempt -> rank basis, and exam -> item -> per-attempt outcome
  const attemptScore = new Map<string, number>();
  const byExam = new Map<number, Map<number, Map<number, boolean>>>();

  for (const r of rows) {
    if (r.itemId === null) continue;
    // 41–43 are polytomous; a binary "solved it" does not exist for them.
    if (r.taskNumber > 40) continue;

    const solved = isClosedTask(r.taskNumber)
      ? r.isCorrect
      : r.awardedPoints === null
        ? null
        : r.awardedPoints >= 1;
    if (solved === null) continue;

    attemptScore.set(`${r.examId}:${r.attemptId}`, r.autoScore ?? 0);
    const items = byExam.get(r.examId) ?? new Map();
    byExam.set(r.examId, items);
    const perAttempt = items.get(r.itemId) ?? new Map<number, boolean>();
    items.set(r.itemId, perAttempt);
    perAttempt.set(r.attemptId, solved);
  }

  // item -> [sum of D weighted by group size, total weight]
  const pooled = new Map<number, [number, number]>();

  for (const [examId, items] of byExam) {
    const attempts = [
      ...new Set([...items.values()].flatMap((m) => [...m.keys()])),
    ].sort(
      (a, b) =>
        (attemptScore.get(`${examId}:${b}`) ?? 0) - (attemptScore.get(`${examId}:${a}`) ?? 0),
    );
    if (attempts.length < MIN_ATTEMPTS_FOR_DISCRIMINATION) continue;

    const groupSize = Math.max(1, Math.round(attempts.length * DISCRIMINATION_GROUP_SHARE));
    const top = attempts.slice(0, groupSize);
    const bottom = attempts.slice(-groupSize);

    for (const [itemId, perAttempt] of items) {
      const share = (group: number[]) => {
        const seen = group.filter((a) => perAttempt.has(a));
        if (seen.length === 0) return null;
        return seen.filter((a) => perAttempt.get(a)).length / seen.length;
      };
      const pTop = share(top);
      const pBottom = share(bottom);
      if (pTop === null || pBottom === null) continue;

      const [sum, weight] = pooled.get(itemId) ?? [0, 0];
      pooled.set(itemId, [sum + (pTop - pBottom) * groupSize, weight + groupSize]);
    }
  }

  return new Map(
    [...pooled].map(([itemId, [sum, weight]]) => [itemId, weight > 0 ? sum / weight : 0]),
  );
}

/** Shape returned for a single exam, including how ready it is to publish. */
async function describeExam(exam: typeof certExams.$inferSelect) {
  const keyCount = await keyCountFor(exam.id);
  const anchorCount = await anchorCountFor(exam.id);
  return {
    id: exam.id,
    course_id: exam.courseId,
    title: exam.title,
    deadline_at: exam.deadlineAt,
    has_variant_file: exam.variantFileId !== null,
    variant_file_name: exam.variantFileName,
    key_filled: keyCount,
    key_required: KEY_TASK_NUMBERS.length,
    anchor_count: anchorCount,
    anchor_recommended: RECOMMENDED_ANCHOR_COUNT,
    published: exam.publishedAt !== null,
    published_at: exam.publishedAt,
    total_max_points: TOTAL_MAX_POINTS,
    created_at: exam.createdAt,
  };
}

const certExamRoutes: FastifyPluginAsync = async (app) => {
  // Static description of the variant format, so both frontends render the
  // right option letters and point ceilings without duplicating the spec.
  app.get("/cert-exams/structure", async () => ({
    total_max_points: TOTAL_MAX_POINTS,
    auto_max_points: AUTO_MAX_POINTS,
    tasks: Array.from({ length: 43 }, (_, i) => i + 1).map((n) => ({
      task_number: n,
      is_closed: isClosedTask(n),
      options: optionsFor(n),
      max_points: maxPointsFor(n),
    })),
  }));


  // --- Rasch calibration ------------------------------------------------

  /**
   * Recalibrates the whole bank from every graded answer.
   *
   * Triggered by hand rather than on a schedule: the input changes only when a
   * variant is reviewed, and an explicit button makes it obvious which numbers
   * the teacher is looking at.
   */
  app.post("/cert-calibration/run", async (request) => {
    const auth = requireTeacher(request);
    return runCalibration(auth.teacherId);
  });

  app.get("/cert-calibration/latest", async (request) => {
    const auth = requireAuth(request);
    return { run: await latestRun(auth.teacherId), min_responses: MIN_RESPONSES_PROVISIONAL };
  });

  // --- item bank -------------------------------------------------------

  /**
   * The teacher's question bank with accumulated response statistics.
   *
   * Everything here is computed live: at 100–150 students the numbers are a
   * single grouped scan, and a cached table would only add a way for the
   * figures to go stale.
   */
  /**
   * The variants a bank item can belong to, as the first screen of the bank.
   *
   * A flat list of every question sorted by task number puts the second
   * variant's «задание 5» directly under the first variant's, and the two are
   * told apart only by a code. Browsing by variant matches how the questions
   * were entered in the first place — one variant at a time.
   */
  /**
   * Оценка попытки с поправкой на трудность варианта.
   *
   * Официальная оценка остаётся первой и неизменной — её считает государство.
   * Здесь второе число: сумма верных переводится в уровень по трудностям
   * своего варианта, уровень — в эквивалент на эталонном, и уже он идёт в ту
   * же государственную формулу. Письменная половина не трогается: 41–43
   * оцениваются в баллах, а дихотомической модели про них сказать нечего.
   */
  function equatedEstimate(params: {
    context: EquatingContext;
    examId: number;
    testCorrect: number;
    writtenPoints: number;
  }) {
    const variant = params.context.byExam.get(params.examId);
    const result: EquatedResult = equateScore({
      correct: params.testCorrect,
      variantDifficulties: variant?.difficulties ?? [],
      referenceDifficulties: params.context.referenceDifficulties,
      linked: variant?.linked ?? false,
    });

    const estimate =
      result.status === "ok" && result.equated_correct !== null
        ? estimateCertScore({
            testCorrect: result.equated_correct,
            writtenPoints: params.writtenPoints,
          })
        : null;

    return {
      status: result.status,
      measure: result.measure,
      standard_error: result.standard_error,
      equated_correct: result.equated_correct,
      reference_length: result.reference_length,
      reference_exam_id: params.context.referenceExamId,
      shared_with_reference: variant?.sharedWithReference ?? 0,
      estimate,
    };
  }

  /**
   * Всё, что модель Раша говорит о банке целиком, а не об одном задании:
   * карта «ученики против заданий», разделяющая способность, задания вне
   * полосы соответствия, связанность вариантов и таблицы перевода.
   */
  app.get("/cert-calibration/overview", async (request) => {
    const auth = requireAuth(request);
    return buildOverview(auth.teacherId);
  });

  /**
   * Эталонный вариант — тот, к чьей шкале приводятся результаты остальных.
   *
   * Настраивается руками, потому что выбор по умолчанию (вариант с наибольшим
   * числом откалиброванных заданий) может смениться при добавлении нового
   * варианта, а от эталона зависит второе число в оценке каждого ученика:
   * прыгать оно не должно.
   */
  app.patch("/cert-calibration/reference", async (request) => {
    const auth = requireTeacher(request);
    const body = z
      .object({ exam_id: z.number().int().positive().nullable() })
      .safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    if (body.data.exam_id !== null) {
      await loadAccessibleExam(auth, body.data.exam_id);
    }
    await db
      .update(teachers)
      .set({ certReferenceExamId: body.data.exam_id })
      .where(eq(teachers.staffUserId, auth.teacherId));

    return { reference_exam_id: (await loadEquatingContext(auth.teacherId)).referenceExamId };
  });

  app.get("/cert-items/variants", async (request) => {
    const auth = requireAuth(request);

    const conditions = [eq(certExams.teacherId, auth.teacherId)];
    const allowed = await accessibleCourseIds(auth);
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      conditions.push(inArray(certExams.courseId, allowed));
    }

    const rows = await db
      .select({
        id: certExams.id,
        title: certExams.title,
        courseId: certExams.courseId,
        courseTitle: courses.title,
        publishedAt: certExams.publishedAt,
        deadlineAt: certExams.deadlineAt,
        createdAt: certExams.createdAt,
        itemCount: sql<number>`(
          SELECT count(*)::int FROM cert_exam_items ei WHERE ei.exam_id = ${certExams.id}
        )`,
      })
      .from(certExams)
      .innerJoin(courses, eq(courses.id, certExams.courseId))
      .where(and(...conditions))
      .orderBy(sql`${certExams.createdAt} DESC`);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      course_id: r.courseId,
      course_title: r.courseTitle,
      published: r.publishedAt !== null,
      deadline_at: r.deadlineAt,
      created_at: r.createdAt,
      item_count: r.itemCount,
    }));
  });

  app.get("/cert-items", async (request) => {
    const auth = requireAuth(request);
    const query = request.query as { topic?: string; task_number?: string };

    const conditions = [eq(certItems.teacherId, auth.teacherId)];
    if (query.topic) conditions.push(eq(certItems.topic, query.topic));
    if (query.task_number && /^\d+$/.test(query.task_number)) {
      conditions.push(eq(certItems.taskNumber, Number(query.task_number)));
    }

    const rows = await db
      .select({
        id: certItems.id,
        taskNumber: certItems.taskNumber,
        correctOption: certItems.correctOption,
        gradingMode: certItems.gradingMode,
        topic: certItems.topic,
        sourceRef: certItems.sourceRef,
        // Only graded answers count: an attempt still in progress has
        // is_correct NULL and must not drag the difficulty down.
        responses: sql<number>`count(${certExamAnswers.isCorrect})::int`,
        correct: sql<number>`count(*) FILTER (WHERE ${certExamAnswers.isCorrect})::int`,
        // For open tasks there is no key, so "difficulty" is the average
        // share of the maximum the teacher actually awarded.
        pointsAwarded: sql<number>`coalesce(sum(${certExamAnswers.awardedPoints}), 0)::int`,
        pointsGraded: sql<number>`count(${certExamAnswers.awardedPoints})::int`,
      })
      .from(certItems)
      .leftJoin(certExamAnswers, eq(certExamAnswers.itemId, certItems.id))
      .where(and(...conditions))
      .groupBy(certItems.id)
      .orderBy(certItems.taskNumber, certItems.id);

    // Which wrong option students actually gravitate to. A key typo shows up
    // as "most of them chose X, but the key says Y" — worth surfacing,
    // because a mistyped letter in a 35-character key silently marks every
    // student wrong and nothing else in the system would notice.
    const distribution = await db
      .select({
        itemId: certExamAnswers.itemId,
        option: certExamAnswers.chosenOption,
        n: sql<number>`count(*)::int`,
      })
      .from(certExamAnswers)
      .innerJoin(certItems, eq(certItems.id, certExamAnswers.itemId))
      .where(
        and(
          eq(certItems.teacherId, auth.teacherId),
          sql`${certExamAnswers.chosenOption} IS NOT NULL`,
          sql`${certExamAnswers.isCorrect} IS NOT NULL`,
        ),
      )
      .groupBy(certExamAnswers.itemId, certExamAnswers.chosenOption);

    // Which variants each item sits in. Fetched as one list rather than a
    // correlated count per row, because the bank is now browsed variant by
    // variant and the client needs the ids themselves, not just how many.
    const usage = await db
      .select({ itemId: certExamItems.itemId, examId: certExamItems.examId })
      .from(certExamItems)
      .innerJoin(certItems, eq(certItems.id, certExamItems.itemId))
      .where(eq(certItems.teacherId, auth.teacherId));

    const examIdsByItem = new Map<number, number[]>();
    for (const u of usage) {
      const list = examIdsByItem.get(u.itemId);
      if (list) list.push(u.examId);
      else examIdsByItem.set(u.itemId, [u.examId]);
    }

    const discrimination = await discriminationByItem(auth.teacherId);
    const calibration = await latestCalibrationByItem(auth.teacherId);
    const responseCounts = await responseCountByItem(auth.teacherId);

    const topChoice = new Map<number, { option: string; n: number }>();
    for (const d of distribution) {
      if (d.itemId === null || d.option === null) continue;
      const prev = topChoice.get(d.itemId);
      if (!prev || d.n > prev.n) topChoice.set(d.itemId, { option: d.option, n: d.n });
    }

    return rows.map((r) => {
      const closed = isClosedTask(r.taskNumber);
      const pValue = r.responses > 0 ? r.correct / r.responses : null;
      const top = topChoice.get(r.id);
      const maxPoints = maxPointsFor(r.taskNumber);
      const avgShare =
        !closed && r.pointsGraded > 0 ? r.pointsAwarded / (r.pointsGraded * maxPoints) : null;

      const d = discrimination.get(r.id) ?? null;
      const cal = calibration.get(r.id) ?? null;
      const calResponses = responseCounts.get(r.id) ?? 0;

      const examIds = examIdsByItem.get(r.id) ?? [];

      return {
        id: r.id,
        // The bank is addressed by code, not by topic name: a topic repeats
        // across dozens of questions, the code is the one label that names
        // exactly this question.
        code: itemCode(r.id, r.taskNumber),
        task_number: r.taskNumber,
        topic: r.topic,
        source_ref: r.sourceRef,
        correct_option: r.correctOption,
        grading_mode: r.gradingMode,
        is_closed: closed,
        max_points: maxPoints,
        used_in_variants: examIds.length,
        exam_ids: examIds,
        responses: closed ? r.responses : r.pointsGraded,
        // Share correct (closed) or share of maximum awarded (open). null
        // until anyone has actually been graded on it.
        p_value: closed ? pValue : avgShare,
        most_chosen: top?.option ?? null,
        // How much better the strong half does than the weak half. null
        // until some variant has enough graded attempts to rank within.
        discrimination: d,
        discrimination_band: d === null ? null : discriminationBand(d),
        // Rasch difficulty in logits — the one figure comparable ACROSS
        // variants, unlike p_value and discrimination above. Absent, never
        // approximate, until the item has enough responses to place.
        difficulty: cal?.difficulty ?? null,
        difficulty_se: cal?.standard_error ?? null,
        infit: cal?.infit ?? null,
        outfit: cal?.outfit ?? null,
        fit_band: cal ? fitBand(cal.outfit) : null,
        calibration_state: calibrationState(calResponses),
        calibration_responses: calResponses,
        calibration_responses_needed: MIN_RESPONSES_PROVISIONAL,
        // Deliberately conservative: a handful of responses is noise, and a
        // flag a teacher learns to ignore is worse than no flag.
        suspect_key:
          closed &&
          r.responses >= 8 &&
          top !== undefined &&
          top.option !== r.correctOption &&
          top.n / r.responses >= 0.5,
      };
    });
  });


  /**
   * Full card for one question: identity, content, who wrote it, and every
   * statistic the stored answers support — including how each option
   * performed, which is where most of the diagnostic value sits. A bare
   * "45% correct" says the question is hard; the per-option split says
   * *why*, and often that the key is on the wrong letter.
   */
  app.get("/cert-items/:id/card", async (request) => {
    const auth = requireAuth(request);
    const itemId = Number((request.params as { id: string }).id);

    const [item] = await db.select().from(certItems).where(eq(certItems.id, itemId)).limit(1);
    if (!item || item.teacherId !== auth.teacherId) throw NotFound("Item not found");

    const [author] = item.createdBy
      ? await db
          .select({ name: staffUsers.displayName })
          .from(staffUsers)
          .where(eq(staffUsers.id, item.createdBy))
          .limit(1)
      : [undefined];

    // Every graded answer to this question, with the attempt it came from.
    const answers = await db
      .select({
        attemptId: certExamAnswers.attemptId,
        examId: certExamAttempts.examId,
        autoScore: certExamAttempts.autoScore,
        chosen: certExamAnswers.chosenOption,
        isCorrect: certExamAnswers.isCorrect,
        awarded: certExamAnswers.awardedPoints,
        answeredAt: certExamAnswers.updatedAt,
      })
      .from(certExamAnswers)
      .innerJoin(certExamAttempts, eq(certExamAttempts.id, certExamAnswers.attemptId))
      .where(
        and(
          eq(certExamAnswers.itemId, itemId),
          sql`${certExamAttempts.status} IN ('submitted','reviewed')`,
        ),
      );

    const answerKey = isClosedTask(item.taskNumber)
      ? []
      : await db
          .select()
          .from(certItemAnswerKeys)
          .where(eq(certItemAnswerKeys.itemId, itemId))
          .orderBy(certItemAnswerKeys.partIndex);

    const closed = isClosedTask(item.taskNumber);
    const graded = answers.filter((a) => (closed ? a.isCorrect !== null : a.awarded !== null));
    const correct = graded.filter((a) =>
      closed ? a.isCorrect === true : (a.awarded ?? 0) >= 1,
    ).length;

    // Rank within each variant, never across: totals from different variants
    // sit on different scales until anchors link them.
    const byExam = new Map<number, typeof graded>();
    for (const a of graded) {
      const list = byExam.get(a.examId) ?? [];
      list.push(a);
      byExam.set(a.examId, list);
    }
    const strongAttempts = new Set<number>();
    const weakAttempts = new Set<number>();
    for (const list of byExam.values()) {
      if (list.length < MIN_ATTEMPTS_FOR_DISCRIMINATION) continue;
      const sorted = [...list].sort((x, y) => (y.autoScore ?? 0) - (x.autoScore ?? 0));
      const g = Math.max(1, Math.round(sorted.length * DISCRIMINATION_GROUP_SHARE));
      sorted.slice(0, g).forEach((a) => strongAttempts.add(a.attemptId));
      sorted.slice(-g).forEach((a) => weakAttempts.add(a.attemptId));
    }

    // Per-option breakdown. A distractor that only the weak pick is doing its
    // job; one that the strong pick more than the key is a warning sign.
    const optionRows = optionsFor(item.taskNumber).map((opt) => {
      const picked = graded.filter((a) => a.chosen === opt);
      const strong = [...strongAttempts].filter((id) =>
        graded.some((a) => a.attemptId === id && a.chosen === opt),
      ).length;
      const weak = [...weakAttempts].filter((id) =>
        graded.some((a) => a.attemptId === id && a.chosen === opt),
      ).length;
      const share = graded.length > 0 ? picked.length / graded.length : 0;
      return {
        option: opt,
        is_key: opt === item.correctOption,
        count: picked.length,
        share,
        strong_count: strong,
        weak_count: weak,
        // Nobody picks it, so the question is really a 3-choice one and a
        // lucky guess pays better than the format intends.
        dead: !!(graded.length >= 10 && opt !== item.correctOption && share < DEAD_DISTRACTOR_SHARE),
      };
    });

    const blank = graded.filter((a) => closed && a.chosen === null).length;
    const pValue = graded.length > 0 ? correct / graded.length : null;
    const discrimination = (await discriminationByItem(auth.teacherId)).get(itemId) ?? null;

    // Which variants it has appeared in, and how it behaved in each. A large
    // jump between administrations usually means the group improved — or
    // that the variant leaked.
    const usageRows = await db
      .select({
        examId: certExams.id,
        title: certExams.title,
        publishedAt: certExams.publishedAt,
        deadlineAt: certExams.deadlineAt,
      })
      .from(certExamItems)
      .innerJoin(certExams, eq(certExams.id, certExamItems.examId))
      .where(eq(certExamItems.itemId, itemId))
      .orderBy(certExams.createdAt);

    const usage = usageRows.map((u) => {
      const list = byExam.get(u.examId) ?? [];
      const ok = list.filter((a) => (closed ? a.isCorrect === true : (a.awarded ?? 0) >= 1)).length;
      return {
        exam_id: u.examId,
        exam_title: u.title,
        published_at: u.publishedAt,
        deadline_at: u.deadlineAt,
        responses: list.length,
        p_value: list.length > 0 ? ok / list.length : null,
      };
    });

    const flags: string[] = [];
    const top = [...optionRows].sort((a, b) => b.count - a.count)[0];
    if (closed && graded.length >= 8 && top && !top.is_key && top.share >= 0.5) {
      flags.push("suspect_key");
    }
    if (discrimination !== null && discrimination < 0) flags.push("negative_discrimination");
    if (pValue !== null && graded.length >= 10 && pValue > 0.85) flags.push("too_easy");
    if (pValue !== null && graded.length >= 10 && pValue < 0.3) flags.push("too_hard");
    if (optionRows.some((o) => o.dead)) flags.push("dead_distractor");
    if (item.keyRevisedAt && graded.some((a) => a.answeredAt < item.keyRevisedAt!)) {
      flags.push("key_revised_mid_flight");
    }

    const calibration = (await latestCalibrationByItem(auth.teacherId)).get(item.id) ?? null;
    const calibrationResponses = (await responseCountByItem(auth.teacherId)).get(item.id) ?? 0;

    return {
      id: item.id,
      code: itemCode(item.id, item.taskNumber),
      task_number: item.taskNumber,
      task_type: taskTypeFor(item.taskNumber),
      topic: item.topic,
      cognitive_level: item.cognitiveLevel,
      source_ref: item.sourceRef,
      author: item.author,
      stem_text: item.stemText,
      notes: item.notes,
      status: item.status,
      correct_option: item.correctOption,
      options: optionsFor(item.taskNumber),
      is_closed: closed,
      max_points: maxPointsFor(item.taskNumber),
      grading_mode: item.gradingMode,
      max_parts: maxPartsFor(item.taskNumber),
      answer_key: answerKey.map((k) => k.accepted),
      // Баллы по частям не хранятся, а считаются: показываем, как они лягут.
      part_points: splitPoints(maxPointsFor(item.taskNumber), answerKey.length),
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      key_revised_at: item.keyRevisedAt,
      entered_by: author?.name ?? null,
      stats: {
        responses: graded.length,
        correct,
        blank,
        p_value: pValue,
        discrimination,
        discrimination_band: discrimination === null ? null : discriminationBand(discrimination),
        min_responses_for_verdict: MIN_ATTEMPTS_FOR_DISCRIMINATION,
        // Rasch placement. Unlike p_value and discrimination above, this is
        // comparable with items from other variants — that is what the whole
        // calibration exists for.
        difficulty: calibration?.difficulty ?? null,
        difficulty_se: calibration?.standard_error ?? null,
        // Только у 41–43: ступени частично-кредитной модели. Трудность у них
        // — среднее этих порогов, и без самих порогов она мало что говорит.
        thresholds: calibration?.thresholds ?? null,
        infit: calibration?.infit ?? null,
        outfit: calibration?.outfit ?? null,
        fit_band: calibration ? fitBand(calibration.outfit) : null,
        calibration_state: calibrationState(calibrationResponses),
        calibration_responses: calibrationResponses,
        calibration_responses_needed: MIN_RESPONSES_PROVISIONAL,
        options: optionRows,
      },
      usage,
      flags,
    };
  });

  app.patch("/cert-items/:id", async (request) => {
    const auth = requireTeacher(request);
    const itemId = Number((request.params as { id: string }).id);

    const [item] = await db.select().from(certItems).where(eq(certItems.id, itemId)).limit(1);
    if (!item || item.teacherId !== auth.teacherId) throw NotFound("Item not found");

    const body = updateItemSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const wantsTypedFields =
      body.data.grading_mode !== undefined || body.data.answer_key !== undefined;
    if (wantsTypedFields && isClosedTask(item.taskNumber)) {
      throw Unprocessable("Режим проверки и ключ с клавиатуры есть только у заданий 36–43");
    }
    if (body.data.answer_key && body.data.answer_key.length > maxPartsFor(item.taskNumber)) {
      throw Unprocessable(
        `Задание ${item.taskNumber} допускает не больше ${maxPartsFor(item.taskNumber)} частей ответа`,
      );
    }

    if (body.data.correct_option !== undefined) {
      if (!isClosedTask(item.taskNumber)) {
        throw Unprocessable("Open tasks have no answer key");
      }
      const allowed = optionsFor(item.taskNumber);
      if (!allowed.includes(body.data.correct_option.toUpperCase())) {
        throw Unprocessable(`Task ${item.taskNumber} accepts ${allowed.join("/")}`);
      }
    }

    // Correcting a key after students have answered means the statistics
    // straddle two different definitions of "correct". Record when it
    // happened so the card can say so instead of quietly averaging.
    const keyChanged =
      body.data.correct_option !== undefined &&
      body.data.correct_option.toUpperCase() !== item.correctOption;
    let hadAnswers = false;
    if (keyChanged) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(certExamAnswers)
        .where(
          and(eq(certExamAnswers.itemId, itemId), sql`${certExamAnswers.isCorrect} IS NOT NULL`),
        );
      hadAnswers = (row?.n ?? 0) > 0;
    }

    // Автоматическая проверка без ключа означала бы ноль баллов всем.
    const existingKey = await db
      .select()
      .from(certItemAnswerKeys)
      .where(eq(certItemAnswerKeys.itemId, itemId))
      .orderBy(certItemAnswerKeys.partIndex);
    const finalMode = body.data.grading_mode ?? item.gradingMode;
    const finalKeyLength =
      body.data.answer_key === undefined
        ? existingKey.length
        : (body.data.answer_key?.length ?? 0);
    if (finalMode === "typed" && finalKeyLength === 0) {
      throw Unprocessable("Для проверки с клавиатуры нужен ключ хотя бы из одной части");
    }

    // Правка ключа после того, как по заданию уже отвечали, разводит
    // статистику на две несравнимые половины — тот же случай, что и с
    // буквой у закрытых заданий.
    const typedKeyChanged =
      body.data.answer_key !== undefined &&
      JSON.stringify(body.data.answer_key ?? []) !==
        JSON.stringify(existingKey.map((k) => k.accepted));
    let typedHadAnswers = false;
    if (typedKeyChanged) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(certExamAnswers)
        .where(
          and(eq(certExamAnswers.itemId, itemId), sql`${certExamAnswers.partCorrect} IS NOT NULL`),
        );
      typedHadAnswers = (row?.n ?? 0) > 0;
    }

    if (body.data.answer_key !== undefined) {
      await db.transaction(async (tx) => {
        await tx.delete(certItemAnswerKeys).where(eq(certItemAnswerKeys.itemId, itemId));
        for (const [i, accepted] of (body.data.answer_key ?? []).entries()) {
          await tx.insert(certItemAnswerKeys).values({
            itemId,
            partIndex: i + 1,
            accepted,
          });
        }
      });
    }

    const [updated] = await db
      .update(certItems)
      .set({
        ...(body.data.correct_option !== undefined
          ? { correctOption: body.data.correct_option.toUpperCase() }
          : {}),
        ...(body.data.source_ref !== undefined ? { sourceRef: body.data.source_ref } : {}),
        ...(body.data.topic !== undefined ? { topic: body.data.topic } : {}),
        ...(body.data.stem_text !== undefined ? { stemText: body.data.stem_text } : {}),
        ...(body.data.author !== undefined ? { author: body.data.author } : {}),
        ...(body.data.cognitive_level !== undefined
          ? { cognitiveLevel: body.data.cognitive_level }
          : {}),
        ...(body.data.status !== undefined ? { status: body.data.status } : {}),
        ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
        ...(body.data.grading_mode !== undefined ? { gradingMode: body.data.grading_mode } : {}),
        ...((keyChanged && hadAnswers) || (typedKeyChanged && typedHadAnswers)
          ? { keyRevisedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(certItems.id, itemId))
      .returning();

    return {
      id: updated.id,
      task_number: updated.taskNumber,
      correct_option: updated.correctOption,
      source_ref: updated.sourceRef,
      topic: updated.topic,
      stem_text: updated.stemText,
      author: updated.author,
      cognitive_level: updated.cognitiveLevel,
      status: updated.status,
      notes: updated.notes,
      key_revised_at: updated.keyRevisedAt,
    };
  });

  app.get("/courses/:courseId/cert-exams", async (request) => {
    const auth = requireAuth(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    const rows = await db
      .select()
      .from(certExams)
      .where(eq(certExams.courseId, courseId))
      .orderBy(sql`${certExams.createdAt} DESC`);
    return Promise.all(rows.map(describeExam));
  });

  app.post("/courses/:courseId/cert-exams", async (request, reply) => {
    const auth = requireTeacher(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    const body = createSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [exam] = await db
      .insert(certExams)
      .values({
        courseId,
        teacherId: auth.teacherId,
        title: body.data.title,
        deadlineAt: body.data.deadline_at,
      })
      .returning();

    reply.code(201).send(await describeExam(exam));
  });

  app.get("/cert-exams/:id", async (request) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    return describeExam(exam);
  });

  app.patch("/cert-exams/:id", async (request) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    const body = updateSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [updated] = await db
      .update(certExams)
      .set({
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.deadline_at !== undefined ? { deadlineAt: body.data.deadline_at } : {}),
        updatedAt: new Date(),
      })
      .where(eq(certExams.id, exam.id))
      .returning();
    return describeExam(updated);
  });

  app.delete("/cert-exams/:id", async (request, reply) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    // Attempts reference the exam with ON DELETE RESTRICT; refusing here
    // gives a clearer message than the generic 409 from the FK violation.
    const [attempt] = await db
      .select({ id: certExamAttempts.id })
      .from(certExamAttempts)
      .where(eq(certExamAttempts.examId, exam.id))
      .limit(1);
    if (attempt) throw Conflict("Students have already started this variant");

    // Items themselves stay in the bank — they may be used by other
    // variants, and their history is the point of having a bank at all.
    await db.delete(certExamItems).where(eq(certExamItems.examId, exam.id));
    await db.delete(certExams).where(eq(certExams.id, exam.id));
    reply.code(204).send();
  });

  // --- answer key -----------------------------------------------------

  app.get("/cert-exams/:id/answer-key", async (request) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    const rows = await db
      .select({
        taskNumber: certExamItems.taskNumber,
        option: certItems.correctOption,
        sourceRef: certItems.sourceRef,
        topic: certItems.topic,
      })
      .from(certExamItems)
      .innerJoin(certItems, eq(certItems.id, certExamItems.itemId))
      .where(eq(certExamItems.examId, exam.id))
      .orderBy(certExamItems.taskNumber);
    return rows
      .filter((r) => r.option !== null)
      .map((r) => ({
        task_number: r.taskNumber,
        correct_option: r.option,
        source_ref: r.sourceRef,
        topic: r.topic,
      }));
  });

  app.put("/cert-exams/:id/answer-key", async (request) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    const body = answerKeySchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    // Validate letters against the per-task option set before touching the
    // DB, so one bad letter doesn't leave a half-written key behind.
    for (const a of body.data.answers) {
      const allowed = optionsFor(a.task_number);
      if (!allowed.includes(a.correct_option.toUpperCase())) {
        throw Unprocessable(
          `Task ${a.task_number} accepts ${allowed.join("/")}, got "${a.correct_option}"`,
        );
      }
    }

    const seen = new Set(body.data.answers.map((a) => a.task_number));
    if (seen.size !== body.data.answers.length) {
      throw Unprocessable("Duplicate task numbers in the key");
    }

    await db.transaction(async (tx) => {
      for (const a of body.data.answers) {
        const option = a.correct_option.toUpperCase();
        let itemId: number | null = null;

        // A cited source is the question's identity: reuse the existing bank
        // item so its response history keeps growing, and correct its key if
        // the teacher fixed a typo.
        if (a.source_ref) {
          const [existing] = await tx
            .select()
            .from(certItems)
            .where(
              and(eq(certItems.teacherId, auth.teacherId), eq(certItems.sourceRef, a.source_ref)),
            )
            .limit(1);
          if (existing) {
            itemId = existing.id;
            if (existing.correctOption !== option) {
              await tx
                .update(certItems)
                .set({ correctOption: option, updatedAt: new Date() })
                .where(eq(certItems.id, existing.id));
            }
          }
        }

        // Otherwise reuse the item already bound to this slot of this exam,
        // so re-saving the key edits the question instead of orphaning it.
        if (itemId === null) {
          const [bound] = await tx
            .select({ itemId: certExamItems.itemId })
            .from(certExamItems)
            .where(
              and(
                eq(certExamItems.examId, exam.id),
                eq(certExamItems.taskNumber, a.task_number),
              ),
            )
            .limit(1);
          if (bound) {
            itemId = bound.itemId;
            await tx
              .update(certItems)
              .set({
                correctOption: option,
                ...(a.source_ref ? { sourceRef: a.source_ref } : {}),
                updatedAt: new Date(),
              })
              .where(eq(certItems.id, bound.itemId));
          }
        }

        if (itemId === null) {
          const [created] = await tx
            .insert(certItems)
            .values({
              teacherId: auth.teacherId,
              taskNumber: a.task_number,
              correctOption: option,
              topic: topicFor(a.task_number),
              sourceRef: a.source_ref ?? null,
              createdBy: auth.staffId,
            })
            .returning();
          itemId = created.id;
        }

        await tx
          .insert(certExamItems)
          .values({ examId: exam.id, taskNumber: a.task_number, itemId })
          .onConflictDoUpdate({
            target: [certExamItems.examId, certExamItems.taskNumber],
            set: { itemId },
          });
      }

      // Open tasks have no key but still need bank items, otherwise their
      // photo answers would have nothing to accumulate statistics against.
      for (const n of PHOTO_TASK_NUMBERS) {
        const [bound] = await tx
          .select({ itemId: certExamItems.itemId })
          .from(certExamItems)
          .where(and(eq(certExamItems.examId, exam.id), eq(certExamItems.taskNumber, n)))
          .limit(1);
        if (bound) continue;
        const [created] = await tx
          .insert(certItems)
          .values({
            teacherId: auth.teacherId,
            taskNumber: n,
            correctOption: null,
            topic: topicFor(n),
            createdBy: auth.staffId,
          })
          .returning();
        await tx
          .insert(certExamItems)
          .values({ examId: exam.id, taskNumber: n, itemId: created.id });
      }
    });

    return describeExam(exam);
  });


  /**
   * Questions from this course's other variants, offered as anchors.
   *
   * Sorted by how hard they turned out to be, because a good anchor set
   * spans the difficulty range rather than clustering — picking eight easy
   * questions links the scales badly. Only tasks 1–35 are listed: an anchor
   * has to carry a known key over to the new variant, and open tasks have
   * none.
   */
  app.get("/cert-exams/:id/anchor-candidates", async (request) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    const rows = await db
      .select({
        id: certItems.id,
        taskNumber: certItems.taskNumber,
        correctOption: certItems.correctOption,
        topic: certItems.topic,
        sourceRef: certItems.sourceRef,
        responses: sql<number>`count(${certExamAnswers.isCorrect})::int`,
        correct: sql<number>`count(*) FILTER (WHERE ${certExamAnswers.isCorrect})::int`,
        alreadyHere: sql<number>`(
          SELECT count(*)::int FROM cert_exam_items ei
          WHERE ei.item_id = ${certItems.id} AND ei.exam_id = ${exam.id}
        )`,
      })
      .from(certItems)
      .innerJoin(certExamItems, eq(certExamItems.itemId, certItems.id))
      .innerJoin(certExams, eq(certExams.id, certExamItems.examId))
      .leftJoin(certExamAnswers, eq(certExamAnswers.itemId, certItems.id))
      .where(
        and(
          eq(certItems.teacherId, auth.teacherId),
          eq(certExams.courseId, exam.courseId),
          sql`${certExams.id} <> ${exam.id}`,
          sql`${certItems.correctOption} IS NOT NULL`,
        ),
      )
      .groupBy(certItems.id)
      .orderBy(certItems.taskNumber);

    return rows.map((r) => ({
      id: r.id,
      task_number: r.taskNumber,
      correct_option: r.correctOption,
      topic: r.topic,
      // Without a citation the question cannot be carried into a new
      // variant as the same item, so the UI prompts for one first.
      source_ref: r.sourceRef,
      responses: r.responses,
      p_value: r.responses > 0 ? r.correct / r.responses : null,
      already_in_this_exam: r.alreadyHere > 0,
    }));
  });

  // --- variant file & publishing --------------------------------------

  app.post("/cert-exams/:id/variant-file/attach-start", async (request) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    const deepLink = await createPendingActionDeepLink({
      actionType: "attach_cert_variant",
      targetCertExamId: exam.id,
    });
    return { deep_link: deepLink };
  });

  app.get("/cert-exams/:id/variant-file/raw", async (request, reply) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    if (!exam.variantFileId) throw NotFound("No variant file attached");

    const file = await fetchTelegramFile(exam.variantFileId);
    reply.header("Content-Type", file.contentType).send(file.buffer);
  });

  app.post("/cert-exams/:id/publish", async (request) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    // Publishing an incomplete variant would show students tasks nobody can
    // grade, so both preconditions are enforced here rather than in the UI.
    if (!exam.variantFileId) throw Conflict("Attach the variant file first");
    const keyCount = await keyCountFor(exam.id);
    if (keyCount < KEY_TASK_NUMBERS.length) {
      throw Conflict(`Answer key incomplete: ${keyCount}/${KEY_TASK_NUMBERS.length}`);
    }

    const [updated] = await db
      .update(certExams)
      .set({ publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(certExams.id, exam.id))
      .returning();
    return describeExam(updated);
  });

  app.post("/cert-exams/:id/unpublish", async (request) => {
    const auth = requireTeacher(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    const [updated] = await db
      .update(certExams)
      .set({ publishedAt: null, updatedAt: new Date() })
      .where(eq(certExams.id, exam.id))
      .returning();
    return describeExam(updated);
  });

  // --- attempts & review ----------------------------------------------

  app.get("/cert-exams/:id/attempts", async (request) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));

    const rows = await db
      .select({
        id: certExamAttempts.id,
        studentId: certExamAttempts.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        attemptNumber: certExamAttempts.attemptNumber,
        status: certExamAttempts.status,
        submittedAt: certExamAttempts.submittedAt,
        isLate: certExamAttempts.isLate,
        autoScore: certExamAttempts.autoScore,
        manualScore: certExamAttempts.manualScore,
        totalScore: certExamAttempts.totalScore,
      })
      .from(certExamAttempts)
      .innerJoin(students, eq(students.id, certExamAttempts.studentId))
      .where(eq(certExamAttempts.examId, exam.id))
      .orderBy(sql`${certExamAttempts.submittedAt} DESC NULLS LAST`);

    // Половины считает база одним запросом на весь список: то же деление, что
    // в splitHalves(), но тянуть ради него все ответы всех попыток незачем.
    const halves = await db
      .select({
        attemptId: certExamAnswers.attemptId,
        testCorrect: sql<number>`(
          count(*) FILTER (WHERE ${certExamAnswers.taskNumber} <= 35 AND ${certExamAnswers.isCorrect})
          + count(*) FILTER (WHERE ${certExamAnswers.taskNumber} BETWEEN 36 AND 40
                             AND coalesce(${certExamAnswers.awardedPoints}, 0) > 0)
        )::int`,
        writtenPoints: sql<number>`coalesce(
          sum(${certExamAnswers.awardedPoints}) FILTER (WHERE ${certExamAnswers.taskNumber} >= 41), 0
        )::int`,
      })
      .from(certExamAnswers)
      .innerJoin(certExamAttempts, eq(certExamAttempts.id, certExamAnswers.attemptId))
      .where(eq(certExamAttempts.examId, exam.id))
      .groupBy(certExamAnswers.attemptId);
    const halvesByAttempt = new Map(halves.map((h) => [h.attemptId, h]));

    const context = await loadEquatingContext(auth.teacherId);

    return rows.map((r) => {
      const h = halvesByAttempt.get(r.id);
      // Обе оценки только у проверенных работ: пока письменная часть не
      // оценена, итог был бы посчитан по половине работы.
      const scored = r.status === "reviewed" && h !== undefined ? h : null;
      const equated = scored
        ? equatedEstimate({
            context,
            examId: exam.id,
            testCorrect: scored.testCorrect,
            writtenPoints: scored.writtenPoints,
          })
        : null;

      return {
        id: r.id,
        student_id: r.studentId,
        student_name: [r.firstName, r.lastName].filter(Boolean).join(" "),
        attempt_number: r.attemptNumber,
        status: r.status,
        submitted_at: r.submittedAt,
        is_late: r.isLate,
        auto_score: r.autoScore,
        manual_score: r.manualScore,
        total_score: r.totalScore,
        cert_total: scored ? estimateCertScore(scored).total : null,
        equated_total: equated?.estimate?.total ?? null,
        equated_status: equated?.status ?? null,
      };
    });
  });

  /** Queue across all accessible courses — the teacher's "what's waiting" view. */
  app.get("/cert-exam-review-queue", async (request) => {
    const auth = requireAuth(request);
    const courseIds = await accessibleCourseIds(auth, "canReviewHomework");

    const conditions = [eq(certExamAttempts.status, "submitted" as const)];
    if (courseIds === null) {
      conditions.push(eq(certExamAttempts.teacherId, auth.teacherId));
    } else {
      if (courseIds.length === 0) return [];
      conditions.push(inArray(certExams.courseId, courseIds));
    }

    const rows = await db
      .select({
        id: certExamAttempts.id,
        examId: certExams.id,
        examTitle: certExams.title,
        courseId: certExams.courseId,
        studentId: certExamAttempts.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        attemptNumber: certExamAttempts.attemptNumber,
        submittedAt: certExamAttempts.submittedAt,
        isLate: certExamAttempts.isLate,
        autoScore: certExamAttempts.autoScore,
      })
      .from(certExamAttempts)
      .innerJoin(certExams, eq(certExams.id, certExamAttempts.examId))
      .innerJoin(students, eq(students.id, certExamAttempts.studentId))
      .where(and(...conditions))
      .orderBy(certExamAttempts.submittedAt);

    return rows.map((r) => ({
      id: r.id,
      exam_id: r.examId,
      exam_title: r.examTitle,
      course_id: r.courseId,
      student_id: r.studentId,
      student_name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      attempt_number: r.attemptNumber,
      submitted_at: r.submittedAt,
      is_late: r.isLate,
      auto_score: r.autoScore,
    }));
  });

  app.get("/cert-exam-attempts/:id", async (request) => {
    const auth = requireAuth(request);
    const attemptId = Number((request.params as { id: string }).id);

    const [attempt] = await db
      .select()
      .from(certExamAttempts)
      .where(eq(certExamAttempts.id, attemptId))
      .limit(1);
    if (!attempt || attempt.teacherId !== auth.teacherId) throw NotFound("Attempt not found");
    const exam = await loadAccessibleExam(auth, attempt.examId);

    const answers = await db
      .select()
      .from(certExamAnswers)
      .where(eq(certExamAnswers.attemptId, attemptId))
      .orderBy(certExamAnswers.taskNumber);
    const keyByTask = await keyMapFor(exam.id);
    const answerByTask = new Map(answers.map((a) => [a.taskNumber, a]));

    const halves = splitHalves(answers);
    const reviewed = attempt.status === "reviewed";
    const equated = reviewed
      ? equatedEstimate({
          context: await loadEquatingContext(auth.teacherId),
          examId: exam.id,
          testCorrect: halves.testCorrect,
          writtenPoints: halves.writtenPoints,
        })
      : null;

    return {
      id: attempt.id,
      exam_id: exam.id,
      exam_title: exam.title,
      student_id: attempt.studentId,
      attempt_number: attempt.attemptNumber,
      status: attempt.status,
      submitted_at: attempt.submittedAt,
      is_late: attempt.isLate,
      auto_score: attempt.autoScore,
      manual_score: attempt.manualScore,
      total_score: attempt.totalScore,
      total_max_points: TOTAL_MAX_POINTS,
      cert_estimate: reviewed ? estimateCertScore(halves) : null,
      test_correct: reviewed ? halves.testCorrect : null,
      test_half_task_count: TEST_HALF_TASK_COUNT,
      equated,
      review_comment_text: attempt.reviewCommentText,
      tasks: Array.from({ length: 43 }, (_, i) => i + 1).map((n) => {
        const a = answerByTask.get(n);
        return {
          task_number: n,
          is_closed: isClosedTask(n),
          max_points: maxPointsFor(n),
          chosen_option: a?.chosenOption ?? null,
          typed_answers: a?.typedAnswers ?? null,
          part_correct: a?.partCorrect ?? null,
          correct_option: isClosedTask(n) ? (keyByTask.get(n) ?? null) : null,
          is_correct: a?.isCorrect ?? null,
          photo_count: a?.photoFileIds?.length ?? 0,
          awarded_points: a?.awardedPoints ?? null,
        };
      }),
    };
  });

  app.get("/cert-exam-attempts/:id/tasks/:task/photos/:index/raw", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string; task: string; index: string };
    const attemptId = Number(params.id);
    const taskNumber = Number(params.task);
    const index = Number(params.index);

    const [attempt] = await db
      .select()
      .from(certExamAttempts)
      .where(eq(certExamAttempts.id, attemptId))
      .limit(1);
    if (!attempt || attempt.teacherId !== auth.teacherId) throw NotFound("Attempt not found");
    await loadAccessibleExam(auth, attempt.examId);

    const [answer] = await db
      .select()
      .from(certExamAnswers)
      .where(
        and(eq(certExamAnswers.attemptId, attemptId), eq(certExamAnswers.taskNumber, taskNumber)),
      )
      .limit(1);
    const fileId = answer?.photoFileIds?.[index];
    if (!fileId) throw NotFound("Photo not found");

    const file = await fetchTelegramFile(fileId);
    reply.header("Content-Type", file.contentType).send(file.buffer);
  });

  app.post("/cert-exam-attempts/:id/review", async (request) => {
    const auth = requireAuth(request);
    const attemptId = Number((request.params as { id: string }).id);

    const [attempt] = await db
      .select()
      .from(certExamAttempts)
      .where(eq(certExamAttempts.id, attemptId))
      .limit(1);
    if (!attempt || attempt.teacherId !== auth.teacherId) throw NotFound("Attempt not found");
    await loadAccessibleExam(auth, attempt.examId);

    if (attempt.status === "in_progress") throw Conflict("Attempt not submitted yet");

    const body = reviewSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    // A teacher can't award more than the spec allows for a task — 41 is
    // worth 30, 42 worth 35, 43 worth 10, everything open before that 1.
    for (const p of body.data.points) {
      const max = maxPointsFor(p.task_number);
      if (p.awarded_points > max) {
        throw Unprocessable(`Task ${p.task_number} allows at most ${max} points`);
      }
    }

    await db.transaction(async (tx) => {
      for (const p of body.data.points) {
        await tx
          .insert(certExamAnswers)
          .values({
            attemptId,
            taskNumber: p.task_number,
            awardedPoints: p.awarded_points,
          })
          .onConflictDoUpdate({
            target: [certExamAnswers.attemptId, certExamAnswers.taskNumber],
            set: { awardedPoints: p.awarded_points, updatedAt: new Date() },
          });
      }

      const [sums] = await tx
        .select({ manual: sql<number>`coalesce(sum(${certExamAnswers.awardedPoints}), 0)::int` })
        .from(certExamAnswers)
        .where(
          and(
            eq(certExamAnswers.attemptId, attemptId),
            sql`${certExamAnswers.taskNumber} > 35`,
          ),
        );
      const manual = sums?.manual ?? 0;
      const auto = attempt.autoScore ?? 0;

      await tx
        .update(certExamAttempts)
        .set({
          status: "reviewed",
          manualScore: manual,
          totalScore: auto + manual,
          reviewedBy: auth.staffId,
          reviewedAt: new Date(),
          reviewCommentText: body.data.comment_text ?? null,
        })
        .where(eq(certExamAttempts.id, attemptId));
    });

    // Re-read the graded answers to report where the attempt lands on the
    // certificate scale — the stored manualScore lumps 36–43 together, while
    // the certificate splits the halves between 40 and 41.
    const gradedAnswers = await db
      .select()
      .from(certExamAnswers)
      .where(eq(certExamAnswers.attemptId, attemptId));

    const [updated] = await db
      .select()
      .from(certExamAttempts)
      .where(eq(certExamAttempts.id, attemptId))
      .limit(1);
    return {
      id: updated.id,
      status: updated.status,
      auto_score: updated.autoScore,
      manual_score: updated.manualScore,
      total_score: updated.totalScore,
      total_max_points: TOTAL_MAX_POINTS,
      cert_estimate: estimateCertScore(splitHalves(gradedAnswers)),
    };
  });
};

export default certExamRoutes;
