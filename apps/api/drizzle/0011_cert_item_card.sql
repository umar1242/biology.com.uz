ALTER TABLE "cert_items" ADD COLUMN "stem_text" text;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "cognitive_level" integer;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "cert_items" ADD COLUMN "key_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cert_items" ADD CONSTRAINT "cert_item_status_valid" CHECK ("status" IN ('active','retired'));--> statement-breakpoint
ALTER TABLE "cert_items" ADD CONSTRAINT "cert_item_cognitive_valid" CHECK ("cognitive_level" IS NULL OR "cognitive_level" IN (1,2));--> statement-breakpoint
ALTER TABLE "cert_items" ADD CONSTRAINT "cert_items_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cert_items_status" ON "cert_items" USING btree ("teacher_id","status");
