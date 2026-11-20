import { $, browser, expect } from "@wdio/globals";

describe("sidebar resizing", () => {
  let previousPreferences: Record<string, string | null>;

  before(async () => {
    previousPreferences = await browser.execute(() => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.removeItem("sidebar_width");
      localStorage.removeItem("sidebar_collapsed");
      return previous;
    });
  });

  after(async () => {
    await browser.execute((preferences) => {
      for (const [key, value] of Object.entries(preferences)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, previousPreferences);
    await browser.refresh();
  });

  it("persists resized width and collapse state across reloads and settings", async () => {
    await browser.refresh();
    const sidebar = $("[data-app-sidebar]");
    const handle = $('[role="separator"][aria-label="Resize sidebar"]');
    await handle.waitForDisplayed();
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    expect(await sidebar.getSize("width")).toBe(240);

    const expectWindowBackgrounds = async () => {
      const layout = await browser.execute(() => {
        const sidebar = document.querySelector("[data-app-sidebar]")!;
        const content = document.querySelector("[data-app-content]")!.parentElement!;
        const spacer = sidebar.firstElementChild!;
        const dragRegion = document.querySelector("[data-tauri-drag-region]")!;
        const dragBounds = dragRegion.getBoundingClientRect();
        const toggle = sidebar.querySelector("button")!;
        const refresh = content.querySelector("header button")!;
        const isClickable = (button: Element) => {
          const bounds = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 4));
        };
        const dragPoints = [12, window.innerWidth / 2, window.innerWidth - 16];
        return {
          sidebarTop: sidebar.getBoundingClientRect().top,
          contentTop: content.getBoundingClientRect().top,
          contentBodyTop: document.querySelector("[data-app-content]")!.getBoundingClientRect().top,
          sidebarColor: getComputedStyle(sidebar).backgroundColor,
          contentColor: getComputedStyle(content).backgroundColor,
          spacerHeight: spacer.getBoundingClientRect().height,
          dragHeight: dragBounds.height,
          dragWidth: dragBounds.width,
          windowWidth: window.innerWidth,
          topRowDraggable: dragPoints.every((x) => document.elementFromPoint(x, 28) === dragRegion),
          buttonsClickable: isClickable(toggle) && isClickable(refresh),
          toggleTop: toggle.getBoundingClientRect().top,
          isMac: navigator.platform.startsWith("Mac"),
        };
      });
      expect(layout.sidebarTop).toBe(0);
      expect(layout.contentTop).toBe(0);
      expect(layout.sidebarColor).not.toBe(layout.contentColor);
      expect(layout.spacerHeight).toBe(layout.isMac ? 12 : 0);
      expect(layout.dragHeight).toBe(layout.isMac ? 36 : 0);
      expect(layout.dragWidth).toBe(layout.windowWidth);
      expect(layout.buttonsClickable).toBe(true);
      if (layout.isMac) expect(layout.topRowDraggable).toBe(true);
      expect(layout.contentBodyTop).toBe(layout.dragHeight);
      expect(layout.toggleTop).toBeGreaterThanOrEqual(layout.spacerHeight);
      if (layout.isMac) expect(layout.toggleTop).toBeLessThan(36);
    };
    await expectWindowBackgrounds();

    const dragBy = async (delta: number) => {
      const { x, y } = await handle.getLocation();
      await browser.action("pointer")
        .move({ x: Math.round(x + 4), y: Math.round(y + 100) })
        .down()
        .move({ x: Math.round(x + 4 + delta), y: Math.round(y + 100), duration: 300 })
        .up()
        .perform();
    };
    const expectWidth = async (width: number) => {
      await expect(handle).toHaveAttribute("aria-valuenow", String(width));
      expect(await sidebar.getSize("width")).toBe(width);
      expect(await $("[data-app-content]").getLocation("x")).toBe(width);
    };

    await dragBy(80);
    await expectWidth(320);
    await dragBy(300);
    await expectWidth(360);
    await dragBy(-300);
    await expectWidth(160);
    await dragBy(96);
    await expectWidth(256);

    // Releasing the pointer ends the drag, including outside the handle.
    await browser.action("pointer").move({ x: 500, y: 100 }).perform();
    await expectWidth(256);

    await browser.refresh();
    await expectWidth(256);

    await $('button[aria-label="Collapse sidebar"]').click();
    expect(await sidebar.getSize("width")).toBe(80);
    expect(await $("[data-app-content]").getLocation("x")).toBe(80);
    await expect(handle).not.toBeExisting();
    await expectWindowBackgrounds();
    await browser.saveScreenshot("/tmp/codex-usage-sidebar-collapsed.png");
    await browser.refresh();
    await expect($('button[aria-label="Expand sidebar"]')).toHaveAttribute("aria-expanded", "false");
    expect(await sidebar.getSize("width")).toBe(80);
    await expect(handle).not.toBeExisting();
    await $('button[aria-label="Expand sidebar"]').click();
    await browser.refresh();
    await expect($('button[aria-label="Collapse sidebar"]')).toHaveAttribute("aria-expanded", "true");
    await expectWidth(256);

    await $('button[aria-label="Settings"]').click();
    await expect($("h1=Settings")).toBeDisplayed();
    await expect(sidebar).not.toBeExisting();
    expect(await $("[data-app-content]").getLocation("y")).toBe(await $("[data-tauri-drag-region]").getSize("height"));
    await $("button=Back").click();
    await expectWidth(256);

    await handle.execute((element) => element.focus());
    await browser.keys("ArrowRight");
    await expectWidth(264);
    await browser.refresh();
    await expectWidth(264);
    await handle.execute((element) => element.focus());
    await browser.keys("ArrowLeft");
    await expectWidth(256);
    await browser.saveScreenshot("/tmp/codex-usage-sidebar-resize.png");
  }).timeout(180_000);
});
