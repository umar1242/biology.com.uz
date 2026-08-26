import "dotenv/config";
import { config } from "../config.js";
import { bot } from "../telegram/bot.js";

// One-off helper for switching a deployment from long polling to webhook
// mode once a real public HTTPS URL exists. Run with BOT_UPDATES_MODE=webhook
// set in the environment the bot process actually uses, then restart it.
const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run set-webhook --workspace=apps/api -- https://your-domain/telegram/webhook");
  process.exit(1);
}

await bot.api.setWebhook(url, {
  secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  drop_pending_updates: true,
});
console.log("Webhook set:", url);
