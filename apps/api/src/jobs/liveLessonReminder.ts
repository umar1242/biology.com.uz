import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { notifyStudent, wasNotifiedRecently } from "../telegram/notify.js";
import { formatDate, formatDateTime, t } from "../lib/i18n.js";
import { languageForStaff, languageForStudent } from "../lib/language.js";

const DEDUPE_MS = 2 * 60 * 60 * 1000; // one reminder per lesson is enough within a 30-min lead window

type Row = {
  lesson_id: string;
  scheduled_at: string;
  title: string;
  live_call_link: string | null;
  course_id: string;
  student_id: string;
  telegram_id: string;
};

/** Reminds enrolled students ~30 minutes before a mandatory live lesson starts. */
export async function runLiveLessonReminder(): Promise<void> {
  const rows = await db.execute<Row>(sql`
    SELECT l.id AS lesson_id, l.scheduled_at, l.title, l.live_call_link, m.course_id,
           s.id AS student_id, s.telegram_id
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    JOIN course_access ca ON ca.course_id = m.course_id AND ca.access_granted = true AND ca.revoked = false
    JOIN students s ON s.id = ca.student_id
    LEFT JOIN course_blacklist cb ON cb.course_id = m.course_id AND cb.student_id = ca.student_id
    WHERE l.lesson_type = 'live' AND l.is_published IS NOT NULL
      AND l.scheduled_at > now() AND l.scheduled_at <= now() + interval '30 minutes'
      AND (cb.is_blacklisted IS NULL OR cb.is_blacklisted = false)
  `);

  for (const r of rows) {
    const lessonId = Number(r.lesson_id);
    const studentId = Number(r.student_id);

    const already = await wasNotifiedRecently({
      notificationType: "live_lesson_reminder",
      recipientStudentId: studentId,
      payloadKey: "lesson_id",
      payloadValue: lessonId,
      withinMs: DEDUPE_MS,
    });
    if (already) continue;

    const lang = await languageForStudent(studentId);
    const startsAt = formatDateTime(lang, new Date(r.scheduled_at));
    await notifyStudent({
      studentId,
      telegramId: Number(r.telegram_id),
      notificationType: "live_lesson_reminder",
      courseId: Number(r.course_id),
      text: r.live_call_link
        ? t(lang, "notifyLiveLessonWithLink", {
            lesson: r.title,
            time: startsAt,
            link: r.live_call_link,
          })
        : t(lang, "notifyLiveLesson", { lesson: r.title, time: startsAt }),
      payload: { lesson_id: lessonId },
    });
  }
}
