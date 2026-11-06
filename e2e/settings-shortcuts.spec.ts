import { $, browser, expect } from "@wdio/globals";

describe("keyboard shortcuts in settings", () => {
  it("provides a direct navigation entry, platform keys and contextual behavior notes", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    const previousSize = await browser.getWindowSize();
    try {
      await browser.execute(() => localStorage.setItem("language", "zh"));
      await browser.refresh();
      await browser.setWindowSize(1100, 760);
      await $('button[aria-label="设置"]').waitForDisplayed({ timeout: 90_000 });
      await browser.keys([process.platform === "darwin" ? "Meta" : "Control", ","]);
      await $("h1=设置").waitForDisplayed();
      const tab = $("#settings-tab-shortcuts");
      await expect(tab).toHaveText("键盘快捷键");
      await expect(tab).toHaveAttribute("aria-selected", "false");
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const section = $("#settings-section-shortcuts");
      await expect(section.$("h3")).toHaveText("键盘快捷键");
      await browser.waitUntil(async () => section.$("h3").execute((heading) => {
        const bounds = heading.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
      }));
      const modifier = process.platform === "darwin" ? "⌘" : "Ctrl+";
      const keys = await section.$$("kbd").map((key) => key.getText());
      expect(keys).toEqual([
        ...[1, 2, 3, 4, 5, 6].map((number) => `${modifier}${number}`),
        `${modifier},`, `${modifier}R`, `${modifier}F`, "Enter", "Shift+Enter",
        process.platform === "darwin" ? "⌘⇧L" : "Ctrl+Shift+L", "Esc",
      ]);
      await expect(section).toHaveText(expect.stringContaining("在项目弹窗中仅刷新当前项目，在会话详情中仅刷新当前会话"));
      await expect(section).toHaveText(expect.stringContaining("先清空查询，再关闭搜索栏，最后关闭当前详情"));
      await expect(section).toHaveText(expect.stringContaining("嵌套弹窗每次只关闭最上层"));
      await expect(section).toHaveText(expect.stringContaining("弹窗打开时，页面切换、设置和侧栏快捷键暂停生效"));
      await browser.saveScreenshot("/tmp/codex-settings-shortcuts.png");

      await browser.setWindowSize(800, 700);
      await section.$("kbd").execute((element) => element.scrollIntoView({ block: "center" }));
      expect(await section.execute((element) => {
        const content = document.querySelector("[data-app-content]")!;
        return element.scrollWidth <= element.clientWidth && content.scrollWidth <= content.clientWidth;
      })).toBe(true);
      await browser.saveScreenshot("/tmp/codex-settings-shortcuts-narrow.png");
      await $("button=返回").click();
      await expect($('[data-testid="dashboard-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    } catch (error) {
      console.log("Shortcut section bounds", await browser.execute(() => ({
        heading: document.querySelector("#settings-section-shortcuts h3")?.getBoundingClientRect().toJSON(),
        scroller: document.querySelector("main")?.parentElement?.parentElement?.getBoundingClientRect().toJSON(),
        scrollTop: document.querySelector("main")?.parentElement?.parentElement?.scrollTop,
        height: window.innerHeight,
      })));
      await browser.saveScreenshot("/tmp/codex-settings-shortcuts-failure.png");
      throw error;
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
