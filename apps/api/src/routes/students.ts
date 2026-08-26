import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  courseAccess,
  courseBlacklist,
  courseDisciplinaryEvents,
  coursePenaltyPoints,
  courses,
  homeworkSubmissions,
  homeworks,
  lessons,
  modules,
  students,
} from "../db/schema.js";
import { requireAuth } from "../plugins/auth.js";
import { accessibleCourseIds, loadAccessibleCourse, requireCourseCapability } from "../lib/access.js";
import { Conflict, NotFound, Unprocessable } from "../lib/errors.js";
import { inviteStudentToCourseGroup, removeStudentFromCourseGroup } from "../telegram/groupMembership.js";
import { notifyStaff } from "../telegram/notify.js";

async function getStudentTelegramId(studentId: number): Promise<number | null> {
  const [row] = await db.select({ telegramId: students.telegramId }).from(students).where(eq(students.id, studentId)).limit(1);
  return row?.telegramId ?? null;
}

const grantAccessSchema = z.object({ expires_at: z.coerce.date() });

const blacklistSchema = z.object({ reason: z.string().min(1).optional() });

const studentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/courses/:courseId/students", async (request) => {
    const auth = requireAuth(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    const rows = await db
      .select({
        access: courseAccess,
        student: students,
        points: coursePenaltyPoints.currentPoints,
        blacklisted: courseBlacklist.isBlacklisted,
      })
      .from(courseAccess)
      .innerJoin(students, eq(students.id, courseAccess.studentId))
      .leftJoin(
        coursePenaltyPoints,
        and(
          eq(coursePenaltyPoints.courseId, courseAccess.courseId),
          eq(coursePenaltyPoints.studentId, courseAccess.studentId),
        ),
      )
      .leftJoin(
        courseBlacklist,
        and(
          eq(courseBlacklist.courseId, courseAccess.courseId),
          eq(courseBlacklist.studentId, courseAccess.studentId),
        ),
      )
      .where(eq(courseAccess.courseId, courseId));

    const [{ homeworkTotal }] = await db
      .select({ homeworkTotal: sql<number>`count(*)::int` })
      .from(homeworks)
      .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, courseId));

    const passedRows = await db
      .select({
        studentId: homeworkSubmissions.studentId,
        passed: sql<number>`count(distinct ${homeworkSubmissions.homeworkId})::int`,
      })
      .from(homeworkSubmissions)
      .innerJoin(homeworks, eq(homeworks.id, homeworkSubmissions.homeworkId))
      .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(homeworkSubmissions.status, "passed")))
      .groupBy(homeworkSubmissions.studentId);
    const passedByStudent = new Map(passedRows.map((r) => [r.studentId, r.passed]));

    return rows.map((r) => ({
      student_id: r.student.id,
      telegram_username: r.student.telegramUsername,
      first_name: r.student.firstName,
      access_granted: r.access.accessGranted,
      expires_at: r.access.expiresAt,
      revoked: r.access.revoked,
      penalty_points: r.points ?? 0,
      is_blacklisted: r.blacklisted ?? false,
      progress_summary: { homework_total: homeworkTotal, homework_passed: passedByStudent.get(r.student.id) ?? 0 },
    }));
  });

  app.get("/students/:id", async (request) => {
    const auth = requireAuth(request);
    const studentId = Number((request.params as { id: string }).id);
    const allowedCourseIds = await accessibleCourseIds(auth);

    const rows = await db
      .select({ access: courseAccess, student: students })
      .from(courseAccess)
      .innerJoin(students, eq(students.id, courseAccess.studentId))
      .where(
        allowedCourseIds
          ? and(
              eq(courseAccess.studentId, studentId),
              eq(courseAccess.teacherId, auth.teacherId),
              inArray(courseAccess.courseId, allowedCourseIds),
            )
          : and(eq(courseAccess.studentId, studentId), eq(courseAccess.teacherId, auth.teacherId)),
      );

    if (rows.length === 0) throw NotFound("Student not found");

    return {
      student_id: studentId,
      telegram_username: rows[0].student.telegramUsername,
      first_name: rows[0].student.firstName,
      last_name: rows[0].student.lastName,
      courses: rows.map((r) => ({
        course_id: r.access.courseId,
        access_granted: r.access.accessGranted,
        expires_at: r.access.expiresAt,
        revoked: r.access.revoked,
      })),
    };
  });

  app.post("/courses/:courseId/students/:studentId/access", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageAccess");

    const body = grantAccessSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
    if (!student) throw NotFound("Student not found");

    const [access] = await db
      .insert(courseAccess)
      .values({
        courseId,
        studentId,
        teacherId: auth.teacherId,
        accessGranted: true,
        grantedAt: new Date(),
        grantedBy: auth.staffId,
        expiresAt: body.data.expires_at,
        revoked: false,
        revokedAt: null,
        revokedBy: null,
      })
      .onConflictDoUpdate({
        target: [courseAccess.courseId, courseAccess.studentId],
        set: {
          accessGranted: true,
          grantedAt: new Date(),
          grantedBy: auth.staffId,
          expiresAt: body.data.expires_at,
          revoked: false,
          revokedAt: null,
          revokedBy: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Bots can't add a user to a group directly — this DMs the invite link.
    // Awaited but errors are swallowed inside the helper (returns false) —
    // a delivery failure (e.g. student never started the bot) shouldn't
    // fail the access grant itself, which already succeeded.
    await inviteStudentToCourseGroup(courseId, student.telegramId, student.id);

    return access;
  });

  app.patch("/courses/:courseId/students/:studentId/access", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageAccess");

    const body = grantAccessSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [existing] = await db
      .select()
      .from(courseAccess)
      .where(and(eq(courseAccess.courseId, courseId), eq(courseAccess.studentId, studentId)))
      .limit(1);
    if (!existing || !existing.accessGranted || existing.revoked) {
      throw NotFound("No active (non-revoked) access to extend — grant access first");
    }

    const [updated] = await db
      .update(courseAccess)
      .set({ expiresAt: body.data.expires_at, updatedAt: new Date() })
      .where(and(eq(courseAccess.courseId, courseId), eq(courseAccess.studentId, studentId)))
      .returning();
    return updated;
  });

  app.post("/courses/:courseId/students/:studentId/access/revoke", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageAccess");

    const [updated] = await db
      .update(courseAccess)
      .set({ revoked: true, revokedAt: new Date(), revokedBy: auth.staffId, updatedAt: new Date() })
      .where(and(eq(courseAccess.courseId, courseId), eq(courseAccess.studentId, studentId)))
      .returning();
    if (!updated) throw NotFound("No access record for this student on this course");

    const telegramId = await getStudentTelegramId(studentId);
    if (telegramId) await removeStudentFromCourseGroup(courseId, telegramId);

    return updated;
  });

  app.get("/access/expiring", async (request) => {
    const auth = requireAuth(request);
    // Scoped to canManageAccess specifically, not just any permission —
    // an assistant who can only review homework shouldn't see billing status.
    const allowedCourseIds = await accessibleCourseIds(auth, "canManageAccess");
    if (allowedCourseIds && allowedCourseIds.length === 0) return [];

    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(courseAccess)
      .where(
        and(
          eq(courseAccess.teacherId, auth.teacherId),
          eq(courseAccess.accessGranted, true),
          eq(courseAccess.revoked, false),
          lte(courseAccess.expiresAt, soon),
          allowedCourseIds ? inArray(courseAccess.courseId, allowedCourseIds) : undefined,
        ),
      );

    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      status: r.expiresAt && r.expiresAt.getTime() < now ? "expired" : "expiring_soon",
    }));
  });

  app.get("/courses/:courseId/students/:studentId/penalty", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await loadAccessibleCourse(auth, courseId);

    const [points] = await db
      .select()
      .from(coursePenaltyPoints)
      .where(and(eq(coursePenaltyPoints.courseId, courseId), eq(coursePenaltyPoints.studentId, studentId)))
      .limit(1);
    const [blacklist] = await db
      .select()
      .from(courseBlacklist)
      .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
      .limit(1);
    const events = await db
      .select()
      .from(courseDisciplinaryEvents)
      .where(
        and(
          eq(courseDisciplinaryEvents.courseId, courseId),
          eq(courseDisciplinaryEvents.studentId, studentId),
        ),
      )
      .orderBy(desc(courseDisciplinaryEvents.createdAt));

    return {
      current_points: points?.currentPoints ?? 0,
      is_blacklisted: blacklist?.isBlacklisted ?? false,
      events,
    };
  });

  app.post("/courses/:courseId/students/:studentId/penalty/reset", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageBlacklist");

    await db.transaction(async (tx) => {
      await tx
        .insert(coursePenaltyPoints)
        .values({ courseId, studentId, currentPoints: 0 })
        .onConflictDoUpdate({
          target: [coursePenaltyPoints.courseId, coursePenaltyPoints.studentId],
          set: { currentPoints: 0, updatedAt: new Date() },
        });
      await tx.insert(courseDisciplinaryEvents).values({
        courseId,
        studentId,
        teacherId: auth.teacherId,
        eventType: "points_reset",
        pointsDelta: 0,
        actorStaffId: auth.staffId,
      });
    });

    return { current_points: 0 };
  });

  app.post("/courses/:courseId/students/:studentId/blacklist", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageBlacklist");

    const body = blacklistSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    await db.transaction(async (tx) => {
      await tx
        .insert(courseBlacklist)
        .values({ courseId, studentId, isBlacklisted: true, blacklistedAt: new Date() })
        .onConflictDoUpdate({
          target: [courseBlacklist.courseId, courseBlacklist.studentId],
          set: { isBlacklisted: true, blacklistedAt: new Date(), updatedAt: new Date() },
        });
      await tx.insert(courseDisciplinaryEvents).values({
        courseId,
        studentId,
        teacherId: auth.teacherId,
        eventType: "manual_blacklist",
        pointsDelta: 0,
        reason: body.data.reason,
        actorStaffId: auth.staffId,
      });
    });

    const telegramId = await getStudentTelegramId(studentId);
    if (telegramId) await removeStudentFromCourseGroup(courseId, telegramId);

    const [course] = await db.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)).limit(1);
    await notifyStaff({
      staffId: auth.teacherId,
      notificationType: "blacklist_event",
      courseId,
      text: `🚫 Ученик #${studentId} заблокирован на курсе «${course?.title ?? courseId}»${body.data.reason ? `: ${body.data.reason}` : ""}`,
    });

    return { is_blacklisted: true };
  });

  app.post("/courses/:courseId/students/:studentId/blacklist/clear", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { courseId: string; studentId: string };
    const courseId = Number(params.courseId);
    const studentId = Number(params.studentId);
    await requireCourseCapability(auth, courseId, "canManageBlacklist");

    const [existing] = await db
      .select()
      .from(courseBlacklist)
      .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
      .limit(1);
    if (!existing?.isBlacklisted) throw Conflict("Student is not currently blacklisted on this course");

    await db.transaction(async (tx) => {
      await tx
        .update(courseBlacklist)
        .set({ isBlacklisted: false, updatedAt: new Date() })
        .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)));
      await tx.insert(courseDisciplinaryEvents).values({
        courseId,
        studentId,
        teacherId: auth.teacherId,
        eventType: "manual_blacklist_clear",
        pointsDelta: 0,
        actorStaffId: auth.staffId,
      });
    });

    // Re-invite if they still hold active (non-revoked) access — they were
    // removed from the group when blacklisted, per the shared removal path.
    const [access] = await db
      .select()
      .from(courseAccess)
      .where(and(eq(courseAccess.courseId, courseId), eq(courseAccess.studentId, studentId)))
      .limit(1);
    if (access?.accessGranted && !access.revoked) {
      const telegramId = await getStudentTelegramId(studentId);
      if (telegramId) await inviteStudentToCourseGroup(courseId, telegramId, studentId);
    }

    return { is_blacklisted: false };
  });
};

export default studentRoutes;
