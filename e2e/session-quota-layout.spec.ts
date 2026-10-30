import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("session quota layout", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("keeps German quota labels and values separate in wide and narrow cards", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const start = new Date();
    start.setHours(8, 0, 0, 0);
    const timestamp = start.toISOString();
    const entries = [
      { timestamp, type: "session_meta", payload: { cwd: "/session-quota-layout" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5" } },
      ...[0, 1].map((index) => ({
        timestamp: new Date(start.getTime() + index * 60_000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } },
          rate_limits: {
            primary: { window_minutes: 300, used_percent: index * 4, resets_at: new Date(start.getTime() + 5 * 3_600_000).toISOString() },
            secondary: { window_minutes: 10080, used_percent: index, resets_at: new Date(start.getTime() + 168 * 3_600_000).toISOString() },
          },
        },
      })),
    ];
    writeFileSync(join(sessions, "session-quota-layout.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const previous = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "de");
      localStorage.setItem("sidebar_width", "240");
      localStorage.setItem("sidebar_collapsed", "false");
      await (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("scan_usage");
      return previous;
    });
    try {
      await browser.refresh();
      await $("button=Lokale Protokolle erneut scannen").waitForEnabled({ timeout: 90_000 });
      await $('[data-testid="sessions-nav-tab"]').click();
      const quota = $('[data-testid="session-card"] .session-card-quota');
      await expect(quota).toHaveText(expect.stringContaining("Ca. 4% · 96% verbleibend"));
      await expect(quota).toHaveText(expect.stringContaining("Ca. 1% · 99% verbleibend"));
      for (const width of [1440, 1280, 1100]) {
        await browser.setWindowSize(width, 960);
        await quota.scrollIntoView({ block: "center" });
        const layout = await quota.execute((element) => {
          const bounds = element.getBoundingClientRect();
          const card = element.closest("article")!.getBoundingClientRect();
          return {
            insideCard: bounds.right <= card.right,
            rows: Array.from(element.firstElementChild!.children).map((row) => {
              const label = row.firstElementChild!.getBoundingClientRect();
              const value = row.querySelector('[role="img"]')!.getBoundingClientRect();
              return { gap: value.left - label.right, inside: value.left >= bounds.left && value.right <= bounds.right, overflow: row.scrollWidth > row.clientWidth + 1 };
            }),
          };
        }) as { insideCard: boolean; rows: Array<{ gap: number; inside: boolean; overflow: boolean }> };
        await browser.saveScreenshot(`/tmp/codex-session-quota-de-${width}.png`);
        expect(layout.insideCard).toBe(true);
        expect(layout.rows).toHaveLength(2);
        for (const row of layout.rows) {
          expect(row.gap).toBeGreaterThanOrEqual(7);
          expect(row.inside).toBe(true);
          expect(row.overflow).toBe(false);
        }
      }
    } finally {
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previous);
      await browser.setWindowSize(1440, 960);
      await browser.refresh();
    }
  }).timeout(120_000);
});
