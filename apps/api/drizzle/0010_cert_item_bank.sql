CREATE TABLE "cert_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"teacher_id" bigint NOT NULL,
	"task_number" integer NOT NULL,
	"correct_option" text,
	"topic" text NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_item_task_range" CHECK ("task_number" BETWEEN 1 AND 43),
	CONSTRAINT "cert_item_option_valid" CHECK (
		("task_number" > 35 AND "correct_option" IS NULL)
		OR ("task_number" <= 32 AND "correct_option" IN ('A','B','C','D'))
		OR ("task_number" BETWEEN 33 AND 35 AND "correct_option" IN ('A','B','C','D','E','F'))
	)
);--> statement-breakpoint
CREATE TABLE "cert_exam_items" (
	"exam_id" bigint NOT NULL,
	"task_number" integer NOT NULL,
	"item_id" bigint NOT NULL,
	CONSTRAINT "cert_exam_items_pk" PRIMARY KEY("exam_id","task_number"),
	CONSTRAINT "cert_exam_item_task_range" CHECK ("task_number" BETWEEN 1 AND 43)
);--> statement-breakpoint
ALTER TABLE "cert_exam_answers" ADD COLUMN "item_id" bigint;--> statement-breakpoint
ALTER TABLE "cert_items" ADD CONSTRAINT "cert_items_teacher_id_teachers_staff_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("staff_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_items" ADD CONSTRAINT "cert_exam_items_exam_id_cert_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."cert_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_items" ADD CONSTRAINT "cert_exam_items_item_id_cert_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cert_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_exam_answers" ADD CONSTRAINT "cert_exam_answers_item_id_cert_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cert_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cert_items_teacher" ON "cert_items" USING btree ("teacher_id","task_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cert_items_source" ON "cert_items" USING btree ("teacher_id","source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_cert_exam_items_item" ON "cert_exam_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_cert_answers_item" ON "cert_exam_answers" USING btree ("item_id");--> statement-breakpoint

-- Backfill: every existing (exam, task) becomes an item carrying that
-- exam's key, so nothing already entered or already answered is lost.
-- Topic comes from the spec's section->task mapping (see lib/certExam.ts).
INSERT INTO "cert_items" ("teacher_id", "task_number", "correct_option", "topic")
SELECT e."teacher_id", k."task_number", k."correct_option",
	CASE
		WHEN k."task_number" = 1 THEN 'life_science'
		WHEN k."task_number" <= 11 THEN 'cell'
		WHEN k."task_number" = 12 THEN 'systematics'
		WHEN k."task_number" <= 19 THEN 'plants_animals'
		WHEN k."task_number" <= 23 THEN 'human'
		WHEN k."task_number" <= 28 THEN 'species_population'
		WHEN k."task_number" <= 32 THEN 'ecosystem'
		ELSE 'logic'
	END
FROM "cert_exam_answer_keys" k
JOIN "cert_exams" e ON e."id" = k."exam_id";--> statement-breakpoint

-- Link each backfilled item to the exam it came from. The join is on the
-- key values because the insert above preserved them one-for-one.
INSERT INTO "cert_exam_items" ("exam_id", "task_number", "item_id")
SELECT k."exam_id", k."task_number", i."id"
FROM "cert_exam_answer_keys" k
JOIN "cert_exams" e ON e."id" = k."exam_id"
JOIN "cert_items" i
	ON i."teacher_id" = e."teacher_id"
	AND i."task_number" = k."task_number"
	AND i."correct_option" = k."correct_option"
	AND i."source_ref" IS NULL;--> statement-breakpoint

-- Open tasks 36–43 had no key row, so they need items created from the
-- exams themselves.
INSERT INTO "cert_items" ("teacher_id", "task_number", "correct_option", "topic")
SELECT e."teacher_id", n, NULL, 'general_bio'
FROM "cert_exams" e CROSS JOIN generate_series(36, 43) n;--> statement-breakpoint

INSERT INTO "cert_exam_items" ("exam_id", "task_number", "item_id")
SELECT e."id", i."task_number", i."id"
FROM "cert_exams" e
JOIN "cert_items" i
	ON i."teacher_id" = e."teacher_id"
	AND i."task_number" BETWEEN 36 AND 43
	AND i."source_ref" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Point existing answers at their item.
UPDATE "cert_exam_answers" a
SET "item_id" = ei."item_id"
FROM "cert_exam_attempts" at
JOIN "cert_exam_items" ei ON ei."exam_id" = at."exam_id"
WHERE a."attempt_id" = at."id" AND ei."task_number" = a."task_number";--> statement-breakpoint

-- The key now lives on the item; keeping the old table would let the two
-- drift apart silently.
DROP TABLE "cert_exam_answer_keys";
