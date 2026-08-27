import type { Context } from "grammy";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  botPendingActions,
  certExamAnswers,
  certExamAttempts,
  certExams,
  courseAccess,
  courseTelegramGroups,
  courses,
  homeworkSubmissions,
  homeworks,
  lessons,
  staffUsers,
  students,
  teachers,
} from "../db/schema.js";
import { hashPassword } from "../auth/password.js";
import { loadStudentAccessibleHomeworkContext } from "../lib/studentAccess.js";
import { t, type Language } from "../lib/i18n.js";
import { isClosedTask } from "../lib/certExam.js";
import { languageForTelegramUser } from "../lib/language.js";
import { config } from "../config.js";
import { bot } from "./bot.js";

function isOwner(telegramId: number): boolean {
  return config.OWNER_TELEGRAM_ID !== undefined && telegramId === config.OWNER_TELEGRAM_ID;
}

// ---------------------------------------------------------------------
// /start — three cases: owner admin menu, student course deep link, or
// claiming a pending action token (video/photo/group-link flows).
// ---------------------------------------------------------------------

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const payload = ctx.match?.toString().trim();
  const lang = await languageForTelegramUser(telegramId);

  if (!payload) {
    if (isOwner(telegramId)) {
      await ctx.reply(t(lang, "ownerMenu"));
    } else {
      await ctx.reply(t(lang, "studentWelcome"));
    }
    return;
  }

  if (payload.startsWith("course_")) {
    await handleStudentCourseStart(ctx, telegramId, Number(payload.slice("course_".length)), lang);
    return;
  }

  await claimPendingAction(ctx, telegramId, payload, lang);
});

async function handleStudentCourseStart(
  ctx: Context,
  telegramId: number,
  courseId: number,
  lang: Language,
) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) {
    await ctx.reply(t(lang, "courseNotFound"));
    return;
  }

  let [student] = await db.select().from(students).where(eq(students.telegramId, telegramId)).limit(1);
  if (!student) {
    [student] = await db
      .insert(students)
      .values({
        telegramId,
        telegramUsername: ctx.from?.username,
        firstName: ctx.from?.first_name ?? "Ученик",
        lastName: ctx.from?.last_name,
      })
      .returning();
  }

  const [existing] = await db
    .select()
    .from(courseAccess)
    .where(and(eq(courseAccess.courseId, courseId), eq(courseAccess.studentId, student.id)))
    .limit(1);

  if (existing) {
    await ctx.reply(t(lang, "alreadyEnrolled", { course: course.title }));
    return;
  }

  await db.insert(courseAccess).values({
    courseId,
    studentId: student.id,
    teacherId: course.teacherId,
    accessGranted: false, // pending — teacher grants access manually after payment
  });
  await ctx.reply(t(lang, "enrolled", { course: course.title }));
}

async function claimPendingAction(
  ctx: Context,
  telegramId: number,
  token: string,
  lang: Language,
) {
  const [pending] = await db
    .select()
    .from(botPendingActions)
    .where(eq(botPendingActions.token, token))
    .limit(1);

  if (!pending || pending.consumedAt || pending.expiresAt < new Date()) {
    await ctx.reply(t(lang, "linkInvalid"));
    return;
  }
  if (pending.claimedAt && pending.telegramId !== telegramId) {
    await ctx.reply(t(lang, "linkClaimedByOther"));
    return;
  }
  if (!pending.claimedAt) {
    await db
      .update(botPendingActions)
      .set({ telegramId, claimedAt: new Date() })
      .where(eq(botPendingActions.id, pending.id));
  }

  if (pending.actionType === "attach_lesson_recording") {
    await ctx.reply(t(lang, "sendVideo"));
  } else if (pending.actionType === "submit_homework") {
    await ctx.reply(t(lang, "sendPhotos"));
  } else if (pending.actionType === "link_course_group") {
    await ctx.reply(t(lang, "linkGroupInstructions", { token }));
  } else if (pending.actionType === "link_staff_notifications" && pending.targetStaffId) {
    // Completes immediately — no follow-up media message needed, unlike
    // the other pending-action types.
    await db
      .update(staffUsers)
      .set({ notificationTelegramId: telegramId, updatedAt: new Date() })
      .where(eq(staffUsers.id, pending.targetStaffId));
    await db.update(botPendingActions).set({ consumedAt: new Date() }).where(eq(botPendingActions.id, pending.id));
    await ctx.reply(t(lang, "notificationsLinked"));
  } else if (pending.actionType === "attach_review_voice") {
    await ctx.reply(t(lang, "sendVoice"));
  } else if (pending.actionType === "attach_cert_variant") {
    await ctx.reply(t(lang, "sendCertVariant"));
  } else if (pending.actionType === "submit_cert_task") {
    await ctx.reply(t(lang, "sendCertTaskPhotos", { task: pending.targetTaskNumber ?? 0 }));
  }
}

