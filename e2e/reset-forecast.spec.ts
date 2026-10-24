import { $, browser, expect } from "@wdio/globals";
import type { CodexQuotaForecastResponse } from "../src/lib/api";
import fixture from "./fixtures/reset-forecast.json";

async function setRemoteForecast(data: CodexQuotaForecastResponse | null) {
  // Only remote responses are fixed; local usage still comes through native IPC.
  // Intercept the transport because Tauri's invoke property is read-only.
  await browser.execute((data) => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
    const forecastUrl = runtime.convertFileSrc("fetch_codex_quota_forecast", "ipc");
    const limitsUrl = runtime.convertFileSrc("fetch_codex_limits", "ipc");
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (url !== forecastUrl && url !== limitsUrl) return fetch(input, options);
      const error = url === limitsUrl || data === null;
      return Promise.resolve(new Response(JSON.stringify(error ? "Forecast fixture unavailable / unauthorized" : data), {
        headers: { "Content-Type": "application/json", "Tauri-Response": error ? "error" : "ok" },
      }));
    };
  }, data);
}

async function refreshForecast() {
  const refresh = $('button[aria-label="Refresh forecast"]');
  await refresh.waitForEnabled();
  await refresh.click();
  await refresh.waitForEnabled();
}

describe("global reset forecast", () => {
  let previousLanguage: string | null;
  before(async () => {
    previousLanguage = await browser.execute(() => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      return previous;
    });
    await browser.refresh();
    await $('[data-testid="global-reset-forecast"]').waitForExist({ timeout: 90_000 });
    // Wait for the bounded startup request before installing fixed responses.
    await browser.waitUntil(async () => {
      const buttons = await $('[data-testid="global-reset-forecast"]').$$('button');
      return await buttons.length > 0 && await buttons[0].isEnabled();
    });
    // Join the startup scan and its account request before replacing remote
    // responses, so a late native completion cannot overwrite the fixture.
    const rescan = $('button=Rescan local logs');
    await rescan.waitForEnabled({ timeout: 90_000 });
    await rescan.click();
    await rescan.waitForEnabled({ timeout: 90_000 });
    await browser.execute(() => { Date.now = () => Date.parse("2026-10-24T01:00:00Z"); });
    await setRemoteForecast(fixture);
    const card = $('[data-testid="global-reset-forecast"]');
    const refresh = card.$('button');
    await refresh.click();
    await $('[data-testid="forecast-status"]').waitForDisplayed();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Official announcement");
  });

  after(async () => {
    await browser.execute((language) => {
      if (language === null) localStorage.removeItem("language");
      else localStorage.setItem("language", language);
    }, previousLanguage);
    await browser.setWindowSize(1440, 960);
    await browser.refresh();
  });

  it("shows both probabilities and independent data when the account request fails", async () => {
    await $('button=Check limits').waitForEnabled();
    await $('button=Check limits').click();
    await expect($('[data-testid="global-reset-forecast"]')).toHaveText(expect.stringContaining("39%"));
    await expect($('[data-testid="global-reset-forecast"]')).toHaveText(expect.stringContaining("63%"));
    await expect($('[data-forecast-horizon="24h"] [role="progressbar"]')).toHaveAttribute("aria-valuenow", "39");
    const loginNotice = $('span=Not Logged In / 尚未登录');
    await loginNotice.waitForExist();
    await loginNotice.scrollIntoView({ block: "center" });
    await expect(loginNotice).toBeDisplayed();
    await $('[data-testid="global-reset-forecast"]').scrollIntoView({ block: "center" });
    await expect($('[data-testid="quota-forecast"]')).not.toExist();
    await expect($('a=codex-reset.com')).toHaveAttribute("href", "https://codex-reset.com/");
    await expect($('button=Show details')).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the announcement, separates its score, and keeps the method and source links", async () => {
    await $('button=Show details').scrollIntoView({ block: "center" });
    await $('button=Show details').click();
    await expect($('#forecast-details')).toHaveText(expect.stringContaining(fixture.latestAlert.summary));
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("Signal score: 93 (not a 24h / 48h probability)"));
    await expect($('a=View original post')).toHaveAttribute("href", fixture.latestAlert.url);
    await expect($('a=Forecast method and accuracy')).toHaveAttribute("href", "https://codex-reset.com/forecast-method");
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("Window ends in 2:00:00"));
    await $('button=Hide details').click();
    await expect($('#forecast-details')).not.toExist();
  });

  it("renders pending, ended, expired and confirmed states without changing probabilities", async () => {
    await setRemoteForecast({ ...fixture, latestAlert: { ...fixture.latestAlert, pending: "done", window: null, score: null } });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Awaiting confirmation");
    await $('button=Show details').click();
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("awaiting monitoring confirmation"));

    await setRemoteForecast({ ...fixture, latestAlert: { ...fixture.latestAlert, window: { endAt: "2026-10-24T00:00:00Z" } } });
    await refreshForecast();
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("Announcement window ended; awaiting confirmation."));
    await expect($('#forecast-details')).not.toHaveText(expect.stringContaining("Confirmed reset time:"));

    await setRemoteForecast({ ...fixture, latestAlert: { ...fixture.latestAlert, state: "expired" } });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Historical model");
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("Expired announcement"));

    await setRemoteForecast({ ...fixture, latestAlert: { kind: "reset", state: "confirmed", observedAt: fixture.lastResetAt } });
    await refreshForecast();
    await expect($('#forecast-details')).toHaveText(expect.stringContaining("Confirmed reset time:"));
    await expect($('[data-forecast-horizon="24h"]')).toHaveText(expect.stringContaining("39%"));
    await $('button=Hide details').click();
  });

  it("retains the last data after a failed refresh", async () => {
    await setRemoteForecast(null);
    await refreshForecast();
    await expect($('[data-testid="global-reset-forecast"] [role="alert"]')).toHaveText("Update failed. Showing the last available forecast.");
    await expect($('[data-forecast-horizon="48h"]')).toHaveText(expect.stringContaining("63%"));
    await setRemoteForecast(fixture);
    await refreshForecast();
    await expect($('[data-testid="global-reset-forecast"] [role="alert"]')).not.toExist();
  });

  it("fits below the quota card at minimum and common desktop widths", async () => {
    for (const width of [1100, 1440]) {
      await browser.setWindowSize(width, 960);
      const card = $('[data-testid="global-reset-forecast"]');
      await card.scrollIntoView({ block: "center" });
      const layout = await card.execute((element) => {
        const bounds = element.getBoundingClientRect();
        const quota = element.previousElementSibling!.getBoundingClientRect();
        return { below: bounds.top >= quota.bottom, fits: element.scrollWidth <= element.clientWidth, inWindow: bounds.right <= window.innerWidth, columns: element.querySelector('[role="progressbar"]')!.parentElement!.parentElement!.children.length };
      });
      expect(layout).toEqual({ below: true, fits: true, inWindow: true, columns: 2 });
      await browser.saveScreenshot(`/tmp/codex-reset-forecast-${width}.png`);
      await $('button=Show details').click();
      expect(await $('#forecast-details').execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await $("#forecast-details").scrollIntoView({ block: "end" });
      await browser.saveScreenshot(`/tmp/codex-reset-forecast-${width}-details.png`);
      await $('button=Hide details').click();
    }
  });
});
