import type { FastifyPluginAsync } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { lessons } from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import {
  loadAccessibleLesson,
  loadAccessibleModule,
  resolveCourseIdForLesson,
} from "../lib/access.js";
import { Unprocessable } from "../lib/errors.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";

const createLessonSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    lesson_type: z.enum(["live", "recorded"]),
    scheduled_at: z.coerce.date(),
    live_call_link: z.string().url().optional(),
  })
  .superRefine((val, ctx) => {
    // Mirrors the lesson_type_fields_consistent CHECK in db/schema.sql —
    // caught here first for a clearer 422 instead of a raw DB error.
    if (val.lesson_type === "recorded" && val.live_call_link) {
      ctx.addIssue({
        code: "custom",
        path: ["live_call_link"],
        message: "live_call_link is only valid for lesson_type = 'live'",
      });
    }
  });

const updateLessonSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  scheduled_at: z.coerce.date().optional(),
  live_call_link: z.string().url().optional(),
});

const reorderSchema = z.object({
  lesson_ids: z.array(z.number().int().positive()).min(1),
});

const lessonRoutes: FastifyPluginAsync = async (app) => {
  app.get("/modules/:moduleId/lessons", async (request) => {
    const auth = requireAuth(request);
    const moduleId = Number((request.params as { moduleId: string }).moduleId);
    await loadAccessibleModule(auth, moduleId);

    return db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.orderIndex));
  });

  app.post("/modules/:moduleId/lessons", async (request, reply) => {
    const auth = requireTeacher(request);
    const moduleId = Number((request.params as { moduleId: string }).moduleId);
    const module_ = await loadAccessibleModule(auth, moduleId);

    const body = createLessonSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [{ nextIndex }] = await db
      .select({ nextIndex: sql<number>`coalesce(max(${lessons.orderIndex}), 0) + 1` })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId));

    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        teacherId: module_.teacherId,
        title: body.data.title,
        description: body.data.description,
        orderIndex: nextIndex,
        lessonType: body.data.lesson_type,
        scheduledAt: body.data.scheduled_at,
        liveCallLink: body.data.lesson_type === "live" ? body.data.live_call_link : undefined,
      })
      .returning();

    reply.code(201).send(lesson);
  });

  app.get("/lessons/:id", async (request) => {
    const auth = requireAuth(request);
    const id = Number((request.params as { id: string }).id);
    const lesson = await loadAccessibleLesson(auth, id);
    // The lesson page needs its course to offer an "up" link back to the
    // module (route is /courses/:courseId/modules/:moduleId) — a lesson row
    // only carries moduleId, so resolve the course here.
    const courseId = await resolveCourseIdForLesson(id);
    return { ...lesson, courseId };
  });

  app.patch("/lessons/:id", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    const lesson = await loadAccessibleLesson(auth, id);

    const body = updateLessonSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);
    if (Object.keys(body.data).length === 0) throw Unprocessable("No fields to update");
    if (body.data.live_call_link && lesson.lessonType !== "live") {
      throw Unprocessable("live_call_link is only valid for lesson_type = 'live'");
    }

    const { scheduled_at, live_call_link, ...rest } = body.data;
    const [updated] = await db
      .update(lessons)
      .set({
        ...rest,
        ...(scheduled_at !== undefined ? { scheduledAt: scheduled_at } : {}),
        ...(live_call_link !== undefined ? { liveCallLink: live_call_link } : {}),
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, id))
      .returning();
    return updated;
  });

  app.delete("/lessons/:id", async (request, reply) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleLesson(auth, id);

    // FK is ON DELETE RESTRICT — a lesson with homework/materials attached
    // fails with a Postgres 23503, mapped to 409 by the global error handler.
    await db.delete(lessons).where(eq(lessons.id, id));
    reply.code(204).send();
  });

  app.post("/lessons/:id/publish", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleLesson(auth, id);

    const [updated] = await db
      .update(lessons)
      .set({ isPublished: new Date(), updatedAt: new Date() })
      .where(eq(lessons.id, id))
      .returning();
    return updated;
  });

  app.post("/lessons/:id/attach-video-start", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleLesson(auth, id);

    const deepLink = await createPendingActionDeepLink({
      actionType: "attach_lesson_recording",
      targetLessonId: id,
    });
    return { deep_link: deepLink };
  });

  app.post("/modules/:moduleId/lessons/reorder", async (request) => {
    const auth = requireTeacher(request);
    const moduleId = Number((request.params as { moduleId: string }).moduleId);
    await loadAccessibleModule(auth, moduleId);

    const body = reorderSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const existing = await db.select().from(lessons).where(eq(lessons.moduleId, moduleId));
    const existingIds = new Set(existing.map((l) => l.id));
    const providedIds = body.data.lesson_ids;

    if (
      providedIds.length !== existingIds.size ||
      !providedIds.every((id) => existingIds.has(id))
    ) {
      throw Unprocessable("lesson_ids must be exactly the module's current lessons, in the new order");
    }

    await db.transaction(async (tx) => {
      for (const id of providedIds) {
        await tx
          .update(lessons)
          .set({ orderIndex: sql`-(${lessons.id})` })
          .where(eq(lessons.id, id));
      }
      for (const [index, id] of providedIds.entries()) {
        await tx.update(lessons).set({ orderIndex: index + 1 }).where(eq(lessons.id, id));
      }
    });

    return db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.orderIndex));
  });
};

export default lessonRoutes;
