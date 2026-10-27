import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse } from "../src/lib/api";

describe("short-range hourly usage", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("switches the one-day and two-day trends from daily to hourly buckets", async () => {
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector('[data-testid="dashboard-nav-tab"]'))),
      { timeout: 90_000, timeoutMsg: "App navigation did not mount" },
    );
    await browser.execute(() => {
      (document.querySelector('[data-testid="dashboard-nav-tab"]') as HTMLElement).click();
    });

    const now = new Date();
    const previousHour = new Date(now.getTime() - 60 * 60_000);
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "hourly-usage.jsonl"), [
      { timestamp: previousHour.toISOString(), type: "session_meta", payload: { cwd: "/hourly-usage" } },
      { timestamp: previousHour.toISOString(), type: "turn_context", payload: { model: "gpt-5" } },
      {
        timestamp: previousHour.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 200,
              output_tokens: 300,
              total_tokens: 1_300,
            },
          },
        },
      },
      {
        timestamp: now.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 2_000,
              cached_input_tokens: 400,
              output_tokens: 600,
              total_tokens: 2_600,
            },
          },
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });

    const range = $('[data-testid="range-switcher"]');
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector('[data-testid="range-switcher"]'))),
      {
        timeout: 15_000,
        timeoutMsg: await browser.execute(() => document.body.innerText.slice(0, 2_000)),
      },
    );
    await range.execute((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    const oneDay = $('[data-testid="range-option-1d"]');
    await oneDay.waitForExist();
    await oneDay.click();

    const chart = $('[data-testid="usage-trends-card"]');
    await expect(chart).toHaveAttribute("data-chart-granularity", "hour");
    const overview = await browser.execute(async () => {
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
        };
      }).__TAURI_INTERNALS__;
      return runtime.invoke<OverviewResponse>("fetch_overview", { range: "1d" });
    });
    expect(overview.hourly?.length).toBeGreaterThan(1);
    await expect(chart).toHaveAttribute("data-chart-points", String(overview.hourly!.length));
    expect(overview.hourly!.at(-1)?.date).toMatch(/T\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(overview.hourly!.reduce((total, row) => total + row.totalTokens, 0)).toBe(
      overview.totals.totalTokens,
    );
    await browser.saveScreenshot("/tmp/codex-usage-hourly-trend.png");

    await range.execute((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    const twoDays = $('[data-testid="range-option-2d"]');
    await twoDays.waitForExist();
    await twoDays.click();

    const twoDayOverview = await browser.execute(async () => {
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
        };
      }).__TAURI_INTERNALS__;
      return runtime.invoke<OverviewResponse>("fetch_overview", { range: "2d" });
    });
    await expect(chart).toHaveAttribute("data-chart-granularity", "hour");
    await expect(chart).toHaveAttribute("data-chart-points", String(twoDayOverview.hourly!.length));
    expect(twoDayOverview.hourly!.length).toBeGreaterThan(overview.hourly!.length);
    expect(twoDayOverview.hourly!.reduce((total, row) => total + row.totalTokens, 0)).toBe(
      twoDayOverview.totals.totalTokens,
    );
  }).timeout(180_000);
});
