CREATE TYPE "public"."cert_exam_attempt_status" AS ENUM('in_progress', 'submitted', 'reviewed');--> statement-breakpoint
ALTER TYPE "public"."bot_pending_action_type" ADD VALUE 'attach_cert_variant';--> statement-breakpoint
ALTER TYPE "public"."bot_pending_action_type" ADD VALUE 'submit_cert_task';--> statement-breakpoint
CREATE TABLE "cert_exams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"title" text NOT NULL,
	"variant_file_id" text,
	"variant_file_name" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "cert_exam_answer_keys" (
	"exam_id" bigint NOT NULL,
	"task_number" integer NOT NULL,
	"correct_option" text NOT NULL,
	CONSTRAINT "cert_exam_answer_keys_pk" PRIMARY KEY("exam_id","task_number"),
	CONSTRAINT "cert_key_task_range" CHECK ("task_number" BETWEEN 1 AND 35),
	CONSTRAINT "cert_key_option_valid" CHECK (
		("task_number" <= 32 AND "correct_option" IN ('A','B','C','D'))
		OR ("task_number" >= 33 AND "correct_option" IN ('A','B','C','D','E','F'))
	)
);--> statement-breakpoint
CREATE TABLE "cert_exam_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exam_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"teacher_id" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "cert_exam_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean,
	"auto_score" integer,
	"manual_score" integer,
	"total_score" integer,
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"review_comment_text" text,
	CONSTRAINT "cert_attempts_unique" UNIQUE("exam_id","student_id","attempt_number"),
	CONSTRAINT "cert_attempt_submitted_consistent" CHECK (
		("status" = 'in_progress' AND "submitted_at" IS NULL)
		OR ("status" IN ('submitted','reviewed') AND "submitted_at" IS NOT NULL)
	),
	CONSTRAINT "cert_attempt_reviewed_consistent" CHECK (
		("status" <> 'reviewed' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
		OR ("status" = 'reviewed' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
	)
);--> statement-breakpoint
CREATE TABLE "cert_exam_answers" (
	"attempt_id" bigint NOT NULL,
	"task_number" integer NOT NULL,
	"chosen_option" text,
	"photo_file_ids" text[],
	"is_correct" boolean,
	"awarded_points" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_exam_answers_pk" PRIMARY KEY("attempt_id","task_number"),
	CONSTRAINT "cert_answer_task_range" CHECK ("task_number" BETWEEN 1 AND 43),
	CONSTRAINT "cert_answer_closed_shape" CHECK (
		"task_number" > 35 OR ("photo_file_ids" IS NULL AND "awarded_points" IS NULL)
	),
	CONSTRAINT "cert_answer_open_shape" CHECK (
		"task_number" <= 35 OR ("chosen_option" IS NULL AND "is_correct" IS NULL)
	),
	CONSTRAINT "cert_answer_points_nonnegative" CHECK ("awarded_points" IS NULL OR "awarded_points" >= 0)
);--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "target_cert_exam_id" bigint;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "target_cert_attempt_id" bigint;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "target_task_number" integer;--> statement-breakpoint
ALTER TABLE "cert_exams" ADD CONSTRAINT "cert_exams_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exams" ADD CONSTRAINT "cert_exams_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_answer_keys" ADD CONSTRAINT "cert_exam_answer_keys_exam_id_cert_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."cert_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_attempts" ADD CONSTRAINT "cert_exam_attempts_exam_id_cert_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."cert_exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_attempts" ADD CONSTRAINT "cert_exam_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_attempts" ADD CONSTRAINT "cert_exam_attempts_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_attempts" ADD CONSTRAINT "cert_exam_attempts_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_answers" ADD CONSTRAINT "cert_exam_answers_attempt_id_cert_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."cert_exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_target_cert_exam_id_cert_exams_id_fk" FOREIGN KEY ("target_cert_exam_id") REFERENCES "public"."cert_exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_target_cert_attempt_id_cert_exam_attempts_id_fk" FOREIGN KEY ("target_cert_attempt_id") REFERENCES "public"."cert_exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cert_exams_course" ON "cert_exams" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_cert_exams_deadline" ON "cert_exams" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "idx_cert_attempts_exam_student" ON "cert_exam_attempts" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_cert_attempts_pending_review" ON "cert_exam_attempts" USING btree ("exam_id") WHERE "status" = 'submitted';
