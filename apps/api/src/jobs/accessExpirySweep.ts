import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { courseAccess, courses } from "../db/schema.js";
import { alertStaff, wasNotifiedRecently } from "../telegram/notify.js";

const ADVANCE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // idea-platforma-kursy.md §8: warn ~3 days ahead
const DEDUPE_ADVANCE_MS = 24 * 60 * 60 * 1000; // at most one advance warning per day
const DEDUPE_RECURRING_MS = 24 * 60 * 60 * 1000; // at most one post-expiry nag per day

/**
 * Access never auto-revokes (by design — the teacher decides). This job is
 * the "keep nagging until they act" half of that design: an advance warning
 * before expiry, then a recurring reminder after, until access is revoked.
 */
export async function runAccessExpirySweep(): Promise<void> {
  const now = new Date();
  const soon = new Date(now.getTime() + ADVANCE_WINDOW_MS);

  const rows = await db
    .select({ access: courseAccess, courseTitle: courses.title })
    .from(courseAccess)
    .innerJoin(courses, eq(courses.id, courseAccess.courseId))
    .where(
      and(eq(courseAccess.accessGranted, true), eq(courseAccess.revoked, false), lte(courseAccess.expiresAt, soon)),
    );

  for (const { access, courseTitle } of rows) {
    if (!access.expiresAt) continue;
    const expired = access.expiresAt.getTime() < now.getTime();
    const notificationType = expired ? "access_expired" : "access_expiring_soon";
    const dedupeMs = expired ? DEDUPE_RECURRING_MS : DEDUPE_ADVANCE_MS;

    const already = await wasNotifiedRecently({
      notificationType,
      recipientStaffId: access.teacherId,
      payloadKey: "access_id",
      payloadValue: access.id,
      withinMs: dedupeMs,
    });
    if (already) continue;

    await alertStaff({
      staffId: access.teacherId,
      courseId: access.courseId,
      studentId: access.studentId,
      payload: { access_id: access.id },
      alert: expired
        ? { kind: "access_expired", expiresAt: access.expiresAt }
        : { kind: "access_expiring", expiresAt: access.expiresAt },
    });
  }
}
