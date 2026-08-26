CREATE TYPE "public"."bot_pending_action_type" AS ENUM('attach_lesson_recording', 'submit_homework');--> statement-breakpoint
CREATE TYPE "public"."course_subject" AS ENUM('biology', 'chemistry');--> statement-breakpoint
CREATE TYPE "public"."disciplinary_event_type" AS ENUM('missed_homework_deadline', 'manual_point_adjustment', 'points_reset', 'auto_blacklist', 'manual_blacklist', 'manual_blacklist_clear');--> statement-breakpoint
CREATE TYPE "public"."lesson_material_type" AS ENUM('video', 'text', 'file');--> statement-breakpoint
CREATE TYPE "public"."lesson_type" AS ENUM('live', 'recorded');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('private_chat', 'group_chat');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_type" AS ENUM('student', 'staff');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('live_lesson_reminder', 'homework_deadline_reminder', 'new_material_published', 'access_expiring_soon', 'access_expired', 'blacklist_event', 'unreviewed_homework_summary');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'teacher', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'passed', 'needs_resubmission');--> statement-breakpoint
CREATE TABLE "assistant_course_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"assistant_id" bigint NOT NULL,
	"course_id" bigint NOT NULL,
	"can_review_homework" boolean DEFAULT true NOT NULL,
	"can_manage_access" boolean DEFAULT false NOT NULL,
	"can_manage_blacklist" boolean DEFAULT false NOT NULL,
	"granted_by" bigint NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistants" (
	"staff_user_id" bigint PRIMARY KEY NOT NULL,
	"teacher_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_pending_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"action_type" "bot_pending_action_type" NOT NULL,
	"target_lesson_id" bigint,
	"target_homework_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "course_access" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"access_granted" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone,
	"granted_by" bigint,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expiry_required_when_granted" CHECK ("course_access"."access_granted" = false OR "course_access"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "course_blacklist" (
	"course_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"is_blacklisted" boolean DEFAULT false NOT NULL,
	"blacklisted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_blacklist_course_id_student_id_pk" PRIMARY KEY("course_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "course_disciplinary_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"event_type" "disciplinary_event_type" NOT NULL,
	"points_delta" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"related_homework_id" bigint,
	"actor_staff_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_penalty_points" (
	"course_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"current_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_penalty_points_course_id_student_id_pk" PRIMARY KEY("course_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "course_telegram_groups" (
	"course_id" bigint PRIMARY KEY NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"invite_link" text,
	"bot_is_member" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_telegram_groups_telegram_chat_id_unique" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"teacher_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"subject" "course_subject" NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"homework_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"photo_file_ids" text[] NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_late" boolean NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"review_comment_text" text,
	"review_comment_voice_file_id" text,
	CONSTRAINT "photo_array_nonempty" CHECK (array_length("homework_submissions"."photo_file_ids", 1) >= 1),
	CONSTRAINT "review_comment_single_form" CHECK (NOT ("homework_submissions"."review_comment_text" IS NOT NULL AND "homework_submissions"."review_comment_voice_file_id" IS NOT NULL)),
	CONSTRAINT "reviewed_fields_consistent" CHECK (("homework_submissions"."status" = 'pending' AND "homework_submissions"."reviewed_by" IS NULL AND "homework_submissions"."reviewed_at" IS NULL)
        OR ("homework_submissions"."status" IN ('passed','needs_resubmission') AND "homework_submissions"."reviewed_by" IS NOT NULL AND "homework_submissions"."reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "homeworks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lesson_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"instructions" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homeworks_lesson_id_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_materials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lesson_id" bigint NOT NULL,
	"material_type" "lesson_material_type" NOT NULL,
	"order_index" integer NOT NULL,
	"text_content" text,
	"telegram_file_id" text,
	"file_name" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_fields_consistent" CHECK (("lesson_materials"."material_type" = 'text' AND "lesson_materials"."text_content" IS NOT NULL AND "lesson_materials"."telegram_file_id" IS NULL)
        OR ("lesson_materials"."material_type" IN ('video','file') AND "lesson_materials"."telegram_file_id" IS NOT NULL AND "lesson_materials"."text_content" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"module_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"order_index" integer NOT NULL,
	"lesson_type" "lesson_type" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"live_call_link" text,
	"live_recording_file_id" text,
	"recorded_video_file_id" text,
	"is_published" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_type_fields_consistent" CHECK (("lessons"."lesson_type" = 'live' AND "lessons"."recorded_video_file_id" IS NULL)
        OR ("lessons"."lesson_type" = 'recorded' AND "lessons"."live_call_link" IS NULL AND "lessons"."live_recording_file_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_student_id" bigint,
	"recipient_staff_id" bigint,
	"course_id" bigint,
	"channel" "notification_channel" NOT NULL,
	"telegram_message_id" bigint,
	"payload" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exactly_one_recipient" CHECK (("notifications_log"."recipient_type" = 'student' AND "notifications_log"."recipient_student_id" IS NOT NULL AND "notifications_log"."recipient_staff_id" IS NULL)
        OR ("notifications_log"."recipient_type" = 'staff' AND "notifications_log"."recipient_staff_id" IS NOT NULL AND "notifications_log"."recipient_student_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role" "staff_role" NOT NULL,
	"telegram_id" bigint,
	"username" "citext",
	"password_hash" text,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "staff_users_username_unique" UNIQUE("username"),
	CONSTRAINT "staff_auth_method_matches_role" CHECK (("staff_users"."role" = 'owner' AND "staff_users"."telegram_id" IS NOT NULL AND "staff_users"."username" IS NULL AND "staff_users"."password_hash" IS NULL)
        OR ("staff_users"."role" IN ('teacher', 'assistant') AND "staff_users"."telegram_id" IS NULL AND "staff_users"."username" IS NOT NULL AND "staff_users"."password_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" text,
	"first_name" text NOT NULL,
	"last_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"staff_user_id" bigint PRIMARY KEY NOT NULL,
	"penalty_point_threshold" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_course_permissions" ADD CONSTRAINT "assistant_course_permissions_assistant_id_assistants_staff_user_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_course_permissions" ADD CONSTRAINT "assistant_course_permissions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_course_permissions" ADD CONSTRAINT "assistant_course_permissions_granted_by_staff_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_target_lesson_id_lessons_id_fk" FOREIGN KEY ("target_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_target_homework_id_homeworks_id_fk" FOREIGN KEY ("target_homework_id") REFERENCES "public"."homeworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_granted_by_staff_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_revoked_by_staff_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_blacklist" ADD CONSTRAINT "course_blacklist_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_blacklist" ADD CONSTRAINT "course_blacklist_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_disciplinary_events" ADD CONSTRAINT "course_disciplinary_events_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_disciplinary_events" ADD CONSTRAINT "course_disciplinary_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_disciplinary_events" ADD CONSTRAINT "course_disciplinary_events_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_disciplinary_events" ADD CONSTRAINT "course_disciplinary_events_related_homework_id_homeworks_id_fk" FOREIGN KEY ("related_homework_id") REFERENCES "public"."homeworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_disciplinary_events" ADD CONSTRAINT "course_disciplinary_events_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_penalty_points" ADD CONSTRAINT "course_penalty_points_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_penalty_points" ADD CONSTRAINT "course_penalty_points_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_telegram_groups" ADD CONSTRAINT "course_telegram_groups_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_homework_id_homeworks_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homeworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_recipient_student_id_students_id_fk" FOREIGN KEY ("recipient_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_recipient_staff_id_staff_users_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_course_permissions_assistant_id_course_id_key" ON "assistant_course_permissions" USING btree ("assistant_id","course_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_perms_course" ON "assistant_course_permissions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_assistants_teacher" ON "assistants" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "idx_pending_actions_lookup" ON "bot_pending_actions" USING btree ("telegram_id","action_type") WHERE "bot_pending_actions"."consumed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "course_access_course_id_student_id_key" ON "course_access" USING btree ("course_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_course_access_student" ON "course_access" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_course_access_expiry_watch" ON "course_access" USING btree ("expires_at") WHERE "course_access"."access_granted" = true AND "course_access"."revoked" = false;--> statement-breakpoint
CREATE INDEX "idx_disc_events_student_course" ON "course_disciplinary_events" USING btree ("course_id","student_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_missed_homework_once" ON "course_disciplinary_events" USING btree ("student_id","related_homework_id") WHERE "course_disciplinary_events"."event_type" = 'missed_homework_deadline';--> statement-breakpoint
CREATE INDEX "idx_courses_teacher" ON "courses" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "homework_submissions_homework_id_student_id_attempt_number_key" ON "homework_submissions" USING btree ("homework_id","student_id","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_submissions_homework_student" ON "homework_submissions" USING btree ("homework_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_pending" ON "homework_submissions" USING btree ("homework_id") WHERE "homework_submissions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_homeworks_deadline" ON "homeworks" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_materials_lesson" ON "lesson_materials" USING btree ("lesson_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_module_id_order_index_key" ON "lessons" USING btree ("module_id","order_index");--> statement-breakpoint
CREATE INDEX "idx_lessons_module" ON "lessons" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "idx_lessons_live_schedule" ON "lessons" USING btree ("scheduled_at") WHERE "lessons"."lesson_type" = 'live';--> statement-breakpoint
CREATE UNIQUE INDEX "modules_course_id_order_index_key" ON "modules" USING btree ("course_id","order_index");--> statement-breakpoint
CREATE INDEX "idx_modules_course" ON "modules" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_student" ON "notifications_log" USING btree ("recipient_student_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_staff" ON "notifications_log" USING btree ("recipient_staff_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_course_type" ON "notifications_log" USING btree ("course_id","notification_type","sent_at");