import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { verifyStudentSession, type StudentSession } from "../auth/studentJwt.js";
import { isStudentOnboarded } from "../lib/studentOnboarding.js";
import { AppError, Unauthorized } from "../lib/errors.js";

/**
 * The only Mini App routes a student may touch before filling the enrolment
 * questionnaire — everything else in /app is closed until then. Listed as
 * route patterns (not raw URLs) so the check is centralised here: a new
 * /app route is gated by default, which is the safe direction to fail.
 */
const PRE_ONBOARDING_ROUTES = new Set([
  "/api/v1/app/auth/telegram",
  "/api/v1/app/application-target",
  "/api/v1/app/courses/:id/application-context",
  "/api/v1/app/courses/:id/application",
]);

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
      return;
    }

    // Gate the whole Mini App behind the questionnaire. Done here rather than
    // per route so that forgetting it on a future /app endpoint is impossible.
    const routePattern = request.routeOptions?.url;
    if (
      routePattern?.startsWith("/api/v1/app/") &&
      !PRE_ONBOARDING_ROUTES.has(routePattern) &&
      !(await isStudentOnboarded(request.studentAuth.studentId))
    ) {
      throw new AppError(
        403,
        "not_onboarded",
        "Заполните анкету по ссылке курса от преподавателя, чтобы пользоваться приложением",
      );
    }
  });
};

export default fp(studentAuthPlugin);

export function requireStudentAuth(request: import("fastify").FastifyRequest): StudentSession {
  if (!request.studentAuth) throw Unauthorized();
  return request.studentAuth;
}
