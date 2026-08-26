import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export type TelegramWebAppUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // Telegram's own recommendation

/**
 * Validates Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app —
 * this is the ONLY thing that proves a Mini App request actually came from
 * Telegram for the claimed user, since there's no separate password for
 * students (idea-platforma-kursy.md §3).
 */
export function verifyTelegramInitData(
  initData: string,
): { ok: true; user: TelegramWebAppUser } | { ok: false; reason: string } {
  if (!config.TELEGRAM_BOT_TOKEN) return { ok: false, reason: "bot not configured" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const dataCheckString = Array.from(params.keys())
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(config.TELEGRAM_BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const computedBuf = Buffer.from(computedHash, "hex");
  const givenBuf = Buffer.from(hash, "hex");
  if (computedBuf.length !== givenBuf.length || !timingSafeEqual(computedBuf, givenBuf)) {
    return { ok: false, reason: "hash mismatch" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    return { ok: false, reason: "stale init data" };
  }

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "missing user field" };

  try {
    const user = JSON.parse(userJson) as TelegramWebAppUser;
    if (!user.id) return { ok: false, reason: "user missing id" };
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "invalid user JSON" };
  }
}
