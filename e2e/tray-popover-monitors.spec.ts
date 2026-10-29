import { $, browser, expect } from "@wdio/globals";

type Monitor = {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
};

describe("menu bar popover across monitors", () => {
  it("reopens on the clicked display after dismissal on another display", async function () {
    if (process.platform !== "darwin") this.skip();
    const monitors = await browser.tauri.execute(({ core }) =>
      core.invoke("plugin:window|available_monitors", { label: "main" })) as Monitor[];
    if (monitors.length < 2) this.skip();
    console.log("Popover test displays:", monitors);

    const visible = async () => await browser.tauri.execute(({ core }) =>
      core.invoke("plugin:window|is_visible", { label: "tray" })) as boolean;
    try {
      // Inject the native tray event's geometry, retaining real monitor discovery,
      // window movement, DPI changes, focus and dismissal in the Tauri application.
      for (const [index, monitor] of [...monitors, monitors[0]].entries()) {
        const scale = monitor.scaleFactor;
        const left = monitor.position.x / scale;
        const top = monitor.position.y / scale;
        const width = monitor.size.width / scale;
        const height = monitor.size.height / scale;
        const icon = { x: left + width - 180, y: top };
        await browser.tauri.execute(({ core }, { icon, scale }) => core.invoke("tray_popover_action", {
          action: {
            toggleAt: {
              position: { x: Math.round(icon.x * scale), y: Math.round(icon.y * scale) },
              size: { width: 100 * scale, height: 24 * scale },
              cursor: { x: icon.x + 50, y: icon.y + 12 },
            },
          },
        }), { icon, scale });
        await browser.waitUntil(visible);
        await browser.switchToWindow("tray");
        await $(".tray-popover").waitForDisplayed();
        await browser.waitUntil(async () => {
          const geometry = await browser.tauri.execute(async ({ core }) => ({
            position: await core.invoke("plugin:window|outer_position", { label: "tray" }),
            size: await core.invoke("plugin:window|outer_size", { label: "tray" }),
            scale: await core.invoke("plugin:window|scale_factor", { label: "tray" }),
          })) as { position: { x: number; y: number }; size: { width: number; height: number }; scale: number };
          const x = geometry.position.x / geometry.scale;
          const y = geometry.position.y / geometry.scale;
          return geometry.scale === scale && x >= left && y >= top
            && x + geometry.size.width / scale <= left + width + 1
            && y + geometry.size.height / scale <= top + height + 1;
        }, { timeoutMsg: `Popover did not move onto ${monitor.name ?? index}` });
        expect(await browser.execute(() => innerWidth)).toBe(390);
        if (index % 2 === 0) await browser.keys("Escape");
        else await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
        await browser.waitUntil(async () => !(await visible()));
        await browser.switchToWindow("main");
      }
    } finally {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "showMain" }));
      await browser.switchToWindow("main");
    }
  });
});
