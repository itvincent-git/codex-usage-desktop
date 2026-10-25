import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexLimitsResponse } from "../src/lib/api";

describe("dashboard layout", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let previousPreferences: Record<string, string | null>;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/dashboard-layout" } },
      { type: "turn_context", payload: { model: "gpt-5" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1234567, cached_input_tokens: 123456, output_tokens: 12345, total_tokens: 1246912 } } } },
    ];
    writeFileSync(join(sessions, "dashboard.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));
    previousPreferences = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "160");
      localStorage.setItem("sidebar_collapsed", "false");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    // Only the remote account response is mocked; usage loads through native commands.
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 25, remainingPercent: 75, windowMinutes: 300, resetsAt: new Date(Date.now() + 295 * 60_000).toISOString() },
      weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: new Date(Date.now() + (6 * 24 + 23) * 3_600_000 + 55 * 60_000).toISOString() },
      resetCreditsAvailableCount: 2,
      resetCredits: [{ id: "first", expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }, { id: "second", expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() }],
      membershipLevel: "plus",
      updatedAt: timestamp,
      source: "dashboard-layout-e2e",
    };
    // Tauri's invoke is read-only; stub only this command's IPC response.
    await browser.execute((limits) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => String(input) === url
        ? Promise.resolve(new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
        : fetch(input, options);
    }, limits);
    await $("button=Check limits").waitForEnabled();
    await $("button=Check limits").click();
    await $('[data-testid="limit-row-5-hour"]').waitForDisplayed();
  });

  after(async () => {
    if (!previousPreferences) return;
    await browser.execute((preferences) => {
      for (const [key, value] of Object.entries(preferences)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, previousPreferences);
    await browser.setWindowSize(1440, 960);
    await browser.refresh();
  });

  run("moves quota controls into the sidebar and keeps them available when collapsed", async () => {
    await browser.setWindowSize(1100, 760);
    const readLayout = () => browser.execute(() => {
      const trends = document.querySelector('[data-testid="usage-trends-card"]')!;
      const hero = trends.parentElement!.parentElement!;
      const header = document.querySelector("h1")!.parentElement!.parentElement!.parentElement!;
      return {
        heroColumns: getComputedStyle(hero).gridTemplateColumns.split(" ").length,
        headerDirection: getComputedStyle(header).flexDirection,
        mainQuotaCount: document.querySelectorAll('[data-app-content] [data-testid^="limit-row-"]').length,
      };
    });
    const expected = { heroColumns: 2, headerDirection: "row", mainQuotaCount: 0 };
    expect(await readLayout()).toEqual(expected);
    await expect($('[data-app-sidebar] [data-testid="limit-row-5-hour"]')).toBeDisplayed();
    await expect($('[data-app-sidebar] button[aria-label="Check limits"]')).toBeDisplayed();
    await expect($('[data-app-sidebar] [data-testid="limit-row-5-hour"] [data-quota-outline]')).toHaveAttribute("stroke-dasharray", "75 100");
    await expect($('[data-app-sidebar] [data-testid="limit-row-5-hour"] [data-quota-countdown]')).toHaveText("4h55m");
    await expect($('[data-app-sidebar] [data-testid="limit-row-weekly"] [data-quota-countdown]')).toHaveText("6d23h");
    await $('[data-testid="models-nav-tab"]').click();
    await expect($('[data-app-sidebar] [data-testid="limit-row-weekly"]')).toBeDisplayed();
    await $('[data-testid="dashboard-nav-tab"]').click();
    await $('button[aria-label="Collapse sidebar"]').click();
    await expect($('button[aria-label="Expand sidebar"]')).toHaveAttribute("aria-expanded", "false");
    expect(await readLayout()).toEqual(expected);
    await $('button[aria-label="Quota overview"]').click();
    await expect($('[data-testid="limit-row-5-hour"]')).toBeDisplayed();
    await $('button[aria-label="Check limits"]').click();
    await $('button[aria-label="Check limits"]').waitForEnabled();
    await expect($('[data-testid="limit-row-5-hour"]')).toHaveText(expect.stringContaining("75%"));
    await browser.saveScreenshot("/tmp/codex-dashboard-layout-1100-collapsed.png");
    await browser.keys("Escape");
    await $('button[aria-label="Expand sidebar"]').click();
    expect(await readLayout()).toEqual(expected);
    await browser.saveScreenshot("/tmp/codex-dashboard-layout-1100.png");
  });

  run("keeps all four trend metrics in one row beside the cost summary", async () => {
    for (const width of [1280, 1440]) {
      await browser.setWindowSize(width, 960);
      const metrics = $(".trend-metrics");
      await metrics.scrollIntoView({ block: "center" });
      const layout = await metrics.execute((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
        rows: getComputedStyle(element).gridTemplateRows.split(" ").length,
        count: element.children.length,
      }));
      expect(layout).toEqual({ columns: 4, rows: 1, count: 4 });
      await browser.saveScreenshot(`/tmp/codex-dashboard-layout-${width}.png`);
    }
  });

  run("fits two-line quota cards at narrow, default and wide sidebar widths", async () => {
    for (const width of [160, 240, 360]) {
      const resize = $('[role="separator"][aria-label="Resize sidebar"]');
      await resize.click();
      const current = Number(await resize.getAttribute("aria-valuenow"));
      for (let step = current; step < width; step += 8) await browser.keys("ArrowRight");
      await browser.setWindowSize(width === 160 ? 1100 : 1440, 960);
      const layout = await browser.execute(() => {
        const sidebar = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect();
        const cards = Array.from(document.querySelectorAll('[data-app-sidebar] [data-testid^="limit-row-"]'));
        return cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const row = card.querySelector('.quota-reset-row')!;
          const pieces = Array.from(row.children).map((child) => child.getBoundingClientRect());
          const outline = card.querySelector('[data-quota-outline]')!.getBoundingClientRect();
          return {
            inside: bounds.left >= sidebar.left && bounds.right <= sidebar.right,
            height: bounds.height,
            overflow: row.scrollWidth > row.clientWidth,
            overlap: pieces.length === 2 && pieces[0].right > pieces[1].left,
            outlineWidth: outline.width,
          };
        });
      });
      expect(layout).toHaveLength(2);
      for (const card of layout) {
        expect(card.inside).toBe(true);
        expect(card.height).toBeLessThan(90);
        expect(card.overflow).toBe(false);
        expect(card.overlap).toBe(false);
        expect(card.outlineWidth).toBeGreaterThan(100);
      }
      await browser.saveScreenshot(`/tmp/codex-sidebar-quota-${width}.png`);
    }
  });
  run("preserves activation from the sidebar without submitting a real model request", async () => {
    const activate = $('button[aria-label="Start limit window"]');
    await expect(activate).toBeDisabled();
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 0, remainingPercent: 100, windowMinutes: 300, resetsAt: new Date(Date.now() + 295 * 60_000).toISOString() },
      weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: new Date(Date.now() + 167 * 3_600_000).toISOString() },
      membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "sidebar-activation-e2e",
    };
    await browser.execute((limits) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const limitsUrl = runtime.convertFileSrc("fetch_codex_limits", "ipc");
      const activationUrl = runtime.convertFileSrc("activate_codex_window", "ipc");
      const fetch = window.fetch.bind(window);
      document.body.dataset.activationRequests = "0";
      window.confirm = () => true;
      window.fetch = (input, options) => {
        if (![limitsUrl, activationUrl].includes(String(input))) return fetch(input, options);
        if (String(input) === activationUrl) document.body.dataset.activationRequests = String(Number(document.body.dataset.activationRequests) + 1);
        const payload = String(input) === activationUrl ? { status: "started", limits } : limits;
        return Promise.resolve(new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
      };
    }, limits);
    await $('button[aria-label="Check limits"]').click();
    await expect(activate).toBeEnabled();
    expect(await browser.execute(() => document.body.dataset.activationRequests)).toBe("0");
    await activate.click();
    await expect(activate).toBeDisabled();
    await expect($('.sidebar-limits [role="status"]')).toBeDisplayed();
    expect(await browser.execute(() => document.body.dataset.activationRequests)).toBe("1");
    await expect($('[data-testid="limit-row-5-hour"] [data-quota-outline]')).toHaveAttribute("stroke-dasharray", "100 100");
  });

  run("shows Chinese quota labels and the monthly limit for a free account", async () => {
    await browser.execute(() => {
      localStorage.setItem("language", "zh");
      localStorage.setItem("sidebar_width", "240");
    });
    await browser.refresh();
    await browser.setWindowSize(1440, 960);
    await $('button=重新扫描本地日志').waitForEnabled({ timeout: 90_000 });
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 0, remainingPercent: 100, windowMinutes: 300, resetsAt: new Date(Date.now() + 295 * 60_000).toISOString() },
      weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: new Date(Date.now() + 167 * 3_600_000).toISOString() },
      membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "sidebar-chinese-e2e",
      resetCreditsAvailableCount: 2, resetCredits: [{ id: "first", expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }],
    };
    const installLimits = async (data: CodexLimitsResponse) => {
      await browser.execute((data) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
        const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
        const fetch = window.fetch.bind(window);
        window.fetch = (input, options) => String(input) === url
          ? Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
          : fetch(input, options);
      }, data);
      await $('button[aria-label="查询限额"]').click();
      await $('button[aria-label="查询限额"]').waitForEnabled();
    };
    await installLimits(limits);
    await expect($('.sidebar-limits')).toHaveText(expect.stringContaining("5小时限制"));
    await expect($('.sidebar-limits')).toHaveText(expect.stringContaining("周限制"));
    await expect($('[data-testid="limit-row-5-hour"] [data-quota-countdown]')).toHaveText("4h55m");
    await expect($('[data-app-content] [data-testid="reset-credit-count"]')).toHaveText("2 次可用");
    await browser.saveScreenshot("/tmp/codex-sidebar-quota-zh.png");
    await installLimits({ ...limits, membershipLevel: "free", session: null, weekly: { usedPercent: 65, remainingPercent: 35, windowMinutes: 43200, resetsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() } });
    await expect($('[data-app-sidebar] [data-testid="limit-row-monthly"]')).toHaveText(expect.stringContaining("月限制"));
    await expect($('[data-testid="limit-row-monthly"] [data-quota-outline]')).toHaveAttribute("stroke-dasharray", "35 100");
    await expect($('[data-testid="limit-row-5-hour"]')).not.toExist();
    await expect($('[data-testid="limit-row-weekly"]')).not.toExist();
    await expect($('button[aria-label="启动额度窗口"]')).not.toExist();
    await browser.saveScreenshot("/tmp/codex-sidebar-quota-monthly.png");
  });

});
