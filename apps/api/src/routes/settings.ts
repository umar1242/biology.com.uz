import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { staffNotificationGroups, staffUsers, teachers } from "../db/schema.js";
import { requireAuth, requireTeacher } from "../plugins/auth.js";
import { Forbidden, Unprocessable } from "../lib/errors.js";
import { createPendingActionDeepLink } from "../telegram/pendingActions.js";
import { languageForStaffNotifications } from "../lib/language.js";

const updateSettingsSchema = z.object({
  penalty_point_threshold: z.number().int().positive().optional(),
  language: z.enum(["ru", "uz"]).optional(),
  notification_language: z.enum(["ru", "uz"]).optional(),
});

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings", async (request) => {
    const auth = requireAuth(request);
    const [teacher] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.staffUserId, auth.teacherId))
      .limit(1);

    const [staff] = await db.select().from(staffUsers).where(eq(staffUsers.id, auth.staffId)).limit(1);
    const [group] = await db
      .select()
      .from(staffNotificationGroups)
      .where(eq(staffNotificationGroups.teacherId, auth.teacherId))
      .limit(1);

    return {
      penalty_point_threshold: teacher.penaltyPointThreshold,
      notifications_linked: !!staff?.notificationTelegramId,
      notification_group_linked: !!group,
      notification_group_title: group?.title ?? null,
      language: staff?.language ?? "ru",
      // The effective language, not the raw column: an assistant opening
      // this page must see what the group actually speaks, and NULL there
      // means "whatever the teacher's panel is set to".
      notification_language: await languageForStaffNotifications(auth.teacherId),
    };
  });

  app.patch("/settings", async (request) => {
    const auth = requireAuth(request);
    const body = updateSettingsSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);
    if (
      body.data.penalty_point_threshold === undefined &&
      body.data.language === undefined &&
      body.data.notification_language === undefined
    ) {
      throw Unprocessable("No fields to update");
    }

    // Language lives on the staff row, so an assistant can pick their own —
    // the threshold stays teacher-only, since it is a course-wide policy.
    if (body.data.language !== undefined) {
      await db
        .update(staffUsers)
        .set({ language: body.data.language, updatedAt: new Date() })
        .where(eq(staffUsers.id, auth.staffId));
    }

    if (body.data.penalty_point_threshold !== undefined) {
      if (auth.role !== "teacher") throw Forbidden("Only the course-owning teacher can do this");
      await db
        .update(teachers)
        .set({ penaltyPointThreshold: body.data.penalty_point_threshold })
        .where(eq(teachers.staffUserId, auth.teacherId));
    }

    // Teacher-only for the same reason as the group itself: it changes the
    // language of everyone's feed, not the caller's own interface.
    if (body.data.notification_language !== undefined) {
      if (auth.role !== "teacher") throw Forbidden("Only the course-owning teacher can do this");
      await db
        .update(teachers)
        .set({ notificationLanguage: body.data.notification_language })
        .where(eq(teachers.staffUserId, auth.teacherId));
    }

    const [teacher] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.staffUserId, auth.teacherId))
      .limit(1);
    const [staff] = await db.select().from(staffUsers).where(eq(staffUsers.id, auth.staffId)).limit(1);
    return {
      penalty_point_threshold: teacher?.penaltyPointThreshold,
      language: staff?.language ?? "ru",
      notification_language: await languageForStaffNotifications(auth.teacherId),
    };
  });

  // Any staff member (teacher or assistant) can opt in to Telegram push
  // notifications — this is separate from login (still username/password).
  // See db/schema.sql staff_users.notification_telegram_id.
  app.post("/settings/notifications/link-start", async (request) => {
    const auth = requireAuth(request);
    const deepLink = await createPendingActionDeepLink({
      actionType: "link_staff_notifications",
      targetStaffId: auth.staffId,
    });
    return { deep_link: deepLink };
  });

  // The shared admin group: one per teacher, so alerts reach assistants too
  // instead of sitting in one person's DMs. Teacher-only, like the penalty
  // threshold — it redirects everyone's notifications, not just your own.
  app.post("/settings/notifications/group-link-start", async (request) => {
    const auth = requireTeacher(request);
    const deepLink = await createPendingActionDeepLink({
      actionType: "link_staff_group",
      targetStaffId: auth.teacherId,
    });
    return { deep_link: deepLink };
  });

  app.delete("/settings/notifications/group", async (request) => {
    const auth = requireTeacher(request);
    await db.delete(staffNotificationGroups).where(eq(staffNotificationGroups.teacherId, auth.teacherId));
    return { ok: true };
  });
};

export default settingsRoutes;
