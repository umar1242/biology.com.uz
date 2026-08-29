import { eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { staffUsers, students, teachers } from "../db/schema.js";
import type { Language } from "./i18n.js";

/**
 * Which language to answer a Telegram user in. The bot only ever knows a
 * chat id, so the preference has to be looked up: students first (the common
 * case), then staff by either of the two ids they can be reached on.
 * Unknown chat — e.g. someone who has never pressed /start — gets Russian.
 */
export async function languageForTelegramUser(telegramId: number): Promise<Language> {
  const [student] = await db
    .select({ language: students.language })
    .from(students)
    .where(eq(students.telegramId, telegramId))
    .limit(1);
  if (student) return student.language;

  const [staff] = await db
    .select({ language: staffUsers.language })
    .from(staffUsers)
    .where(or(eq(staffUsers.telegramId, telegramId), eq(staffUsers.notificationTelegramId, telegramId)))
    .limit(1);
  return staff?.language ?? "ru";
}

export async function languageForStudent(studentId: number): Promise<Language> {
  const [row] = await db
    .select({ language: students.language })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  return row?.language ?? "ru";
}

export async function languageForStaff(staffId: number): Promise<Language> {
  const [row] = await db
    .select({ language: staffUsers.language })
    .from(staffUsers)
    .where(eq(staffUsers.id, staffId))
    .limit(1);
  return row?.language ?? "ru";
}

/**
 * Language of the staff notification feed. The teacher's explicit choice
 * wins; without one it follows their interface language, which is how this
 * worked before the setting existed.
 *
 * Separate from `languageForStaff` on purpose: the admin group is shared
 * with assistants, so its language is a property of the group, not of the
 * person who happens to be reading the panel.
 */
export async function languageForStaffNotifications(teacherId: number): Promise<Language> {
  const [row] = await db
    .select({ chosen: teachers.notificationLanguage, fallback: staffUsers.language })
    .from(teachers)
    .innerJoin(staffUsers, eq(staffUsers.id, teachers.staffUserId))
    .where(eq(teachers.staffUserId, teacherId))
    .limit(1);
  return row?.chosen ?? row?.fallback ?? "ru";
}
