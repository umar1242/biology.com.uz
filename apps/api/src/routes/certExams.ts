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
  students,
} from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import { accessibleCourseIds, loadAccessibleCourse } from "../lib/access.js";
import { Conflict, NotFound, Unprocessable } from "../lib/errors.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";
import { fetchTelegramFile } from "../telegram/client.js";
import {
  AUTO_MAX_POINTS,
  KEY_TASK_NUMBERS,
  PHOTO_TASK_NUMBERS,
  TOTAL_MAX_POINTS,
  isClosedTask,
  maxPointsFor,
  optionsFor,
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

/** Shape returned for a single exam, including how ready it is to publish. */
async function describeExam(exam: typeof certExams.$inferSelect) {
  const keyCount = await keyCountFor(exam.id);
  return {
    id: exam.id,
    course_id: exam.courseId,
    title: exam.title,
    deadline_at: exam.deadlineAt,
    has_variant_file: exam.variantFileId !== null,
    variant_file_name: exam.variantFileName,
    key_filled: keyCount,
    key_required: KEY_TASK_NUMBERS.length,
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


  // --- item bank -------------------------------------------------------

  /**
   * The teacher's question bank with accumulated response statistics.
   *
   * Everything here is computed live: at 100–150 students the numbers are a
   * single grouped scan, and a cached table would only add a way for the
   * figures to go stale.
   */
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
        usedInVariants: sql<number>`(
          SELECT count(*)::int FROM cert_exam_items ei WHERE ei.item_id = ${certItems.id}
        )`,
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

      return {
        id: r.id,
        task_number: r.taskNumber,
        topic: r.topic,
        source_ref: r.sourceRef,
        correct_option: r.correctOption,
        is_closed: closed,
        max_points: maxPoints,
        used_in_variants: r.usedInVariants,
        responses: closed ? r.responses : r.pointsGraded,
        // Share correct (closed) or share of maximum awarded (open). null
        // until anyone has actually been graded on it.
        p_value: closed ? pValue : avgShare,
        most_chosen: top?.option ?? null,
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

  app.patch("/cert-items/:id", async (request) => {
    const auth = requireTeacher(request);
    const itemId = Number((request.params as { id: string }).id);

    const [item] = await db.select().from(certItems).where(eq(certItems.id, itemId)).limit(1);
    if (!item || item.teacherId !== auth.teacherId) throw NotFound("Item not found");

    const body = updateItemSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    if (body.data.correct_option !== undefined) {
      if (!isClosedTask(item.taskNumber)) {
        throw Unprocessable("Open tasks have no answer key");
      }
      const allowed = optionsFor(item.taskNumber);
      if (!allowed.includes(body.data.correct_option.toUpperCase())) {
        throw Unprocessable(`Task ${item.taskNumber} accepts ${allowed.join("/")}`);
      }
    }

    const [updated] = await db
      .update(certItems)
      .set({
        ...(body.data.correct_option !== undefined
          ? { correctOption: body.data.correct_option.toUpperCase() }
          : {}),
        ...(body.data.source_ref !== undefined ? { sourceRef: body.data.source_ref } : {}),
        ...(body.data.topic !== undefined ? { topic: body.data.topic } : {}),
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
          })
          .returning();
        await tx
          .insert(certExamItems)
          .values({ examId: exam.id, taskNumber: n, itemId: created.id });
      }
    });

    return describeExam(exam);
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

    return rows.map((r) => ({
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
    }));
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
      review_comment_text: attempt.reviewCommentText,
      tasks: Array.from({ length: 43 }, (_, i) => i + 1).map((n) => {
        const a = answerByTask.get(n);
        return {
          task_number: n,
          is_closed: isClosedTask(n),
          max_points: maxPointsFor(n),
          chosen_option: a?.chosenOption ?? null,
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
    };
  });
};

export default certExamRoutes;
