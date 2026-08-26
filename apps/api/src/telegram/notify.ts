import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { notificationsLog, staffUsers } from "../db/schema.js";
import { bot } from "./bot.js";

type StaffNotificationType =
  | "access_expiring_soon"
  | "access_expired"
  | "blacklist_event"
  | "unreviewed_homework_summary";

type StudentNotificationType = "live_lesson_reminder" | "homework_deadline_reminder" | "new_material_published";

/**
 * Sends a Telegram DM to a teacher/assistant and logs it — silently does
 * nothing (returns false) if they never linked notifications (see
 * staff_users.notification_telegram_id). The dashboard summary widgets are
 * the fallback for a teacher who hasn't linked: this is a nice-to-have push
 * channel, not the only way to see this information.
 */
export async function notifyStaff(params: {
  staffId: number;
  notificationType: StaffNotificationType;
  courseId?: number;
  text: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const [staff] = await db.select().from(staffUsers).where(eq(staffUsers.id, params.staffId)).limit(1);
  if (!staff?.notificationTelegramId) return false;

  try {
    const sent = await bot.api.sendMessage(staff.notificationTelegramId, params.text);
    await db.insert(notificationsLog).values({
      notificationType: params.notificationType,
      recipientType: "staff",
      recipientStaffId: params.staffId,
      courseId: params.courseId,
      channel: "private_chat",
      telegramMessageId: sent.message_id,
      payload: params.payload,
    });
    return true;
  } catch {
    return false;
  }
}

export async function notifyStudent(params: {
  studentId: number;
  telegramId: number;
  notificationType: StudentNotificationType;
  courseId?: number;
  text: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const sent = await bot.api.sendMessage(params.telegramId, params.text);
    await db.insert(notificationsLog).values({
      notificationType: params.notificationType,
      recipientType: "student",
      recipientStudentId: params.studentId,
      courseId: params.courseId,
      channel: "private_chat",
      telegramMessageId: sent.message_id,
      payload: params.payload,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Dedupe guard for periodic sweeps — e.g. "don't send access_expiring_soon
 * for this same course_access row twice." `payloadKey`/`payloadValue` match
 * against the JSONB `payload` column since notifications_log has no generic
 * foreign key for arbitrary entities (homework, lesson, access row, ...).
 */
export async function wasNotifiedRecently(params: {
  notificationType: StaffNotificationType | StudentNotificationType;
  recipientStudentId?: number;
  recipientStaffId?: number;
  payloadKey: string;
  payloadValue: number;
  withinMs: number;
}): Promise<boolean> {
  const since = new Date(Date.now() - params.withinMs);
  const conditions = [
    eq(notificationsLog.notificationType, params.notificationType),
    gte(notificationsLog.sentAt, since),
    sql`${notificationsLog.payload} ->> ${params.payloadKey} = ${String(params.payloadValue)}`,
  ];
  if (params.recipientStudentId !== undefined) {
    conditions.push(eq(notificationsLog.recipientStudentId, params.recipientStudentId));
  }
  if (params.recipientStaffId !== undefined) {
    conditions.push(eq(notificationsLog.recipientStaffId, params.recipientStaffId));
  }

  const rows = await db
    .select({ id: notificationsLog.id })
    .from(notificationsLog)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}
