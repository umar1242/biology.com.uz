import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { courseAccess, courseBlacklist, courses, lessonMaterials, lessons, modules } from "../../db/schema.js";
import { requireStudentAuth } from "../../plugins/studentAuth.js";
import {
  assertNotFrozen,
  loadStudentAccessibleCourse,
  loadStudentAccessibleLesson,
  loadStudentAccessibleModule,
} from "../../lib/studentAccess.js";
import { bot } from "../../telegram/bot.js";
import { AppError, NotFound } from "../../lib/errors.js";

const appCourseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/app/courses", async (request) => {
    const auth = requireStudentAuth(request);

    const rows = await db
      .select({ course: courses, blacklisted: courseBlacklist.isBlacklisted })
      .from(courseAccess)
      .innerJoin(courses, eq(courses.id, courseAccess.courseId))
      .leftJoin(
        courseBlacklist,
        and(
          eq(courseBlacklist.courseId, courseAccess.courseId),
          eq(courseBlacklist.studentId, courseAccess.studentId),
        ),
      )
      .where(
        and(
          eq(courseAccess.studentId, auth.studentId),
          eq(courseAccess.accessGranted, true),
          eq(courseAccess.revoked, false),
        ),
      );

    return rows.filter((r) => !r.blacklisted).map((r) => r.course);
  });

  app.get("/app/courses/:id/modules", async (request) => {
    const auth = requireStudentAuth(request);
    const courseId = Number((request.params as { id: string }).id);
    await loadStudentAccessibleCourse(auth.studentId, courseId);

    return db.select().from(modules).where(eq(modules.courseId, courseId)).orderBy(asc(modules.orderIndex));
  });

  app.get("/app/modules/:id/lessons", async (request) => {
    const auth = requireStudentAuth(request);
    const moduleId = Number((request.params as { id: string }).id);
    await loadStudentAccessibleModule(auth.studentId, moduleId);

    // Drafts (is_published IS NULL) are never shown to students.
    return db
      .select()
      .from(lessons)
      .where(and(eq(lessons.moduleId, moduleId), isNotNull(lessons.isPublished)))
      .orderBy(asc(lessons.orderIndex));
  });

  app.get("/app/lessons/:id", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);
    const lesson = await loadStudentAccessibleLesson(auth.studentId, id);

    const materials = await db
      .select()
      .from(lessonMaterials)
      .where(eq(lessonMaterials.lessonId, id))
      .orderBy(asc(lessonMaterials.orderIndex));

    const hasRecording =
      lesson.lessonType === "live" ? lesson.liveRecordingFileId !== null : lesson.recordedVideoFileId !== null;

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      lesson_type: lesson.lessonType,
      scheduled_at: lesson.scheduledAt,
      live_call_link: lesson.lessonType === "live" ? lesson.liveCallLink : undefined,
      has_recording: hasRecording,
      // telegram_file_id deliberately omitted for video/file materials — no
      // delivery endpoint for them exists yet (only the primary lesson
      // video, via request-video below); follow-up, not a gap in this pass.
      materials: materials.map((m) => ({
        index: m.orderIndex,
        material_type: m.materialType,
        text_content: m.materialType === "text" ? m.textContent : undefined,
        file_name: m.fileName,
        caption: m.caption,
      })),
    };
  });

  app.post("/app/lessons/:id/request-video", async (request) => {
    const auth = requireStudentAuth(request);
    const id = Number((request.params as { id: string }).id);
    const lesson = await loadStudentAccessibleLesson(auth.studentId, id);
    const [module_] = await db.select().from(modules).where(eq(modules.id, lesson.moduleId)).limit(1);
    if (module_) await assertNotFrozen(auth.studentId, module_.courseId);

    const fileId = lesson.lessonType === "live" ? lesson.liveRecordingFileId : lesson.recordedVideoFileId;
    if (!fileId) {
      throw NotFound(
        lesson.lessonType === "live"
          ? "Учитель не оставил запись этого урока"
          : "У урока пока нет видео",
      );
    }

    try {
      await bot.api.sendVideo(auth.telegramId, fileId);
    } catch (err) {
      // Most realistically: the student has never opened a chat with the
      // bot (Telegram requires that before a bot can message a user), or
      // the stored file_id has expired/is invalid on Telegram's side. The
      // client only needs the clean message below, but the actual Telegram
      // error is worth keeping server-side for diagnosis.
      request.log.warn(err, "Telegram sendVideo failed for request-video");
      throw new AppError(
        502,
        "telegram_error",
        "Не удалось отправить видео в чат — откройте чат с ботом и попробуйте снова",
      );
    }
    return { status: "sent_to_chat" };
  });
};

export default appCourseRoutes;
