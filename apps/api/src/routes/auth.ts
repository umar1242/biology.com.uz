import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { assistants, staffUsers } from "../db/schema.js";
import { verifyPassword } from "../auth/password.js";
import { signStaffSession } from "../auth/jwt.js";
import { requireAuth } from "../plugins/auth.js";
import { AppError, Unprocessable } from "../lib/errors.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  // Password brute-force guard: argon2 is deliberately slow, but that only
  // raises the cost per guess — it does not cap the number of guesses. 8 per
  // 5 minutes per client IP is generous for a human, punishing for a script.
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
    async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) throw Unprocessable(body.error.message);

    const [staff] = await db
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.username, body.data.username))
      .limit(1);

    // Same error for "no such user" and "wrong password" — don't leak which
    // half was wrong.
    const invalidCredentials = () => new AppError(401, "invalid_credentials", "Wrong username or password");

    if (!staff || !staff.isActive || staff.role === "owner" || !staff.passwordHash) {
      throw invalidCredentials();
    }

    const ok = await verifyPassword(staff.passwordHash, body.data.password);
    if (!ok) throw invalidCredentials();

    let teacherId: number;
    if (staff.role === "teacher") {
      teacherId = staff.id;
    } else {
      const [assistant] = await db
        .select()
        .from(assistants)
        .where(eq(assistants.staffUserId, staff.id))
        .limit(1);
      if (!assistant) throw invalidCredentials(); // data inconsistency guard
      teacherId = assistant.teacherId;
    }

    const token = await signStaffSession({
      staffId: staff.id,
      role: staff.role as "teacher" | "assistant",
      teacherId,
      displayName: staff.displayName,
    });

    reply.send({
      access_token: token,
      role: staff.role,
      staff_id: staff.id,
      teacher_id: teacherId,
    });
    },
  );

  app.get("/auth/me", async (request) => {
    const auth = requireAuth(request);
    return {
      staff_id: auth.staffId,
      role: auth.role,
      teacher_id: auth.teacherId,
      display_name: auth.displayName,
    };
  });
};

export default authRoutes;
