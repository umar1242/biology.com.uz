import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { notifyStudent, wasNotifiedRecently } from "../telegram/notify.js";
import { formatDate, formatDateTime, t } from "../lib/i18n.js";
import { languageForStaff, languageForStudent } from "../lib/language.js";

const DEDUPE_MS = 20 * 60 * 60 * 1000; // one reminder per homework, ~day-scale window is enough

type Row = {
  homework_id: string;
  deadline_at: string;
  course_id: string;
  lesson_title: string;
  student_id: string;
  telegram_id: string;
};

/** Reminds a student ~24h before a deadline they haven't submitted for yet. */
export async function runHomeworkDeadlineReminder(): Promise<void> {
  const rows = await db.execute<Row>(sql`
    SELECT h.id AS homework_id, h.deadline_at, m.course_id, l.title AS lesson_title,
           s.id AS student_id, s.telegram_id
    FROM homeworks h
    JOIN lessons l ON l.id = h.lesson_id AND l.is_published IS NOT NULL
    JOIN modules m ON m.id = l.module_id
    JOIN course_access ca ON ca.course_id = m.course_id AND ca.access_granted = true AND ca.revoked = false
    JOIN students s ON s.id = ca.student_id
    LEFT JOIN course_blacklist cb ON cb.course_id = m.course_id AND cb.student_id = ca.student_id
    WHERE h.deadline_at > now() AND h.deadline_at <= now() + interval '24 hours'
      AND (cb.is_blacklisted IS NULL OR cb.is_blacklisted = false)
      AND NOT EXISTS (
        SELECT 1 FROM homework_submissions hs
        WHERE hs.homework_id = h.id AND hs.student_id = s.id
      )
  `);

  for (const r of rows) {
    const homeworkId = Number(r.homework_id);
    const studentId = Number(r.student_id);

    const already = await wasNotifiedRecently({
      notificationType: "homework_deadline_reminder",
      recipientStudentId: studentId,
      payloadKey: "homework_id",
      payloadValue: homeworkId,
      withinMs: DEDUPE_MS,
    });
    if (already) continue;

    const lang = await languageForStudent(studentId);
    await notifyStudent({
      studentId,
      telegramId: Number(r.telegram_id),
      notificationType: "homework_deadline_reminder",
      courseId: Number(r.course_id),
      text: t(lang, "notifyHomeworkDeadline", {
        lesson: r.lesson_title,
        time: formatDateTime(lang, new Date(r.deadline_at)),
      }),
      payload: { homework_id: homeworkId },
    });
  }
}
