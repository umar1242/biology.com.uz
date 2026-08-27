import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  certExamAnswerKeys,
  certExamAnswers,
  certExamAttempts,
  certExams,
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
      }),
    )
    .min(1),
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
    .from(certExamAnswerKeys)
    .where(eq(certExamAnswerKeys.examId, examId));
  return row?.n ?? 0;
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

    await db.delete(certExamAnswerKeys).where(eq(certExamAnswerKeys.examId, exam.id));
    await db.delete(certExams).where(eq(certExams.id, exam.id));
    reply.code(204).send();
  });

  // --- answer key -----------------------------------------------------

  app.get("/cert-exams/:id/answer-key", async (request) => {
    const auth = requireAuth(request);
    const exam = await loadAccessibleExam(auth, Number((request.params as { id: string }).id));
    const rows = await db
      .select()
      .from(certExamAnswerKeys)
      .where(eq(certExamAnswerKeys.examId, exam.id))
      .orderBy(certExamAnswerKeys.taskNumber);
    return rows.map((r) => ({ task_number: r.taskNumber, correct_option: r.correctOption }));
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
      await tx
        .delete(certExamAnswerKeys)
        .where(
          and(
            eq(certExamAnswerKeys.examId, exam.id),
            inArray(certExamAnswerKeys.taskNumber, [...seen]),
          ),
        );
      await tx.insert(certExamAnswerKeys).values(
        body.data.answers.map((a) => ({
          examId: exam.id,
          taskNumber: a.task_number,
          correctOption: a.correct_option.toUpperCase(),
        })),
      );
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
    const key = await db
      .select()
      .from(certExamAnswerKeys)
      .where(eq(certExamAnswerKeys.examId, exam.id));
    const keyByTask = new Map(key.map((k) => [k.taskNumber, k.correctOption]));
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
