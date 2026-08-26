import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { assistantCoursePermissions, courseTelegramGroups, courses } from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import { loadAccessibleCourse } from "../lib/access.js";
import { Unprocessable } from "../lib/errors.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";
import { getBotUsername } from "../telegram/bot.js";

const createCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  subject: z.enum(["biology", "chemistry"]),
});

const updateCourseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});

const courseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/courses", async (request) => {
    const auth = requireAuth(request);

    if (auth.role === "teacher") {
      return db.select().from(courses).where(eq(courses.teacherId, auth.teacherId));
    }

    // Assistant: only courses they've been explicitly granted onto.
    const rows = await db
      .select({ course: courses })
      .from(assistantCoursePermissions)
      .innerJoin(courses, eq(courses.id, assistantCoursePermissions.courseId))
      .where(eq(assistantCoursePermissions.assistantId, auth.staffId));
    return rows.map((r) => r.course);
  });

  app.post("/courses", async (request, reply) => {
    const auth = requireTeacher(request);
    const body = createCourseSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [course] = await db
      .insert(courses)
      .values({
        teacherId: auth.teacherId,
        title: body.data.title,
        description: body.data.description,
        subject: body.data.subject,
      })
      .returning();

    reply.code(201).send(course);
  });

  app.get("/courses/:id", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    return loadAccessibleCourse(auth, id);
  });

  app.patch("/courses/:id", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleCourse(auth, id);

    const body = updateCourseSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);
    if (Object.keys(body.data).length === 0) throw Unprocessable("No fields to update");

    const [updated] = await db
      .update(courses)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(courses.id, id))
      .returning();
    return updated;
  });

  app.post("/courses/:id/archive", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleCourse(auth, id);

    const [updated] = await db
      .update(courses)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(courses.id, id))
      .returning();
    return updated;
  });

  app.get("/courses/:id/telegram-group", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleCourse(auth, id);

    const [group] = await db
      .select()
      .from(courseTelegramGroups)
      .where(eq(courseTelegramGroups.courseId, id))
      .limit(1);
    return group ?? { linked: false };
  });

  /**
   * The enrolment link a teacher hands to students. The bot has always
   * understood `?start=course_<id>` (telegram/handlers.ts), but nothing ever
   * produced the URL — a teacher had to know the format and assemble it by
   * hand, so in practice there was no way to add students to a course at all.
   *
   * Unlike the pending-action deep links, this one carries no token: it is
   * meant to be reused for the whole group and never expires. Opening it only
   * registers a request for access — the teacher still grants it explicitly.
   */
  app.get("/courses/:id/invite-link", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleCourse(auth, id);

    const username = await getBotUsername();
    return { invite_link: `https://t.me/${username}?start=course_${id}` };
  });

  app.post("/courses/:id/telegram-group/link-start", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleCourse(auth, id);

    const deepLink = await createPendingActionDeepLink({
      actionType: "link_course_group",
      targetCourseId: id,
    });
    return { deep_link: deepLink };
  });
};

export default courseRoutes;
