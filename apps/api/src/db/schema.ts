// Drizzle schema mirroring db/schema.sql (source of truth for rationale —
// see that file's comments for *why*; this file is the queryable/typed
// counterpart consumed by the API, kept in sync by hand).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  doublePrecision,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// ---------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------

export const staffRoleEnum = pgEnum("staff_role", ["owner", "teacher", "assistant"]);
// Interface language. Stored server-side (not just in the browser) because the
// BOT has to know which language to write a reminder or a homework verdict in,
// and it never sees the client's local settings.
export const languageEnum = pgEnum("language", ["ru", "uz"]);
export const courseSubjectEnum = pgEnum("course_subject", ["biology", "chemistry"]);
export const lessonTypeEnum = pgEnum("lesson_type", ["live", "recorded"]);
export const lessonMaterialTypeEnum = pgEnum("lesson_material_type", ["video", "text", "file"]);
export const submissionStatusEnum = pgEnum("submission_status", [
  "pending",
  "passed",
  "needs_resubmission",
]);
export const disciplinaryEventTypeEnum = pgEnum("disciplinary_event_type", [
  "missed_homework_deadline",
  "manual_point_adjustment",
  "points_reset",
  "auto_blacklist",
  "manual_blacklist",
  "manual_blacklist_clear",
  "trial_expired_freeze",
]);
export const certExamAttemptStatusEnum = pgEnum("cert_exam_attempt_status", [
  "in_progress",
  "submitted",
  "reviewed",
]);
export const notificationRecipientTypeEnum = pgEnum("notification_recipient_type", [
  "student",
  "staff",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "private_chat",
  "group_chat",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "live_lesson_reminder",
  "homework_deadline_reminder",
  "new_material_published",
  "access_expiring_soon",
  "access_expired",
  "blacklist_event",
  "unreviewed_homework_summary",
  "trial_expired",
  "application_submitted",
  "cert_attempt_submitted",
  "student_removed",
  "group_invite_failed",
]);
export const botPendingActionTypeEnum = pgEnum("bot_pending_action_type", [
  "attach_lesson_recording",
  "submit_homework",
  "link_course_group",
  "link_staff_notifications",
  "attach_review_voice",
  "attach_cert_variant",
  "submit_cert_task",
  "course_application",
  "link_staff_group",
]);

// ---------------------------------------------------------------------
// 2. Identity & roles
// ---------------------------------------------------------------------

export const staffUsers = pgTable(
  "staff_users",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    role: staffRoleEnum("role").notNull(),
    telegramId: bigint("telegram_id", { mode: "number" }).unique(),
    username: citext("username").unique(),
    passwordHash: text("password_hash"),
    notificationTelegramId: bigint("notification_telegram_id", { mode: "number" }).unique(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    language: languageEnum("language").notNull().default("ru"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "staff_auth_method_matches_role",
      sql`(${table.role} = 'owner' AND ${table.telegramId} IS NOT NULL AND ${table.username} IS NULL AND ${table.passwordHash} IS NULL)
        OR (${table.role} IN ('teacher', 'assistant') AND ${table.telegramId} IS NULL AND ${table.username} IS NOT NULL AND ${table.passwordHash} IS NOT NULL)`,
    ),
  ],
);