// ---------------------------------------------------------------------
// Video ingestion — teacher attaches a lesson recording (live or recorded).
// ---------------------------------------------------------------------

bot.on("message:video", async (ctx) => {
  const telegramId = ctx.from.id;
  const pending = await findClaimedPending(telegramId, "attach_lesson_recording");
  if (!pending?.targetLessonId) return void (await replyNoPendingAction(ctx));

  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, pending.targetLessonId)).limit(1);
  if (!lesson) return;

  const fileId = ctx.message.video.file_id;
  await db
    .update(lessons)
    .set(
      lesson.lessonType === "live"
        ? { liveRecordingFileId: fileId, updatedAt: new Date() }
        : { recordedVideoFileId: fileId, updatedAt: new Date() },
    )
    .where(eq(lessons.id, lesson.id));

  await db.update(botPendingActions).set({ consumedAt: new Date() }).where(eq(botPendingActions.id, pending.id));
  await ctx.reply(t(await languageForTelegramUser(telegramId), "videoSaved"));
});

// ---------------------------------------------------------------------
// Voice comment ingestion — teacher/assistant records a review comment
// instead of typing one (review_comment_text / review_comment_voice_file_id
// are mutually exclusive on the row, per db/schema.sql's CHECK).
// ---------------------------------------------------------------------

bot.on("message:voice", async (ctx) => {
  const telegramId = ctx.from.id;
  const pending = await findClaimedPending(telegramId, "attach_review_voice");
  if (!pending?.targetSubmissionId) return void (await replyNoPendingAction(ctx));

  const fileId = ctx.message.voice.file_id;
  const [submission] = await db
    .update(homeworkSubmissions)
    .set({ reviewCommentVoiceFileId: fileId, reviewCommentText: null })
    .where(eq(homeworkSubmissions.id, pending.targetSubmissionId))
    .returning();

  await db.update(botPendingActions).set({ consumedAt: new Date() }).where(eq(botPendingActions.id, pending.id));
  await ctx.reply(t(await languageForTelegramUser(telegramId), "voiceSaved"));

  // Deliver it to the student right away — a Telegram file_id can't be
  // played back inside the Mini App directly, so forwarding it into their
  // own chat with the bot is the only way they actually hear it (matches
  // idea-platforma-kursy.md §6.2: student gets the verdict + comment via
  // Telegram, text or voice).
  if (submission) {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, submission.studentId))
      .limit(1);
    if (student) {
      try {
        await bot.api.sendMessage(student.telegramId, t(student.language, "teacherVoiceComment"));
        await bot.api.sendVoice(student.telegramId, fileId);
      } catch {
        // Student may never have started the bot — the comment still
        // lives on the submission row either way.
      }
    }
  }
});

// ---------------------------------------------------------------------
// Photo ingestion — student submits homework. Telegram sends an album as
// several messages sharing one media_group_id; buffer briefly so a
// multi-photo submission becomes one row, not several.
// ---------------------------------------------------------------------

const albumBuffers = new Map<
  string,
  { fileIds: string[]; telegramId: number; ctx: Context; timer: NodeJS.Timeout }
>();
const ALBUM_BUFFER_WINDOW_MS = 1500;

