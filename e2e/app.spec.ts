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
});
