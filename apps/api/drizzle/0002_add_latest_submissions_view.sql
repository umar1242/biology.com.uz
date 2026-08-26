-- Latest attempt per (homework, student) — what the review queue and
-- student progress screens actually want. Not modeled in schema.ts (see
-- comment there) to avoid pinning to a specific drizzle-orm view API.
CREATE VIEW latest_homework_submissions AS
SELECT DISTINCT ON (homework_id, student_id) *
FROM homework_submissions
ORDER BY homework_id, student_id, attempt_number DESC;
