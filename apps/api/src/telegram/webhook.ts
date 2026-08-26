import type { FastifyPluginAsync } from "fastify";
import type { Update } from "grammy/types";
import { config } from "../config.js";
import { bot } from "./bot.js";
import "./handlers.js"; // side-effect: registers bot.command/bot.on handlers

const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/telegram/webhook", async (request, reply) => {
    if (config.TELEGRAM_WEBHOOK_SECRET) {
      const secret = request.headers["x-telegram-bot-api-secret-token"];
      if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
        reply.code(401).send();
        return;
      }
    }

    try {
      await bot.handleUpdate(request.body as Update);
    } catch (err) {
      // Always ACK 200 regardless — a non-2xx here makes Telegram retry
      // the SAME update, which for most of our handlers means re-running
      // a side effect (e.g. a failed outbound reply) rather than fixing
      // the underlying problem. Log and move on; the DB writes that did
      // succeed before the failure already happened.
      request.log.error(err, "Error while processing Telegram update");
    }
    reply.code(200).send();
  });
};

export default webhookRoutes;
