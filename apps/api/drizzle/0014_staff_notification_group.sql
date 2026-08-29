-- Staff notifications move from a personal DM to a shared admin group, and
-- gain four new event types.
--
-- Enum labels first and each on its own statement: Postgres cannot use a
-- newly added label inside the transaction that adds it.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'application_submitted';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'cert_attempt_submitted';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'student_removed';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'group_invite_failed';--> statement-breakpoint
ALTER TYPE "bot_pending_action_type" ADD VALUE IF NOT EXISTS 'link_staff_group';--> statement-breakpoint

-- One notification group per teacher. UNIQUE on the chat id so the same
-- Telegram group cannot quietly become the inbox of two teachers at once.
CREATE TABLE IF NOT EXISTS "staff_notification_groups" (
  "teacher_id" bigint PRIMARY KEY REFERENCES "teachers"("staff_user_id"),
  "telegram_chat_id" bigint NOT NULL UNIQUE,
  "title" text,
  "linked_by_staff_id" bigint REFERENCES "staff_users"("id"),
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
