-- Открытые задания 36–43: помимо ручной проверки по фотографии появляется
-- ввод ответа с клавиатуры. Режим и ключ живут у задания банка, а не у
-- варианта: вопрос переезжает между вариантами вместе со своим ключом.
ALTER TABLE "cert_items" ADD COLUMN "grading_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cert_items" ADD CONSTRAINT "cert_item_grading_mode_valid"
  CHECK ("grading_mode" IN ('manual','typed')
    AND ("task_number" > 35 OR "grading_mode" = 'manual'));--> statement-breakpoint

-- До шести частей у ответа, у каждой несколько допустимых написаний.
-- Баллы не хранятся: они делятся между частями поровну, и число, которое
-- можно рассинхронизировать с максимумом задания, здесь не заводится.
CREATE TABLE IF NOT EXISTS "cert_item_answer_keys" (
  "item_id" bigint NOT NULL REFERENCES "cert_items"("id") ON DELETE CASCADE,
  "part_index" integer NOT NULL,
  "accepted" text[] NOT NULL,
  CONSTRAINT "cert_item_answer_keys_pk" PRIMARY KEY ("item_id", "part_index"),
  CONSTRAINT "cert_answer_key_part_range" CHECK ("part_index" BETWEEN 1 AND 6),
  CONSTRAINT "cert_answer_key_not_empty" CHECK (array_length("accepted", 1) >= 1)
);--> statement-breakpoint

ALTER TABLE "cert_exam_answers" ADD COLUMN "typed_answers" text[];--> statement-breakpoint
ALTER TABLE "cert_exam_answers" ADD COLUMN "part_correct" boolean[];--> statement-breakpoint

-- Закрытые задания по-прежнему не имеют ничего из открытой части.
ALTER TABLE "cert_exam_answers" DROP CONSTRAINT "cert_answer_closed_shape";--> statement-breakpoint
ALTER TABLE "cert_exam_answers" ADD CONSTRAINT "cert_answer_closed_shape"
  CHECK ("task_number" > 35 OR ("photo_file_ids" IS NULL AND "awarded_points" IS NULL
    AND "typed_answers" IS NULL AND "part_correct" IS NULL));
