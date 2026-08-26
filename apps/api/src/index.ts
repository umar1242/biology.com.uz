import "dotenv/config";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { bot } from "./telegram/bot.js";
import { startJobs } from "./jobs/index.js";

const app = buildApp();

if (config.TELEGRAM_BOT_TOKEN) {
  if (config.BOT_UPDATES_MODE === "polling") {
    // Long polling — the bot pulls updates itself, no public URL needed.
    // A stale webhook registration would make Telegram refuse to hand out
    // updates via getUpdates, so clear it defensively before starting.
    await bot.api.deleteWebhook();
    bot.start({ onStart: () => app.log.info("Telegram bot: long polling started") });
  } else {
    await bot.init(); // fetches bot info once — required before bot.handleUpdate()
  }
}
startJobs();

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API listening on :${config.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
