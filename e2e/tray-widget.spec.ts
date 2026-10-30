import { $, browser, expect } from "@wdio/globals";
import { writeFileSync } from "node:fs";
import type { CodexLimitsResponse } from "../src/lib/api";
import type { TrayIconBitmap } from "../src/lib/tray-icon";

describe("menu bar quota widget", () => {
  const run = process.platform === "darwin" && process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("distinguishes 5-hour and weekly/monthly remaining quota rings with saved preferences", async () => {
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
          const offset = (y * icon.width + x) * 4;
          const lightText = icon.rgba[offset] === 245 && icon.rgba[offset + 1] === 245 && icon.rgba[offset + 2] === 247;
          const darkText = icon.rgba[offset] === 37 && icon.rgba[offset + 1] === 43 && icon.rgba[offset + 2] === 55;
          if ((lightText || darkText) && icon.rgba[offset + 3] > 128) pixels.push({ x, y });
        }
      }
      expect(pixels.length).toBeGreaterThan(0);
      const centerX = (Math.min(...pixels.map(({ x }) => x)) + Math.max(...pixels.map(({ x }) => x)) + 1) / 2;
      const centerY = (Math.min(...pixels.map(({ y }) => y)) + Math.max(...pixels.map(({ y }) => y)) + 1) / 2;
      expect(Math.abs(centerX - 27)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(centerY - 27)).toBeLessThanOrEqual(1.5);
    };
    const expectOutlinedText = (icon: TrayIconBitmap) => {
      // Both text tones must be present inside the ring and in the countdown.
      // This covers a light webview over a dark menu bar, and the reverse.
      for (const [start, end] of [[0, 54], [69, 120]]) {
        for (const [red, green, blue] of [[245, 245, 247], [37, 43, 55]]) {
          let count = 0;
          for (let y = 0; y < icon.height; y++) {
            for (let x = start; x < end; x++) {
              const offset = (y * icon.width + x) * 4;
              if (icon.rgba[offset] === red && icon.rgba[offset + 1] === green
                && icon.rgba[offset + 2] === blue && icon.rgba[offset + 3] > 128) count++;
            }
          }
          expect(count).toBeGreaterThan(0);
        }
      }
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
      expectOutlinedText(both);
      const colorCount = (rgba: number[], red: number, green: number, blue: number) => rgba.filter((_, i) => i % 4 === 0
        && rgba[i] === red && rgba[i + 1] === green && rgba[i + 2] === blue && rgba[i + 3] === 255).length;
      // Fully consumed 5-hour quota has an empty ring; 11% weekly quota has a purple arc.
      const emptyRing = both.rgba.filter((_, index) => Math.floor(index / 4) % both.width < 54);
      expect(colorCount(emptyRing, 54, 184, 131)).toBe(0);
      expect(colorCount(both.rgba, 139, 92, 246)).toBeGreaterThan(30);

      const availableLimits = {
        ...limits,
        session: { ...limits.session!, usedPercent: 0, remainingPercent: 100 },
        weekly: { ...limits.weekly!, usedPercent: 11, remainingPercent: 89 },
      };
      await install(availableLimits);
      await browser.waitUntil(async () => (await result())?.title === "⏱️ 100%/2h3m 🗓️ 89%/1d2h");
      const full = (await result())!.icon!;
      expectCenteredNumber(full);
      const fullRing = full.rgba.filter((_, index) => Math.floor(index / 4) % full.width < 54);
      expect(colorCount(fullRing, 54, 184, 131)).toBeGreaterThan(500);
      expect(colorCount(fullRing, 139, 92, 246)).toBe(0);
      expect(colorCount(full.rgba, 139, 92, 246)).toBeGreaterThan(500);
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
      expect(colorCount(equal.rgba, 54, 184, 131)).toBeGreaterThan(500);
      expect(colorCount(equal.rgba, 139, 92, 246)).toBeGreaterThan(500);

      for (const remainingPercent of [7, 97, 99]) {
        await install({ ...availableLimits, session: { ...availableLimits.session, usedPercent: 100 - remainingPercent, remainingPercent } });
        await browser.waitUntil(async () => (await result())?.title === `⏱️ ${remainingPercent}%/2h3m 🗓️ 89%/1d2h`);
        expectCenteredNumber((await result())!.icon!);
      }

      await install({ ...availableLimits, session: null });
      await browser.waitUntil(async () => (await result())?.title === "🗓️ 89%/1d2h");
      const single = (await result())!.icon!;
      expect(single.width).toBeLessThan(both.width);
      expect(colorCount(single.rgba, 54, 184, 131)).toBe(0);
      expect(colorCount(single.rgba, 139, 92, 246)).toBeGreaterThan(500);

      await install({ ...availableLimits, session: null, weekly: { ...availableLimits.weekly, usedPercent: 50, remainingPercent: 50 } });
      await browser.waitUntil(async () => (await result())?.title === "🗓️ 50%/1d2h");
      expect(colorCount((await result())!.icon!.rgba, 139, 92, 246)).toBeGreaterThan(100);
      expect(colorCount((await result())!.icon!.rgba, 54, 184, 131)).toBe(0);

      await install({ ...availableLimits, membershipLevel: "free" });
      await browser.waitUntil(async () => (await result())?.title === "M: 89%/1d2h");
      const monthly = (await result())!.icon!;
      expect(colorCount(monthly.rgba, 139, 92, 246)).toBeGreaterThan(500);
      expect(colorCount(monthly.rgba, 54, 184, 131)).toBe(0);

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: false, limitWeekly: false, tokens: true, cost: false })));
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title.startsWith("T: ") === true);
      const tokensOnly = (await result())!.icon!;
      expect(colorCount(tokensOnly.rgba, 59, 130, 246)).toBeGreaterThan(500);
      expect(colorCount(tokensOnly.rgba, 212, 160, 23)).toBe(0);

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: true, limitWeekly: true, tokens: true, cost: true })));
      await reload();
      await install(availableLimits);
      await browser.waitUntil(async () => (await result())?.title.includes("T: ") === true);
      const allMetrics = (await result())!.icon!;
      expectOutlinedText(allMetrics);
      expect(colorCount(allMetrics.rgba, 59, 130, 246)).toBeGreaterThan(500);
      expect(colorCount(allMetrics.rgba, 212, 160, 23)).toBeGreaterThan(500);
      expect(colorCount(allMetrics.rgba, 54, 184, 131)).toBeGreaterThan(500);
      expect(colorCount(allMetrics.rgba, 139, 92, 246)).toBeGreaterThan(500);
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
      const contrastPng = await browser.execute((icon) => {
        const source = document.createElement("canvas");
        source.width = icon.width;
        source.height = icon.height;
        source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
        const canvas = document.createElement("canvas");
        canvas.width = icon.width + 24;
        canvas.height = icon.height * 2 + 36;
        const context = canvas.getContext("2d")!;
        for (const [index, color] of ["#101114", "#eeeeee"].entries()) {
          const y = index * (icon.height + 12);
          context.fillStyle = color;
          context.fillRect(0, y, canvas.width, icon.height + 24);
          context.drawImage(source, 12, y + 12);
        }
        return canvas.toDataURL("image/png").split(",")[1];
      }, allMetrics);
      writeFileSync("/tmp/codex-tray-contrast.png", Buffer.from(contrastPng, "base64"));

      await browser.execute(() => localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: false, limitWeekly: false, tokens: false, cost: true })));
      await reload();
      await install(limits);
      await browser.waitUntil(async () => (await result())?.title.startsWith("$") === true);
      expect(colorCount((await result())!.icon!.rgba, 212, 160, 23)).toBeGreaterThan(500);
      expect(colorCount((await result())!.icon!.rgba, 59, 130, 246)).toBe(0);

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
});
