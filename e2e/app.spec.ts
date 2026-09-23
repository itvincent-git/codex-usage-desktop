import { $, browser, expect } from "@wdio/globals";

describe("Codex Usage Desktop page", () => {
  it("loads inside the Tauri WebView", async () => {
    await expect(browser).toHaveTitle("Codex Usage Desktop");
    await expect($("#root")).toBeDisplayed();

    const hasTauriRuntime = await browser.execute(
      () => "__TAURI_INTERNALS__" in window,
    );
    expect(hasTauriRuntime).toBe(true);
  });

  it("shows both 24-hour and 48-hour reset probabilities", async () => {
    const forecast = $('[data-testid="quota-forecast"]');
    const forecast24h = $('[data-forecast-horizon="24h"]');
    const forecast48h = $('[data-forecast-horizon="48h"]');

    await forecast.waitForDisplayed({ timeout: 10_000 });
    await expect(forecast24h).toBeDisplayed();
    await expect(forecast48h).toBeDisplayed();
    expect(await forecast24h.getText()).toMatch(/^\d+\s*24h$/);
    expect(await forecast48h.getText()).toMatch(/^\d+\s*48h$/);
  });

  it("opens the pricing catalog and refreshes without leaving the app unusable", async () => {
    await $('[data-testid="models-nav-tab"]').click();
    await $('[data-testid="models-catalog-tab"]').click();

    const catalog = $('[data-testid="pricing-catalog"]');
    const refresh = $('[data-testid="refresh-pricing"]');
    await refresh.waitForEnabled({ timeout: 10_000 });
    await refresh.click();
    await refresh.waitForEnabled({ timeout: 15_000 });

    const search = $('[data-testid="pricing-search"]');
    await search.setValue("gpt-6-");
    const catalogText = await catalog.getText();
    expect(catalogText).toContain("gpt-6-sol");
    expect(catalogText).toContain("gpt-6-luna");
  }).timeout(240_000);
});
