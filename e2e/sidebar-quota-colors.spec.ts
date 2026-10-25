import { $, browser, expect } from "@wdio/globals";
import type { CodexLimitsResponse } from "../src/lib/api";

describe("sidebar quota color reminders", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("changes only the quota outline color in the sidebar and popover", async () => {
    const previous = await browser.execute(() => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "zh");
      localStorage.setItem("sidebar_width", "240");
      localStorage.setItem("sidebar_collapsed", "false");
      return previous;
    });
    try {
      await browser.refresh();
      await $('button[aria-label="查询限额"]').waitForEnabled({ timeout: 90_000 });
      const installLimits = async (sessionRemaining: number, weeklyRemaining: number, membershipLevel = "plus") => {
        const limits: CodexLimitsResponse = {
          session: { usedPercent: 100 - sessionRemaining, remainingPercent: sessionRemaining, windowMinutes: 300, resetsAt: new Date(Date.now() + 4 * 3_600_000).toISOString() },
          weekly: { usedPercent: 100 - weeklyRemaining, remainingPercent: weeklyRemaining, windowMinutes: 10080, resetsAt: new Date(Date.now() + 6 * 86_400_000).toISOString() },
          membershipLevel, updatedAt: new Date().toISOString(), source: "quota-colors-mock",
        };
        // Mock only the remote account response; the real Tauri app handles everything else.
        await browser.execute((limits) => {
          const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
          const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
          const fetch = window.fetch.bind(window);
          window.fetch = (input, options) => String(input) === url
            ? Promise.resolve(new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
            : fetch(input, options);
        }, limits);
        await $('button[aria-label="查询限额"]').click();
        await $('button[aria-label="查询限额"]').waitForEnabled();
      };
      const expectColor = async (id: string, remaining: number, tone: string) => {
        const row = $(`[data-testid="limit-row-${id}"]`);
        await expect(row).toHaveText(expect.stringContaining(`${Math.round(remaining)}%`));
        await expect(row.$('[data-quota-outline]')).toHaveAttribute("stroke-dasharray", `${remaining} 100`);
        const colors = await row.execute((element, tone) => {
          const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--${tone}`).trim().split(/\s+/).join(", ");
          const expected = `rgb(${rgb})`;
          const primary = `rgb(${getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().split(/\s+/).join(", ")})`;
          return {
            outline: getComputedStyle(element.querySelector('[data-quota-outline]')!).stroke === expected,
            value: getComputedStyle(element.querySelector('.text-xl')!).color === primary,
            label: getComputedStyle(element.querySelector('span.absolute')!).color === primary,
            countdown: getComputedStyle(element.querySelector('[data-quota-countdown]')!).color === primary,
          };
        }, tone);
        expect(colors).toEqual({ outline: true, value: true, label: true, countdown: true });
      };

      for (const [session, weekly, sessionTone, weeklyTone] of [
        [100, 0, "success", "error"],
        [70, 30, "success", "warning"],
        [69.9, 29.9, "warning", "error"],
        [0, 100, "error", "success"],
        [75, 50, "success", "warning"],
      ] as const) {
        await installLimits(session, weekly);
        await expectColor("5-hour", session, sessionTone);
        await expectColor("weekly", weekly, weeklyTone);
      }
      await browser.saveScreenshot("/tmp/codex-sidebar-quota-colors.png");
      await $('button[aria-label="收起侧栏"]').click();
      await $('button[aria-label="额度概览"]').click();
      await expectColor("5-hour", 75, "success");
      await expectColor("weekly", 50, "warning");
      await installLimits(20, 70);
      await expectColor("5-hour", 20, "error");
      await expectColor("weekly", 70, "success");
      await browser.saveScreenshot("/tmp/codex-sidebar-quota-colors-popover.png");
      await browser.keys("Escape");
      await $('button[aria-label="展开侧栏"]').click();
      for (const [remaining, tone] of [[70, "success"], [30, "warning"], [0, "error"]] as const) {
        await installLimits(100, remaining, "free");
        await expectColor("monthly", remaining, tone);
        await expect($('[data-testid="limit-row-5-hour"]')).not.toExist();
        await expect($('[data-testid="limit-row-weekly"]')).not.toExist();
      }
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
