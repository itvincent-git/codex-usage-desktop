import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Run with CODEX_USAGE_REFRESH_E2E=1 to isolate the native scanner and app data.
describe("German layouts", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("fits German pages, settings and detail dialogs at supported window sizes", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/german-layout/project" } },
      { type: "turn_context", payload: { model: "gpt-5", cwd: "/german-layout/project" } },
      { type: "event_msg", payload: { type: "user_message", message: "Deutsche Benutzeroberfläche prüfen" } },
      { type: "event_msg", payload: { type: "agent_message", message: "Layoutprüfung abgeschlossen" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1234567, cached_input_tokens: 123456, output_tokens: 12345, total_tokens: 1246912 } } } },
    ];
    writeFileSync(join(sessions, "german.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n") + "\n");
    const previous = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed", "show_logs_tab"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "de");
      localStorage.setItem("show_logs_tab", "true");
      await (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("scan_usage");
      return previous;
    });
    const failures: Array<{ label: string; issues: string[] }> = [];
    const checkLayout = async (label: string) => {
      await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const issues = await browser.execute(() => {
        const content = document.querySelector("[data-app-content]")!;
        const bounds = content.getBoundingClientRect();
        const issues: string[] = [];
        if (content.firstElementChild!.scrollWidth > content.firstElementChild!.clientWidth) issues.push("page overflow");
        for (const el of document.querySelectorAll("[data-app-content] button, [data-app-content] h1, [data-app-content] h2, [data-app-content] h3, [data-app-sidebar] button, [data-testid^='limit-row-'] > div")) {
          if (el.closest("table, [aria-hidden='true'], [inert]")) continue;
          const rect = el.getBoundingClientRect();
          if (!rect.width || !rect.height || !el.checkVisibility()) continue;
          if (el.closest("[data-app-content]") && rect.right > bounds.right + 1) issues.push(`outside page: ${el.textContent}`);
          if (getComputedStyle(el).textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1) issues.push(`text overflow: ${el.textContent}`);
          if (getComputedStyle(el).display.includes("flex")) {
            const children = Array.from(el.children).filter((child) => getComputedStyle(child).position !== "absolute");
            for (let i = 1; i < children.length; i++) {
              const a = children[i - 1].getBoundingClientRect();
              const b = children[i].getBoundingClientRect();
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`overlap: ${el.textContent}`);
            }
          }
        }
        for (const el of content.querySelectorAll(".trend-metrics p")) {
          if (el.scrollWidth > el.clientWidth + 1) issues.push(`clipped metric: ${el.textContent}`);
        }
        return issues;
      });
      await browser.saveScreenshot(`/tmp/codex-german-${label}.png`);
      if (issues.length) { failures.push({ label, issues }); console.log(JSON.stringify({ label, issues })); }
    };
    try {
      for (const scenario of [
        { width: 1100, sidebar: 360, collapsed: false },
        { width: 1440, sidebar: 240, collapsed: false },
        { width: 1100, sidebar: 160, collapsed: false },
        { width: 1100, sidebar: 240, collapsed: true },
      ]) {
        await browser.execute((scenario) => {
          localStorage.setItem("sidebar_width", String(scenario.sidebar));
          localStorage.setItem("sidebar_collapsed", "false");
        }, scenario);
        await browser.refresh();
        await browser.setWindowSize(scenario.width, scenario.width === 1440 ? 960 : 760);
        await $("button=Lokale Protokolle erneut scannen").waitForEnabled({ timeout: 90_000 });
        // Keep local usage on the real Rust path; supply a deterministic account response.
        await browser.execute(() => {
          const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
          const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
          const fetch = window.fetch.bind(window);
          const limits = {
            session: { usedPercent: 25, remainingPercent: 75, windowMinutes: 300, resetsAt: new Date(Date.now() + 295 * 60_000).toISOString() },
            weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: new Date(Date.now() + 167 * 3_600_000).toISOString() },
            membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "german-layout-e2e",
            resetCreditsAvailableCount: 2,
            resetCredits: [{ id: "credit-1", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }],
          };
          window.fetch = (input, options) => String(input) === url
            ? Promise.resolve(new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
            : fetch(input, options);
        });
        // Startup can still have a native limits request in flight; retry after it settles.
        await browser.waitUntil(async () => {
          if (await $('[data-testid="limit-row-5-hour"]').isDisplayed()) return true;
          const query = $('button[aria-label="Limits prüfen"]');
          if (await query.isEnabled()) await query.click();
          return false;
        }, { timeout: 90_000, timeoutMsg: "Account fixture did not render" });
        if (scenario.collapsed) await $('button[aria-controls="app-navigation"]').click();
        const label = `${scenario.width}-${scenario.sidebar}-${scenario.collapsed}`;
        for (const page of ["dashboard", "sessions", "models", "daily", "monthly", "projects", "logs"]) {
          await $(`[data-testid="${page}-nav-tab"]`).click();
          await expect($(`[data-testid="${page}-nav-tab"]`)).toHaveAttribute("aria-selected", "true");
          if (page === "dashboard") await $(".trend-metrics").waitForDisplayed();
          if (page === "sessions") await $('[data-testid="session-card"]').waitForDisplayed();
          if (page === "models") await $('[data-testid="model-analytics"]').waitForDisplayed();
          if (page === "monthly") await $('[data-monthly-scroll]').waitForDisplayed();
          await checkLayout(`${label}-${page}`);
          if (page === "sessions") {
            await $('[data-testid="session-card"]').click();
            await expect($('[aria-labelledby="session-detail-title"]')).toHaveText(expect.stringContaining("Layoutprüfung abgeschlossen"));
            await checkLayout(`${label}-session-detail`);
            await $('button[aria-label="Sitzungsdetails schließen"]').click();
          }
          if (page === "projects") {
            await $('[data-testid="project-comparison"] tr[role="button"]').click();
            await $('[aria-labelledby="modal-project-title"] [data-testid="session-card"]').waitForDisplayed();
            await checkLayout(`${label}-project-detail`);
            await $('button[aria-label="Projektdetails schließen"]').click();
          }
        }
        await $('button[aria-label="Einstellungen"]').click();
        await expect($("h1=Einstellungen")).toBeDisplayed();
        for (const section of ["general", "menuBar", "maintenance", "third_party"]) {
          await $(`#settings-tab-${section}`).click();
          await expect($(`#settings-tab-${section}`)).toHaveAttribute("aria-selected", "true");
          await $(`#settings-section-${section}`).execute((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
          await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await checkLayout(`${label}-settings-${section}`);
        }
      }
      expect(failures).toEqual([]);
    } catch (error) {
      await browser.saveScreenshot("/tmp/codex-german-failure.png");
      console.log(await browser.execute(() => document.body.innerText));
      throw error;
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
  }).timeout(240_000);
});
