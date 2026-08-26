import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { homeworkSubmissions, homeworks, lessons, modules, students } from "../db/schema.js";
import { requireAuth } from "../plugins/auth.js";
import { accessibleCourseIds, requireCourseCapability, resolveCourseIdForHomework } from "../lib/access.js";
import { NotFound, Unprocessable } from "../lib/errors.js";
import { bot } from "../telegram/bot.js";
import { t } from "../lib/i18n.js";
import { fetchTelegramFile } from "../telegram/client.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";

// `latest_homework_submissions` isn't modeled in schema.ts (see comment
// there), so it's queried via raw SQL — which bypasses Drizzle's column
// type mapping (camelCase names, bigint-as-string -> number). Normalize by
// hand so both endpoints return an identically shaped submission object.
type RawSubmissionRow = {
  id: string;
  homework_id: string;
  student_id: string;
  teacher_id: string;
  attempt_number: number;
  photo_file_ids: string[];
  submitted_at: string;
  is_late: boolean;
  status: "pending" | "passed" | "needs_resubmission";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment_text: string | null;
  review_comment_voice_file_id: string | null;
};

function normalizeSubmissionRow(row: RawSubmissionRow) {
  return {
    id: Number(row.id),
    homeworkId: Number(row.homework_id),
    studentId: Number(row.student_id),
    teacherId: Number(row.teacher_id),
    attemptNumber: row.attempt_number,
    photoFileIds: row.photo_file_ids,
    submittedAt: new Date(row.submitted_at),
    isLate: row.is_late,
    status: row.status,
    reviewedBy: row.reviewed_by === null ? null : Number(row.reviewed_by),
    reviewedAt: row.reviewed_at === null ? null : new Date(row.reviewed_at),
    reviewCommentText: row.review_comment_text,
    reviewCommentVoiceFileId: row.review_comment_voice_file_id,
  };
}

const reviewSchema = z.object({
  status: z.enum(["passed", "needs_resubmission"]),
  comment_text: z.string().min(1).optional(),
});

/** Loads a submission and enforces can_review_homework on its course. */
async function loadReviewableSubmission(
  auth: Parameters<typeof requireCourseCapability>[0],
  submissionId: number,
) {
  const [submission] = await db
    .select()
    .from(homeworkSubmissions)
    .where(eq(homeworkSubmissions.id, submissionId))
    .limit(1);
  if (!submission || submission.teacherId !== auth.teacherId) {
    throw NotFound("Submission not found");
  }
  const { courseId } = await resolveCourseIdForHomework(submission.homeworkId);
  await requireCourseCapability(auth, courseId, "canReviewHomework");
  return submission;
}

/**
 * Best-effort Telegram delivery of a review verdict. Failure is swallowed —
 * a student who never started the bot must not make the review call fail;
 * the verdict is already persisted on the row and visible in the Mini App.
 */
async function notifyStudentOfReview(submission: typeof homeworkSubmissions.$inferSelect | undefined) {
  if (!submission) return;
  const [student] = await db
    .select()
    .from(students)
    .where(eq(students.id, submission.studentId))
    .limit(1);
  if (!student) return;

  const lang = student.language;
  const verdict = t(lang, submission.status === "passed" ? "verdictPassed" : "verdictRejected");
  const comment = submission.reviewCommentText
    ? t(lang, "verdictComment", { text: submission.reviewCommentText })
    : "";
  try {
    await bot.api.sendMessage(student.telegramId, `${verdict}${comment}`);
  } catch {
    // Student never started the bot / blocked it — nothing to recover.
  }
}

const submissionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/homework/:id/submissions", async (request) => {
    const auth = requireAuth(request);
    const homeworkId = Number((request.params as { id: string }).id);
    const { courseId } = await resolveCourseIdForHomework(homeworkId);
    await requireCourseCapability(auth, courseId, "canReviewHomework");

    const latestOnly = (request.query as { latest?: string }).latest !== "false";
    if (latestOnly) {
      const rows = await db.execute<RawSubmissionRow>(
        sql`SELECT * FROM latest_homework_submissions WHERE homework_id = ${homeworkId} ORDER BY student_id`,
      );
      return rows.map(normalizeSubmissionRow);
    }

    return db
      .select()
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.homeworkId, homeworkId))
      .orderBy(homeworkSubmissions.studentId, homeworkSubmissions.attemptNumber);
  });

  app.get("/submissions/:id", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    return loadReviewableSubmission(auth, id);
  });

  app.post("/submissions/:id/review", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadReviewableSubmission(auth, id);

    const body = reviewSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [updated] = await db
      .update(homeworkSubmissions)
      .set({
        status: body.data.status,
        reviewedBy: auth.staffId,
        reviewedAt: new Date(),
        // `?? null` (not `undefined`) so re-reviewing without a comment
        // actually clears the previous one instead of Drizzle skipping the
        // column. Voice is cleared alongside it because the two forms are
        // mutually exclusive at the DB level (review_comment_single_form
        // CHECK) — leaving a prior voice comment in place while writing text
        // violated that CHECK and surfaced as a 500.
        reviewCommentText: body.data.comment_text ?? null,
        reviewCommentVoiceFileId: null,
      })
      .where(eq(homeworkSubmissions.id, id))
      .returning();

    // Mirror the voice-comment path in telegram/handlers.ts: the student
    // learns the verdict in Telegram, not only by opening the Mini App
    // (idea-platforma-kursy.md §6.2). Sent directly rather than through
    // notifyStudent because notification_type has no value for a review
    // verdict — same tradeoff the voice path already makes.
    await notifyStudentOfReview(updated);
    return updated;
  });

  app.post("/submissions/:id/review/voice-start", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadReviewableSubmission(auth, id);

    const deepLink = await createPendingActionDeepLink({
      actionType: "attach_review_voice",
      targetSubmissionId: id,
    });
    return { deep_link: deepLink };
  });

  app.get("/review-queue", async (request) => {
    const auth = requireAuth(request);
    const query = request.query as { course_id?: string; is_late?: string; status?: string };

    const conditions = [eq(homeworkSubmissions.teacherId, auth.teacherId)];
    if (query.status) {
      conditions.push(
        eq(homeworkSubmissions.status, query.status as "pending" | "passed" | "needs_resubmission"),
      );
    }
    if (query.is_late !== undefined) {
      conditions.push(eq(homeworkSubmissions.isLate, query.is_late === "true"));
    }

    let allowedCourseIds = await accessibleCourseIds(auth, "canReviewHomework");
    if (allowedCourseIds && allowedCourseIds.length === 0) return [];
    if (query.course_id) {
      const requested = Number(query.course_id);
      // A non-numeric course_id used to reach Postgres as NaN and come back
      // as a 500; an unparseable filter simply matches nothing.
      if (!Number.isInteger(requested)) return [];
      if (allowedCourseIds && !allowedCourseIds.includes(requested)) return [];
      allowedCourseIds = [requested];
    }

    const rows = await db
      .select({ submission: homeworkSubmissions, courseId: modules.courseId })
      .from(homeworkSubmissions)
      .innerJoin(homeworks, eq(homeworks.id, homeworkSubmissions.homeworkId))
      .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(
        allowedCourseIds
          ? and(...conditions, inArray(modules.courseId, allowedCourseIds))
          : and(...conditions),
      )
      .orderBy(homeworkSubmissions.submittedAt);

    return rows.map((r) => ({ ...r.submission, course_id: r.courseId }));
  });

  app.get("/submissions/:id/photos", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    const submission = await loadReviewableSubmission(auth, id);

    return {
      photos: submission.photoFileIds.map((_, index) => ({
        index,
        url: `/api/v1/submissions/${id}/photos/${index}/raw`,
      })),
    };
  });

  app.get("/submissions/:id/photos/:index/raw", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string; index: string };
    const id = Number(params.id);
    const index = Number(params.index);

    const submission = await loadReviewableSubmission(auth, id);
    const fileId = submission.photoFileIds[index];
    if (fileId === undefined) throw NotFound("Photo index out of range");

    const { buffer, contentType } = await fetchTelegramFile(fileId);
    reply.type(contentType).send(buffer);
  });
};

export default submissionRoutes;
