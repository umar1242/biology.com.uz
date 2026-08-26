import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { courseAccess, courseBlacklist, coursePenaltyPoints, courses, students } from "../../db/schema.js";
import { requireStudentAuth } from "../../plugins/studentAuth.js";
import { NotFound, Unprocessable } from "../../lib/errors.js";
import { z } from "zod";

type AccessStatus = "pending" | "active" | "expired_pending" | "revoked";

function accessStatus(row: { accessGranted: boolean; revoked: boolean; expiresAt: Date | null }): AccessStatus {
  if (row.revoked) return "revoked";
  if (!row.accessGranted) return "pending"; // registered via bot, awaiting teacher's grant
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return "expired_pending";
  return "active";
}

const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/app/profile", async (request) => {
    const auth = requireStudentAuth(request);

    const [student] = await db.select().from(students).where(eq(students.id, auth.studentId)).limit(1);
    if (!student) throw NotFound("Student not found");

    const rows = await db
      .select({
        access: courseAccess,
        courseTitle: courses.title,
        points: coursePenaltyPoints.currentPoints,
        blacklisted: courseBlacklist.isBlacklisted,
      })
      .from(courseAccess)
      .innerJoin(courses, eq(courses.id, courseAccess.courseId))
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
      .where(eq(courseAccess.studentId, auth.studentId));

    return {
      telegram_username: student.telegramUsername,
      first_name: student.firstName,
      language: student.language,
      courses: rows.map((r) => ({
        course_id: r.access.courseId,
        title: r.courseTitle,
        access_status: accessStatus(r.access),
        penalty_points: r.points ?? 0,
        is_blacklisted: r.blacklisted ?? false,
      })),
    };
  });

  // Persisted server-side, not just in the browser: the bot reads this to
  // decide which language a deadline reminder or homework verdict goes out in.
  app.patch("/app/profile/language", async (request) => {
    const auth = requireStudentAuth(request);
    const body = z.object({ language: z.enum(["ru", "uz"]) }).safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [updated] = await db
      .update(students)
      .set({ language: body.data.language, updatedAt: new Date() })
      .where(eq(students.id, auth.studentId))
      .returning({ language: students.language });
    return { language: updated.language };
  });
};

export default profileRoutes;
