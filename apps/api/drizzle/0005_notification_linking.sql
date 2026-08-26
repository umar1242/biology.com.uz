ALTER TYPE "public"."bot_pending_action_type" ADD VALUE 'link_staff_notifications';--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "target_staff_id" bigint;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "notification_telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_target_staff_id_staff_users_id_fk" FOREIGN KEY ("target_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_notification_telegram_id_unique" UNIQUE("notification_telegram_id");