bot.on("message:photo", async (ctx) => {
  const telegramId = ctx.from.id;
  const sizes = ctx.message.photo;
  const fileId = sizes[sizes.length - 1].file_id; // largest resolution
  const groupId = ctx.message.media_group_id;

  if (!groupId) {
    await routePhotos(ctx, telegramId, [fileId]);
    return;
  }

  const buffered = albumBuffers.get(groupId);
  if (buffered) {
    buffered.fileIds.push(fileId);
    buffered.ctx = ctx;
    clearTimeout(buffered.timer);
    buffered.timer = setTimeout(() => void flushAlbum(groupId), ALBUM_BUFFER_WINDOW_MS);
  } else {
    const timer = setTimeout(() => void flushAlbum(groupId), ALBUM_BUFFER_WINDOW_MS);
    albumBuffers.set(groupId, { fileIds: [fileId], telegramId, ctx, timer });
  }
});

async function flushAlbum(groupId: string) {
  const buffered = albumBuffers.get(groupId);
  if (!buffered) return;
  albumBuffers.delete(groupId);
  await routePhotos(buffered.ctx, buffered.telegramId, buffered.fileIds);
}

/**
 * Photos can now belong to three different flows, so the newest claimed
 * pending action decides. Certificate flows are checked first: a student
 * mid-exam may also have an old, still-unconsumed homework link lying
 * around, and silently filing exam pages as homework would be worse than
 * either failure mode being visible.
 */
async function routePhotos(ctx: Context, telegramId: number, fileIds: string[]) {
  const certTask = await findClaimedPending(telegramId, "submit_cert_task");
  if (certTask?.targetCertAttemptId && certTask.targetTaskNumber) {
    await finalizeCertTaskPhotos(ctx, telegramId, fileIds, certTask);
    return;
  }
  const certVariant = await findClaimedPending(telegramId, "attach_cert_variant");
  if (certVariant?.targetCertExamId) {
    await finalizeCertVariant(ctx, telegramId, fileIds[0], null, certVariant);
    return;
  }
  await finalizeHomeworkSubmission(ctx, telegramId, fileIds);
}

/** Teacher attached the variant itself — a PDF (document) or a photo of it. */
async function finalizeCertVariant(
  ctx: Context,
  telegramId: number,
  fileId: string,
  fileName: string | null,
  pending: { id: number; targetCertExamId: number | null },
) {
  if (!pending.targetCertExamId) return;
  const lang = await languageForTelegramUser(telegramId);

  await db
    .update(certExams)
    .set({ variantFileId: fileId, variantFileName: fileName, updatedAt: new Date() })
    .where(eq(certExams.id, pending.targetCertExamId));
  await db
    .update(botPendingActions)
    .set({ consumedAt: new Date() })
    .where(eq(botPendingActions.id, pending.id));

  await ctx.reply(t(lang, "certVariantSaved"));
}

/** Student sent the photographed solution for one open task (36–43). */
async function finalizeCertTaskPhotos(
  ctx: Context,
  telegramId: number,
  fileIds: string[],
  pending: { id: number; targetCertAttemptId: number | null; targetTaskNumber: number | null },
) {
  const taskNumber = pending.targetTaskNumber;
  const attemptId = pending.targetCertAttemptId;
  if (!attemptId || !taskNumber || isClosedTask(taskNumber)) return;

  const [student] = await db
    .select()
    .from(students)
    .where(eq(students.telegramId, telegramId))
    .limit(1);
  if (!student) return;

  const [attempt] = await db
    .select()
    .from(certExamAttempts)
    .where(eq(certExamAttempts.id, attemptId))
    .limit(1);
  if (!attempt) return;

  // Same reasoning as the homework flow: the deep link carries no identity,
  // so whoever opens it must be re-checked against the attempt's real owner.
  if (attempt.studentId !== student.id) {
    await ctx.reply(t(student.language, "noCertAccess"));
    return;
  }
  if (attempt.status !== "in_progress") {
    await ctx.reply(t(student.language, "certAlreadySubmitted"));
    return;
  }

  // Re-sending replaces that task's photos rather than appending: the
  // student's intent when they send again is "use these instead".
  await db
    .insert(certExamAnswers)
    .values({ attemptId, taskNumber, photoFileIds: fileIds })
    .onConflictDoUpdate({
      target: [certExamAnswers.attemptId, certExamAnswers.taskNumber],
      set: { photoFileIds: fileIds, updatedAt: new Date() },
    });
  await db
    .update(botPendingActions)
    .set({ consumedAt: new Date() })
    .where(eq(botPendingActions.id, pending.id));

  await ctx.reply(
    t(student.language, "certTaskAccepted", { task: taskNumber, count: fileIds.length }),
  );
}

