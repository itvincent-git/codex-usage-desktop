import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse } from "../src/lib/api";

describe("dashboard quota trends", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let previousPreferences: Record<string, string | null>;
  const card = '[data-testid="usage-trends-card"]';
  const views = `${card} [role="group"][aria-label="Trend view"]`;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    for (const daysAgo of [9, 2, 1, 0]) {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      date.setHours(8, 0, 0, 0);
      const entries: unknown[] = [
        { timestamp: date.toISOString(), type: "session_meta", payload: { cwd: "/quota-trends" } },
        { timestamp: date.toISOString(), type: "turn_context", payload: { model: "gpt-5" } },
      ];
      for (let index = 0; index < 4; index++) {
        const timestamp = new Date(date.getTime() + [0, 1, 6, 7][index] * 3_600_000).toISOString();
        entries.push({
          timestamp, type: "event_msg", payload: {
            type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 100, total_tokens: 1100 } },
            ...(daysAgo === 1 ? {} : { rate_limits: {
              primary: { window_minutes: 300, used_percent: daysAgo === 0 ? 0 : [0, 80, 0, 70][index], resets_at: new Date(date.getTime() + (index < 2 ? 5 : 11) * 3_600_000).toISOString() },
              secondary: { window_minutes: 10080, used_percent: daysAgo === 0 ? 0 : [0, 5, 5, 10][index], resets_at: new Date(date.getTime() + 168 * 3_600_000).toISOString() },
            } }),
          },
        });
      }
      writeFileSync(join(sessions, `quota-trends-${daysAgo}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n"));
    }
    previousPreferences = await browser.execute(async () => {
      const keys = ["language", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_collapsed", "false");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await $('button=Rescan local logs').waitForEnabled({ timeout: 90_000 });
    await $('[data-testid="dashboard-nav-tab"]').click();
  });

  after(async () => {
    if (!previousPreferences) return;
    await browser.execute((preferences) => {
      for (const [key, value] of Object.entries(preferences)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, previousPreferences);
  });

  run("switches native daily usage between cost and quota, including range and full screen", async () => {
    await browser.setWindowSize(1440, 960);
    await $(card).waitForDisplayed();
    await expect($(views).$('button=Cost')).toHaveAttribute("aria-pressed", "true");
    // Open Radix menus with the keyboard: the embedded driver's click does not emit pointerdown.
    await $('button[aria-label="Select time range"]').execute((element) => element.focus());
    await browser.keys("Enter");
    await $('[role="menu"]').waitForDisplayed();
    await $('[role="menu"]').$('div=Last 7 Days').click();
    await $('button=Rescan local logs').waitForEnabled();
    const data = await browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<OverviewResponse> } }).__TAURI_INTERNALS__;
      return runtime.invoke("fetch_overview", { range: "7d" });
    });
    expect(data.daily.some((day) => day.fiveHourPercent === 150)).toBe(true);
    expect(data.daily.some((day) => day.fiveHourPercent === 0)).toBe(true);
    expect(data.daily.some((day) => day.totalTokens > 0 && day.fiveHourPercent == null)).toBe(true);

    const barCount = await $(`${card} .recharts-bar-rectangles`).$$('.recharts-bar-rectangle').length;
    const height = (await $(card).getSize()).height;
    await $(views).$('button=Quota').click();
    await expect($(views).$('button=Quota')).toHaveAttribute("aria-pressed", "true");
    await expect($(card).$('button=5h usage')).toBeDisplayed();
    await expect($(card).$('button=Weekly/monthly usage')).toBeDisplayed();
    await expect($(`${card} .recharts-line-dot[stroke="#f97316"]`)).toBeDisplayed();
    expect(await $(`${card} .recharts-bar-rectangles`).$$('.recharts-bar-rectangle').length).toBe(barCount);
    expect((await $(card).getSize()).height).toBe(height);
    const axis = $(card).$$('.recharts-yAxis-tick-labels')[1];
    // Recharts renders tick labels in a separate layer; inspect their SVG text.
    await browser.waitUntil(async () => axis.execute((element) => element.textContent!.includes("%")));
    const axisText = await axis.execute((element) => element.textContent!) as string;
    const ticks = axisText.match(/[\d,.]+%/g)!.map((text) => Number(text.replace(/[% ,]/g, "")));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(150);

    await $(card).$('button=5h usage').click();
    await expect($(card).$('button=5h usage')).toHaveAttribute("aria-pressed", "false");
    await expect($(`${card} .recharts-line-dot[stroke="#f97316"]`)).not.toExist();
    await $(card).$('button=5h usage').click();

    // The embedded driver dispatches DOM events, so use the chart's keyboard navigation for tooltips.
    await $(`${card} svg[role="application"]`).execute((element) => element.focus());
    await browser.keys("ArrowRight");
    await $(`${card} .recharts-tooltip-wrapper`).waitForDisplayed();
    await expect($(`${card} .recharts-tooltip-wrapper`)).toHaveText(expect.stringContaining("Observed daily quota consumption"));
    await expect($(`${card} .recharts-tooltip-wrapper`)).not.toHaveText(expect.stringContaining("$"));

    await $('button[aria-label="Expand chart to full screen"]').click();
    await expect($('[role="dialog"]')).toBeDisplayed();
    await expect($(views).$('button=Quota')).toHaveAttribute("aria-pressed", "true");
    await browser.keys("Escape");
    await expect($('[role="dialog"]')).not.toExist();
    await expect($(views).$('button=Quota')).toHaveAttribute("aria-pressed", "true");

    await $('button[aria-label="Select time range"]').execute((element) => element.focus());
    await browser.keys("Enter");
    await $('[role="menu"]').waitForDisplayed();
    await $('[role="menu"]').$('div=Last 14 Days').click();
    // Range changes remount the dashboard; view choice is local to the chart's lifetime.
    await expect($(views).$('button=Cost')).toHaveAttribute("aria-pressed", "true");
    await $(views).$('button=Quota').click();
    await browser.waitUntil(async () => await $(card).$$('.recharts-line-dot[stroke="#f97316"]').length === 3);
    await expect($(views).$('button=Quota')).toHaveAttribute("aria-pressed", "true");
    await browser.saveScreenshot("/tmp/codex-dashboard-quota-trends.png");

    await $(views).$('button=Cost').click();
    await expect($(card).$('button=5h usage')).not.toExist();
    await browser.waitUntil(async () => $(card).$$('.recharts-yAxis-tick-labels')[1].execute((element) => element.textContent!.includes("$")));
  });

  run("keeps Chinese quota controls readable in the narrower dashboard", async () => {
    await browser.execute(() => localStorage.setItem("language", "zh"));
    await browser.refresh();
    await $('button=重新扫描本地日志').waitForEnabled({ timeout: 90_000 });
    await browser.setWindowSize(1100, 760);
    await $(card).$('[role="group"][aria-label="趋势视图"]').$("button=额度").click();
    await expect($(card).$('button=5h 消耗')).toBeDisplayed();
    await expect($(card).$('button=周/月消耗')).toBeDisplayed();
    const overflows = await $(card).execute((element) => {
      const header = element.firstElementChild!;
      const buttons = [...header.querySelectorAll("button")];
      const bounds = header.getBoundingClientRect();
      return header.scrollWidth > header.clientWidth || buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left < bounds.left || rect.right > bounds.right;
      });
    });
    expect(overflows).toBe(false);
    await browser.saveScreenshot("/tmp/codex-dashboard-quota-trends-zh-1100.png");
  });
});
