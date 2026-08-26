import { eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { staffUsers, students } from "../db/schema.js";
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
