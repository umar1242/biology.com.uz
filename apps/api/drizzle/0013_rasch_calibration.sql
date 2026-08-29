-- Rasch calibration of the question bank.
--
-- Stored as runs with history rather than columns on cert_items: a difficulty
-- is an estimate that sharpens as responses accumulate, and watching it move
-- is itself informative.
CREATE TABLE "cert_calibration_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"teacher_id" bigint NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"persons" integer NOT NULL,
	"items" integer NOT NULL,
	"iterations" integer NOT NULL,
	"converged" boolean NOT NULL
);--> statement-breakpoint
ALTER TABLE "cert_calibration_runs" ADD CONSTRAINT "cert_calibration_runs_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "cert_item_calibrations" (
	"run_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"difficulty" double precision NOT NULL,
	"standard_error" double precision NOT NULL,
	"infit" double precision NOT NULL,
	"outfit" double precision NOT NULL,
	"responses" integer NOT NULL,
	CONSTRAINT "cert_item_calibrations_run_id_item_id_pk" PRIMARY KEY("run_id","item_id")
);--> statement-breakpoint
ALTER TABLE "cert_item_calibrations" ADD CONSTRAINT "cert_item_calibrations_run_id_cert_calibration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cert_calibration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_item_calibrations" ADD CONSTRAINT "cert_item_calibrations_item_id_cert_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cert_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_item_calibrations_item" ON "cert_item_calibrations" USING btree ("item_id");
