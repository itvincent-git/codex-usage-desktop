import { $, $$, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("page layouts beside the sidebar", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("keeps every page usable with a wide sidebar at the minimum window size", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/sidebar-layout/long-project-name" } },
      { type: "turn_context", payload: { model: "gpt-5", cwd: "/sidebar-layout/long-project-name" } },
      { type: "event_msg", payload: { type: "user_message", message: "Check page layouts beside the expanded sidebar" } },
      { type: "event_msg", payload: { type: "agent_message", message: "Sidebar layout reply" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1234567, cached_input_tokens: 123456, output_tokens: 12345, total_tokens: 1246912 } } } },
    ];
    writeFileSync(join(sessions, "layout.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n") + "\n");
    const previous = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed", "show_logs_tab"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "360");
      localStorage.setItem("sidebar_collapsed", "false");
      localStorage.setItem("show_logs_tab", "true");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    try {
      await browser.refresh();
      await browser.setWindowSize(1100, 760);
      await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
      for (const page of ["dashboard", "sessions", "models", "daily", "monthly", "projects", "logs"]) {
        await $(`[data-testid="${page}-nav-tab"]`).click();
        await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
        if (page === "sessions") await $('[data-testid="session-card"]').waitForDisplayed();
        if (page === "models") await $('[data-testid="model-analytics"]').waitForDisplayed();
        if (page === "monthly") await $('[data-monthly-scroll]').waitForDisplayed();
        const layout = await browser.execute(() => {
          const content = document.querySelector("[data-app-content]")!;
          const scroller = content.firstElementChild!;
          const bounds = content.getBoundingClientRect();
          return {
            width: window.innerWidth,
            contentWidth: bounds.width,
            scrollWidth: scroller.scrollWidth,
            clientWidth: scroller.clientWidth,
            overflowing: Array.from(content.querySelectorAll("*"))
              .filter((el) => {
                if (el.closest("table, svg, [aria-hidden='true']")) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.right > bounds.right + 1;
              })
              .slice(0, 12).map((el) => ({ tag: el.tagName, className: el.getAttribute("class"), text: el.textContent?.slice(0, 50) })),
          };
        });
        expect(layout.width).toBe(1100);
        expect(layout.contentWidth).toBe(740);
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
        expect(layout.overflowing).toEqual([]);
        if (page === "sessions") {
          const cardOverflow = await $('[data-testid="session-card"]').execute((card) => {
            const bounds = card.getBoundingClientRect();
            return Array.from(card.children).some((child) => child.getBoundingClientRect().right > bounds.right);
          });
          expect(cardOverflow).toBe(false);
          await $('[data-testid="session-card"]').click();
          await expect($('[aria-labelledby="session-detail-title"]')).toHaveText(expect.stringContaining("Sidebar layout reply"));
          await browser.saveScreenshot("/tmp/codex-layout-session-detail.png");
          await $('button[aria-label^="Close tab:"]').click();
        }
        if (page === "models") {
          await $('[data-quota-model] summary').click();
          await expect($('[data-quota-details]')).toBeDisplayed();
          await $('[data-testid="models-catalog-tab"]').click();
          await $('[data-testid="pricing-search"]').waitForDisplayed();
          await $('[data-testid="pricing-search"]').setValue("gpt");
          await expect($('[data-testid="pricing-catalog"] table')).toBeDisplayed();
          await $('[data-testid="models-usage-tab"]').click();
        }
        if (page === "projects") {
          await $('[data-testid="project-comparison"] tr[role="button"]').click();
          const project = $('[aria-labelledby="modal-project-title"]');
          await project.waitForDisplayed();
          await project.$('[data-testid="session-card"]').waitForDisplayed();
          const clipped = await project.execute((dialog) => {
            const bounds = dialog.getBoundingClientRect();
            return Array.from(dialog.querySelectorAll("header button, [data-testid='session-card'] > div"))
              .some((element) => element.getBoundingClientRect().right > bounds.right);
          });
          expect(clipped).toBe(false);
          await browser.saveScreenshot("/tmp/codex-layout-project-detail.png");
          await $('button[aria-label="Close project details"]').click();
        }
        if (page === "logs") {
          await browser.tauri.execute(({ core }) => core.invoke("plugin:log|log", {
            level: 3,
            message: "Sidebar layout log fixture",
            location: "e2e/sidebar-layout.spec.ts",
          }));
          await browser.waitUntil(async () => await $$("[data-app-content] .font-mono > div > span:first-child").length > 0);
          const times = await browser.execute(() => Array.from(document.querySelectorAll("[data-app-content] .font-mono > div > span:first-child"))
            .map((element) => element.textContent));
          expect(times.length).toBeGreaterThan(0);
          expect(times.every((time) => /^\d{2}:\d{2}:\d{2}[.,]\d{3}$/.test(time ?? ""))).toBe(true);
        }
        const tableScroll = await browser.execute(() => {
          const element = document.querySelector("[data-app-content] table")?.parentElement;
          if (!element) return null;
          element.scrollLeft = element.scrollWidth;
          const lastCell = element.querySelector("thead th:last-child")!;
          return {
            left: element.scrollLeft,
            lastColumnVisible: lastCell.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1,
          };
        });
        if (tableScroll) expect(tableScroll.lastColumnVisible).toBe(true);
        if (["daily", "monthly"].includes(page)) expect(tableScroll?.left).toBe(0);
        await browser.execute(() => { document.querySelector("[data-app-content]")!.firstElementChild!.scrollTop = 0; });
        await browser.saveScreenshot(`/tmp/codex-layout-${page}.png`);
        if (page === "dashboard") {
          await $(".trend-metrics").scrollIntoView({ block: "center" });
          const clippedValues = await $(".trend-metrics").execute((metrics) =>
            Array.from(metrics.querySelectorAll("p[title]"))
              .filter((element) => element.scrollWidth > element.clientWidth)
              .map((element) => element.textContent));
          expect(clippedValues).toEqual([]);
          await browser.saveScreenshot("/tmp/codex-layout-dashboard-metrics.png");
        }
      }
      await $('button[aria-label="Settings"]').click();
      await expect($("h1=Settings")).toBeDisplayed();
      await browser.saveScreenshot("/tmp/codex-layout-settings.png");
      for (const section of ["general", "menuBar", "maintenance"]) {
        const tab = $(`#settings-tab-${section}`);
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        const overflows = await $(`#settings-section-${section}`).execute((element) =>
          element.scrollWidth > element.clientWidth);
        expect(overflows).toBe(false);
        await browser.saveScreenshot(`/tmp/codex-layout-settings-${section}.png`);
      }
      await $("button=Back").click();
      await $('[data-testid="models-nav-tab"]').click();
      await $('[data-testid="model-analytics"]').waitForDisplayed();
      const previousScroll = await browser.execute(() => {
        const scroller = document.querySelector("[data-app-content]")!.firstElementChild!;
        scroller.scrollTop = 200;
        return scroller.scrollTop;
      });
      expect(previousScroll).toBeGreaterThan(0);
      await $('[data-testid="dashboard-nav-tab"]').click();
      expect(await browser.execute(() => document.querySelector("[data-app-content]")!.firstElementChild!.scrollTop)).toBe(0);
      for (const scenario of [
        { width: 1100, sidebar: 360, collapsed: true, language: "en" },
        { width: 1440, sidebar: 160, collapsed: false, language: "en" },
        { width: 1100, sidebar: 360, collapsed: false, language: "zh" },
        { width: 1100, sidebar: 360, collapsed: false, language: "ja" },
      ]) {
        await browser.execute((scenario) => {
          localStorage.setItem("language", scenario.language);
          localStorage.setItem("sidebar_width", String(scenario.sidebar));
          localStorage.setItem("sidebar_collapsed", String(scenario.collapsed));
        }, scenario);
        await browser.refresh();
        await browser.setWindowSize(scenario.width, 760);
        for (const page of ["dashboard", "sessions", "models", "daily", "monthly", "projects", "logs"]) {
          await $(`[data-testid="${page}-nav-tab"]`).click();
          if (page === "sessions") await $('[data-testid="session-card"]').waitForDisplayed();
          if (page === "models") await $('[data-testid="model-analytics"]').waitForDisplayed();
          if (page === "monthly") await $('[data-monthly-scroll]').waitForDisplayed();
          const layout = await browser.execute(() => {
            const content = document.querySelector("[data-app-content]")!;
            const scroller = content.firstElementChild!;
            const clippedCards = Array.from(content.querySelectorAll("[data-testid='session-card']"))
              .filter((card) => Array.from(card.children).some((element) => element.getBoundingClientRect().right > card.getBoundingClientRect().right));
            return { overflow: scroller.scrollWidth > scroller.clientWidth, clippedCards: clippedCards.length };
          });
          if (layout.overflow) {
            await browser.saveScreenshot("/tmp/codex-layout-overflow.png");
            const overflowing = await browser.execute(() => {
              const content = document.querySelector("[data-app-content]")!;
              return Array.from(content.querySelectorAll("*"))
                .filter(element => element.getBoundingClientRect().right > content.getBoundingClientRect().right + 1)
                .slice(0, 8).map(element => ({ tag: element.tagName, className: element.getAttribute("class"), text: element.textContent?.slice(0, 80) }));
            });
            throw new Error(JSON.stringify({ scenario, page, overflowing }));
          }
          expect({ scenario, page, ...layout }).toEqual({ scenario, page, overflow: false, clippedCards: 0 });
          await browser.saveScreenshot(`/tmp/codex-layout-${scenario.language}-${scenario.width}-${scenario.collapsed ? "collapsed" : "expanded"}-${page}.png`);
        }
      }
    } finally {
      unlinkSync(join(sessions, "layout.jsonl"));
      await browser.execute(async () => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
      });
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previous);
      await browser.setWindowSize(1440, 960);
      await browser.refresh();
    }
  }).timeout(240_000);
});
