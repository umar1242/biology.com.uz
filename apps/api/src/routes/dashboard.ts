import type { FastifyPluginAsync } from "fastify";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  courseAccess,
  courseBlacklist,
  coursePenaltyPoints,
  courses,
  homeworkSubmissions,
  homeworks,
  lessons,
  modules,
  teachers,
} from "../db/schema.js";
import { requireAuth } from "../plugins/auth.js";
import { accessibleCourseIds } from "../lib/access.js";

const EXPIRY_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const UPCOMING_LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard/summary", async (request) => {
    const auth = requireAuth(request);

    // Each metric uses the capability that actually gates the corresponding
    // action, matching /review-queue and /access/expiring — an assistant
    // only sees numbers for courses they could act on.
    const reviewCourseIds = await accessibleCourseIds(auth, "canReviewHomework");
    const accessCourseIds = await accessibleCourseIds(auth, "canManageAccess");
    const blacklistCourseIds = await accessibleCourseIds(auth, "canManageBlacklist");
    const anyCourseIds = await accessibleCourseIds(auth);

    if (reviewCourseIds?.length === 0 && accessCourseIds?.length === 0 && anyCourseIds?.length === 0) {
      return {
        active_students: 0,
        unreviewed_homework_count: 0,
        upcoming_live_lessons: 0,
        access_needing_attention_count: 0,
        students_near_blacklist_threshold: 0,
      };
    }

    const now = new Date();
    const expirySoon = new Date(now.getTime() + EXPIRY_WARNING_WINDOW_MS);
    const liveWindowEnd = new Date(now.getTime() + UPCOMING_LIVE_WINDOW_MS);

    const [
      [{ activeStudents }],
      [{ unreviewedHomework }],
      [{ upcomingLive }],
      [{ accessNeedingAttention }],
      [{ nearThreshold }],
    ] = await Promise.all([
      db
        .select({ activeStudents: sql<number>`count(distinct ${courseAccess.studentId})::int` })
        .from(courseAccess)
        .where(
          and(
            eq(courseAccess.teacherId, auth.teacherId),
            eq(courseAccess.accessGranted, true),
            eq(courseAccess.revoked, false),
            anyCourseIds ? inArray(courseAccess.courseId, anyCourseIds) : undefined,
          ),
        ),

      db
        .select({ unreviewedHomework: sql<number>`count(*)::int` })
        .from(homeworkSubmissions)
        .innerJoin(homeworks, eq(homeworks.id, homeworkSubmissions.homeworkId))
        .innerJoin(lessons, eq(lessons.id, homeworks.lessonId))
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(
          and(
            eq(homeworkSubmissions.teacherId, auth.teacherId),
            eq(homeworkSubmissions.status, "pending"),
            reviewCourseIds ? inArray(modules.courseId, reviewCourseIds) : undefined,
          ),
        ),

      db
        .select({ upcomingLive: sql<number>`count(*)::int` })
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(
          and(
            eq(lessons.teacherId, auth.teacherId),
            eq(lessons.lessonType, "live"),
            gte(lessons.scheduledAt, now),
            lte(lessons.scheduledAt, liveWindowEnd),
            anyCourseIds ? inArray(modules.courseId, anyCourseIds) : undefined,
          ),
        ),

      db
        .select({ accessNeedingAttention: sql<number>`count(*)::int` })
        .from(courseAccess)
        .where(
          and(
            eq(courseAccess.teacherId, auth.teacherId),
            eq(courseAccess.accessGranted, true),
            eq(courseAccess.revoked, false),
            lte(courseAccess.expiresAt, expirySoon),
            accessCourseIds ? inArray(courseAccess.courseId, accessCourseIds) : undefined,
          ),
        ),

      db
        .select({ nearThreshold: sql<number>`count(*)::int` })
        .from(coursePenaltyPoints)
        .innerJoin(courses, eq(courses.id, coursePenaltyPoints.courseId))
        .innerJoin(teachers, eq(teachers.staffUserId, courses.teacherId))
        .leftJoin(
          courseBlacklist,
          and(
            eq(courseBlacklist.courseId, coursePenaltyPoints.courseId),
            eq(courseBlacklist.studentId, coursePenaltyPoints.studentId),
          ),
        )
        .where(
          and(
            eq(courses.teacherId, auth.teacherId),
            gte(coursePenaltyPoints.currentPoints, sql`${teachers.penaltyPointThreshold} - 1`),
            sql`coalesce(${courseBlacklist.isBlacklisted}, false) = false`,
            blacklistCourseIds ? inArray(coursePenaltyPoints.courseId, blacklistCourseIds) : undefined,
          ),
        ),
    ]);

    return {
      active_students: activeStudents,
      unreviewed_homework_count: unreviewedHomework,
      upcoming_live_lessons: upcomingLive,
      access_needing_attention_count: accessNeedingAttention,
      students_near_blacklist_threshold: nearThreshold,
    };
  });
};

export default dashboardRoutes;
