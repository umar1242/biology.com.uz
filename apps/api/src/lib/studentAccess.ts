import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { courseAccess, courseBlacklist, courses, lessons, modules } from "../db/schema.js";
import { AppError, NotFound } from "./errors.js";
import { resolveCourseIdForHomework } from "./access.js";

/**
 * Blocks the actions a frozen (unpaid-after-trial) student may not take:
 * pulling a lesson video into chat, submitting homework, sitting a cert exam.
 * Deliberately NOT part of loadStudentAccessibleCourse — a frozen student
 * keeps full read access and still sees the whole course, so freezing shows
 * up only at the moment they try to do something.
 *
 * 403 with a distinct code rather than 404: the Mini App turns `access_frozen`
 * into an explanatory banner, and hiding the reason would just look broken.
 */
export async function assertNotFrozen(studentId: number, courseId: number): Promise<void> {
  const [access] = await db
    .select({ isFrozen: courseAccess.isFrozen })
    .from(courseAccess)
    .where(and(eq(courseAccess.studentId, studentId), eq(courseAccess.courseId, courseId)))
    .limit(1);
  if (access?.isFrozen) {
    throw new AppError(
      403,
      "access_frozen",
      "Доступ приостановлен: пробный период закончился. Свяжитесь с преподавателем.",
    );
  }
}

/**
 * Loads a course and enforces the student-facing visibility rule from
 * docs/api-design.md §3: access_granted AND NOT revoked AND NOT blacklisted.
 * Same 404-not-403 policy as the staff-side loadAccessibleCourse — doesn't
 * confirm whether the course exists at all to someone without access to it.
 */
export async function loadStudentAccessibleCourse(studentId: number, courseId: number) {
  const [access] = await db
    .select()
    .from(courseAccess)
    .where(and(eq(courseAccess.studentId, studentId), eq(courseAccess.courseId, courseId)))
    .limit(1);
  if (!access || !access.accessGranted || access.revoked) throw NotFound("Course not found");

  const [blacklist] = await db
    .select()
    .from(courseBlacklist)
    .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
    .limit(1);
  if (blacklist?.isBlacklisted) throw NotFound("Course not found");

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw NotFound("Course not found");
  return course;
}

export async function loadStudentAccessibleModule(studentId: number, moduleId: number) {
  const [module_] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!module_) throw NotFound("Module not found");
  await loadStudentAccessibleCourse(studentId, module_.courseId);
  return module_;
}

/** Also enforces that the lesson is published — drafts are invisible to students. */
export async function loadStudentAccessibleLesson(studentId: number, lessonId: number) {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson || !lesson.isPublished) throw NotFound("Lesson not found");
  await loadStudentAccessibleModule(studentId, lesson.moduleId);
  return lesson;
}

export async function loadStudentAccessibleHomeworkContext(studentId: number, homeworkId: number) {
  const { courseId, lessonId } = await resolveCourseIdForHomework(homeworkId);
  await loadStudentAccessibleCourse(studentId, courseId);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson?.isPublished) throw NotFound("Homework not found");
  return { courseId, lessonId };
}
