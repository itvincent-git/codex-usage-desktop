import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, queryDailyRows } from "../db";
import { scanCodexUsage } from "../scanService";
import { createCodexFixture } from "./fixtures";

describe("scanCodexUsage", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      await cleanupTasks.pop()!();
    }
  });

  it("imports daily Codex usage into SQLite", async () => {
    const fixture = await createCodexFixture();
    cleanupTasks.push(fixture.cleanup);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-usage-desktop-db-"));
    cleanupTasks.push(() => rm(tempDir, { recursive: true, force: true }));

    const db = openDatabase(path.join(tempDir, "usage.db"));
    cleanupTasks.push(async () => closeDatabase(db));

    const result = await scanCodexUsage({
      db,
      codexHome: fixture.codexHome,
      timezone: "UTC",
    });

    const rows = queryDailyRows(db, "2026-04-18", "2026-04-26");

    expect(result.importedDays).toBe(4);
    expect(rows.map((row) => row.date)).toEqual(["2026-04-18", "2026-04-21", "2026-04-24", "2026-04-26"]);
    expect(rows.at(-1)?.totalTokens).toBe(1600);
  });
});

