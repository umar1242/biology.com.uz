import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { verifyStaffSession, type StaffSession } from "../auth/jwt.js";
import { Forbidden, Unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: StaffSession;
  }
}

/**
 * Decorates every request with `request.auth` when a valid Bearer token is
 * present, but does NOT reject requests without one — routes opt in via
 * `requireAuth`. This keeps the plugin usable for future public routes
 * (e.g. the Mini App's own student auth, added separately) without every
 * route paying for a hard requirement it doesn't need.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", undefined);

  app.addHook("preHandler", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;

    const token = header.slice("Bearer ".length);
    try {
      request.auth = await verifyStaffSession(token);
    } catch {
      // Invalid/expired token: leave request.auth unset: routes requiring
      // auth via requireAuth() will reject with 401 on their own.
    }
  });
};

export default fp(authPlugin);

/** Call at the top of a handler to enforce a valid staff session. */
export function requireAuth(request: import("fastify").FastifyRequest): StaffSession {
  if (!request.auth) throw Unauthorized();
  return request.auth;
}

/** Call to enforce the session belongs to a teacher (not an assistant). */
export function requireTeacher(request: import("fastify").FastifyRequest): StaffSession {
  const auth = requireAuth(request);
  if (auth.role !== "teacher") throw Forbidden("Only the course-owning teacher can do this");
  return auth;
}
