import { $, browser, expect } from "@wdio/globals";

describe("menu bar popover dismissal", () => {
  it("closes on a second tray click even when focus is lost before mouse-up", async function () {
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
      for (let attempt = 0; attempt < 2; attempt++) {
        await actionAt("toggleAt");
        await browser.waitUntil(visible);
        await browser.switchToWindow("tray");
        await $(".tray-popover").waitForDisplayed();

        // Inject the native focus-loss/click sequence with the cursor on the
        // status item. Both actions use the production Rust dismissal path.
        await actionAt("focusLostAt");
        expect(await visible()).toBe(true);
        await actionAt("toggleAt");
        await browser.waitUntil(async () => !(await visible()), {
          timeoutMsg: "The second tray click reopened the popover",
        });
        await browser.switchToWindow("main");
      }

      await actionAt("toggleAt");
      await browser.waitUntil(visible);
      await browser.switchToWindow("tray");
      await actionAt("focusLostAt", { x: cursor.x, y: cursor.y + 100 });
      await browser.waitUntil(async () => !(await visible()));
    } finally {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      await browser.switchToWindow("main");
    }
  });
});
