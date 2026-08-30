-- Эталонный вариант: тот, к чьей шкале приводятся результаты остальных.
-- NULL — платформа берёт вариант с наибольшим числом откалиброванных заданий,
-- то есть тот, чья шкала опирается на самые надёжные измерения.
ALTER TABLE "teachers" ADD COLUMN "cert_reference_exam_id" bigint
  REFERENCES "cert_exams"("id") ON DELETE SET NULL;
