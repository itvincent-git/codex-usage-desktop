import { $, browser, expect } from "@wdio/globals";
import fixture from "./fixtures/reset-forecast.json";

async function controlSnapshots(action: "holdResetSnapshots" | "releaseResetSnapshots" | "restoreResetTransport") {
  await browser.execute((action) => (window as unknown as Record<string, () => void>)[action](), action);
}

describe("reset module skeletons", () => {
  it("replaces missing snapshots independently and retains loaded content during refresh", async () => {
    await $('[data-testid="global-reset-forecast"]').waitForExist({ timeout: 90_000 });
    const rescan = $('button=Rescan local logs');
    await rescan.waitForEnabled({ timeout: 90_000 });
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    await browser.execute(() => localStorage.setItem("language", "en"));
    await browser.refresh();
    await rescan.waitForEnabled({ timeout: 90_000 });
    await browser.waitUntil(async () => {
      const button = $('[data-testid="global-reset-forecast"] button');
      return await button.isExisting() && await button.isEnabled();
    });

    await browser.execute((forecast) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const commands = ["fetch_codex_limits", "fetch_latest_codex_reset", "fetch_codex_reset_history", "fetch_codex_quota_forecast"];
      const urls = commands.map((command) => runtime.convertFileSrc(command, "ipc"));
      const originalFetch = window.fetch.bind(window);
      const reset = { id: "skeleton-test", resetType: "regular", announcedAt: "2026-10-24T00:30:00Z", text: "Reset confirmed", source: { url: "https://example.com/reset" } };
      let loaded = false;
      let held = false;
      const pending: (() => void)[] = [];
      window.fetch = (input, options) => {
        const index = urls.indexOf(String(input));
        if (index < 0) return originalFetch(input, options);
        const respond = () => {
          const values = [
            { session: null, weekly: null, updatedAt: forecast.updatedAt, source: "oauth", resetCreditsAvailableCount: loaded ? 0 : null },
            loaded ? reset : null,
            loaded ? [reset] : [],
            loaded ? forecast : null,
          ];
          return new Response(JSON.stringify(values[index]), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } });
        };
        return held ? new Promise<Response>((resolve) => pending.push(() => resolve(respond()))) : Promise.resolve(respond());
      };
      Object.assign(window, {
        holdResetSnapshots: () => { held = true; },
        releaseResetSnapshots: () => { loaded = true; held = false; pending.splice(0).forEach((resolve) => resolve()); },
        restoreResetTransport: () => { window.fetch = originalFetch; },
      });
    }, fixture);

    // Empty snapshots exercise the no-data view; local scans still use native IPC.
    try {
      await rescan.click();
      await rescan.waitForEnabled({ timeout: 90_000 });
      await $('button[aria-label="Check limits"]').click();
      const latest = $('[data-testid="latest-reset-skeleton"]');
      const credits = $('[data-testid="reset-credits-skeleton"]');
      const forecast = $('[data-testid="forecast-skeleton"]');
      await expect(latest).toBeDisplayed();
      await expect(credits).toBeDisplayed();
      await expect(forecast).toBeDisplayed();
      await expect($('[data-testid="reset-credit-count"]')).not.toExist();
      for (const width of [1100, 1440]) {
        await browser.setWindowSize(width, 960);
        for (const selector of ['[data-testid="reset-area"]', '[data-testid="global-reset-forecast"]']) {
          expect(await $(selector).execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
      }
      await browser.saveScreenshot("/tmp/codex-reset-skeletons.png");

      await controlSnapshots("holdResetSnapshots");
      await $('button[aria-label="Refresh forecast"]').click();
      await expect(forecast).toBeDisplayed();
      await controlSnapshots("releaseResetSnapshots");
      await expect(forecast).not.toExist();
      await expect(latest).toBeDisplayed();
      await expect(credits).toBeDisplayed();

      await $('button[aria-label="Check limits"]').waitForEnabled();
      await $('button[aria-label="Check limits"]').click();
      await expect(credits).not.toExist();
      await expect($('[data-testid="reset-credit-count"]')).toHaveText("0 available");
      await rescan.click();
      await rescan.waitForEnabled({ timeout: 90_000 });
      await expect(latest).not.toExist();
      await expect($('button[aria-label="View token resets from the last 30 days"]')).toBeDisplayed();

      await controlSnapshots("holdResetSnapshots");
      await $('button[aria-label="Refresh forecast"]').click();
      await expect($('[data-testid="forecast-status"]')).toBeDisplayed();
      await expect(forecast).not.toExist();
      await controlSnapshots("releaseResetSnapshots");
      await $('button[aria-label="Refresh forecast"]').waitForEnabled();
    } finally {
      await controlSnapshots("releaseResetSnapshots");
      await controlSnapshots("restoreResetTransport");
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
