import { $, browser, expect } from "@wdio/globals";

describe("settings back button", () => {
  it("stays in place while settings scroll and returns to the previous page", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    const previousSize = await browser.getWindowSize();
    try {
      await browser.execute(() => localStorage.setItem("language", "zh"));
      await browser.refresh();
      await browser.setWindowSize(1100, 760);
      await $('[data-testid="dashboard-nav-tab"]').click();
      await $('button[aria-label="设置"]').click();
      await $('[role="tabpanel"][aria-label="设置"]').waitForDisplayed({ timeout: 90_000 });
      const back = $("button=返回");
      await expect(back).toBeDisplayed();
      const initial = await back.getLocation();
      const headingTop = await $("#settings-section-general h3").getLocation("y");

      await browser.execute(() => {
        const scroller = document.querySelector("main")!.parentElement!.parentElement!;
        scroller.scrollTop = scroller.scrollHeight;
      });
      await browser.waitUntil(async () =>
        await browser.execute(() => document.querySelector("main")!.parentElement!.parentElement!.scrollTop) > 0,
      );
      expect(await $("#settings-section-general h3").getLocation("y")).toBeLessThan(headingTop);
      expect(await back.getLocation()).toEqual(initial);
      await expect(back).toBeDisplayed();
      const canClickBack = await back.execute((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
      expect(canClickBack).toBe(true);
      await browser.saveScreenshot("/tmp/codex-settings-back-button-scrolled.png");

      await browser.execute(() => {
        document.querySelector("main")!.parentElement!.parentElement!.scrollTop = 0;
      });
      await browser.waitUntil(async () => await $("#settings-section-general h3").getLocation("y") === headingTop);
      expect(await back.getLocation()).toEqual(initial);
      await $("#settings-tab-maintenance").click();
      await browser.waitUntil(async () =>
        await browser.execute(() => document.querySelector("main")!.parentElement!.parentElement!.scrollTop) > 0,
      );
      expect(await back.getLocation()).toEqual(initial);
      await back.click();
      await expect($('[data-testid="dashboard-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
      await browser.setWindowSize(previousSize.width, previousSize.height);
      await browser.refresh();
    }
  });
});
