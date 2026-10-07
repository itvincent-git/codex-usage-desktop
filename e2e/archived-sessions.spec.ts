import { $, browser, expect } from "@wdio/globals";
import { copyFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MonthlyUsageResponse } from "../src/lib/api";

// CODEX_USAGE_ARCHIVE_E2E=1 enables an isolated Codex home and app database.
describe("archived session usage", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("preserves monthly totals after archiving and counts duplicate copies once", async () => {
    const home = process.env.CODEX_HOME!;
    const sessions = join(home, "sessions", "2026", "09", "01");
    const archived = join(home, "archived_sessions");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c382c";
    const name = `rollout-2026-09-01T09-00-00-${id}.jsonl`;
    const activePath = join(sessions, name);
    const archivedPath = join(archived, name);
    const timestamp = "2026-09-01T09:00:00Z";
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
    writeFileSync(activePath, [
      { timestamp, type: "session_meta", payload: { id, cwd: "/archive-test" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5" } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    ].map((entry) => JSON.stringify(entry)).join("\n"));

    const rescan = () => browser.execute(async () => {
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: <T>(command: string) => Promise<T> };
      }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return runtime.invoke<MonthlyUsageResponse>("fetch_monthly_usage");
    });
    const showMonthlyTotal = async () => {
      await browser.refresh();
      const tab = $('[data-testid="monthly-nav-tab"]');
      await tab.waitForDisplayed({ timeout: 90_000 });
      await tab.click();
      const row = $('[data-monthly-row="2026-09"]');
      await row.waitForDisplayed({ timeout: 15_000 });
      await expect(row.$('[data-metric="totalTokens"]')).toHaveText(expect.stringContaining("1,300"));
    };

    const initial = (await rescan()).monthly.find((month) => month.month === "2026-09")!;
    expect(initial.totalTokens).toBe(1300);
    expect(initial.costUSD).toBeGreaterThan(0);
    await showMonthlyTotal();

    copyFileSync(activePath, archivedPath);
    expect((await rescan()).monthly.find((month) => month.month === "2026-09")!.totalTokens).toBe(1300);

    renameSync(activePath, archivedPath);
    const after = (await rescan()).monthly.find((month) => month.month === "2026-09")!;
    expect(after.totalTokens).toBe(initial.totalTokens);
    expect(after.costUSD).toBe(initial.costUSD);
    await showMonthlyTotal();
  }).timeout(180_000);
});
