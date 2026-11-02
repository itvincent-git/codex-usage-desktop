import { $, browser, expect } from "@wdio/globals";
import { writeFileSync } from "node:fs";
import type { CodexLimitsResponse } from "../src/lib/api";
import { renderTrayIcon, type TrayIconBitmap } from "../src/lib/tray-icon";

describe("menu bar quota widget", () => {
  const run = process.platform === "darwin" && process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("updates monochrome quota and metric templates with saved preferences", async () => {
    const previous = await browser.execute(() => {
      const keys = ["language", "tray_title_show", "tray_title_formats", "tray_countdown_units"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      for (const key of keys.slice(1)) localStorage.removeItem(key);
      localStorage.setItem("tray_title_formats", JSON.stringify({
        limit5h: "legacy {remaining}",
        limitWeekly: "🗓️ {remaining}/{reset}",
        limitMonthly: "M: {remaining}/{reset}",
        separator: " ┃ ",
      }));
      return previous;
    });
    const now = Date.now();
    const reset = new Date(now + 123 * 60_000).toISOString();
    const weeklyReset = new Date(now + (26 * 60 + 30) * 60_000).toISOString();
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 100, remainingPercent: 0, windowMinutes: 300, resetsAt: reset },
      weekly: { usedPercent: 89, remainingPercent: 11, windowMinutes: 10080, resetsAt: weeklyReset },
      membershipLevel: "pro", updatedAt: new Date().toISOString(), source: "tray-widget-test",
    };
    const install = async (value: CodexLimitsResponse) => {
      await browser.execute(({ limits, now }) => {
        const mockState = window as unknown as { limitsMockUsed: boolean };
        mockState.limitsMockUsed = false;
        Date.now = () => now;
        const runtime = (window as unknown as { __TAURI_INTERNALS__: {
          convertFileSrc: (path: string, protocol: string) => string;
        } }).__TAURI_INTERNALS__;
        const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
        const trayUrl = runtime.convertFileSrc("update_tray", "ipc");
        const fetch = window.fetch.bind(window);
        const state = window as unknown as { trayResult?: { title: string; icon: TrayIconBitmap | null }; trayError?: string };
        window.fetch = async (input, options) => {
          if (String(input) === url) {
            mockState.limitsMockUsed = true;
            return new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } });
          }
          const response = await fetch(input, options);
          if (String(input) === trayUrl) {
            if (response.headers.get("Tauri-Response") === "ok") {
              state.trayResult = JSON.parse(String(options!.body)).payload;
            } else state.trayError = await response.clone().text();
          }
          return response;
        };
      }, { limits: value, now });
      await browser.waitUntil(async () => {
        await $('button[aria-label="Check limits"]').click();
        await $('button[aria-label="Check limits"]').waitForEnabled();
        return browser.execute(() => (window as unknown as { limitsMockUsed: boolean }).limitsMockUsed);
      }, { timeout: 30_000 });
    };
    const result = () => browser.execute(() => {
      const state = window as unknown as { trayResult?: { title: string; icon: TrayIconBitmap | null }; trayError?: string };
      if (state.trayError) throw new Error(state.trayError);
      return state.trayResult;
    });
    const expectCenteredNumber = (icon: TrayIconBitmap) => {
      const pixels: { x: number; y: number }[] = [];
      for (let y = 0; y < icon.height; y++) {
        for (let x = 0; x < 54; x++) {
          if (Math.hypot(x + 0.5 - 27, y + 0.5 - 27) > 20) continue;
          const offset = (y * icon.width + x) * 4;
          if (icon.rgba[offset + 3] > 128) pixels.push({ x, y });
        }
      }
      expect(pixels.length).toBeGreaterThan(0);
      const centerX = (Math.min(...pixels.map(({ x }) => x)) + Math.max(...pixels.map(({ x }) => x)) + 1) / 2;
      const centerY = (Math.min(...pixels.map(({ y }) => y)) + Math.max(...pixels.map(({ y }) => y)) + 1) / 2;
      expect(Math.abs(centerX - 27)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(centerY - 27)).toBeLessThanOrEqual(1.5);
    };
    const expectTemplate = async (icon: TrayIconBitmap) => {
      // Inspect the native image after each update, including preference reloads.
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "assertTemplate" }));
      expect(icon.rgba.some((value, index) => index % 4 === 3 && value === 255)).toBe(true);
      expect(icon.rgba.every((value, index) => index % 4 === 3 || value === 0)).toBe(true);
    };
    const opaqueRingPixels = (icon: TrayIconBitmap) => {
      let count = 0;
      for (let y = 0; y < icon.height; y++) {
        for (let x = 0; x < 54; x++) {
          const radius = Math.hypot(x + 0.5 - 27, y + 0.5 - 27);
          if (radius > 18 && radius < 26 && icon.rgba[(y * icon.width + x) * 4 + 3] === 255) count++;
        }
      }
      return count;
    };
    const reload = async () => {
      await browser.execute(() => { (window as unknown as { trayReloading: boolean }).trayReloading = true; });
      await browser.refresh();
      await browser.waitUntil(async () => {
        try {
          return await browser.execute(() => !(window as unknown as { trayReloading?: boolean }).trayReloading);
        } catch {
          return false;
        }
      }, { timeout: 90_000 });
      await $('button=Rescan local logs').waitForEnabled({ timeout: 90_000 });
      await $('button[aria-label="Check limits"]').waitForEnabled({ timeout: 90_000 });
    };
    try {
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title === "⏱️ 0%/2h3m 🗓️ 11%/1d2h");
      const both = (await result())!.icon!;
      expect(both.height).toBe(54);
      expect(both.rgba).toHaveLength(both.width * both.height * 4);
      expectCenteredNumber(both);
      await expectTemplate(both);
      // An exhausted quota keeps its faint track but has no opaque progress arc.
      expect(opaqueRingPixels(both)).toBe(0);

      const availableLimits = {
        ...limits,
        session: { ...limits.session!, usedPercent: 0, remainingPercent: 100 },
        weekly: { ...limits.weekly!, usedPercent: 11, remainingPercent: 89 },
      };
      await install(availableLimits);
      await browser.waitUntil(async () => (await result())?.title === "⏱️ 100%/2h3m 🗓️ 89%/1d2h");
      const full = (await result())!.icon!;
      expectCenteredNumber(full);
      await expectTemplate(full);
      expect(opaqueRingPixels(full)).toBeGreaterThan(500);
      const png = await browser.execute((icon) => {
        const canvas = document.createElement("canvas");
        canvas.width = icon.width;
        canvas.height = icon.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      }, full);
      writeFileSync("/tmp/codex-tray-widget.png", Buffer.from(png, "base64"));

      await install({ ...availableLimits, session: { ...availableLimits.session, usedPercent: 11, remainingPercent: 89 } });
      await browser.waitUntil(async () => (await result())?.title === "⏱️ 89%/2h3m 🗓️ 89%/1d2h");
      const equal = (await result())!.icon!;
      expectCenteredNumber(equal);
      await expectTemplate(equal);
      expect(opaqueRingPixels(equal)).toBeGreaterThan(500);

      for (const remainingPercent of [7, 97, 99]) {
        await install({ ...availableLimits, session: { ...availableLimits.session, usedPercent: 100 - remainingPercent, remainingPercent } });
        await browser.waitUntil(async () => (await result())?.title === `⏱️ ${remainingPercent}%/2h3m 🗓️ 89%/1d2h`);
        expectCenteredNumber((await result())!.icon!);
      }

      await install({ ...availableLimits, session: null });
      await browser.waitUntil(async () => (await result())?.title === "🗓️ 89%/1d2h");
      const single = (await result())!.icon!;
      expect(single.width).toBeLessThan(both.width);
      await expectTemplate(single);
      expect(opaqueRingPixels(single)).toBeGreaterThan(500);

      await install({ ...availableLimits, session: null, weekly: { ...availableLimits.weekly, usedPercent: 50, remainingPercent: 50 } });
      await browser.waitUntil(async () => (await result())?.title === "🗓️ 50%/1d2h");
      const half = (await result())!.icon!;
      await expectTemplate(half);
      expect(opaqueRingPixels(half)).toBeGreaterThan(100);
      expect(opaqueRingPixels(half)).toBeLessThan(opaqueRingPixels(single));

      await install({ ...availableLimits, membershipLevel: "free" });
      await browser.waitUntil(async () => (await result())?.title === "M: 89%/1d2h");
      const monthly = (await result())!.icon!;
      await expectTemplate(monthly);
      expect(opaqueRingPixels(monthly)).toBe(opaqueRingPixels(single));

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: false, limitWeekly: false, tokens: true, cost: false })));
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title.startsWith("T: ") === true);
      const tokensOnly = (await result())!.icon!;
      await expectTemplate(tokensOnly);
      expect(opaqueRingPixels(tokensOnly)).toBeGreaterThan(500);

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: true, limitWeekly: true, tokens: true, cost: true })));
      await reload();
      await install(availableLimits);
      await browser.waitUntil(async () => (await result())?.title.includes("T: ") === true);
      const allMetrics = (await result())!.icon!;
      await expectTemplate(allMetrics);
      expect(allMetrics.width).toBeGreaterThan(full.width);
      expect(allMetrics.width).toBeGreaterThan(tokensOnly.width);
      const gapStart = await browser.execute(() => {
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
        return Math.ceil((23 + context.measureText("2h3m").width) * 3);
      });
      for (let y = 0; y < allMetrics.height; y++) {
        for (let x = gapStart; x < gapStart + 30; x++) {
          expect(allMetrics.rgba[(y * allMetrics.width + x) * 4 + 3]).toBe(0);
        }
      }
      const metricsPng = await browser.execute((icon) => {
        const canvas = document.createElement("canvas");
        canvas.width = icon.width;
        canvas.height = icon.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      }, allMetrics);
      writeFileSync("/tmp/codex-tray-metrics.png", Buffer.from(metricsPng, "base64"));

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: false, limitWeekly: false, tokens: false, cost: true })));
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title.startsWith("$") === true);
      await expectTemplate((await result())!.icon!);
      expect(opaqueRingPixels((await result())!.icon!)).toBeGreaterThan(500);

      await browser.execute(() => {
        localStorage.removeItem("tray_title_show");
        localStorage.setItem("tray_title_formats", JSON.stringify({ limit5h: "5h {remaining}" }));
      });
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title === "⏱️ 0%/2h3m 🗓️ 11%/1d2h");
      expect((await result())!.icon).not.toBeNull();

      await $('button[aria-label="Settings"]').click();
      await $('button[role="tab"]=Menu Bar / System Tray').click();
      const settings = $('#settings-section-menuBar');
      await settings.waitForDisplayed();
      const settingsText = await settings.getText();
      expect(settingsText).not.toContain("5-hour limit template");
      expect(settingsText).not.toContain("Weekly limit template");
      expect(settingsText).not.toContain("Monthly limit template");
      expect(settingsText).not.toContain("Item separator");
      await expect(settings.$('input[aria-label="Minute"]')).toBeDisplayed();
      await expect(settings.$('input[aria-label="Hour"]')).toBeDisplayed();
      await expect(settings.$('input[aria-label="Day"]')).toBeDisplayed();
    } catch (error) {
      const last = await result();
      console.error("Last native tray update:", { title: last?.title, hasIcon: Boolean(last?.icon) });
      throw error;
    } finally {
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previous);
      await browser.refresh();
    }
  }).timeout(180_000);

  run("renders a transparent alpha mask with faint empty tracks and no outline", async () => {
    for (const remainingPercent of [null, 0, 7, 100]) {
      const icon = await browser.execute<TrayIconBitmap, Parameters<typeof renderTrayIcon>>(renderTrayIcon, [
        { kind: "5h", remainingPercent, countdown: "2h3m" },
      ], [{ kind: "tokens", value: "1.2M" }, { kind: "cost", value: "$3.45" }]);
      expect(icon.rgba.every((value, index) => index % 4 === 3 || value === 0)).toBe(true);
      // The 25% track stays visible at zero/unavailable; full quota is opaque.
      const alpha = icon.rgba[(49 * icon.width + 27) * 4 + 3];
      expect(alpha).toBe(remainingPercent === 100 ? 255 : 64);
      // The larger ring reaches the outer rows without clipping its curve.
      for (const y of [0, icon.height - 1]) {
        expect(icon.rgba[(y * icon.width + 27) * 4 + 3]).toBeGreaterThan(0);
        for (const x of [0, 53]) expect(icon.rgba[(y * icon.width + x) * 4 + 3]).toBe(0);
      }
    }

    const icon = await browser.execute<TrayIconBitmap, Parameters<typeof renderTrayIcon>>(renderTrayIcon, [
      { kind: "5h", remainingPercent: 95, countdown: "19m" },
      { kind: "weekly", remainingPercent: 92, countdown: "3d19h" },
    ], []);
    // Preview the alpha mask with representative system tints; native Template
    // behavior is verified above against NSImage, rather than this simulation.
    const png = await browser.execute((icon) => {
      const source = document.createElement("canvas");
      source.width = icon.width;
      source.height = icon.height;
      source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
      const canvas = document.createElement("canvas");
      canvas.width = icon.width + 48;
      canvas.height = 3 * (icon.height + 36);
      const context = canvas.getContext("2d")!;
      for (const [index, [background, foreground]] of [
        ["#eeeeee", "#000000"], ["#16181d", "#ffffff"], ["#96985e", "#ffffff"],
      ].entries()) {
        const tint = document.createElement("canvas");
        tint.width = source.width;
        tint.height = source.height;
        const mask = tint.getContext("2d")!;
        mask.drawImage(source, 0, 0);
        mask.globalCompositeOperation = "source-in";
        mask.fillStyle = foreground;
        mask.fillRect(0, 0, tint.width, tint.height);
        const y = index * (icon.height + 36);
        context.fillStyle = background;
        context.fillRect(0, y, canvas.width, icon.height + 36);
        context.drawImage(tint, 24, y + 18);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    }, icon);
    writeFileSync("/tmp/codex-tray-template-preview.png", Buffer.from(png, "base64"));
  });
});
