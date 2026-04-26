import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, upsertDailyRows } from "../db";
import { getOverview } from "../overviewService";

describe("getOverview", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it("fills missing dates and calculates overview totals", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-usage-overview-"));
    cleanups.push(() => rm(tempDir, { recursive: true, force: true }));

    const db = openDatabase(path.join(tempDir, "overview.db"));
    cleanups.push(async () => closeDatabase(db));

    upsertDailyRows(db, [
      {
        date: "2026-04-21",
        inputTokens: 800,
        cachedInputTokens: 100,
        outputTokens: 200,
        reasoningOutputTokens: 0,
        totalTokens: 1000,
        costUSD: 0.0028875,
        models: {},
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
      {
        date: "2026-04-26",
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 400,
        reasoningOutputTokens: 0,
        totalTokens: 1600,
        costUSD: 0.005275,
        models: {},
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
    ]);

    const overview = getOverview({
      db,
      range: "7d",
      timezone: "UTC",
      now: new Date("2026-04-26T10:00:00.000Z"),
    });

    expect(overview.startDate).toBe("2026-04-20");
    expect(overview.endDate).toBe("2026-04-26");
    expect(overview.daily).toHaveLength(7);
    expect(overview.totals.totalTokens).toBe(2600);
    expect(overview.totals.avgTokensPerDay).toBeCloseTo(371.428571, 6);
  });
});
