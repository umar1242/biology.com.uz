import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  courseAccess,
  courseDisciplinaryEvents,
  courses,
  lessons,
  modules,
} from "../db/schema.js";
import { isTrialExhausted, lessonsConsumedSince } from "../lib/trial.js";
import { alertStaff } from "../telegram/notify.js";

/**
 * Freezes students whose free trial has been used up without payment.
 *
 * "Frozen" is deliberately mild: they keep their place in the course group and
 * can still see everything, they just cannot act (no lesson video to chat, no
 * homework submission, no cert exam — enforced in lib/studentAccess.ts).
 * Removing them from the Telegram group is a separate, manual decision the
 * teacher makes from the dashboard's removal queue, because a student who
 * asks for a few more days to pay should be able to stay.
 */
export async function runTrialExpirySweep(): Promise<void> {
  const rows = await db
    .select({ access: courseAccess, allowance: courses.trialLessonCount })
    .from(courseAccess)
    .innerJoin(courses, eq(courses.id, courseAccess.courseId))
    .where(
      and(
        eq(courseAccess.isTrial, true),
        eq(courseAccess.isFrozen, false),
        eq(courseAccess.revoked, false),
      ),
    );
  if (rows.length === 0) return;

  // One query for every course in play rather than one per student: a course
  // with 40 trial students would otherwise mean 40 identical lesson scans.
  const courseIds = [...new Set(rows.map((r) => r.access.courseId))];
  const lessonRows = await db
    .select({ courseId: modules.courseId, publishedAt: lessons.isPublished })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds));

  const publishedByCourse = new Map<number, (Date | null)[]>();
  for (const row of lessonRows) {
    const list = publishedByCourse.get(row.courseId) ?? [];
    list.push(row.publishedAt);
    publishedByCourse.set(row.courseId, list);
  }

  for (const { access, allowance } of rows) {
    // A trial row without a start date can't be measured — leave it alone
    // rather than guessing and freezing someone who just signed up.
    if (!access.trialStartedAt) continue;

    const consumed = lessonsConsumedSince(
      publishedByCourse.get(access.courseId) ?? [],
      access.trialStartedAt,
    );
    if (!isTrialExhausted(consumed, allowance)) continue;

    const frozenAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(courseAccess)
        .set({ isFrozen: true, frozenAt, frozenReason: "trial_expired", updatedAt: frozenAt })
        .where(eq(courseAccess.id, access.id));
      await tx.insert(courseDisciplinaryEvents).values({
        courseId: access.courseId,
        studentId: access.studentId,
        teacherId: access.teacherId,
        eventType: "trial_expired_freeze",
        pointsDelta: 0,
        reason: `Пробный период исчерпан: уроков после записи ${consumed}, бесплатно ${allowance}`,
      });
    });

    // Outside the transaction on purpose — a Telegram hiccup must not roll
    // back a freeze that already happened. The next sweep won't re-notify:
    // the row is no longer in the selection above.
    await alertStaff({
      staffId: access.teacherId,
      courseId: access.courseId,
      studentId: access.studentId,
      payload: { access_id: access.id, lessons_consumed: consumed },
      alert: { kind: "trial_expired", lessonsConsumed: consumed, allowance },
    });
  }
}
