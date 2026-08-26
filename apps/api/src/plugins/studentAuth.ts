import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { verifyStudentSession, type StudentSession } from "../auth/studentJwt.js";
import { Unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    studentAuth?: StudentSession;
  }
}

/**
 * Mirrors plugins/auth.ts but for the separate student JWT — kept as its
 * own decorator (`request.studentAuth`, not `request.auth`) so a student
 * token can never accidentally satisfy a staff-only route or vice versa,
 * even though both share the same signing secret (see auth/jwt.ts's `kind`
 * claim, which is what verifyStudentSession actually checks).
 */
const studentAuthPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("studentAuth", undefined);

  app.addHook("preHandler", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;

    const token = header.slice("Bearer ".length);
    try {
      request.studentAuth = await verifyStudentSession(token);
    } catch {
      // Invalid/expired/wrong-kind token — routes call requireStudentAuth
      // and get a 401 on their own.
    }
  });
};

export default fp(studentAuthPlugin);

export function requireStudentAuth(request: import("fastify").FastifyRequest): StudentSession {
  if (!request.studentAuth) throw Unauthorized();
  return request.studentAuth;
}
