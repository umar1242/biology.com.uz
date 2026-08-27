import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  certExamAnswerKeys,
  certExamAnswers,
  certExamAttempts,
  certExams,
  courseAccess,
  courseBlacklist,
  courses,
} from "../../db/schema.js";
import { requireStudentAuth } from "../../plugins/studentAuth.js";
import { loadStudentAccessibleCourse } from "../../lib/studentAccess.js";
import { createPendingActionDeepLink } from "../../telegram/pendingActions.js";
import { fetchTelegramFile } from "../../telegram/client.js";
import { bot } from "../../telegram/bot.js";
import { students } from "../../db/schema.js";
import { Conflict, NotFound, Unprocessable } from "../../lib/errors.js";
import {
  TOTAL_MAX_POINTS,
  isClosedTask,
  isValidTaskNumber,
  maxPointsFor,
  optionsFor,
} from "../../lib/certExam.js";

const saveAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        task_number: z.number().int().min(1).max(35),
        // null clears a previously picked option (student changed their mind
        // and wants the task blank rather than wrong).
        chosen_option: z.string().min(1).max(1).nullable(),
      }),
    )
    .min(1),
});

/**
 * Loads the student's attempt and proves it is theirs. Deliberately 404 for
 * someone else's attempt — a 403 would confirm the id exists.
 */
