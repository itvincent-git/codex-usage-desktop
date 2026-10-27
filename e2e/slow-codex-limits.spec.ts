import { $, browser, expect } from "@wdio/globals";

describe("slow native Codex limits fallback", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1"
    && process.env.CODEX_CLI_PATH?.endsWith("mock-slow-codex-cli.cjs") ? it : it.skip;

  run("displays limits when the CLI takes more than three seconds to respond", async () => {
    const previous = await browser.execute(() => {
      const keys = ["language", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_collapsed", "false");
      return previous;
    });
    try {
      await browser.refresh();
      const refresh = $('button[aria-label="Check limits"]');
      await refresh.waitForEnabled({ timeout: 90_000 });
      const quota = $('[data-testid="limit-row-monthly"]');
      // Wait for the startup query before exercising a separate manual refresh.
      await expect(quota).toHaveText(expect.stringContaining("60%"));
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await refresh.waitForEnabled({ timeout: 15_000 });
      await expect(quota).toHaveText(expect.stringContaining("60%"));
      await expect($('.sidebar-limits')).not.toHaveText(expect.stringContaining("Unable to get Codex limits"));

      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(quota).toHaveText(expect.stringContaining("60%"));
      await refresh.waitForEnabled({ timeout: 15_000 });
      await expect(quota).toHaveText(expect.stringContaining("60%"));
    } finally {
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previous);
    }
  }).timeout(120_000);
});
