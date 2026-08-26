import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { homeworks } from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import { loadAccessibleCourse, loadAccessibleLesson, resolveCourseIdForHomework } from "../lib/access.js";
import { Unprocessable } from "../lib/errors.js";

const createHomeworkSchema = z.object({
  instructions: z.string().optional(),
  deadline_at: z.coerce.date(),
});

const updateHomeworkSchema = z.object({
  instructions: z.string().optional(),
  deadline_at: z.coerce.date().optional(),
});

const homeworkRoutes: FastifyPluginAsync = async (app) => {
  app.get("/lessons/:lessonId/homework", async (request) => {
    const auth = requireAuth(request);
    const lessonId = Number((request.params as { lessonId: string }).lessonId);
    await loadAccessibleLesson(auth, lessonId); // tenant + course-access check

    const [hw] = await db.select().from(homeworks).where(eq(homeworks.lessonId, lessonId)).limit(1);
    if (!hw) return null; // a lesson may not have homework yet — not an error
    return hw;
  });

  app.post("/lessons/:lessonId/homework", async (request, reply) => {
    const auth = requireTeacher(request);
    const lessonId = Number((request.params as { lessonId: string }).lessonId);
    await loadAccessibleLesson(auth, lessonId);

    const body = createHomeworkSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    // UNIQUE(lesson_id) enforces "exactly one homework per lesson" — a
    // second POST here surfaces as 409 via the global PG error mapping.
    const [hw] = await db
      .insert(homeworks)
      .values({
        lessonId,
        teacherId: auth.teacherId,
        instructions: body.data.instructions,
        deadlineAt: body.data.deadline_at,
      })
      .returning();

    reply.code(201).send(hw);
  });

  app.patch("/homework/:id", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    const { courseId } = await resolveCourseIdForHomework(id);
    await loadAccessibleCourse(auth, courseId);

    const body = updateHomeworkSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);
    if (Object.keys(body.data).length === 0) throw Unprocessable("No fields to update");

    const { deadline_at, ...rest } = body.data;
    const [updated] = await db
      .update(homeworks)
      .set({
        ...rest,
        ...(deadline_at !== undefined ? { deadlineAt: deadline_at } : {}),
        updatedAt: new Date(),
      })
      .where(eq(homeworks.id, id))
      .returning();
    return updated;
  });

  // Without this, a lesson that ever had homework attached could never be
  // deleted: DELETE /lessons/:id hits the ON DELETE RESTRICT FK from
  // homeworks and returns a 409 with no way to clear the blocker.
  app.delete("/homework/:id", async (request, reply) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    const { courseId } = await resolveCourseIdForHomework(id);
    await loadAccessibleCourse(auth, courseId);

    // Submissions reference the homework under the same RESTRICT policy, so
    // deleting graded work is refused rather than silently discarding a
    // student's attempts — the global PG mapping turns that into a 409.
    await db.delete(homeworks).where(eq(homeworks.id, id));
    reply.code(204).send();
  });
};

export default homeworkRoutes;
