CREATE TYPE "public"."language" AS ENUM('ru', 'uz');--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "language" "language" DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "language" "language" DEFAULT 'ru' NOT NULL;