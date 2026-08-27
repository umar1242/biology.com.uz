ALTER TABLE "cert_exams" ADD COLUMN "variant_file_kind" text;--> statement-breakpoint
ALTER TABLE "cert_exams" ADD CONSTRAINT "cert_variant_file_kind_valid" CHECK ("variant_file_kind" IS NULL OR "variant_file_kind" IN ('photo','document'));
