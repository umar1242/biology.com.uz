import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { homeworkSubmissions } from "../db/schema.js";
import { notifyStaff, wasNotifiedRecently } from "../telegram/notify.js";
import { formatDate, formatDateTime, t } from "../lib/i18n.js";
import { languageForStaff, languageForStudent } from "../lib/language.js";

const DEDUPE_MS = 20 * 60 * 60 * 1000; // roughly once/day per teacher

/** A once-daily "you have N pending reviews" nudge per teacher. */
export async function runUnreviewedHomeworkDigest(): Promise<void> {
  const rows = await db
    .select({ teacherId: homeworkSubmissions.teacherId, count: sql<number>`count(*)::int` })
    .from(homeworkSubmissions)
    .where(eq(homeworkSubmissions.status, "pending"))
    .groupBy(homeworkSubmissions.teacherId);

  for (const row of rows) {
    if (row.count === 0) continue;

    const already = await wasNotifiedRecently({
      notificationType: "unreviewed_homework_summary",
      recipientStaffId: row.teacherId,
      payloadKey: "digest",
      payloadValue: 1,
      withinMs: DEDUPE_MS,
    });
    if (already) continue;

    const lang = await languageForStaff(row.teacherId);
    await notifyStaff({
      staffId: row.teacherId,
      notificationType: "unreviewed_homework_summary",
      text: t(lang, "notifyUnreviewedDigest", { count: row.count }),
      payload: { digest: 1 },
    });
  }
}
