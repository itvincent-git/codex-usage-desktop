import { $, browser, expect } from "@wdio/globals";
import type { CodexQuotaForecastResponse, CodexResetAnnouncement } from "../src/lib/api";
import fixture from "./fixtures/reset-forecast.json";

async function setRemoteForecast(data: CodexQuotaForecastResponse | null, resets: CodexResetAnnouncement[] = []) {
  // Only remote responses are fixed; local usage still comes through native IPC.
  // Intercept the transport because Tauri's invoke property is read-only.
  await browser.execute(({ data, resets }) => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
    const forecastUrl = runtime.convertFileSrc("fetch_codex_quota_forecast", "ipc");
    const limitsUrl = runtime.convertFileSrc("fetch_codex_limits", "ipc");
    const historyUrl = runtime.convertFileSrc("fetch_codex_reset_history", "ipc");
    const latestUrl = runtime.convertFileSrc("fetch_latest_codex_reset", "ipc");
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (![forecastUrl, limitsUrl, historyUrl, latestUrl].includes(url)) return fetch(input, options);
      const error = url === limitsUrl || (url === forecastUrl && data === null);
      const response = url === historyUrl ? resets : url === latestUrl ? resets[0] ?? null : data;
      return Promise.resolve(new Response(JSON.stringify(error ? "Forecast fixture unavailable / unauthorized" : response), {
        headers: { "Content-Type": "application/json", "Tauri-Response": error ? "error" : "ok" },
      }));
    };
  }, { data, resets });
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
    await browser.execute(() => { Date.now = () => Date.parse("2026-10-24T01:00:00Z"); });
    await setRemoteForecast(fixture);
    await rescan.click();
    await rescan.waitForEnabled({ timeout: 90_000 });
    const card = $('[data-testid="global-reset-forecast"]');
    const refresh = card.$('button');
    await refresh.click();
    await $('[data-testid="forecast-status"]').waitForDisplayed();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time window");
  });

  after(async () => {
    await browser.execute((language) => {
      if (language === null) localStorage.removeItem("language");
      else localStorage.setItem("language", language);
    }, previousLanguage);
    await browser.setWindowSize(1440, 960);
    await browser.refresh();
  });

  it("prioritizes the explicit promise and evidence independently of account access", async () => {
    await $('button=Check limits').waitForEnabled();
    await $('button=Check limits').click();
    const card = $('[data-testid="global-reset-forecast"]');
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time window");
    await expect(card).not.toHaveText(expect.stringContaining("39%"));
    await expect(card).not.toHaveText(expect.stringContaining("63%"));
    await expect(card).not.toHaveText(expect.stringContaining("93%"));
    await expect($('[data-testid="forecast-announcement"]')).toHaveText(expect.stringContaining(fixture.latestAlert.summary));
    const evidence = $('[aria-label="Evidence for this signal"]');
    await expect(evidence.$$('li')).toBeElementsArrayOfSize(2);
    await expect(evidence).toHaveText(expect.stringContaining(fixture.evidencePosts[0].text));
    await expect(evidence).toHaveText(expect.stringContaining(fixture.evidencePosts[1].text));
    await expect(evidence).toHaveText(expect.stringContaining("not a measured success rate"));
    await expect(evidence).toHaveText(expect.stringContaining("Within the next three hours · UTC"));
    await expect($('a=@thsottiaux ↗')).toHaveAttribute("href", fixture.latestAlert.url);
    await expect($('[data-testid="quota-forecast"]')).not.toExist();
    await expect($('a=codex-reset.com')).toHaveAttribute("href", "https://codex-reset.com/");
    await expect($('button=Show historical reference')).not.toExist();
  });

  it("shows the latest five feed posts, original links and feed availability", async () => {
    const feed = $('[aria-label="Latest 5 feed posts"]');
    await expect(feed.$$('li')).toBeElementsArrayOfSize(5);
    for (let i = 0; i < fixture.recentPosts.length; i++) {
      const item = (await feed.$$('li'))[i];
      await expect(item).toHaveText(expect.stringContaining(fixture.recentPosts[i].text));
      await expect(item.$('a')).toHaveAttribute("href", fixture.recentPosts[i].url);
      await expect(item.$('time')).toHaveAttribute("datetime", fixture.recentPosts[i].at);
    }
    await expect($('#forecast-details')).not.toExist();
    await setRemoteForecast({ ...fixture, recentPosts: null });
    await refreshForecast();
    await expect(feed).toHaveText(expect.stringContaining("The feed is unavailable."));
    await setRemoteForecast({ ...fixture, recentPosts: [] });
    await refreshForecast();
    await expect(feed).toHaveText(expect.stringContaining("No recent feed posts."));
    await setRemoteForecast({ ...fixture, evidenceStale: true });
    await refreshForecast();
    await expect(feed).toHaveText(expect.stringContaining("Showing older feed data"));
    await expect(feed.$$('li')).toBeElementsArrayOfSize(5);
    await setRemoteForecast(fixture);
    await refreshForecast();
  });

  it("distinguishes untimed promises and incomplete or stale evidence", async () => {
    await setRemoteForecast({ ...fixture, latestAlert: { ...fixture.latestAlert, score: 83, window: null } });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time unknown");
    const evidence = $('[aria-label="Evidence for this signal"]');
    await setRemoteForecast({ ...fixture, evidencePosts: [fixture.evidencePosts[0]] });
    await refreshForecast();
    await expect(evidence).toHaveText(expect.stringContaining("reply context is missing"));
    await expect(evidence.$$('li')).toBeElementsArrayOfSize(1);
    await setRemoteForecast({ ...fixture, evidencePosts: null, evidenceStale: true });
    await refreshForecast();
    await expect(evidence).toHaveText(expect.stringContaining("original posts could not be loaded"));
    await expect(evidence).toHaveText(expect.stringContaining("Evidence is out of date"));
    await expect(evidence.$$('li')).toBeElementsArrayOfSize(0);
  });

  it("rejects stale feed labels, expired windows, fulfilled promises and past reset alerts", async () => {
    const cases: CodexQuotaForecastResponse[] = [
      { ...fixture, hasOfficialSignal: false },
      { ...fixture, latestAlert: { ...fixture.latestAlert, state: "expired" } },
      { ...fixture, latestAlert: { ...fixture.latestAlert, window: { endAt: "2026-10-24T00:00:00Z" } } },
      { ...fixture, lastResetAt: "2026-10-24T00:30:00Z" },
      { ...fixture, latestAlert: { kind: "reset", state: "confirmed", summary: "Old reset confirmed" } },
    ];
    for (const data of cases) {
      await setRemoteForecast(data);
      await refreshForecast();
      await expect($('[data-testid="forecast-status"]')).toHaveText("No reliable announcement");
      await expect($('[aria-label="Evidence for this signal"]')).not.toExist();
      await expect($('[aria-label="Latest 5 feed posts"]').$$("li")).toBeElementsArrayOfSize(5);
      await expect($('[data-testid="forecast-announcement"]')).not.toHaveText(expect.stringContaining("Old reset confirmed"));
    }
  });

  it("separates taking effect from a future prediction and marks outdated snapshots", async () => {
    await setRemoteForecast({ ...fixture, hasOfficialSignal: false, latestAlert: { ...fixture.latestAlert, pending: "done", window: null, score: null } });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Taking effect");
    await expect($('[data-testid="forecast-announcement"]')).toHaveText(expect.stringContaining("awaiting monitoring confirmation"));
    await setRemoteForecast({ ...fixture, updatedAt: "2026-10-24T00:50:00Z" });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Signal needs rechecking");
    await expect($('[data-testid="forecast-announcement"]')).toHaveText(expect.stringContaining("Current validity is unknown"));
  });

  it("retains evidence after a failed refresh but revalidates before restoring a strong signal", async () => {
    await setRemoteForecast(fixture);
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time window");
    await setRemoteForecast(null);
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Signal needs rechecking");
    await expect($('[data-testid="global-reset-forecast"] [role="alert"]')).toHaveText("Update failed. The previous signal needs rechecking.");
    await expect($('[aria-label="Evidence for this signal"]')).toHaveText(expect.stringContaining(fixture.evidencePosts[0].text));
    await setRemoteForecast(fixture);
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time window");
    await expect($('[data-testid="global-reset-forecast"] [role="alert"]')).not.toExist();
  });

  it("keeps the no-signal view compact with a side-by-side feed and bottom-right attribution", async () => {
    await expect($('[data-testid="forecast-status"]')).toHaveText("Explicit announcement · time window");
    await setRemoteForecast({ ...fixture, hasOfficialSignal: false });
    await refreshForecast();
    await expect($('[data-testid="forecast-status"]')).toHaveText("No reliable announcement");
    const card = $('[data-testid="global-reset-forecast"]');
    await expect(card).not.toHaveText(expect.stringContaining("Feed activity alone"));
    await expect($('[aria-label="Evidence for this signal"]')).not.toExist();
    for (const width of [1100, 1440]) {
      await browser.setWindowSize(width, 960);
      await card.scrollIntoView({ block: "center" });
      const layout = await card.execute((element) => {
        const bounds = element.getBoundingClientRect();
        const status = element.querySelector('[data-testid="forecast-announcement"]')!.getBoundingClientRect();
        const feed = element.querySelector('section[aria-label="Latest 5 feed posts"]')!;
        const feedBounds = feed.getBoundingClientRect();
        const source = element.querySelector('a[href="https://codex-reset.com/"]')!.getBoundingClientRect();
        return {
          sideBySide: feedBounds.left > status.right && Math.abs(feedBounds.top - status.top) < 1,
          compact: bounds.height < 380,
          sourceAtBottomRight: bounds.right - source.right < 24 && source.top > feedBounds.bottom,
          fits: element.scrollWidth <= element.clientWidth && feed.scrollWidth <= feed.clientWidth,
        };
      });
      expect(layout).toEqual({ sideBySide: true, compact: true, sourceAtBottomRight: true, fits: true });
      await expect($('[aria-label="Latest 5 feed posts"]').$$('li')).toBeElementsArrayOfSize(5);
      await card.saveScreenshot(`/tmp/codex-reset-forecast-compact-${width}.png`);
    }
    await setRemoteForecast(fixture);
    await refreshForecast();
  });

  it("fits below the quota card with evidence visible at minimum and common widths", async () => {
    for (const width of [1100, 1440]) {
      await browser.setWindowSize(width, 960);
      const card = $('[data-testid="global-reset-forecast"]');
      await card.scrollIntoView({ block: "center" });
      const layout = await card.execute((element) => {
        const bounds = element.getBoundingClientRect();
        const quota = element.previousElementSibling!.getBoundingClientRect();
        return { below: bounds.top >= quota.bottom, fits: element.scrollWidth <= element.clientWidth, inWindow: bounds.right <= window.innerWidth };
      });
      expect(layout).toEqual({ below: true, fits: true, inWindow: true });
      await browser.saveScreenshot(`/tmp/codex-reset-forecast-${width}.png`);
      const feed = $('[aria-label="Latest 5 feed posts"]');
      expect(await feed.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await feed.scrollIntoView({ block: "end" });
      await browser.saveScreenshot(`/tmp/codex-reset-forecast-${width}-feed.png`);
    }
  });
});
