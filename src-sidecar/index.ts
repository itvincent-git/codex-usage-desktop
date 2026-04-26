import { createSidecarServer } from "./server";

export async function startServer() {
  const port = Number(process.env.CODEX_USAGE_DESKTOP_PORT ?? 43110);
  const databasePath = process.env.CODEX_USAGE_DESKTOP_DB_PATH;
  const server = createSidecarServer({ databasePath });
  await server.start(port);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer();
}

