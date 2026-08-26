import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  OWNER_TELEGRAM_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_API_URL: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // "polling" needs no public URL at all — the right default for a
  // self-hosted deploy behind no domain. "webhook" is for when a public
  // HTTPS endpoint (real domain or tunnel) is actually available.
  BOT_UPDATES_MODE: z.enum(["polling", "webhook"]).default("polling"),
  // Printed in the bot's "teacher created" reply so a new teacher knows where
  // to log in; was hardcoded to the production host inside the handler.
  DASHBOARD_URL: z.string().default("https://admin.biolog.com.uz"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
