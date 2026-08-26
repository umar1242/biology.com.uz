import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { assistantCoursePermissions, courses, homeworks, lessons, modules } from "../db/schema.js";
import type { StaffSession } from "../auth/jwt.js";
import { Forbidden, NotFound } from "./errors.js";

/**
 * Loads a course and enforces tenant + (for assistants) per-course access.
 * Every course-scoped route funnels through this — it's the one place that
 * has to get multi-tenant isolation right, per db/schema.sql §8.
 */
export async function loadAccessibleCourse(auth: StaffSession, courseId: number) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course || course.teacherId !== auth.teacherId) {
    // Same 404 whether the course doesn't exist or belongs to another
    // tenant — a 403 here would confirm the id exists cross-tenant.
    throw NotFound("Course not found");
  }

  if (auth.role === "assistant") {
    const [perm] = await db
      .select()
      .from(assistantCoursePermissions)
      .where(
        and(
          eq(assistantCoursePermissions.assistantId, auth.staffId),
          eq(assistantCoursePermissions.courseId, courseId),
        ),
      )
      .limit(1);
    if (!perm) throw NotFound("Course not found");
  }

  return course;
}

export async function loadAccessibleModule(auth: StaffSession, moduleId: number) {
  const [module_] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!module_) throw NotFound("Module not found");
  await loadAccessibleCourse(auth, module_.courseId); // throws NotFound if not accessible
  return module_;
}

export async function loadAccessibleLesson(auth: StaffSession, lessonId: number) {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson) throw NotFound("Lesson not found");
  await loadAccessibleModule(auth, lesson.moduleId);
  return lesson;
}

/** Pure lookup, no auth — resolves the course a lesson belongs to. */
export async function resolveCourseIdForLesson(lessonId: number): Promise<number> {
  const [row] = await db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (!row) throw NotFound("Lesson not found");
  return row.courseId;
}

/** Pure lookup, no auth — resolves the course a homework belongs to. */
export async function resolveCourseIdForHomework(
  homeworkId: number,
): Promise<{ courseId: number; lessonId: number }> {
  const [hw] = await db.select().from(homeworks).where(eq(homeworks.id, homeworkId)).limit(1);
  if (!hw) throw NotFound("Homework not found");
  const courseId = await resolveCourseIdForLesson(hw.lessonId);
  return { courseId, lessonId: hw.lessonId };
}

type AssistantCapability = "canReviewHomework" | "canManageAccess" | "canManageBlacklist";

/**
 * Course ids an assistant can act on — optionally narrowed to a specific
 * capability (e.g. only courses where can_manage_access is granted, not
 * just any permission row). Returns null for a teacher, meaning "all of my
 * courses" — callers filter by teacherId directly in that case rather than
 * enumerating ids.
 */
export async function accessibleCourseIds(
  auth: StaffSession,
  capability?: AssistantCapability,
): Promise<number[] | null> {
  if (auth.role === "teacher") return null;

  const conditions = [eq(assistantCoursePermissions.assistantId, auth.staffId)];
  if (capability) conditions.push(eq(assistantCoursePermissions[capability], true));

  const perms = await db
    .select({ courseId: assistantCoursePermissions.courseId })
    .from(assistantCoursePermissions)
    .where(and(...conditions));
  return perms.map((p) => p.courseId);
}

/**
 * Enforces tenant access AND (for assistants) a specific granted capability
 * on the course — existence of a permission row is not enough, since a
 * teacher can grant e.g. can_manage_access without can_review_homework.
 * A teacher always passes: full rights within their own tenant.
 */
export async function requireCourseCapability(
  auth: StaffSession,
  courseId: number,
  capability: AssistantCapability,
) {
  await loadAccessibleCourse(auth, courseId);
  if (auth.role === "teacher") return;

  const [perm] = await db
    .select()
    .from(assistantCoursePermissions)
    .where(
      and(
        eq(assistantCoursePermissions.assistantId, auth.staffId),
        eq(assistantCoursePermissions.courseId, courseId),
      ),
    )
    .limit(1);
  if (!perm || !perm[capability]) {
    throw Forbidden(`Missing ${capability} permission for this course`);
  }
}