async function loadOwnAttempt(studentId: number, attemptId: number) {
  const [attempt] = await db
    .select()
    .from(certExamAttempts)
    .where(eq(certExamAttempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.studentId !== studentId) throw NotFound("Attempt not found");
  return attempt;
}

/** The exam as a student may see it — never includes the answer key. */
function describeForStudent(exam: typeof certExams.$inferSelect, attempt?: { status: string; id: number } | null) {
  return {
    id: exam.id,
    course_id: exam.courseId,
    title: exam.title,
    deadline_at: exam.deadlineAt,
    has_variant_file: exam.variantFileId !== null,
    variant_file_name: exam.variantFileName,
    total_max_points: TOTAL_MAX_POINTS,
    attempt_id: attempt?.id ?? null,
    attempt_status: attempt?.status ?? null,
  };
}

const appCertExamRoutes: FastifyPluginAsync = async (app) => {
  /** Published variants across every course the student still has access to. */
  app.get("/app/cert-exams", async (request) => {
    const auth = requireStudentAuth(request);

    const rows = await db
      .select({
        exam: certExams,
        courseTitle: courses.title,
        blacklisted: courseBlacklist.isBlacklisted,
      })
      .from(certExams)
      .innerJoin(courses, eq(courses.id, certExams.courseId))
      .innerJoin(
        courseAccess,
        and(
          eq(courseAccess.courseId, certExams.courseId),
          eq(courseAccess.studentId, auth.studentId),
          eq(courseAccess.accessGranted, true),
          eq(courseAccess.revoked, false),
        ),
      )
      .leftJoin(
        courseBlacklist,
        and(
          eq(courseBlacklist.courseId, certExams.courseId),
          eq(courseBlacklist.studentId, auth.studentId),
        ),
      )
      .where(isNotNull(certExams.publishedAt))
      .orderBy(sql`${certExams.deadlineAt} ASC`);

    const visible = rows.filter((r) => r.blacklisted !== true);
    if (visible.length === 0) return [];

    const attempts = await db
      .select()
      .from(certExamAttempts)
      .where(eq(certExamAttempts.studentId, auth.studentId));
    const latestByExam = new Map<number, (typeof attempts)[number]>();
    for (const a of attempts) {
      const prev = latestByExam.get(a.examId);
      if (!prev || a.attemptNumber > prev.attemptNumber) latestByExam.set(a.examId, a);
    }

    return visible.map((r) => ({
      ...describeForStudent(r.exam, latestByExam.get(r.exam.id) ?? null),
      course_title: r.courseTitle,
    }));
  });

  app.get("/app/cert-exams/:id", async (request) => {
    const auth = requireStudentAuth(request);
    const examId = Number((request.params as { id: string }).id);

    const [exam] = await db.select().from(certExams).where(eq(certExams.id, examId)).limit(1);
    if (!exam || exam.publishedAt === null) throw NotFound("Exam not found");
    await loadStudentAccessibleCourse(auth.studentId, exam.courseId);

    const attempts = await db
      .select()
      .from(certExamAttempts)
      .where(
        and(eq(certExamAttempts.examId, examId), eq(certExamAttempts.studentId, auth.studentId)),
      )
      .orderBy(sql`${certExamAttempts.attemptNumber} DESC`);

    return {
      ...describeForStudent(exam, attempts[0] ?? null),
      // The task list carries only shape, never the key.
      tasks: Array.from({ length: 43 }, (_, i) => i + 1).map((n) => ({
        task_number: n,
        is_closed: isClosedTask(n),
        options: optionsFor(n),
        max_points: maxPointsFor(n),
      })),
    };
  });

  app.get("/app/cert-exams/:id/variant-file/raw", async (request, reply) => {
    const auth = requireStudentAuth(request);
    const examId = Number((request.params as { id: string }).id);

    const [exam] = await db.select().from(certExams).where(eq(certExams.id, examId)).limit(1);
    if (!exam || exam.publishedAt === null) throw NotFound("Exam not found");
    await loadStudentAccessibleCourse(auth.studentId, exam.courseId);
    if (!exam.variantFileId) throw NotFound("No variant file attached");

    const file = await fetchTelegramFile(exam.variantFileId);
    reply.header("Content-Type", file.contentType).send(file.buffer);
  });


  /**
   * Sends the variant to the student's own Telegram chat.
   *
   * This exists because downloading it in-page does not work inside
   * Telegram: the raw endpoint needs a Bearer token, so it has to be
   * fetched as a blob, and Telegram's WebView refuses to open blob: URLs
   * via window.open — the button simply did nothing on a phone. Pushing the
   * file through the bot is the native path, costs no re-upload (Telegram
   * already holds the file behind its file_id) and leaves the student with
   * the variant in a chat they can reopen later.
   */
  app.post("/app/cert-exams/:id/variant-file/send", async (request) => {
    const auth = requireStudentAuth(request);
    const examId = Number((request.params as { id: string }).id);

    const [exam] = await db.select().from(certExams).where(eq(certExams.id, examId)).limit(1);
    if (!exam || exam.publishedAt === null) throw NotFound("Exam not found");
    await loadStudentAccessibleCourse(auth.studentId, exam.courseId);
    if (!exam.variantFileId) throw NotFound("No variant file attached");

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, auth.studentId))
      .limit(1);
    if (!student) throw NotFound("Student not found");

    const caption = exam.title;
    try {
      // Older variants predate the kind column; a photo id is the safe
      // default there because that was the only path the bot had then.
      if (exam.variantFileKind === "document") {
        await bot.api.sendDocument(Number(student.telegramId), exam.variantFileId, { caption });
      } else {
        await bot.api.sendPhoto(Number(student.telegramId), exam.variantFileId, { caption });
      }
    } catch (err) {
      request.log.error({ err, examId }, "Failed to send variant file to student");
      throw Conflict("Could not send the file. Open the bot chat and press Start, then retry.");
    }

    return { sent: true };
  });

  app.post("/app/cert-exams/:id/start", async (request, reply) => {
    const auth = requireStudentAuth(request);
    const examId = Number((request.params as { id: string }).id);

    const [exam] = await db.select().from(certExams).where(eq(certExams.id, examId)).limit(1);
    if (!exam || exam.publishedAt === null) throw NotFound("Exam not found");
    await loadStudentAccessibleCourse(auth.studentId, exam.courseId);

    const existing = await db
      .select()
      .from(certExamAttempts)
      .where(
        and(eq(certExamAttempts.examId, examId), eq(certExamAttempts.studentId, auth.studentId)),
      )
      .orderBy(sql`${certExamAttempts.attemptNumber} DESC`);

    // Resume rather than start over: an in-progress attempt already holds
    // saved answers, and a second row would orphan them.
    const open = existing.find((a) => a.status === "in_progress");
    if (open) return { id: open.id, attempt_number: open.attemptNumber, status: open.status };

    const nextNumber = (existing[0]?.attemptNumber ?? 0) + 1;
    const [attempt] = await db
      .insert(certExamAttempts)
      .values({
        examId,
        studentId: auth.studentId,
        teacherId: exam.teacherId,
        attemptNumber: nextNumber,
      })
      .returning();

    reply.code(201).send({
      id: attempt.id,
      attempt_number: attempt.attemptNumber,
      status: attempt.status,
    });
  });

  /** Current state of the student's own attempt, including saved answers. */
  app.get("/app/cert-exam-attempts/:id", async (request) => {
    const auth = requireStudentAuth(request);
    const attempt = await loadOwnAttempt(auth.studentId, Number((request.params as { id: string }).id));

    const [exam] = await db
      .select()
      .from(certExams)
      .where(eq(certExams.id, attempt.examId))
      .limit(1);
    const answers = await db
      .select()
      .from(certExamAnswers)
      .where(eq(certExamAnswers.attemptId, attempt.id));
    const byTask = new Map(answers.map((a) => [a.taskNumber, a]));

    // Correctness and points are withheld until the teacher has reviewed —
    // otherwise a student could learn the key from their own attempt.
    const reviewed = attempt.status === "reviewed";

    return {
      id: attempt.id,
      exam_id: exam.id,
      exam_title: exam.title,
      status: attempt.status,
      attempt_number: attempt.attemptNumber,
      submitted_at: attempt.submittedAt,
      is_late: attempt.isLate,
      deadline_at: exam.deadlineAt,
      auto_score: reviewed ? attempt.autoScore : null,
      manual_score: reviewed ? attempt.manualScore : null,
      total_score: reviewed ? attempt.totalScore : null,
      total_max_points: TOTAL_MAX_POINTS,
      review_comment_text: reviewed ? attempt.reviewCommentText : null,
      tasks: Array.from({ length: 43 }, (_, i) => i + 1).map((n) => {
        const a = byTask.get(n);
        return {
          task_number: n,
          is_closed: isClosedTask(n),
          options: optionsFor(n),
          max_points: maxPointsFor(n),
          chosen_option: a?.chosenOption ?? null,
          photo_count: a?.photoFileIds?.length ?? 0,
          is_correct: reviewed ? (a?.isCorrect ?? null) : null,
          awarded_points: reviewed ? (a?.awardedPoints ?? null) : null,
        };
      }),
    };
  });

  app.put("/app/cert-exam-attempts/:id/answers", async (request) => {
    const auth = requireStudentAuth(request);
    const attempt = await loadOwnAttempt(auth.studentId, Number((request.params as { id: string }).id));
    if (attempt.status !== "in_progress") throw Conflict("Attempt already submitted");

    const body = saveAnswersSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    for (const a of body.data.answers) {
      if (a.chosen_option === null) continue;
      const allowed = optionsFor(a.task_number);
      if (!allowed.includes(a.chosen_option.toUpperCase())) {
        throw Unprocessable(
          `Task ${a.task_number} accepts ${allowed.join("/")}, got "${a.chosen_option}"`,
        );
      }
    }

    await db.transaction(async (tx) => {
      for (const a of body.data.answers) {
        await tx
          .insert(certExamAnswers)
          .values({
            attemptId: attempt.id,
            taskNumber: a.task_number,
            chosenOption: a.chosen_option === null ? null : a.chosen_option.toUpperCase(),
          })
          .onConflictDoUpdate({
            target: [certExamAnswers.attemptId, certExamAnswers.taskNumber],
            set: {
              chosenOption: a.chosen_option === null ? null : a.chosen_option.toUpperCase(),
              updatedAt: new Date(),
            },
          });
      }
    });

    return { saved: body.data.answers.length };
  });

  /** Deep link that lets the student send photos for one open task (36–43). */
  app.post("/app/cert-exam-attempts/:id/tasks/:task/photo-start", async (request) => {
    const auth = requireStudentAuth(request);
    const params = request.params as { id: string; task: string };
    const attempt = await loadOwnAttempt(auth.studentId, Number(params.id));
    const taskNumber = Number(params.task);

    if (!isValidTaskNumber(taskNumber) || isClosedTask(taskNumber)) {
      throw Unprocessable("Photos are only accepted for tasks 36–43");
    }
    if (attempt.status !== "in_progress") throw Conflict("Attempt already submitted");

    const deepLink = await createPendingActionDeepLink({
      actionType: "submit_cert_task",
      targetCertAttemptId: attempt.id,
      targetTaskNumber: taskNumber,
    });
    return { deep_link: deepLink, task_number: taskNumber };
  });

  app.post("/app/cert-exam-attempts/:id/submit", async (request) => {
    const auth = requireStudentAuth(request);
    const attempt = await loadOwnAttempt(auth.studentId, Number((request.params as { id: string }).id));
    if (attempt.status !== "in_progress") throw Conflict("Attempt already submitted");

    const [exam] = await db
      .select()
      .from(certExams)
      .where(eq(certExams.id, attempt.examId))
      .limit(1);

    const key = await db
      .select()
      .from(certExamAnswerKeys)
      .where(eq(certExamAnswerKeys.examId, exam.id));
    const keyByTask = new Map(key.map((k) => [k.taskNumber, k.correctOption]));

    const answers = await db
      .select()
      .from(certExamAnswers)
      .where(eq(certExamAnswers.attemptId, attempt.id));

    // Grade the closed half now and freeze each verdict on the row, so a
    // later key correction never silently rewrites an already-sat attempt.
    let autoScore = 0;
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const a of answers) {
        if (!isClosedTask(a.taskNumber)) continue;
        const correct = keyByTask.get(a.taskNumber);
        const isCorrect = a.chosenOption !== null && a.chosenOption === correct;
        if (isCorrect) autoScore += 1;
        await tx
          .update(certExamAnswers)
          .set({ isCorrect, updatedAt: now })
          .where(
            and(
              eq(certExamAnswers.attemptId, attempt.id),
              eq(certExamAnswers.taskNumber, a.taskNumber),
            ),
          );
      }

      await tx
        .update(certExamAttempts)
        .set({
          status: "submitted",
          submittedAt: now,
          isLate: now > exam.deadlineAt,
          autoScore,
        })
        .where(eq(certExamAttempts.id, attempt.id));
    });

    // autoScore is stored but deliberately NOT returned here, and GET keeps
    // hiding it until the teacher reviews: handing back a per-attempt score
    // immediately would let a student resubmit their way to the whole key.
    return { id: attempt.id, status: "submitted", is_late: now > exam.deadlineAt };
  });
};

export default appCertExamRoutes;
