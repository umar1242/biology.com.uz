// A stand-in for the Telegram Bot API, so the e2e suites can run without a
// real bot — and without touching the network at all.
//
// This is not about avoiding Telegram's rate limits: several endpoints call
// the API mid-request (a deep link needs getMe for the bot's username, an
// enrolment needs createChatInviteLink), so without an answer those requests
// fail and whole scenarios become untestable. The stub answers them the way
// Telegram would, and never claims to have delivered anything anywhere real.
//
//   node test/telegram-stub.mjs &
//   TELEGRAM_BOT_API_URL=http://127.0.0.1:8099 npm run dev:api
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 8099);
let messageId = 1000;

const RESULTS = {
  getMe: () => ({ id: 1, is_bot: true, first_name: "E2E Stub", username: "e2e_stub_bot" }),
  sendMessage: () => ({ message_id: messageId++, date: Math.floor(Date.now() / 1000) }),
  sendPhoto: () => ({ message_id: messageId++, date: Math.floor(Date.now() / 1000) }),
  sendDocument: () => ({ message_id: messageId++, date: Math.floor(Date.now() / 1000) }),
  createChatInviteLink: () => ({ invite_link: "https://t.me/+e2eStubInvite", creates_join_request: false }),
  getFile: () => ({ file_id: "STUB", file_unique_id: "STUB", file_path: "stub/file.jpg" }),
  // Long polling would spin: the stub is meant for BOT_UPDATES_MODE=webhook,
  // and answers getUpdates only so a stray poll does not error.
  getUpdates: () => [],
};

const server = createServer((req, res) => {
  // Telegram's URL shape: /bot<token>/<method>
  const method = (req.url ?? "").split("/").pop()?.split("?")[0] ?? "";
  req.resume();
  req.on("end", () => {
    const result = RESULTS[method] ? RESULTS[method]() : true;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`telegram stub on :${PORT}`));
