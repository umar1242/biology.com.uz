import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import { botPendingActions } from "../db/schema.js";
import { getBotUsername } from "./bot.js";

const PENDING_ACTION_TTL_MS = 30 * 60 * 1000; // 30 minutes

type CreatePendingActionParams =
  | { actionType: "attach_lesson_recording"; targetLessonId: number }
  | { actionType: "submit_homework"; targetHomeworkId: number }
  | { actionType: "link_course_group"; targetCourseId: number }
  | { actionType: "link_staff_notifications"; targetStaffId: number }
  | { actionType: "link_staff_group"; targetStaffId: number }
  | { actionType: "attach_review_voice"; targetSubmissionId: number }
  | { actionType: "attach_cert_variant"; targetCertExamId: number }
  | {
      actionType: "submit_cert_task";
      targetCertAttemptId: number;
      // Which of tasks 36–43 the incoming photos belong to. Without it the
      // bot could not tell one open task's answer from another's.
      targetTaskNumber: number;
    };

/**
 * Issues a fresh deep link for one of the bot's "send me media next" flows.
 * See db/schema.sql §9 for the two/three-phase lifecycle this row goes
 * through (created → claimed → consumed).
 */
export async function createPendingActionDeepLink(params: CreatePendingActionParams): Promise<string> {
  const token = randomBytes(16).toString("hex");

  await db.insert(botPendingActions).values({
    token,
    actionType: params.actionType,
    targetLessonId: "targetLessonId" in params ? params.targetLessonId : undefined,
    targetHomeworkId: "targetHomeworkId" in params ? params.targetHomeworkId : undefined,
    targetCourseId: "targetCourseId" in params ? params.targetCourseId : undefined,
    targetStaffId: "targetStaffId" in params ? params.targetStaffId : undefined,
    targetSubmissionId: "targetSubmissionId" in params ? params.targetSubmissionId : undefined,
    targetCertExamId: "targetCertExamId" in params ? params.targetCertExamId : undefined,
    targetCertAttemptId: "targetCertAttemptId" in params ? params.targetCertAttemptId : undefined,
    targetTaskNumber: "targetTaskNumber" in params ? params.targetTaskNumber : undefined,
    expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS),
  });

  const username = await getBotUsername();
  return `https://t.me/${username}?start=${token}`;
}