// The variant is normally a PDF, which arrives as a document, not a photo.
bot.on("message:document", async (ctx) => {
  const telegramId = ctx.from.id;
  const pending = await findClaimedPending(telegramId, "attach_cert_variant");
  if (!pending?.targetCertExamId) return void (await replyNoPendingAction(ctx));

  await finalizeCertVariant(
    ctx,
    telegramId,
    ctx.message.document.file_id,
    ctx.message.document.file_name ?? null,
    pending,
  );
});

async function finalizeHomeworkSubmission(ctx: Context, telegramId: number, fileIds: string[]) {
  const pending = await findClaimedPending(telegramId, "submit_homework");
  if (!pending?.targetHomeworkId) return void (await replyNoPendingAction(ctx));

  const [homework] = await db
    .select()
    .from(homeworks)
    .where(eq(homeworks.id, pending.targetHomeworkId))
    .limit(1);
  const [student] = await db.select().from(students).where(eq(students.telegramId, telegramId)).limit(1);
  if (!homework || !student) return;

  // The deep link is issued to a specific student from the Mini App but
  // carries no identity of its own — whoever opens it first claims it. Without
  // this check, a forwarded link let another Telegram user file a submission
  // against a course they have no access to at all. Re-verify against the
  // claimant's own access rather than trusting the token.
  try {
    await loadStudentAccessibleHomeworkContext(student.id, homework.id);
  } catch {
    await ctx.reply(t(student.language, "noHomeworkAccess"));
    return;
  }

  const [{ maxAttempt }] = await db
    .select({ maxAttempt: sql<number>`coalesce(max(${homeworkSubmissions.attemptNumber}), 0)::int` })
    .from(homeworkSubmissions)
    .where(
      and(eq(homeworkSubmissions.homeworkId, homework.id), eq(homeworkSubmissions.studentId, student.id)),
    );

  await db.insert(homeworkSubmissions).values({
    homeworkId: homework.id,
    studentId: student.id,
    teacherId: homework.teacherId,
    attemptNumber: maxAttempt + 1,
    photoFileIds: fileIds,
    isLate: new Date() > homework.deadlineAt,
  });
  await db.update(botPendingActions).set({ consumedAt: new Date() }).where(eq(botPendingActions.id, pending.id));
  await ctx.reply(t(student.language, "submissionAccepted", { count: fileIds.length }));
}

/**
 * Media sent with no active pending action used to be dropped in silence,
 * which reads as "the bot is broken" — the sender has no way to tell their
 * photo/video was ignored on purpose. Private chats only: the bot also sees
 * media in linked course groups, where answering every message would be spam.
 */
async function replyNoPendingAction(ctx: Context) {
  if (ctx.chat?.type !== "private") return;
  const lang = await languageForTelegramUser(ctx.from?.id ?? 0);
  await ctx.reply(
    "Не вижу, к чему это прикрепить. Откройте нужное действие в приложении " +
      "или дашборде и перейдите по ссылке — после этого пришлите файл сюда.",
  );
}

async function findClaimedPending(
  telegramId: number,
  actionType:
    | "attach_lesson_recording"
    | "submit_homework"
    | "attach_review_voice"
    | "attach_cert_variant"
    | "submit_cert_task",
) {
  const [pending] = await db
    .select()
    .from(botPendingActions)
    .where(
      and(
        eq(botPendingActions.telegramId, telegramId),
        eq(botPendingActions.actionType, actionType),
        isNull(botPendingActions.consumedAt),
      ),
    )
    .orderBy(desc(botPendingActions.claimedAt))
    .limit(1);
  if (!pending || pending.expiresAt < new Date()) return null;
  return pending;
}

