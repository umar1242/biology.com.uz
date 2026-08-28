-- Enrolment questionnaire, trial period and the "frozen for non-payment" state.
--
-- Enum values first: Postgres cannot use a newly added enum label inside the
-- same transaction that adds it, so these run as their own statements before
-- anything references them.
ALTER TYPE "disciplinary_event_type" ADD VALUE IF NOT EXISTS 'trial_expired_freeze';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'trial_expired';--> statement-breakpoint
ALTER TYPE "bot_pending_action_type" ADD VALUE IF NOT EXISTS 'course_application';--> statement-breakpoint

-- Telegram-verified phone. Only ever written from a contact the student
-- shared about themselves (contact.user_id = from.id), never typed in.
ALTER TABLE "students" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint

-- How many published lessons a new student gets free before being frozen.
ALTER TABLE "courses" ADD COLUMN "trial_lesson_count" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "trial_lesson_count_nonnegative" CHECK ("trial_lesson_count" >= 0);--> statement-breakpoint

ALTER TABLE "course_access" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_access" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_access" ADD COLUMN "is_frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_access" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_access" ADD COLUMN "frozen_reason" text;--> statement-breakpoint
ALTER TABLE "course_access" ADD COLUMN "removed_from_group_at" timestamp with time zone;--> statement-breakpoint

-- Trial access is granted immediately but has no expiry date — it ends on a
-- lesson count, so it is the one granted state allowed to leave expires_at
-- NULL. Replaces the stricter original constraint.
ALTER TABLE "course_access" DROP CONSTRAINT "expiry_required_when_granted";--> statement-breakpoint
ALTER TABLE "course_access" ADD CONSTRAINT "expiry_required_when_granted" CHECK ("access_granted" = false OR "expires_at" IS NOT NULL OR "is_trial" = true);--> statement-breakpoint

CREATE INDEX "idx_course_access_trial_watch" ON "course_access" USING btree ("course_id") WHERE "is_trial" = true AND "is_frozen" = false AND "revoked" = false;--> statement-breakpoint

CREATE TABLE "course_applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"parent_phone_primary" text NOT NULL,
	"parent_phone_secondary" text,
	"about_self" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "course_applications" ADD CONSTRAINT "course_applications_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_applications" ADD CONSTRAINT "course_applications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_applications_course_id_student_id_key" ON "course_applications" USING btree ("course_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_course_applications_course" ON "course_applications" USING btree ("course_id");