export const teachers = pgTable("teachers", {
  staffUserId: bigint("staff_user_id", { mode: "number" })
    .primaryKey()
    .references(() => staffUsers.id),
  penaltyPointThreshold: integer("penalty_point_threshold").notNull().default(3),
  // Language of the staff notification feed. Deliberately separate from the
  // teacher's own interface language (staff_users.language): the admin group
  // is read by assistants too, so which language it speaks is a property of
  // the group, not of whoever last clicked a flag in the panel.
  // NULL = follow the teacher's interface language, which is what everyone
  // had before this column existed.
  notificationLanguage: languageEnum("notification_language"),
  // Вариант, к чьей шкале приводятся результаты остальных. Ссылка объявлена
  // ниже, в relations-стиле, чтобы не заводить круговую зависимость таблиц:
  // cert_exams ссылается на teachers, и обратная ссылка здесь замкнула бы
  // определения друг на друга. NULL — платформа выбирает сама вариант с
  // наибольшим числом откалиброванных заданий.
  certReferenceExamId: bigint("cert_reference_exam_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The Telegram group the platform's staff notifications go to — one per
 * teacher. Alerts used to be a DM to whoever linked notifications, which
 * meant an assistant covering for the teacher simply never saw them. The
 * group is the shared inbox; the personal DM stays as a fallback for a
 * teacher who has not linked one (see telegram/notify.ts).
 */
export const staffNotificationGroups = pgTable("staff_notification_groups", {
  teacherId: bigint("teacher_id", { mode: "number" })
    .primaryKey()
    .references(() => teachers.staffUserId),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull().unique(),
  title: text("title"),
  linkedByStaffId: bigint("linked_by_staff_id", { mode: "number" }).references(() => staffUsers.id),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistants = pgTable(
  "assistants",
  {
    staffUserId: bigint("staff_user_id", { mode: "number" })
      .primaryKey()
      .references(() => staffUsers.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_assistants_teacher").on(table.teacherId)],
);

export const students = pgTable("students", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  telegramUsername: text("telegram_username"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  // Only ever written from a Telegram `contact` the student shared about
  // themselves — that is the number the account is registered with, which a
  // hand-typed field could not guarantee. See telegram/handlers.ts.
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  language: languageEnum("language").notNull().default("ru"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------
// 3. Courses & Telegram group linkage
// ---------------------------------------------------------------------

export const courses = pgTable(
  "courses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    title: text("title").notNull(),
    description: text("description"),
    subject: courseSubjectEnum("subject").notNull(),
    // How many published lessons a new student gets for free before the
    // trial-expiry sweep freezes them (jobs/trialExpirySweep.ts).
    trialLessonCount: integer("trial_lesson_count").notNull().default(2),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_courses_teacher").on(table.teacherId),
    check("trial_lesson_count_nonnegative", sql`${table.trialLessonCount} >= 0`),
  ],
);

export const assistantCoursePermissions = pgTable(
  "assistant_course_permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    assistantId: bigint("assistant_id", { mode: "number" })
      .notNull()
      .references(() => assistants.staffUserId),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    canReviewHomework: boolean("can_review_homework").notNull().default(true),
    canManageAccess: boolean("can_manage_access").notNull().default(false),
    canManageBlacklist: boolean("can_manage_blacklist").notNull().default(false),
    grantedBy: bigint("granted_by", { mode: "number" })
      .notNull()
      .references(() => staffUsers.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("assistant_course_permissions_assistant_id_course_id_key").on(
      table.assistantId,
      table.courseId,
    ),
    index("idx_assistant_perms_course").on(table.courseId),
  ],
);

export const courseTelegramGroups = pgTable("course_telegram_groups", {
  courseId: bigint("course_id", { mode: "number" })
    .primaryKey()
    .references(() => courses.id),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull().unique(),
  inviteLink: text("invite_link"),
  botIsMember: boolean("bot_is_member").notNull().default(true),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------
// 4. Modules / Lessons / Materials
// ---------------------------------------------------------------------

export const modules = pgTable(
  "modules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    title: text("title").notNull(),
    description: text("description"),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("modules_course_id_order_index_key").on(table.courseId, table.orderIndex),
    index("idx_modules_course").on(table.courseId),
  ],
);

export const lessons = pgTable(
  "lessons",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    moduleId: bigint("module_id", { mode: "number" })
      .notNull()
      .references(() => modules.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    title: text("title").notNull(),
    description: text("description"),
    orderIndex: integer("order_index").notNull(),
    lessonType: lessonTypeEnum("lesson_type").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    liveCallLink: text("live_call_link"),
    liveRecordingFileId: text("live_recording_file_id"),
    recordedVideoFileId: text("recorded_video_file_id"),
    isPublished: timestamp("is_published", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lessons_module_id_order_index_key").on(table.moduleId, table.orderIndex),
    index("idx_lessons_module").on(table.moduleId),
    index("idx_lessons_live_schedule")
      .on(table.scheduledAt)
      .where(sql`${table.lessonType} = 'live'`),
    check(
      "lesson_type_fields_consistent",
      sql`(${table.lessonType} = 'live' AND ${table.recordedVideoFileId} IS NULL)
        OR (${table.lessonType} = 'recorded' AND ${table.liveCallLink} IS NULL AND ${table.liveRecordingFileId} IS NULL)`,
    ),
  ],
);

export const lessonMaterials = pgTable(
  "lesson_materials",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    lessonId: bigint("lesson_id", { mode: "number" })
      .notNull()
      .references(() => lessons.id),
    materialType: lessonMaterialTypeEnum("material_type").notNull(),
    orderIndex: integer("order_index").notNull(),
    textContent: text("text_content"),
    telegramFileId: text("telegram_file_id"),
    fileName: text("file_name"),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_lesson_materials_lesson").on(table.lessonId, table.orderIndex),
    check(
      "material_fields_consistent",
      sql`(${table.materialType} = 'text' AND ${table.textContent} IS NOT NULL AND ${table.telegramFileId} IS NULL)
        OR (${table.materialType} IN ('video','file') AND ${table.telegramFileId} IS NOT NULL AND ${table.textContent} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------
// 5. Homework & submissions
// ---------------------------------------------------------------------

export const homeworks = pgTable(
  "homeworks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    lessonId: bigint("lesson_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => lessons.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    instructions: text("instructions"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_homeworks_deadline").on(table.deadlineAt)],
);

export const homeworkSubmissions = pgTable(
  "homework_submissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    homeworkId: bigint("homework_id", { mode: "number" })
      .notNull()
      .references(() => homeworks.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    attemptNumber: integer("attempt_number").notNull(),
    photoFileIds: text("photo_file_ids").array().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    isLate: boolean("is_late").notNull(),
    status: submissionStatusEnum("status").notNull().default("pending"),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).references(() => staffUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewCommentText: text("review_comment_text"),
    reviewCommentVoiceFileId: text("review_comment_voice_file_id"),
  },
  (table) => [
    uniqueIndex("homework_submissions_homework_id_student_id_attempt_number_key").on(
      table.homeworkId,
      table.studentId,
      table.attemptNumber,
    ),
    index("idx_submissions_homework_student").on(table.homeworkId, table.studentId),
    index("idx_submissions_pending")
      .on(table.homeworkId)
      .where(sql`${table.status} = 'pending'`),
    check("photo_array_nonempty", sql`array_length(${table.photoFileIds}, 1) >= 1`),
    check(
      "review_comment_single_form",
      sql`NOT (${table.reviewCommentText} IS NOT NULL AND ${table.reviewCommentVoiceFileId} IS NOT NULL)`,
    ),
    check(
      "reviewed_fields_consistent",
      sql`(${table.status} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
        OR (${table.status} IN ('passed','needs_resubmission') AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`,
    ),
  ],
);
// NOTE: db/schema.sql also defines a `latest_homework_submissions` view
// (DISTINCT ON latest attempt per homework+student). Not modeled here as a
// Drizzle view to avoid pinning to a specific drizzle-orm view API — it's
// added as a plain SQL statement appended to the generated migration
// (see apps/api/drizzle/ after running `npm run db:generate`).

// ---------------------------------------------------------------------
// 6. Course access
// ---------------------------------------------------------------------

export const courseAccess = pgTable(
  "course_access",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    accessGranted: boolean("access_granted").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    grantedBy: bigint("granted_by", { mode: "number" }).references(() => staffUsers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: bigint("revoked_by", { mode: "number" }).references(() => staffUsers.id),

    // Trial: granted immediately when the application form is submitted, and
    // bounded by a lesson count rather than a date — trialStartedAt is the
    // point lessons are counted from (jobs/trialExpirySweep.ts).
    isTrial: boolean("is_trial").notNull().default(false),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),

    // Frozen = still enrolled and can still see everything, but cannot act:
    // no lesson video to chat, no homework submission, no cert exam. Kept
    // separate from `revoked` (teacher cut them off) and from the blacklist
    // (discipline) — this one is specifically about unpaid tuition.
    isFrozen: boolean("is_frozen").notNull().default(false),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    frozenReason: text("frozen_reason"),

    // Set when staff actually kicks them from the course group via the
    // dashboard's removal queue — never automatically.
    removedFromGroupAt: timestamp("removed_from_group_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("course_access_course_id_student_id_key").on(table.courseId, table.studentId),
    index("idx_course_access_student").on(table.studentId),
    index("idx_course_access_expiry_watch")
      .on(table.expiresAt)
      .where(sql`${table.accessGranted} = true AND ${table.revoked} = false`),
    // Trial access is deliberately open-ended in time — it ends when the
    // course publishes its (trialLessonCount + 1)-th lesson, not on a date,
    // so it is the one granted state allowed to have no expiresAt.
    check(
      "expiry_required_when_granted",
      sql`${table.accessGranted} = false OR ${table.expiresAt} IS NOT NULL OR ${table.isTrial} = true`,
    ),
    index("idx_course_access_trial_watch")
      .on(table.courseId)
      .where(sql`${table.isTrial} = true AND ${table.isFrozen} = false AND ${table.revoked} = false`),
  ],
);

/**
 * The enrolment questionnaire a student fills in the Mini App before joining
 * a course. One per (course, student): resubmitting is refused rather than
 * silently overwriting, since submitting is what grants the trial and sends
 * the group invite.
 */
export const courseApplications = pgTable(
  "course_applications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    fullName: text("full_name").notNull(),
    // Snapshot of the Telegram-verified number at submission time — students
    // may later change their Telegram phone, but the application should keep
    // the number the teacher was actually given.
    phone: text("phone").notNull(),
    parentPhonePrimary: text("parent_phone_primary").notNull(),
    parentPhoneSecondary: text("parent_phone_secondary"),
    aboutSelf: text("about_self"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("course_applications_course_id_student_id_key").on(
      table.courseId,
      table.studentId,
    ),
    index("idx_course_applications_course").on(table.courseId),
  ],
);

// ---------------------------------------------------------------------
// 7. Penalty points, blacklist, disciplinary log
// ---------------------------------------------------------------------

export const coursePenaltyPoints = pgTable(
  "course_penalty_points",
  {
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    currentPoints: integer("current_points").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.courseId, table.studentId] })],
);

export const courseBlacklist = pgTable(
  "course_blacklist",
  {
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    isBlacklisted: boolean("is_blacklisted").notNull().default(false),
    blacklistedAt: timestamp("blacklisted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.courseId, table.studentId] })],
);

export const courseDisciplinaryEvents = pgTable(
  "course_disciplinary_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    eventType: disciplinaryEventTypeEnum("event_type").notNull(),
    pointsDelta: integer("points_delta").notNull().default(0),
    reason: text("reason"),
    relatedHomeworkId: bigint("related_homework_id", { mode: "number" }).references(
      () => homeworks.id,
    ),
    actorStaffId: bigint("actor_staff_id", { mode: "number" }).references(() => staffUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_disc_events_student_course").on(
      table.courseId,
      table.studentId,
      table.createdAt,
    ),
    uniqueIndex("uq_missed_homework_once")
      .on(table.studentId, table.relatedHomeworkId)
      .where(sql`${table.eventType} = 'missed_homework_deadline'`),
  ],
);

// ---------------------------------------------------------------------
// 9. Bot pending-action correlation
// ---------------------------------------------------------------------

export const botPendingActions = pgTable(
  "bot_pending_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    token: text("token").notNull().unique(),
    telegramId: bigint("telegram_id", { mode: "number" }),
    actionType: botPendingActionTypeEnum("action_type").notNull(),
    targetLessonId: bigint("target_lesson_id", { mode: "number" }).references(() => lessons.id),
    targetHomeworkId: bigint("target_homework_id", { mode: "number" }).references(
      () => homeworks.id,
    ),
    targetCourseId: bigint("target_course_id", { mode: "number" }).references(() => courses.id),
    targetStaffId: bigint("target_staff_id", { mode: "number" }).references(() => staffUsers.id),
    targetSubmissionId: bigint("target_submission_id", { mode: "number" }).references(
      () => homeworkSubmissions.id,
    ),
    targetCertExamId: bigint("target_cert_exam_id", { mode: "number" }).references(
      () => certExams.id,
    ),
    targetCertAttemptId: bigint("target_cert_attempt_id", { mode: "number" }).references(
      () => certExamAttempts.id,
    ),
    targetTaskNumber: integer("target_task_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_pending_actions_lookup")
      .on(table.telegramId, table.actionType)
      .where(sql`${table.consumedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------
// 10. Notifications log
// ---------------------------------------------------------------------

export const notificationsLog = pgTable(
  "notifications_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    notificationType: notificationTypeEnum("notification_type").notNull(),
    recipientType: notificationRecipientTypeEnum("recipient_type").notNull(),
    recipientStudentId: bigint("recipient_student_id", { mode: "number" }).references(
      () => students.id,
    ),
    recipientStaffId: bigint("recipient_staff_id", { mode: "number" }).references(
      () => staffUsers.id,
    ),
    courseId: bigint("course_id", { mode: "number" }).references(() => courses.id),
    channel: notificationChannelEnum("channel").notNull(),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    payload: jsonb("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notifications_student").on(table.recipientStudentId, table.sentAt),
    index("idx_notifications_staff").on(table.recipientStaffId, table.sentAt),
    index("idx_notifications_course_type").on(
      table.courseId,
      table.notificationType,
      table.sentAt,
    ),
    check(
      "exactly_one_recipient",
      sql`(${table.recipientType} = 'student' AND ${table.recipientStudentId} IS NOT NULL AND ${table.recipientStaffId} IS NULL)
        OR (${table.recipientType} = 'staff' AND ${table.recipientStaffId} IS NOT NULL AND ${table.recipientStudentId} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------
// 11. Certificate exam (Milliy Sertifikat variants)
// ---------------------------------------------------------------------
// A variant is 43 tasks with a fixed shape defined by the state spec —
// see lib/certExam.ts for the ranges and point weights. Only 1–35 have a
// machine-checkable key; 36–43 are photographed solutions a teacher grades
// by hand, which is why the answer row carries both shapes.

export const certExams = pgTable(
  "cert_exams",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    courseId: bigint("course_id", { mode: "number" })
      .notNull()
      .references(() => courses.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    title: text("title").notNull(),
    // The variant itself is a PDF/photo the teacher sends through the bot,
    // stored as a Telegram file_id like every other media in this project.
    variantFileId: text("variant_file_id"),
    variantFileName: text("variant_file_name"),
    // Telegram file_ids are type-bound: a photo id must be re-sent with
    // sendPhoto and a document id with sendDocument, so which handler
    // ingested it has to be remembered to send it back to a student.
    variantFileKind: text("variant_file_kind"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    // NULL = draft. A variant stays invisible to students until the teacher
    // has both attached the file and filled all 35 key entries.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_cert_exams_course").on(table.courseId),
    index("idx_cert_exams_deadline").on(table.deadlineAt),
    check(
      "cert_variant_file_kind_valid",
      sql`${table.variantFileKind} IS NULL OR ${table.variantFileKind} IN ('photo','document')`,
    ),
  ],
);

// The item bank. A question is its own row rather than "position N inside
// variant M", so its response history survives the variant being edited or
// deleted, accumulates across cohorts, and can be reused in a new variant.
// That accumulation is also the precondition for ever calibrating item
// difficulty (Rasch) — without it every response collected is unusable.
export const certItems = pgTable(
  "cert_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    // The slot a question belongs to. The spec fixes both the option set and
    // the topic per position, so this is the question's own property, not
    // just where it happened to land in one variant.
    taskNumber: integer("task_number").notNull(),
    correctOption: text("correct_option"),
    topic: text("topic").notNull(),
    // Optional "Spectrum 2026, вариант 1, №5". When two variants cite the
    // same source the platform treats them as one question, which is what
    // makes statistics add up instead of splitting.
    sourceRef: text("source_ref"),
    // The question itself. Optional: the variant is already attached as a
    // file, and retyping 43 stems per variant is work the teacher may not
    // want. Filled in, it makes the bank searchable and reusable on its own.
    stemText: text("stem_text"),
    // Who wrote the question — usually the textbook's authors, not the
    // staff member who typed it in (that is created_by).
    author: text("author"),
    // Spec §VI: I lower cognitive level, II higher. Not derivable from the
    // position, so the teacher sets it.
    cognitiveLevel: integer("cognitive_level"),
    // Открытые задания (36–43) по умолчанию проверяет преподаватель. Если у
    // вопроса есть однозначный короткий ответ, он включает режим "typed" и
    // задаёт ключ в cert_item_answer_keys — тогда работа проверяется сразу.
    // Режим живёт у задания, а не у варианта: вопрос переезжает между
    // вариантами вместе со своим ключом, как и у закрытых заданий.
    gradingMode: text("grading_mode").notNull().default("manual"),
    // Retire rather than delete: a bad question's history is what explains
    // past results, and deleting it would silently rewrite them.
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => staffUsers.id),
    // Set when the key is corrected after answers already existed. Statistics
    // from before and after that moment are not comparable, and the card has
    // to say so rather than averaging across the change.
    keyRevisedAt: timestamp("key_revised_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_cert_items_teacher").on(table.teacherId, table.taskNumber),
    index("idx_cert_items_status").on(table.teacherId, table.status),
    check("cert_item_status_valid", sql`${table.status} IN ('active','retired')`),
    check(
      "cert_item_cognitive_valid",
      sql`${table.cognitiveLevel} IS NULL OR ${table.cognitiveLevel} IN (1,2)`,
    ),
    uniqueIndex("idx_cert_items_source")
      .on(table.teacherId, table.sourceRef)
      .where(sql`${table.sourceRef} IS NOT NULL`),
    check("cert_item_task_range", sql`${table.taskNumber} BETWEEN 1 AND 43`),
    check(
      "cert_item_grading_mode_valid",
      sql`${table.gradingMode} IN ('manual','typed')
        AND (${table.taskNumber} > 35 OR ${table.gradingMode} = 'manual')`,
    ),
    check(
      "cert_item_option_valid",
      sql`(${table.taskNumber} > 35 AND ${table.correctOption} IS NULL)
        OR (${table.taskNumber} <= 32 AND ${table.correctOption} IN ('A','B','C','D'))
        OR (${table.taskNumber} BETWEEN 33 AND 35 AND ${table.correctOption} IN ('A','B','C','D','E','F'))`,
    ),
  ],
);

/** Which question sits at which position of a variant. */
export const certExamItems = pgTable(
  "cert_exam_items",
  {
    examId: bigint("exam_id", { mode: "number" })
      .notNull()
      .references(() => certExams.id, { onDelete: "cascade" }),
    taskNumber: integer("task_number").notNull(),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => certItems.id),
  },
  (table) => [
    primaryKey({ name: "cert_exam_items_pk", columns: [table.examId, table.taskNumber] }),
    index("idx_cert_exam_items_item").on(table.itemId),
    check("cert_exam_item_task_range", sql`${table.taskNumber} BETWEEN 1 AND 43`),
  ],
);

/**
 * One run of the Rasch calibration over the teacher's whole answer history.
 *
 * Kept as a snapshot with history rather than columns on cert_items: an item's
 * difficulty is an estimate that sharpens as responses accumulate, and seeing
 * it move — or refuse to settle — is itself the signal that something changed
 * about the question or the cohort.
 */
export const certCalibrationRuns = pgTable("cert_calibration_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  teacherId: bigint("teacher_id", { mode: "number" })
    .notNull()
    .references(() => teachers.staffUserId),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  /** Persons and items that survived the extreme-score screen. */
  persons: integer("persons").notNull(),
  items: integer("items").notNull(),
  iterations: integer("iterations").notNull(),
  converged: boolean("converged").notNull(),
});

export const certItemCalibrations = pgTable(
  "cert_item_calibrations",
  {
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => certCalibrationRuns.id),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => certItems.id),
    /** Logits. Higher is harder. Comparable across variants — that is the point. */
    difficulty: doublePrecision("difficulty").notNull(),
    standardError: doublePrecision("standard_error").notNull(),
    infit: doublePrecision("infit").notNull(),
    outfit: doublePrecision("outfit").notNull(),
    responses: integer("responses").notNull(),
    // Только у заданий с баллами (41–43): пороги перехода между ступенями по
    // частично-кредитной модели. difficulty у них — среднее этих порогов.
    thresholds: doublePrecision("thresholds").array(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.itemId] }),
    index("idx_item_calibrations_item").on(table.itemId),
  ],
);

export const certExamAttempts = pgTable(
  "cert_exam_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    examId: bigint("exam_id", { mode: "number" })
      .notNull()
      .references(() => certExams.id),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => teachers.staffUserId),
    attemptNumber: integer("attempt_number").notNull(),
    status: certExamAttemptStatusEnum("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Frozen at submit time against the deadline as it stood then — same
    // reasoning as homework_submissions.is_late.
    isLate: boolean("is_late"),
    autoScore: integer("auto_score"),
    manualScore: integer("manual_score"),
    totalScore: integer("total_score"),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).references(() => staffUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewCommentText: text("review_comment_text"),
  },
  (table) => [
    uniqueIndex("cert_attempts_unique").on(table.examId, table.studentId, table.attemptNumber),
    index("idx_cert_attempts_exam_student").on(table.examId, table.studentId),
    index("idx_cert_attempts_pending_review")
      .on(table.examId)
      .where(sql`${table.status} = 'submitted'`),
    check(
      "cert_attempt_submitted_consistent",
      sql`(${table.status} = 'in_progress' AND ${table.submittedAt} IS NULL)
        OR (${table.status} IN ('submitted','reviewed') AND ${table.submittedAt} IS NOT NULL)`,
    ),
    check(
      "cert_attempt_reviewed_consistent",
      sql`(${table.status} <> 'reviewed' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
        OR (${table.status} = 'reviewed' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Ключ открытого задания: до шести частей, у каждой несколько допустимых
 * написаний. Баллы здесь не хранятся — они делятся между частями поровну
 * (см. splitPoints в lib/certExam.ts), поэтому число, которое можно
 * рассинхронизировать с максимумом задания, просто не заводится.
 */
export const certItemAnswerKeys = pgTable(
  "cert_item_answer_keys",
  {
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => certItems.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    accepted: text("accepted").array().notNull(),
  },
  (table) => [
    primaryKey({ name: "cert_item_answer_keys_pk", columns: [table.itemId, table.partIndex] }),
    check("cert_answer_key_part_range", sql`${table.partIndex} BETWEEN 1 AND 6`),
    check("cert_answer_key_not_empty", sql`array_length(${table.accepted}, 1) >= 1`),
  ],
);

export const certExamAnswers = pgTable(
  "cert_exam_answers",
  {
    attemptId: bigint("attempt_id", { mode: "number" })
      .notNull()
      .references(() => certExamAttempts.id, { onDelete: "cascade" }),
    taskNumber: integer("task_number").notNull(),
    // Denormalized from cert_exam_items: statistics group by question, and
    // resolving it through the exam on every read would make the item-bank
    // queries a three-table join for no benefit.
    itemId: bigint("item_id", { mode: "number" }).references(() => certItems.id),
    // Closed tasks (1–35): the picked letter, and the verdict frozen at
    // submit time so a later key correction can't silently rewrite history.
    chosenOption: text("chosen_option"),
    isCorrect: boolean("is_correct"),
    // Open tasks (36–43): photographed solution + the teacher's points.
    photoFileIds: text("photo_file_ids").array(),
    awardedPoints: integer("awarded_points"),
    // Открытые задания в режиме "typed": что ученик набрал по каждой части
    // и вердикт по ней. Вердикт замораживается при сдаче — по той же
    // причине, что и is_correct у закрытых: поздняя правка ключа не должна
    // переписывать уже сданную работу.
    typedAnswers: text("typed_answers").array(),
    partCorrect: boolean("part_correct").array(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "cert_exam_answers_pk", columns: [table.attemptId, table.taskNumber] }),
    check("cert_answer_task_range", sql`${table.taskNumber} BETWEEN 1 AND 43`),
    check(
      "cert_answer_closed_shape",
      sql`${table.taskNumber} > 35 OR (${table.photoFileIds} IS NULL AND ${table.awardedPoints} IS NULL
        AND ${table.typedAnswers} IS NULL AND ${table.partCorrect} IS NULL)`,
    ),
    check(
      "cert_answer_open_shape",
      sql`${table.taskNumber} <= 35 OR (${table.chosenOption} IS NULL AND ${table.isCorrect} IS NULL)`,
    ),
    index("idx_cert_answers_item").on(table.itemId),
    check(
      "cert_answer_points_nonnegative",
      sql`${table.awardedPoints} IS NULL OR ${table.awardedPoints} >= 0`,
    ),
  ],
);
