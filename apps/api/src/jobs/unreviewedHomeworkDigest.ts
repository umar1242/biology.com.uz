import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { homeworkSubmissions } from "../db/schema.js";
import { alertStaff, wasNotifiedRecently } from "../telegram/notify.js";

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

    await alertStaff({
      staffId: row.teacherId,
      payload: { digest: 1 },
      alert: { kind: "unreviewed_homework", count: row.count },
    });
  }
}
