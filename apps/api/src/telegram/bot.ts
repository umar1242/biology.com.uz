import { Bot } from "grammy";
import { config } from "../config.js";

if (!config.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN, {
  client: {
    apiRoot: config.TELEGRAM_BOT_API_URL ?? "https://api.telegram.org",
  },
});

let cachedUsername: string | null = null;

/** Used to build t.me/<username>?start=... deep links. Cached after first call. */
export async function getBotUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername;
  const me = await bot.api.getMe();
  if (!me.username) throw new Error("Bot has no username");
  cachedUsername = me.username;
  return cachedUsername;
}
