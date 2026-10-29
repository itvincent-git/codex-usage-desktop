import { $, browser, expect } from "@wdio/globals";

describe("third-party attribution", () => {
  it("moves the reset data source into Settings and supports Chinese navigation", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      for (const language of ["en", "zh"]) {
        await browser.execute((value) => localStorage.setItem("language", value), language);
        await browser.refresh();
        const forecast = $('[data-testid="global-reset-forecast"]');
        await forecast.waitForDisplayed({ timeout: 90_000 });
        await expect(forecast).not.toHaveText(expect.stringContaining("codex-reset.com"));
        await expect($('a=codex-reset.com')).not.toExist();

        await $(`button[aria-label="${language === "zh" ? "设置" : "Settings"}"]`).click();
        const tab = $(`button[role="tab"]=${language === "zh" ? "第三方" : "Third Party"}`);
        await expect(tab).toHaveAttribute("aria-selected", "false");
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        const section = $('#settings-section-third_party');
        await expect(section.$('a=codex-reset.com')).toBeDisplayed();
        await expect(section.$('a=codex-reset.com')).toHaveAttribute("href", "https://codex-reset.com/");
        await expect(section).toHaveText(expect.stringContaining(language === "zh"
          ? "重置历史、预告及动态数据由 codex-reset.com 提供"
          : "Reset history, announcements and feed data are provided by codex-reset.com."));
        expect(await section.$('a=codex-reset.com').execute((link) => {
          const paragraph = link.closest("p");
          return paragraph !== null && getComputedStyle(link).color === getComputedStyle(paragraph).color
            && getComputedStyle(link).fontWeight === getComputedStyle(paragraph).fontWeight;
        })).toBe(true);
        await browser.setWindowSize(1100, 760);
        expect(await section.execute((element) => element.scrollWidth > element.clientWidth)).toBe(false);
        await section.saveScreenshot(`/tmp/codex-third-party-${language}.png`);
      }
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
      await browser.refresh();
    }
  });
});
