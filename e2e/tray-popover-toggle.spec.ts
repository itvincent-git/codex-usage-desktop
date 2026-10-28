import { $, browser, expect } from "@wdio/globals";

describe("menu bar popover dismissal", () => {
  it("closes with either mouse button without opening the main window after focus is lost", async function () {
    if (process.platform !== "darwin") this.skip();
    const monitor = await browser.tauri.execute(({ core }) =>
      core.invoke("plugin:window|primary_monitor", { label: "main" })) as {
        position: { x: number; y: number };
        size: { width: number; height: number };
        scaleFactor: number;
      };
    const scale = monitor.scaleFactor;
    const position = {
      x: monitor.position.x + monitor.size.width - 180 * scale,
      y: monitor.position.y,
    };
    const size = { width: 100 * scale, height: 24 * scale };
    const cursor = { x: position.x / scale + 50, y: position.y / scale + 12 };
    const geometry = { position, size, cursor };
    const visible = async () => await browser.tauri.execute(({ core }) =>
      core.invoke("plugin:window|is_visible", { label: "tray" })) as boolean;
    const actionAt = async (action: "toggleAt" | "focusLostAt", point = cursor) =>
      browser.tauri.execute(({ core }, { action, geometry }) => core.invoke("tray_popover_action", {
        action: { [action]: geometry },
      }), { action, geometry: { ...geometry, cursor: point } });

    try {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      await browser.waitUntil(async () => !(await visible()));
      for (const button of ["right", "left"]) {
        await browser.tauri.execute(({ core }) => core.invoke("plugin:window|hide", { label: "main" }));
        await actionAt("toggleAt");
        await browser.waitUntil(visible);
        await browser.switchToWindow("tray");
        await $(".tray-popover").waitForDisplayed();

        // Inject the native focus-loss/click sequence with the cursor on the
        // status item. Both actions use the production Rust dismissal path.
        await actionAt("focusLostAt");
        expect(await visible()).toBe(true);
        if (button === "right") await actionAt("toggleAt");
        else await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "leftClick" }));
        await browser.waitUntil(async () => !(await visible()), {
          timeoutMsg: "The second tray click reopened the popover",
        });
        expect(await browser.tauri.execute(({ core }) =>
          core.invoke("plugin:window|is_visible", { label: "main" }))).toBe(false);
        await browser.switchToWindow("main");
      }

      await actionAt("toggleAt");
      await browser.waitUntil(visible);
      await browser.switchToWindow("tray");
      await actionAt("focusLostAt", { x: cursor.x, y: cursor.y + 100 });
      await browser.waitUntil(async () => !(await visible()));
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "leftClick" }));
      expect(await browser.tauri.execute(({ core }) =>
        core.invoke("plugin:window|is_visible", { label: "main" }))).toBe(true);
    } finally {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      await browser.switchToWindow("main");
    }
  });

  it("clears the native status button highlight on outside click, Escape and show main", async function () {
    if (process.platform !== "darwin") this.skip();
    const visible = async () => await browser.tauri.execute(({ core }) =>
      core.invoke("plugin:window|is_visible", { label: "tray" })) as boolean;
    const assertHighlighted = async (expected: boolean) => browser.waitUntil(async () => {
      try {
        await browser.tauri.execute(({ core }, expected) =>
          core.invoke("tray_popover_action", { action: { assertHighlighted: { expected } } }), expected);
        return true;
      } catch { return false; }
    }, { timeoutMsg: `Expected native status button highlight to be ${expected}` });
    try {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      for (const dismissal of ["outside", "escape", "showMain"]) {
        await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "toggle" }));
        await browser.waitUntil(visible);
        await browser.switchToWindow("tray");
        await $(".tray-popover").waitForDisplayed();
        await assertHighlighted(true);

        if (dismissal === "outside") {
          await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
        } else if (dismissal === "escape") {
          await browser.keys("Escape");
        } else {
          await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
        }
        await browser.waitUntil(async () => !(await visible()));
        await assertHighlighted(false);
        await browser.switchToWindow("main");
      }
    } finally {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      await browser.switchToWindow("main");
    }
  });
});
