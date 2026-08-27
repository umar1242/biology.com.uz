import "dotenv/config";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { bot } from "./telegram/bot.js";
import { startJobs, stopJobs } from "./jobs/index.js";
import { queryClient } from "./db/client.js";

const app = buildApp();

const botEnabled = Boolean(config.TELEGRAM_BOT_TOKEN);

if (botEnabled) {
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
startJobs(app.log);

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API listening on :${config.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// Graceful shutdown. Docker sends SIGTERM on `compose down`/`restart`/redeploy;
// without this Node exits instantly, cutting in-flight requests and possibly a
// disciplinary/access job mid-transaction. Drain in dependency order: stop
// accepting new work (bot + cron), let Fastify finish open requests, then close
// the DB pool last so nothing queries a closing connection.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; // a second signal during teardown must not re-enter
  shuttingDown = true;
  app.log.info(`${signal} received — shutting down gracefully`);

  // Hard cap: if any step hangs (e.g. a stuck Telegram long-poll), don't wait
  // for Docker's own SIGKILL — exit non-zero so the failure is visible.
  const forceExit = setTimeout(() => {
    app.log.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await stopJobs();
    if (botEnabled && config.BOT_UPDATES_MODE === "polling") {
      await bot.stop();
    }
    await app.close(); // stops accepting connections, awaits in-flight handlers
    await queryClient.end({ timeout: 5 }); // close the postgres pool last
    clearTimeout(forceExit);
    app.log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
