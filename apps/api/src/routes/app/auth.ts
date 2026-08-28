import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { students } from "../../db/schema.js";
import { verifyTelegramInitData } from "../../telegram/initData.js";
import { signStudentSession } from "../../auth/studentJwt.js";
import { Unauthorized, Unprocessable } from "../../lib/errors.js";
import { isStudentOnboarded } from "../../lib/studentOnboarding.js";

const authSchema = z.object({ init_data: z.string().min(1) });

const appAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post("/app/auth/telegram", async (request) => {
    const body = authSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const result = verifyTelegramInitData(body.data.init_data);
    if (!result.ok) throw Unauthorized(`Invalid Telegram init data: ${result.reason}`);

    // Normally a student row already exists from the bot's /start deep-link
    // flow (idea-platforma-kursy.md's onboarding path) — upserting here
    // just makes the Mini App robust to being opened before that happens.
    const [student] = await db
      .insert(students)
      .values({
        telegramId: result.user.id,
        telegramUsername: result.user.username,
        firstName: result.user.first_name,
        lastName: result.user.last_name,
      })
      .onConflictDoUpdate({
        target: students.telegramId,
        set: {
          telegramUsername: result.user.username,
          firstName: result.user.first_name,
          lastName: result.user.last_name,
          updatedAt: new Date(),
        },
      })
      .returning();

    const token = await signStudentSession({ studentId: student.id, telegramId: student.telegramId });
    // Lets the Mini App show the "fill the questionnaire first" screen without
    // firing a request per tab only to collect a wall of 403s.
    const onboarded = await isStudentOnboarded(student.id);
    return { access_token: token, student_id: student.id, onboarded };
  });
};

export default appAuthRoutes;