// ---------------------------------------------------------------------
// Group linking — teacher runs /link_<token> inside the course's Telegram
// group after adding the bot to it.
// ---------------------------------------------------------------------

bot.hears(/^\/link_([a-f0-9]+)/, async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  const token = ctx.match[1];
  const lang = await languageForTelegramUser(ctx.from?.id ?? 0);

  const [pending] = await db
    .select()
    .from(botPendingActions)
    .where(eq(botPendingActions.token, token))
    .limit(1);

  if (
    !pending ||
    pending.actionType !== "link_course_group" ||
    pending.consumedAt ||
    pending.expiresAt < new Date() ||
    !pending.targetCourseId
  ) {
    await ctx.reply(t(lang, "linkInvalid"));
    return;
  }

  await db
    .insert(courseTelegramGroups)
    .values({ courseId: pending.targetCourseId, telegramChatId: ctx.chat.id })
    .onConflictDoUpdate({
      target: courseTelegramGroups.courseId,
      set: { telegramChatId: ctx.chat.id, botIsMember: true, linkedAt: new Date() },
    });
  await db
    .update(botPendingActions)
    .set({ telegramId: ctx.chat.id, claimedAt: new Date(), consumedAt: new Date() })
    .where(eq(botPendingActions.id, pending.id));

  await ctx.reply(t(lang, "groupLinked"));
});

// ---------------------------------------------------------------------
// Owner admin commands — the only surface for creating teacher accounts,
// per idea-platforma-kursy.md §2.1 (no self-serve signup).
// ---------------------------------------------------------------------

/**
 * Strips the angle brackets people copy straight out of a usage line.
 * `/add_teacher <aziz> <pass>` used to create an account whose username
 * was literally "<aziz>", so the teacher then failed to log in with
 * "aziz" and the bot's success message gave no hint why.
 */
function stripPlaceholderBrackets(value: string): string {
  return value.replace(/^<(.+)>$/, "$1");
}

bot.command("add_teacher", async (ctx) => {
  if (!ctx.from || !isOwner(ctx.from.id)) return;
  const lang = await languageForTelegramUser(ctx.from.id);
  const args = (ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? []).map(
    stripPlaceholderBrackets,
  );
  if (args.length < 3) {
    await ctx.reply(t(lang, "addTeacherUsage"));
    return;
  }
  const [username, password, ...nameParts] = args;
  const displayName = nameParts.join(" ");

  try {
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [staff] = await tx
        .insert(staffUsers)
        .values({ role: "teacher", username, passwordHash, displayName })
        .returning();
      await tx.insert(teachers).values({ staffUserId: staff.id });
    });
    // Echo the exact login string: the whole point of the failure above was
    // that the account name silently differed from what the owner typed.
    await ctx.reply(
      t(lang, "teacherCreated", {
        username,
        name: displayName,
        url: config.DASHBOARD_URL,
      }),
    );
  } catch {
    await ctx.reply(t(lang, "teacherCreateFailed"));
  }
});

bot.command("list_teachers", async (ctx) => {
  if (!ctx.from || !isOwner(ctx.from.id)) return;
  const lang = await languageForTelegramUser(ctx.from.id);
  const rows = await db
    .select({
      id: staffUsers.id,
      username: staffUsers.username,
      displayName: staffUsers.displayName,
      isActive: staffUsers.isActive,
    })
    .from(staffUsers)
    .where(eq(staffUsers.role, "teacher"));

  if (rows.length === 0) {
    await ctx.reply(t(lang, "noTeachers"));
    return;
  }
  await ctx.reply(
    rows
      .map((r) => `#${r.id} ${r.username} — ${r.displayName}${r.isActive ? "" : t(lang, "teacherInactive")}`)
      .join("\n"),
  );
});
