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

    await forecast.waitForDisplayed({ timeout: 10_000 });
    expect(await forecast.getText()).toMatch(/24.*%.*48.*%/s);
  });
});
