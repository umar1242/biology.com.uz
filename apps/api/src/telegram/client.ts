import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

const apiBase = config.TELEGRAM_BOT_API_URL ?? "https://api.telegram.org";

/**
 * Downloads a file Telegram already has (by file_id) — used to proxy
 * homework photos into the dashboard, since the teacher was never a
 * participant in the student's private chat with the bot where the photo
 * actually lives (docs/api-design.md, "Просмотр фото сдачи").
 */
export async function fetchTelegramFile(
  fileId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new AppError(503, "telegram_not_configured", "Telegram bot token is not configured");
  }

  const getFileRes = await fetch(
    `${apiBase}/bot${config.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const getFileJson = (await getFileRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
    description?: string;
  };
  if (!getFileJson.ok || !getFileJson.result) {
    throw new AppError(
      502,
      "telegram_error",
      getFileJson.description ?? "Failed to resolve file from Telegram",
    );
  }

  const filePath = getFileJson.result.file_path;

  // A local Bot API server started with TELEGRAM_LOCAL=1 — which is what
  // docker-compose runs and what TELEGRAM_BOT_API_URL points at — never
  // serves files over HTTP. It writes them to its own filesystem and returns
  // an ABSOLUTE path (/var/lib/telegram-bot-api/<token>/photos/file_0.jpg).
  // The old code fetched that string as if it were a URL, so every homework
  // photo 404'd and the review screen could not display a single submission.
  // Read it off the shared volume when we can see it.
  if (filePath.startsWith("/")) {
    try {
      const buffer = await readFile(filePath);
      return { buffer, contentType: contentTypeForPath(filePath) };
    } catch {
      // Not mounted (the dev API runs on the host, outside the container's
      // volume) or unreadable. The same file_id resolves on the cloud API,
      // so fall back to that rather than failing the request — verified
      // against a file_id minted by the local server.
      return fetchFromCloud(fileId, config.TELEGRAM_BOT_TOKEN);
    }
  }

  const fileRes = await fetch(`${apiBase}/file/bot${config.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileRes.ok) {
    throw new AppError(502, "telegram_error", "Failed to download file from Telegram");
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    // The cloud API serves photos as application/octet-stream with an
    // extensionless path, which browsers won't render in an <img>. Trust the
    // header only when it actually names a type.
    contentType: usableContentType(fileRes.headers.get("content-type")) ?? contentTypeForPath(filePath),
  };
}

async function fetchFromCloud(
  fileId: string,
  token: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const json = (await res.json()) as { ok: boolean; result?: { file_path: string } };
  if (!json.ok || !json.result) {
    throw new AppError(502, "telegram_error", "Failed to resolve file from Telegram");
  }

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${json.result.file_path}`);
  if (!fileRes.ok) {
    throw new AppError(502, "telegram_error", "Failed to download file from Telegram");
  }
  return {
    buffer: Buffer.from(await fileRes.arrayBuffer()),
    contentType:
      usableContentType(fileRes.headers.get("content-type")) ??
      contentTypeForPath(json.result.file_path),
  };
}

function usableContentType(header: string | null): string | undefined {
  if (!header || header.startsWith("application/octet-stream")) return undefined;
  return header;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
};

/** The filesystem carries no content type, unlike an HTTP download. */
function contentTypeForPath(filePath: string): string {
  const byExtension = CONTENT_TYPES[extname(filePath).toLowerCase()];
  if (byExtension) return byExtension;
  // The cloud API hands back extensionless paths like "photos/file_0"; every
  // Telegram photo is a JPEG, and the dashboard renders these in an <img>.
  if (filePath.includes("photos/")) return "image/jpeg";
  return "application/octet-stream";
}
