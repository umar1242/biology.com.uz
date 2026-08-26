// Dev utility: sends a chat message with a `web_app` inline button so a
// Mini App served over a temporary HTTPS tunnel can be opened for real
// inside Telegram (Telegram requires HTTPS + its own WebView — a plain
// browser tab to localhost can't provide either).
//
// Usage: npx tsx scripts/send-miniapp-link.ts <telegram_id> <https_url>
import "dotenv/config";
import { bot } from "../src/telegram/bot.js";

const [telegramId, url] = process.argv.slice(2);
if (!telegramId || !url) {
  console.error("Usage: npx tsx scripts/send-miniapp-link.ts <telegram_id> <https_url>");
  process.exit(1);
}

await bot.init();
await bot.api.sendMessage(Number(telegramId), "Готово — можно открыть Mini App:", {
  reply_markup: {
    inline_keyboard: [[{ text: "Открыть Mini App", web_app: { url } }]],
  },
});
console.log("Sent.");
process.exit(0);
