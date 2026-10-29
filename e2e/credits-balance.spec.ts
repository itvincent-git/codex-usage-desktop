import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexLimitsResponse } from "../src/lib/api";

// Use the existing isolated Codex home and application database.
describe("Dashboard paid credits", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let previousLanguage: string | null;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    writeFileSync(join(sessions, "credits.jsonl"), [
      { timestamp, type: "session_meta", payload: { cwd: "/credits-balance" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5" } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } },
    ].map((entry) => JSON.stringify(entry)).join("\n"));
    previousLanguage = await browser.execute(async () => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    // Only the remote account response is mocked; startup and usage use native commands.
    await browser.execute(() => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => String(input) === url
        ? Promise.resolve(new Response(localStorage.getItem("credits_e2e_response"), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
        : fetch(input, options);
    });
  });

  after(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    await browser.execute((language) => {
      if (language === null) localStorage.removeItem("language");
      else localStorage.setItem("language", language);
      localStorage.removeItem("credits_e2e_response");
    }, previousLanguage);
    await browser.setWindowSize(1440, 960);
  });

  run("refreshes positive, zero, unlimited and unavailable balances beside the account", async () => {
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 25, remainingPercent: 75, windowMinutes: 300, resetsAt: null },
      weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: null },
      account: "credits@example.com", membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "credits-e2e",
    };
    await browser.setWindowSize(1100, 760);
    for (const [credits, creditsIsMock, expected] of [
      [{ hasCredits: true, unlimited: false, balance: "1250.500001" }, true, "1250.500001"],
      [{ hasCredits: false, unlimited: false, balance: null }, false, "0"],
      [{ hasCredits: true, unlimited: true, balance: null }, false, "Unlimited"],
      [null, true, "Unavailable"],
    ] as const) {
      await browser.execute((response) => localStorage.setItem("credits_e2e_response", JSON.stringify(response)), { ...limits, credits, creditsIsMock });
      const refresh = $("button=Check limits");
      await refresh.waitForEnabled();
      await refresh.click();
      const balance = $('[data-testid="credits-balance"]');
      await balance.waitForDisplayed();
      await expect(balance).toHaveText(expect.stringContaining(`Credits balance: ${expected}`));
      await expect(balance).toHaveText(creditsIsMock ? expect.stringContaining("Simulated data") : expect.not.stringContaining("Simulated data"));
      await expect($("span=credits@example.com")).toBeDisplayed();
      await expect($('[data-testid="limit-row-5-hour"]')).toBeDisplayed();
      const layout = await browser.execute((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      }, await balance);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.viewport);
      expect(layout.overflow).toBe(false);
    }
    await browser.saveScreenshot("/tmp/codex-credits-balance-1100.png");
  });
});
