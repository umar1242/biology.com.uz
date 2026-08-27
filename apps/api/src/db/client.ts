import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const queryClient = postgres(connectionString, {
  // Explicit pool sizing instead of the driver default (10). One API
  // instance serving ~150 students never needs many concurrent DB
  // connections; a bounded pool also keeps a burst (or a slow query pileup)
  // from exhausting Postgres' own connection slots.
  max: 10,
  // Reap connections idle longer than 30s so the pool shrinks between the
  // cron sweeps and traffic lulls rather than holding sockets open.
  idle_timeout: 30,
  // Fail fast if Postgres can't be reached (e.g. it's mid-restart) instead
  // of a request hanging indefinitely on connect.
  connect_timeout: 10,
});
export const db = drizzle(queryClient, { schema });
