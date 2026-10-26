import { $, browser, expect } from "@wdio/globals";

describe("settings update placement", () => {
  it("shows App Updates first when opening Settings", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "zh"));
      await browser.refresh();
      await $('button[aria-label="设置"]').click();
      const panel = $('[role="tabpanel"][aria-label="设置"]');
      await panel.waitForDisplayed({ timeout: 90_000 });
      await expect(panel.$('h3')).toHaveText("应用更新");
      await expect(panel.$('button=检查更新')).toBeDisplayed();
      const headings = await panel.$$('h3').map((heading) => heading.getText());
      expect(headings.indexOf("语言设置")).toBeGreaterThan(0);
      expect(headings.indexOf("本地缓存管理")).toBeGreaterThan(0);
      await $('button[role="tab"]=维护').click();
      await expect($('#settings-section-maintenance').$('h3')).toHaveText("本地缓存管理");
      await $('button[role="tab"]=通用').click();
      await expect(panel.$('h3')).toBeDisplayed();
      await browser.saveScreenshot("/tmp/codex-settings-updates-top.png");
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
      await browser.refresh();
    }
  });
});
