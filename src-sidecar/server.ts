import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { closeDatabase, openDatabase } from "./db";
import { getOverview } from "./overviewService";
import { scanCodexUsage } from "./scanService";
import type { RangeKey } from "./types";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function createSidecarServer(options: {
  databasePath?: string;
  timezone?: string;
  now?: () => Date;
}) {
  const databasePath = options.databasePath ?? path.resolve(process.cwd(), "codex-usage-desktop.db");
  const db = openDatabase(databasePath);

  const server = createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Invalid request." });
      return;
    }

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scan") {
        const body = await readBody(request);
        const result = await scanCodexUsage({
          db,
          codexHome: typeof body.codexHome === "string" ? body.codexHome : undefined,
          timezone: options.timezone,
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/overview") {
        const range = url.searchParams.get("range");

        if (range !== "1d" && range !== "2d" && range !== "7d" && range !== "14d" && range !== "30d") {
          sendJson(response, 400, { error: "Range must be one of 1d, 2d, 7d, 14d, or 30d." });
          return;
        }

        sendJson(
          response,
          200,
          getOverview({
            db,
            range: range as RangeKey,
            timezone: options.timezone,
            now: options.now?.(),
          }),
        );
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error.",
      });
    }
  });

  return {
    server,
    async start(port: number) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      closeDatabase(db);
    },
  };
}
