import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { assistantCoursePermissions, assistants, staffUsers } from "../db/schema.js";
import { requireTeacher } from "../plugins/auth.js";
import { hashPassword } from "../auth/password.js";
import { loadAccessibleCourse } from "../lib/access.js";
import type { StaffSession } from "../auth/jwt.js";
import { NotFound, Unprocessable } from "../lib/errors.js";

const createAssistantSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
  display_name: z.string().min(1),
});

const updateAssistantSchema = z.object({ is_active: z.boolean() });

const permissionsSchema = z.object({
  can_review_homework: z.boolean(),
  can_manage_access: z.boolean(),
  can_manage_blacklist: z.boolean(),
});

/** Verifies staff id `id` is an assistant belonging to this teacher's tenant. */
async function loadOwnAssistant(auth: StaffSession, id: number) {
  const [assistant] = await db
    .select()
    .from(assistants)
    .where(and(eq(assistants.staffUserId, id), eq(assistants.teacherId, auth.teacherId)))
    .limit(1);
  if (!assistant) throw NotFound("Assistant not found");
  return assistant;
}

const assistantRoutes: FastifyPluginAsync = async (app) => {
  app.get("/assistants", async (request) => {
    const auth = requireTeacher(request);
    return db
      .select({
        staff_id: staffUsers.id,
        username: staffUsers.username,
        display_name: staffUsers.displayName,
        is_active: staffUsers.isActive,
        created_at: staffUsers.createdAt,
      })
      .from(assistants)
      .innerJoin(staffUsers, eq(staffUsers.id, assistants.staffUserId))
      .where(eq(assistants.teacherId, auth.teacherId));
  });

  app.post("/assistants", async (request, reply) => {
    const auth = requireTeacher(request);
    const body = createAssistantSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const passwordHash = await hashPassword(body.data.password);

    // UNIQUE(username) surfaces as 409 via the global PG error mapping if
    // the username is already taken.
    const created = await db.transaction(async (tx) => {
      const [staff] = await tx
        .insert(staffUsers)
        .values({
          role: "assistant",
          username: body.data.username,
          passwordHash,
          displayName: body.data.display_name,
        })
        .returning();
      await tx.insert(assistants).values({ staffUserId: staff.id, teacherId: auth.teacherId });
      return staff;
    });

    reply.code(201).send({
      staff_id: created.id,
      username: created.username,
      display_name: created.displayName,
      is_active: created.isActive,
    });
  });

  app.patch("/assistants/:id", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadOwnAssistant(auth, id);

    const body = updateAssistantSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [updated] = await db
      .update(staffUsers)
      .set({ isActive: body.data.is_active, updatedAt: new Date() })
      .where(eq(staffUsers.id, id))
      .returning();
    return {
      staff_id: updated.id,
      username: updated.username,
      display_name: updated.displayName,
      is_active: updated.isActive,
    };
  });

  app.get("/assistants/:id/permissions", async (request) => {
    const auth = requireTeacher(request);
    const id = Number((request.params as { id: string }).id);
    await loadOwnAssistant(auth, id);

    return db
      .select()
      .from(assistantCoursePermissions)
      .where(eq(assistantCoursePermissions.assistantId, id));
  });

  app.put("/assistants/:id/permissions/:courseId", async (request) => {
    const auth = requireTeacher(request);
    const params = request.params as { id: string; courseId: string };
    const assistantId = Number(params.id);
    const courseId = Number(params.courseId);
    await loadOwnAssistant(auth, assistantId);
    await loadAccessibleCourse(auth, courseId); // confirms the course is this teacher's

    const body = permissionsSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [perm] = await db
      .insert(assistantCoursePermissions)
      .values({
        assistantId,
        courseId,
        canReviewHomework: body.data.can_review_homework,
        canManageAccess: body.data.can_manage_access,
        canManageBlacklist: body.data.can_manage_blacklist,
        grantedBy: auth.staffId,
      })
      .onConflictDoUpdate({
        target: [assistantCoursePermissions.assistantId, assistantCoursePermissions.courseId],
        set: {
          canReviewHomework: body.data.can_review_homework,
          canManageAccess: body.data.can_manage_access,
          canManageBlacklist: body.data.can_manage_blacklist,
          grantedBy: auth.staffId,
          grantedAt: new Date(),
        },
      })
      .returning();
    return perm;
  });

  app.delete("/assistants/:id/permissions/:courseId", async (request, reply) => {
    const auth = requireTeacher(request);
    const params = request.params as { id: string; courseId: string };
    const assistantId = Number(params.id);
    const courseId = Number(params.courseId);
    await loadOwnAssistant(auth, assistantId);
    await loadAccessibleCourse(auth, courseId);

    await db
      .delete(assistantCoursePermissions)
      .where(
        and(
          eq(assistantCoursePermissions.assistantId, assistantId),
          eq(assistantCoursePermissions.courseId, courseId),
        ),
      );
    reply.code(204).send();
  });
};

export default assistantRoutes;
