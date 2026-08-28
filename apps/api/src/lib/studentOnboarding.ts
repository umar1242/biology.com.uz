import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  botPendingActions,
  courseAccess,
  courseApplications,
  courseBlacklist,
  courses,
} from "../db/schema.js";

/**
 * Whether this student may use the Mini App at all.
 *
 * The rule is exactly "has filled the enrolment questionnaire" — nothing else
 * counts. Course access on its own deliberately does NOT open the app: a
 * student enrolled through the old flow still has to fill the form, which is
 * the point of having one. The gate screen offers them a button straight to
 * it (see applicationTargetFor).
 */
export async function isStudentOnboarded(studentId: number): Promise<boolean> {
  const [application] = await db
    .select({ id: courseApplications.id })
    .from(courseApplications)
    .where(eq(courseApplications.studentId, studentId))
    .limit(1);
  return Boolean(application);
}

/**
 * Which course the gate screen's "fill it in" button should open.
 *
 * Two sources, in order of how strong a signal they are:
 *   1. the last course link this person opened in the bot — they were on their
 *      way to this exact course's form;
 *   2. failing that, a course they already have access to — this is the path
 *      for students enrolled before the questionnaire existed, who otherwise
 *      would see a gate with nowhere to go.
 *
 * Blacklisted courses are skipped: barred students must not be handed a route
 * back in (the form itself refuses them too).
 */
export async function applicationTargetFor(
  studentId: number,
  telegramId: number,
): Promise<{ course_id: number; title: string } | null> {
  const intents = await db
    .select({ courseId: botPendingActions.targetCourseId })
    .from(botPendingActions)
    .where(
      and(
        eq(botPendingActions.telegramId, telegramId),
        eq(botPendingActions.actionType, "course_application"),
      ),
    )
    .orderBy(desc(botPendingActions.createdAt))
    .limit(5);

  const fallback = await db
    .select({ courseId: courseAccess.courseId })
    .from(courseAccess)
    .where(eq(courseAccess.studentId, studentId))
    .orderBy(desc(courseAccess.createdAt))
    .limit(5);

  const candidates = [
    ...intents.map((r) => r.courseId),
    ...fallback.map((r) => r.courseId),
  ].filter((id): id is number => id !== null);

  for (const courseId of candidates) {
    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course || course.isArchived) continue;

    const [blacklist] = await db
      .select({ isBlacklisted: courseBlacklist.isBlacklisted })
      .from(courseBlacklist)
      .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
      .limit(1);
    if (blacklist?.isBlacklisted) continue;

    return { course_id: course.id, title: course.title };
  }
  return null;
}
