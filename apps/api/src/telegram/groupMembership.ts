import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { courseTelegramGroups } from "../db/schema.js";
import { bot } from "./bot.js";
import { t } from "../lib/i18n.js";
import { languageForStudent } from "../lib/language.js";

async function ensureInviteLink(courseId: number): Promise<string | null> {
  const [group] = await db
    .select()
    .from(courseTelegramGroups)
    .where(eq(courseTelegramGroups.courseId, courseId))
    .limit(1);
  if (!group) return null;
  if (group.inviteLink) return group.inviteLink;

  try {
    const link = await bot.api.createChatInviteLink(group.telegramChatId);
    await db
      .update(courseTelegramGroups)
      .set({ inviteLink: link.invite_link })
      .where(eq(courseTelegramGroups.courseId, courseId));
    return link.invite_link;
  } catch {
    return null;
  }
}

/**
 * Telegram bots cannot add an arbitrary user to a group directly — the only
 * way in is an invite link the user opens themselves. So "adding" a student
 * to their course group means DMing them the link, not an API call that
 * completes the membership on its own.
 */
export async function inviteStudentToCourseGroup(
  courseId: number,
  studentTelegramId: number,
  studentId: number,
): Promise<boolean> {
  const link = await ensureInviteLink(courseId);
  if (!link) return false;
  try {
    const lang = await languageForStudent(studentId);
    await bot.api.sendMessage(studentTelegramId, t(lang, "notifyCourseInvite", { link }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a student from the course's Telegram group — ban immediately
 * followed by unban so it's a kick, not a permanent block (they could be
 * re-invited later if access is restored).
 */
export async function removeStudentFromCourseGroup(courseId: number, studentTelegramId: number): Promise<boolean> {
  const [group] = await db
    .select()
    .from(courseTelegramGroups)
    .where(eq(courseTelegramGroups.courseId, courseId))
    .limit(1);
  if (!group) return false;

  try {
    await bot.api.banChatMember(group.telegramChatId, studentTelegramId);
    await bot.api.unbanChatMember(group.telegramChatId, studentTelegramId, { only_if_banned: true });
    return true;
  } catch {
    return false;
  }
}
