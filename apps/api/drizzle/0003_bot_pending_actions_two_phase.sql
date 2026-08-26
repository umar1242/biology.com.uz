ALTER TABLE "bot_pending_actions" ALTER COLUMN "telegram_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ADD CONSTRAINT "bot_pending_actions_token_unique" UNIQUE("token");