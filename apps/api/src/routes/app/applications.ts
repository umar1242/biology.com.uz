import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  courseAccess,
  courseApplications,
  courseBlacklist,
  courses,
  students,
} from "../../db/schema.js";
import { requireStudentAuth } from "../../plugins/studentAuth.js";
import { AppError, Conflict, NotFound, Unprocessable } from "../../lib/errors.js";
import { inviteStudentToCourseGroup } from "../../telegram/groupMembership.js";
import { applicationTargetFor } from "../../lib/studentOnboarding.js";
import { alertStaff } from "../../telegram/notify.js";

// Uzbek numbers are entered in several shapes (+998 90 123 45 67, 909…,
// with or without spaces/dashes), so validate on digits rather than a strict
// format and keep whatever the student typed for the teacher to read.
const phoneSchema = z
  .string()
  .trim()
  .min(7, "Слишком короткий номер")
  .max(20)
  .refine((v) => (v.match(/\d/g) ?? []).length >= 7, "Номер должен содержать минимум 7 цифр");

const applicationSchema = z.object({
  full_name: z.string().trim().min(3).max(200),
  phone: phoneSchema,
  parent_phone_primary: phoneSchema,
  parent_phone_secondary: phoneSchema.optional().or(z.literal("")),
  about_self: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * A blacklisted student must not be able to walk back in through the course
 * link: submitting the form grants access AND has the bot send the group
 * invite, so without this check the blacklist could be undone by anyone who
 * still had the link.
 */
async function assertNotBlacklisted(studentId: number, courseId: number): Promise<void> {
  const [row] = await db
    .select({ isBlacklisted: courseBlacklist.isBlacklisted })
    .from(courseBlacklist)
    .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
    .limit(1);
  if (row?.isBlacklisted) {
    throw new AppError(
      403,
      "blacklisted",
      "Запись на этот курс закрыта. Обратитесь к преподавателю.",
    );
  }
}

const updateApplicationSchema = applicationSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "Нечего обновлять",
);

const appApplicationRoutes: FastifyPluginAsync = async (app) => {
  /** The student's own questionnaires, one per course, for the profile tab. */
  app.get("/app/applications", async (request) => {
    const auth = requireStudentAuth(request);

    const rows = await db
      .select({ application: courseApplications, courseTitle: courses.title })
      .from(courseApplications)
      .innerJoin(courses, eq(courses.id, courseApplications.courseId))
      .where(eq(courseApplications.studentId, auth.studentId));

    return rows.map(({ application, courseTitle }) => ({
      id: application.id,
      course_id: application.courseId,
      course_title: courseTitle,
      full_name: application.fullName,
      phone: application.phone,
      parent_phone_primary: application.parentPhonePrimary,
      parent_phone_secondary: application.parentPhoneSecondary,
      about_self: application.aboutSelf,
      submitted_at: application.submittedAt,
    }));
  });

  /**
   * Editing an already-submitted questionnaire. Only the answers change —
   * course and student are fixed, so this can never be used to move an
   * application onto a different course or to enrol somewhere new.
   */
  app.patch("/app/applications/:id", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);

    const body = updateApplicationSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [existing] = await db
      .select()
      .from(courseApplications)
      .where(eq(courseApplications.id, id))
      .limit(1);
    // 404 rather than 403 for someone else's application — same policy as the
    // rest of the student API, which never confirms what it will not show.
    if (!existing || existing.studentId !== auth.studentId) throw NotFound("Application not found");

    const d = body.data;
    const [updated] = await db
      .update(courseApplications)
      .set({
        ...(d.full_name !== undefined ? { fullName: d.full_name } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.parent_phone_primary !== undefined
          ? { parentPhonePrimary: d.parent_phone_primary }
          : {}),
        ...(d.parent_phone_secondary !== undefined
          ? { parentPhoneSecondary: d.parent_phone_secondary || null }
          : {}),
        ...(d.about_self !== undefined ? { aboutSelf: d.about_self || null } : {}),
      })
      .where(eq(courseApplications.id, id))
      .returning();

    return {
      id: updated.id,
      course_id: updated.courseId,
      full_name: updated.fullName,
      phone: updated.phone,
      parent_phone_primary: updated.parentPhonePrimary,
      parent_phone_secondary: updated.parentPhoneSecondary,
      about_self: updated.aboutSelf,
      submitted_at: updated.submittedAt,
    };
  });

  /**
   * Which course the "not onboarded yet" gate screen should send the student
   * to. Reachable before onboarding by design — it is what makes the gate a
   * dead end with a way out rather than just a dead end.
   */
  app.get("/app/application-target", async (request) => {
    const auth = requireStudentAuth(request);
    return { target: await applicationTargetFor(auth.studentId, auth.telegramId) };
  });

  /**
   * Everything the questionnaire's intro screen needs. Deliberately does NOT
   * go through loadStudentAccessibleCourse: the whole point is that the
   * student has no access to this course yet.
   */
  app.get("/app/courses/:id/application-context", async (request) => {
    const auth = requireStudentAuth(request);
    const courseId = Number((request.params as { id: string }).id);

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course || course.isArchived) throw NotFound("Course not found");
    await assertNotBlacklisted(auth.studentId, courseId);

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, auth.studentId))
      .limit(1);

    const [existing] = await db
      .select({ id: courseApplications.id })
      .from(courseApplications)
      .where(
        and(
          eq(courseApplications.courseId, courseId),
          eq(courseApplications.studentId, auth.studentId),
        ),
      )
      .limit(1);

    return {
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        subject: course.subject,
        trial_lesson_count: course.trialLessonCount,
      },
      // Pre-fills the form: the student confirms this number rather than
      // retyping it, since it is the one Telegram already verified.
      verified_phone: student?.phone ?? null,
      full_name_suggestion: [student?.firstName, student?.lastName].filter(Boolean).join(" "),
      already_submitted: Boolean(existing),
    };
  });

  /**
   * Submitting the questionnaire is what enrols the student: it stores the
   * answers, opens trial access, and has the bot send the group invite — the
   * teacher approves nothing. Students who never pay are filtered out later
   * by jobs/trialExpirySweep.ts, not at the door.
   */
  app.post("/app/courses/:id/application", async (request, reply) => {
    const auth = requireStudentAuth(request);
    const courseId = Number((request.params as { id: string }).id);

    const body = applicationSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course || course.isArchived) throw NotFound("Course not found");
    await assertNotBlacklisted(auth.studentId, courseId);

    const [existing] = await db
      .select({ id: courseApplications.id })
      .from(courseApplications)
      .where(
        and(
          eq(courseApplications.courseId, courseId),
          eq(courseApplications.studentId, auth.studentId),
        ),
      )
      .limit(1);
    if (existing) throw Conflict("Анкета на этот курс уже подана");

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(courseApplications).values({
        courseId,
        studentId: auth.studentId,
        fullName: body.data.full_name,
        phone: body.data.phone,
        parentPhonePrimary: body.data.parent_phone_primary,
        parentPhoneSecondary: body.data.parent_phone_secondary || null,
        aboutSelf: body.data.about_self || null,
      });

      // A row may already exist from the old pre-questionnaire flow (pending,
      // never granted) — turn it into trial access rather than colliding on
      // the (course, student) unique index.
      await tx
        .insert(courseAccess)
        .values({
          courseId,
          studentId: auth.studentId,
          teacherId: course.teacherId,
          accessGranted: true,
          grantedAt: now,
          isTrial: true,
          trialStartedAt: now,
        })
        .onConflictDoUpdate({
          target: [courseAccess.courseId, courseAccess.studentId],
          set: {
            accessGranted: true,
            grantedAt: now,
            revoked: false,
            revokedAt: null,
            isTrial: true,
            trialStartedAt: now,
            isFrozen: false,
            frozenAt: null,
            frozenReason: null,
            updatedAt: now,
          },
        });
    });

    // Outside the transaction: a Telegram failure must not undo an accepted
    // application. The student can always be re-invited from the dashboard.
    const invited = await inviteStudentToCourseGroup(courseId, auth.telegramId, auth.studentId);
    if (!invited) {
      request.log.warn(
        { courseId, studentId: auth.studentId },
        "application accepted but course group invite could not be sent",
      );
    }

    // The teacher learns about a new student here and nowhere else in real
    // time — before this, an application only showed up if someone happened
    // to open the dashboard. The invite outcome rides along in the same
    // message: whether the student actually got into the group is the first
    // thing anyone asks next.
    await alertStaff({
      staffId: course.teacherId,
      courseId,
      studentId: auth.studentId,
      alert: {
        kind: "application_submitted",
        phone: body.data.phone,
        parentPhone: body.data.parent_phone_primary,
        parentPhoneSecondary: body.data.parent_phone_secondary || null,
        aboutSelf: body.data.about_self || null,
        inviteSent: invited,
      },
    });

    reply.code(201).send({ ok: true, invite_sent: invited });
  });
};

export default appApplicationRoutes;
