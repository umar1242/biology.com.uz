import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  courseApplications,
  courses,
  notificationsLog,
  staffNotificationGroups,
  staffUsers,
  students,
} from "../db/schema.js";
import { bot } from "./bot.js";
import { languageForStaffNotifications } from "../lib/language.js";
import {
  logTypeFor,
  renderStaffAlert,
  type AlertSubject,
  type StaffAlert,
  type StaffNotificationType,
} from "../lib/staffAlerts.js";

type StudentNotificationType = "live_lesson_reminder" | "homework_deadline_reminder" | "new_material_published";

type AlertParams = {
  /** The teacher the alert belongs to — routing and language both follow it. */
  staffId: number;
  courseId?: number;
  studentId?: number;
  payload?: Record<string, unknown>;
  alert: StaffAlert;
};

/**
 * Where a teacher's alerts go. The shared admin group wins when it exists so
 * assistants see the same feed; the personal DM stays as the fallback for a
 * teacher who has only ever linked notifications to themselves. Returning
 * the channel too keeps notifications_log honest about which one was used.
 */
async function alertTarget(
  staffId: number,
): Promise<{ chatId: number; channel: "group_chat" | "private_chat" } | null> {
  const [group] = await db
    .select({ chatId: staffNotificationGroups.telegramChatId })
    .from(staffNotificationGroups)
    .where(eq(staffNotificationGroups.teacherId, staffId))
    .limit(1);
  if (group) return { chatId: group.chatId, channel: "group_chat" };

  const [staff] = await db
    .select({ chatId: staffUsers.notificationTelegramId })
    .from(staffUsers)
    .where(eq(staffUsers.id, staffId))
    .limit(1);
  if (staff?.chatId) return { chatId: staff.chatId, channel: "private_chat" };

  return null;
}

/**
 * Fills in the names the template shows. Done here rather than at each call
 * site so every alert names a student the same way — the application's full
 * name when there is one (that is the name on the paperwork), otherwise the
 * Telegram profile name.
 */
async function resolveSubject(courseId?: number, studentId?: number): Promise<AlertSubject> {
  const subject: AlertSubject = { courseId, studentId };

  if (courseId !== undefined) {
    const [course] = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    subject.courseTitle = course?.title ?? null;
  }

  if (studentId !== undefined) {
    const [student] = await db
      .select({ firstName: students.firstName, lastName: students.lastName })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    const conditions = [eq(courseApplications.studentId, studentId)];
    if (courseId !== undefined) conditions.push(eq(courseApplications.courseId, courseId));
    const [application] = await db
      .select({ fullName: courseApplications.fullName })
      .from(courseApplications)
      .where(and(...conditions))
      .limit(1);

    subject.studentLabel =
      application?.fullName ??
      (student ? [student.firstName, student.lastName].filter(Boolean).join(" ") : null);
  }

  return subject;
}

/**
 * Sends one staff alert through the shared template and logs it. Silently
 * does nothing (returns false) when the teacher has neither an admin group
 * nor a linked DM: the dashboard is the source of truth, and Telegram is a
 * push channel on top of it, not the only way to learn any of this.
 */
export async function alertStaff(params: AlertParams): Promise<boolean> {
  const target = await alertTarget(params.staffId);
  if (!target) return false;

  const lang = await languageForStaffNotifications(params.staffId);
  const subject = await resolveSubject(params.courseId, params.studentId);
  const text = renderStaffAlert(lang, params.alert, subject);

  try {
    const sent = await bot.api.sendMessage(target.chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    await db.insert(notificationsLog).values({
      notificationType: logTypeFor(params.alert.kind),
      recipientType: "staff",
      recipientStaffId: params.staffId,
      courseId: params.courseId,
      channel: target.channel,
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
