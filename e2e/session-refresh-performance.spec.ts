import { $, browser, expect } from "@wdio/globals";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionDetailRow, SessionRescanResponse } from "../src/lib/api";

// Opt in with CODEX_USAGE_PERF_FIXTURE pointing to an isolated app-data/ and codex/ snapshot.
describe("session refresh with a real log snapshot", () => {
  const run = process.env.CODEX_USAGE_PERF_FIXTURE ? it : it.skip;

  run("measures the visible loading state with the full session cache loaded", async () => {
    await browser.execute(() => {
      localStorage.setItem("language", "en");
      localStorage.setItem("auto_refresh_interval_minutes", "60");
    });
    await browser.refresh();
    await $('[data-testid="sessions-nav-tab"]').waitForDisplayed({ timeout: 120_000 });
    await $('button=Rescan local logs').waitForEnabled({ timeout: 120_000 });
    await $('[data-testid="sessions-nav-tab"]').click();
    const card = $('[data-testid="session-card"]');
    await card.waitForDisplayed({ timeout: 120_000 });
    await card.click();
    const detail = $('[aria-labelledby="session-detail-title"]');
    const refresh = detail.$('button=Refresh this session');
    await refresh.waitForEnabled({ timeout: 120_000 });
    await detail.$('[aria-label="Session summary"]').waitForDisplayed();
    const title = await detail.$("#session-detail-title").getText();
    const summary = await detail.$('[aria-label="Session summary"]').getText();
    await browser.saveScreenshot("/tmp/codex-session-refresh-before.png");

    for (let attempt = 0; attempt < 3; attempt++) {
      await refresh.execute((button) => {
        performance.clearMarks();
        performance.clearMeasures();
        button.addEventListener("click", () => {
          performance.mark("refresh-click");
          const observer = new MutationObserver(() => {
            if (button.getAttribute("aria-busy") === "true") performance.mark("refresh-busy");
            else if (performance.getEntriesByName("refresh-busy").length) {
              performance.measure("refresh-visible-loading", "refresh-click");
              observer.disconnect();
            }
          });
          observer.observe(button, { attributes: true, attributeFilter: ["aria-busy"] });
        }, { once: true });
      });
      await refresh.click();
      await browser.waitUntil(async () => browser.execute(() => performance.getEntriesByName("refresh-visible-loading").length > 0), { timeout: 120_000 });
      await expect(refresh).toHaveAttribute("aria-busy", "false");
      await expect(detail.$("#session-detail-title")).toHaveText(title);
      await expect(detail.$('[aria-label="Session summary"]')).toHaveText(summary);
      const duration = await browser.execute(() => performance.getEntriesByName("refresh-visible-loading")[0].duration);
      console.log(`[real session refresh ${attempt + 1}] visible loading=${Math.round(duration)}ms`);
    }
    await browser.saveScreenshot("/tmp/codex-session-refresh-after.png");

    const timings = await browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      const started = performance.now();
      const sessions = await runtime.invoke<SessionDetailRow[]>("fetch_session_details");
      const listMs = performance.now() - started;
      const title = document.querySelector("#session-detail-title")?.textContent?.trim();
      const selected = sessions.find((session) => title === (session.threadName || session.sessionId.replace(/\.jsonl(?:\.zst)?$/, "")));
      if (!selected) throw new Error("Could not identify the open session");
      const scanStarted = performance.now();
      const result = await runtime.invoke<SessionRescanResponse>("rescan_session", { path: selected.path });
      const scanMs = performance.now() - scanStarted;
      const overviewStarted = performance.now();
      await runtime.invoke("fetch_overview", { range: "30d" });
      return { path: selected.path, sessions: sessions.length, bytes: result.session.sizeBytes, turns: result.detail.turns.length, scanMs: Math.round(scanMs), nativeMetrics: result.scan.metrics, listMs: Math.round(listMs), overviewMs: Math.round(performance.now() - overviewStarted) };
    });
    const { path, ...measurements } = timings;
    console.log(`[real session commands] ${JSON.stringify(measurements)}`);
    // Prove the optimization still renders newly appended turns, using only the snapshot.
    expect(path.startsWith(join(process.env.CODEX_USAGE_PERF_FIXTURE!, "codex") + "/")).toBe(true);
    const marker = `Session refresh regression ${Date.now()}`;
    await expect(detail).not.toHaveText(expect.stringContaining(marker));
    const timestamp = new Date().toISOString();
    appendFileSync(path, "\n" + [
      { timestamp, type: "event_msg", payload: { type: "task_started", turn_id: marker } },
      { timestamp, type: "event_msg", payload: { type: "user_message", message: marker } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await refresh.click();
    await expect(detail).toHaveText(expect.stringContaining(marker));
    await refresh.waitForEnabled({ timeout: 120_000 });
  }).timeout(300_000);
});
