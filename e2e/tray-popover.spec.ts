import { $, $$, browser, expect } from "@wdio/globals";
import type { CodexLimitsResponse } from "../src/lib/api";
import type { TrayPopoverData } from "../src/lib/tray-popover";

describe("menu bar usage popover", () => {
  it("renders live tray data with the app icon and supports dismissal and opening the main window", async function () {
    if (process.platform !== "darwin") this.skip();
    await browser.switchToWindow("main");
    const previous = await browser.execute(() => Object.fromEntries(
      ["language", "tray_menu_show"].map((key) => [key, localStorage.getItem(key)]),
    ));
    const reload = async () => {
      await browser.execute(() => { (window as unknown as { reloading: boolean }).reloading = true; });
      await browser.refresh();
      await browser.waitUntil(async () => {
        try { return await browser.execute(() => !(window as unknown as { reloading?: boolean }).reloading); }
        catch { return false; }
      }, { timeout: 90_000 });
      try {
        await $('button[aria-label="查询限额"]').waitForEnabled({ timeout: 90_000 });
      } catch (error) {
        console.error("Native window state:", await browser.execute(() => ({ url: location.href, text: document.body.innerText })));
        throw error;
      }
    };
    const showPopover = async () => {
      await browser.tauri.execute(({ core }) => core.invoke("tray_popover_action", { action: "toggle" }));
      await browser.switchToWindow("tray");
      await $(".tray-popover").waitForDisplayed();
    };
    const isVisible = () => browser.tauri.execute<boolean>(({ core }) => core.invoke("plugin:window|is_visible", { label: "tray" }));
    try {
      await browser.execute(() => {
        localStorage.setItem("language", "zh");
        localStorage.setItem("tray_menu_show", JSON.stringify({ limit5h: true, limitWeekly: true, tokens: true, cost: true }));
      });
      await reload();
      const limits: CodexLimitsResponse = {
        session: { usedPercent: 28, remainingPercent: 72, windowMinutes: 300, resetsAt: new Date(Date.now() + 143 * 60_000).toISOString() },
        weekly: { usedPercent: 4, remainingPercent: 96, windowMinutes: 10080, resetsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
        account: "itvincent@gmail.com", membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "tray-popover-test",
      };
      await browser.execute((limits) => {
        const state = window as unknown as { limitsMockUsed: boolean };
        state.limitsMockUsed = false;
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc(path: string, protocol: string): string } }).__TAURI_INTERNALS__;
        const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
        const fetch = window.fetch.bind(window);
        window.fetch = async (input, options) => {
          if (String(input) === url) {
            state.limitsMockUsed = true;
            return new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } });
          }
          return fetch(input, options);
        };
      }, limits);
      // The startup query may still be running when the dashboard first appears.
      await browser.waitUntil(async () => {
        await $('button[aria-label="查询限额"]').click();
        await $('button[aria-label="查询限额"]').waitForEnabled();
        return browser.execute(() => (window as unknown as { limitsMockUsed: boolean }).limitsMockUsed);
      }, { timeout: 30_000 });
      await browser.waitUntil(async () => {
        const data = await browser.tauri.execute<TrayPopoverData>(({ core }) => core.invoke("get_tray_popover"));
        return data?.account === limits.account && data.quotas[0]?.remainingPercent === 72;
      });
      await showPopover();
      await expect($(".tray-identity")).toHaveText(expect.stringContaining("itvincent@gmail.com"));
      await expect($(".tray-membership")).toHaveText(/plus/i);
      await expect($('[data-quota="5h"] strong')).toHaveText("72%");
      await expect($('[data-quota="weekly"] strong')).toHaveText("96%");
      await expect($('[data-quota="5h"] [role="progressbar"]')).toHaveAttribute("aria-valuenow", "72");
      await expect($('[data-quota="5h"] .tray-quota-detail')).toHaveText(expect.stringContaining("已用 28%"));
      await expect($$(".tray-metric")).toBeElementsArrayOfSize(2);
      expect(await browser.execute(() => {
        const image = document.querySelector<HTMLImageElement>(".tray-app-icon")!;
        return image.complete && image.naturalWidth === 512;
      })).toBe(true);
      expect(await browser.execute(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await browser.saveScreenshot("/tmp/codex-tray-popover.png");

      // Updates use the Rust snapshot/event path while the panel stays open.
      const data = await browser.tauri.execute<TrayPopoverData>(({ core }) => core.invoke("get_tray_popover"));
      const update = { ...data, quotas: [{ ...data.quotas[0], remainingPercent: 0, usedText: "已用 100%" }], cost: null };
      await browser.tauri.execute(({ core }, popover) => core.invoke("update_tray", { payload: { title: "Codex Usage", items: [], popover } }), update);
      await expect($('[data-quota="5h"] strong')).toHaveText("0%");
      await expect($$(".tray-quota")).toBeElementsArrayOfSize(1);
      await expect($$(".tray-metric")).toBeElementsArrayOfSize(1);
      await browser.keys("Escape");
      await browser.waitUntil(async () => !(await isVisible()));

      await browser.switchToWindow("main");
      await showPopover();
      await expect($('[data-quota="5h"] strong')).toHaveText("0%");
      await $('button=显示主窗口').click();
      await browser.waitUntil(async () => !(await isVisible()));
      await browser.switchToWindow("main");
      await expect($('button[aria-label="查询限额"]')).toBeDisplayed();

      await showPopover();
      await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
      await browser.waitUntil(async () => !(await isVisible()));
    } finally {
      await browser.switchToWindow("main");
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previous);
      await browser.refresh();
    }
  }).timeout(240_000);
});
