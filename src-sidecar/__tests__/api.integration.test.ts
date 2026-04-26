import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSidecarServer } from "../server";
import { createCodexFixture } from "./fixtures";

const describeRealApi = process.env.RUN_REAL_API_TESTS ? describe : describe.skip;

describeRealApi("sidecar API", () => {
  let baseUrl = "";
  let closeServer: (() => Promise<void>) | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const fixture = await createCodexFixture();
    cleanup = fixture.cleanup;

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-usage-desktop-api-"));
    const server = createSidecarServer({
      databasePath: path.join(tempDir, "usage.db"),
      timezone: "UTC",
      now: () => new Date("2026-04-26T10:00:00.000Z"),
    });
    await server.start(0);

    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind sidecar server.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = async () => {
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    };

    const response = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ codexHome: fixture.codexHome }),
    });

    expect(response.status).toBe(200);
  }, 30000);

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }

    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("returns the recent 1 day overview", async () => {
    const response = await fetch(`${baseUrl}/api/overview?range=1d`);
    const payload = (await response.json()) as {
      totals: { totalTokens: number; costUSD: number };
      startDate: string;
      endDate: string;
    };

    expect(response.status).toBe(200);
    expect(payload.startDate).toBe("2026-04-26");
    expect(payload.endDate).toBe("2026-04-26");
    expect(payload.totals.totalTokens).toBe(1600);
    expect(payload.totals.costUSD).toBeCloseTo(0.005275, 6);
  });

  it("returns the recent 7 day overview", async () => {
    const response = await fetch(`${baseUrl}/api/overview?range=7d`);
    const payload = (await response.json()) as {
      totals: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      daily: Array<{ date: string; totalTokens: number }>;
    };

    expect(response.status).toBe(200);
    expect(payload.totals.inputTokens).toBe(2600);
    expect(payload.totals.cachedInputTokens).toBe(400);
    expect(payload.totals.outputTokens).toBe(800);
    expect(payload.totals.totalTokens).toBe(3400);
    expect(payload.daily).toHaveLength(7);
  });
});
