import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  courseAccess,
  courseBlacklist,
  courses,
  homeworkSubmissions,
  homeworks,
  lessons,
  modules,
} from "../../db/schema.js";
import { requireStudentAuth } from "../../plugins/studentAuth.js";
import { loadStudentAccessibleHomeworkContext } from "../../lib/studentAccess.js";
import { createPendingActionDeepLink } from "../../telegram/pendingActions.js";
import { NotFound } from "../../lib/errors.js";

const appHomeworkRoutes: FastifyPluginAsync = async (app) => {
  // Flat "all my assignments across all courses" list — not in the original
  // api-design.md (which only had per-homework GET /app/homework/:id), but
  // the Mini App's "Задания" tab needs exactly this to render a real list
  // instead of requiring the student to already know a homework id.
  app.get("/app/homework", async (request) => {
    const auth = requireStudentAuth(request);

    const rows = await db
      .select({
        homework: homeworks,
        lessonTitle: lessons.title,
        courseId: modules.courseId,
        courseTitle: courses.title,
        blacklisted: courseBlacklist.isBlacklisted,
      })
      .from(homeworks)
      .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .innerJoin(
        courseAccess,
        and(
          eq(courseAccess.courseId, modules.courseId),
          eq(courseAccess.studentId, auth.studentId),
          eq(courseAccess.accessGranted, true),
          eq(courseAccess.revoked, false),
        ),
      )
      .leftJoin(
        courseBlacklist,
        and(eq(courseBlacklist.courseId, modules.courseId), eq(courseBlacklist.studentId, auth.studentId)),
      )
      .where(isNotNull(lessons.isPublished))
      .orderBy(desc(homeworks.deadlineAt));

    const visible = rows.filter((r) => !r.blacklisted);
    const homeworkIds = visible.map((r) => r.homework.id);

    const submissions = homeworkIds.length
      ? await db
          .select()
          .from(homeworkSubmissions)
          .where(
            and(eq(homeworkSubmissions.studentId, auth.studentId), inArray(homeworkSubmissions.homeworkId, homeworkIds)),
          )
      : [];

    const latestByHomework = new Map<number, (typeof submissions)[number]>();
    for (const s of submissions) {
      const existing = latestByHomework.get(s.homeworkId);
      if (!existing || s.attemptNumber > existing.attemptNumber) latestByHomework.set(s.homeworkId, s);
    }

    return visible.map((r) => {
      const latest = latestByHomework.get(r.homework.id);
      return {
        id: r.homework.id,
        course_id: r.courseId,
        course_title: r.courseTitle,
        lesson_title: r.lessonTitle,
        deadline_at: r.homework.deadlineAt,
        status: latest?.status ?? "not_submitted",
        is_late: latest?.isLate ?? false,
        submitted_at: latest?.submittedAt ?? null,
      };
    });
  });

  app.get("/app/homework/:id", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadStudentAccessibleHomeworkContext(auth.studentId, id);

    const [row] = await db
      .select({ homework: homeworks, lessonTitle: lessons.title, courseId: modules.courseId, courseTitle: courses.title })
      .from(homeworks)
      .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(eq(homeworks.id, id))
      .limit(1);
    if (!row) throw NotFound("Homework not found");

    return {
      id: row.homework.id,
      course_id: row.courseId,
      course_title: row.courseTitle,
      lesson_title: row.lessonTitle,
      instructions: row.homework.instructions,
      deadline_at: row.homework.deadlineAt,
    };
  });

  app.get("/app/homework/:id/submissions", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadStudentAccessibleHomeworkContext(auth.studentId, id);

    return db
      .select()
      .from(homeworkSubmissions)
      .where(and(eq(homeworkSubmissions.homeworkId, id), eq(homeworkSubmissions.studentId, auth.studentId)))
      .orderBy(asc(homeworkSubmissions.attemptNumber));
  });

  app.post("/app/homework/:id/submit-start", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadStudentAccessibleHomeworkContext(auth.studentId, id);

    const deepLink = await createPendingActionDeepLink({
      actionType: "submit_homework",
      targetHomeworkId: id,
    });
    return { deep_link: deepLink };
  });
};

export default appHomeworkRoutes;
