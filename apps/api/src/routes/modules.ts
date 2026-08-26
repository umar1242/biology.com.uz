import type { FastifyPluginAsync } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { modules } from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import { loadAccessibleCourse, loadAccessibleModule } from "../lib/access.js";
import { Unprocessable } from "../lib/errors.js";

const createModuleSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

const updateModuleSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});

const reorderSchema = z.object({
  module_ids: z.array(z.number().int().positive()).min(1),
});

const moduleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/courses/:courseId/modules", async (request) => {
    const auth = requireAuth(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    return db
      .select()
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.orderIndex));
  });

  app.post("/courses/:courseId/modules", async (request, reply) => {
    const auth = requireTeacher(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    const body = createModuleSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    // Append to the end of the course's module list.
    const [{ nextIndex }] = await db
      .select({ nextIndex: sql<number>`coalesce(max(${modules.orderIndex}), 0) + 1` })
      .from(modules)
      .where(eq(modules.courseId, courseId));

    const [module_] = await db
      .insert(modules)
      .values({
        courseId,
        teacherId: auth.teacherId,
        title: body.data.title,
        description: body.data.description,
        orderIndex: nextIndex,
      })
      .returning();

    reply.code(201).send(module_);
  });

  app.patch("/modules/:id", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleModule(auth, id);

    const body = updateModuleSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);
    if (Object.keys(body.data).length === 0) throw Unprocessable("No fields to update");

    const [updated] = await db
      .update(modules)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(modules.id, id))
      .returning();
    return updated;
  });

  app.delete("/modules/:id", async (request, reply) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadAccessibleModule(auth, id);

    // FK is ON DELETE RESTRICT — a module with lessons under it fails with
    // a Postgres 23503, mapped to 409 by the global error handler.
    await db.delete(modules).where(eq(modules.id, id));
    reply.code(204).send();
  });

  app.post("/courses/:courseId/modules/reorder", async (request) => {
    const auth = requireTeacher(request);
    const courseId = Number((request.params as { courseId: string }).courseId);
    await loadAccessibleCourse(auth, courseId);

    const body = reorderSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const existing = await db.select().from(modules).where(eq(modules.courseId, courseId));
    const existingIds = new Set(existing.map((m) => m.id));
    const providedIds = body.data.module_ids;

    if (
      providedIds.length !== existingIds.size ||
      !providedIds.every((id) => existingIds.has(id))
    ) {
      throw Unprocessable("module_ids must be exactly the course's current modules, in the new order");
    }

    await db.transaction(async (tx) => {
      // Two-phase update: order_index has a UNIQUE(course_id, order_index)
      // constraint, so writing final positions directly can collide
      // mid-update (e.g. swapping 1 and 2). Push everything to negative
      // placeholders first, then to their real positions.
      for (const id of providedIds) {
        await tx
          .update(modules)
          .set({ orderIndex: sql`-(${modules.id})` })
          .where(eq(modules.id, id));
      }
      for (const [index, id] of providedIds.entries()) {
        await tx.update(modules).set({ orderIndex: index + 1 }).where(eq(modules.id, id));
      }
    });

    return db
      .select()
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.orderIndex));
  });
};

export default moduleRoutes;
