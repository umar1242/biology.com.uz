import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";
import authPlugin from "./plugins/auth.js";
import studentAuthPlugin from "./plugins/studentAuth.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import moduleRoutes from "./routes/modules.js";
import lessonRoutes from "./routes/lessons.js";
import homeworkRoutes from "./routes/homework.js";
import submissionRoutes from "./routes/submissions.js";
import studentRoutes from "./routes/students.js";
import settingsRoutes from "./routes/settings.js";
import assistantRoutes from "./routes/assistants.js";
import dashboardRoutes from "./routes/dashboard.js";
import appAuthRoutes from "./routes/app/auth.js";
import appCourseRoutes from "./routes/app/courses.js";
import appHomeworkRoutes from "./routes/app/homework.js";
import appProfileRoutes from "./routes/app/profile.js";
import webhookRoutes from "./telegram/webhook.js";
import { AppError, NotFound } from "./lib/errors.js";

// Postgres error codes we translate into a clean 409 instead of a raw 500 —
// both come up routinely from the ON DELETE RESTRICT / UNIQUE constraints
// baked into db/schema.sql, and are worth surfacing distinctly to clients.
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_UNIQUE_VIOLATION = "23505";

export function buildApp() {
  // trustProxy: behind Caddy + the Cloudflare tunnel every request would
  // otherwise carry the proxy's own address as request.ip. The real client
  // IP is what rate limiting must key on (see the keyGenerator below).
  const app = Fastify({ logger: true, trustProxy: true });

  // Dev-friendly: dashboard/Mini App run on different ports/origins than
  // the API. Tightened to real origins once those are deployed behind Caddy.
  //
  // `methods` is listed explicitly — @fastify/cors without it tries to
  // auto-reflect allowed methods per route and got this wrong in practice
  // (Access-Control-Allow-Methods came back as "GET,HEAD,POST" even for
  // routes that also register PATCH/PUT/DELETE), silently breaking every
  // cross-origin PATCH/PUT/DELETE call with an opaque "Failed to fetch" —
  // no CORS error, no server-side log, since the browser never even sends
  // the real request once the preflight omits the method.
  app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // Baseline flood ceiling on every route, with a much stricter per-route
  // override on /auth/login (see routes/auth.ts). Keyed on the real client
  // IP: Cloudflare puts it in CF-Connecting-IP; behind the tunnel request.ip
  // alone would collapse every visitor onto the proxy's single address and
  // let one attacker lock out everyone (or hide behind the shared bucket).
  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) =>
      (req.headers["cf-connecting-ip"] as string | undefined) ?? req.ip,
    // Only rate-limit traffic that actually arrived from the public internet
    // through Cloudflare — which always stamps CF-Connecting-IP. Requests
    // without it can only come from inside (LAN via Caddy, health checks,
    // the e2e suite): the api port is never exposed publicly, so this can't
    // be spoofed from outside to dodge the limit. Without this, every
    // internal caller collapses onto Caddy's single address and trips the
    // login limit as a group (it broke the student e2e's own provisioning).
    allowList: (req) => req.headers["cf-connecting-ip"] === undefined,
  });

  // Both frontends' fetch wrapper always sets Content-Type: application/json,
  // even for bodyless POSTs (submit-start, archive, revoke, etc.) — Fastify's
  // default JSON parser rejects an empty body under that content-type
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which every such route would otherwise
  // hit. Treat an empty body as "no body" instead of a parse error.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return;
    }

    // Drizzle wraps the driver's PostgresError in a DrizzleQueryError — the
    // Postgres error code lives on `.cause`, not the top-level error.
    const pgCode =
      (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === PG_FOREIGN_KEY_VIOLATION) {
      reply.code(409).send({
        error: {
          code: "conflict",
          message: "This action is blocked by related records that still reference it",
        },
      });
      return;
    }
    if (pgCode === PG_UNIQUE_VIOLATION) {
      reply
        .code(409)
        .send({ error: { code: "conflict", message: "A conflicting record already exists" } });
      return;
    }

    // Fastify plugins (notably @fastify/rate-limit -> 429) throw errors that
    // already carry a client-facing statusCode. Honor it instead of masking
    // every one as a 500 — otherwise a rate-limited login looks like a server
    // crash to the client and to monitoring.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      reply.code(statusCode).send({
        error: { code: (error as { code?: string }).code ?? "error", message: (error as Error).message },
      });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ error: { code: "internal_error", message: "Something went wrong" } });
  });

  // Every route param in this API is a numeric id (:id, :courseId,
  // :studentId, :moduleId, :lessonId, :index). Handlers do a plain
  // `Number(params.x)`, so a non-numeric segment used to reach Postgres as
  // NaN and come back as "invalid input syntax for type bigint" — a 500 on
  // what is really just a bad URL. Reject those centrally instead of
  // guarding ~60 call sites. 404 (not 422) keeps it consistent with the
  // existing policy of not distinguishing "malformed" from "not yours".
  app.addHook("preValidation", async (request) => {
    const params = request.params as Record<string, unknown> | undefined;
    if (!params) return;
    for (const value of Object.values(params)) {
      if (typeof value !== "string") continue;
      if (!/^\d+$/.test(value)) throw NotFound();
    }
  });

  app.register(authPlugin);
  app.register(studentAuthPlugin);

  app.get("/health", async () => {
    await db.execute(sql`SELECT 1`);
    return { status: "ok" };
  });

  app.register(authRoutes, { prefix: "/api/v1" });
  app.register(courseRoutes, { prefix: "/api/v1" });
  app.register(moduleRoutes, { prefix: "/api/v1" });
  app.register(lessonRoutes, { prefix: "/api/v1" });
  app.register(homeworkRoutes, { prefix: "/api/v1" });
  app.register(submissionRoutes, { prefix: "/api/v1" });
  app.register(studentRoutes, { prefix: "/api/v1" });
  app.register(settingsRoutes, { prefix: "/api/v1" });
  app.register(assistantRoutes, { prefix: "/api/v1" });
  app.register(dashboardRoutes, { prefix: "/api/v1" });
  app.register(appAuthRoutes, { prefix: "/api/v1" });
  app.register(appCourseRoutes, { prefix: "/api/v1" });
  app.register(appHomeworkRoutes, { prefix: "/api/v1" });
  app.register(appProfileRoutes, { prefix: "/api/v1" });
  app.register(webhookRoutes);

  return app;
}
