import { $, browser, expect } from "@wdio/globals";
import type { CodexLimitsResponse } from "../src/lib/api";

describe("sidebar quota color reminders", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("anchors quota depletion at the top center and changes only the outline color", async () => {
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
      const expectColor = async (id: string, remaining: number, tone: string, compact = false) => {
        const row = $(`[data-testid="limit-row-${id}"]`);
        await expect(row).toHaveText(expect.stringContaining(`${Math.round(remaining)}%`));
        await expect(row.$('[data-quota-outline]')).toHaveAttribute("stroke-dasharray", `${remaining} ${100 - remaining}`);
        const colors = await row.execute((element, tone, compact) => {
          const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--${tone}`).trim().split(/\s+/).join(", ");
          const expected = `rgb(${rgb})`;
          const primary = `rgb(${getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().split(/\s+/).join(", ")})`;
          return {
            outline: getComputedStyle(element.querySelector('[data-quota-outline]')!).stroke === expected,
            value: getComputedStyle(element.querySelector('.text-xl')!).color === primary,
            label: getComputedStyle(element.querySelector('[data-quota-label]')!).color === primary,
            countdown: compact ? !element.querySelector('[data-quota-countdown]') : getComputedStyle(element.querySelector('[data-quota-countdown]')!).color === primary,
          };
        }, tone, compact);
        expect(colors).toEqual({ outline: true, value: true, label: true, countdown: true });
        await browser.waitUntil(async () => row.$('[data-quota-outline]').execute((element) => {
          const outline = element as unknown as SVGRectElement;
          const bounds = outline.getBBox();
          const length = outline.getTotalLength();
          const offset = Number.parseFloat(getComputedStyle(outline).strokeDashoffset);
          const start = ((-offset % 100) + 100) % 100;
          const point = outline.getPointAtLength(start * length / 100);
          const remaining = Number(outline.getAttribute("stroke-dasharray")!.split(" ")[0]);
          const end = outline.getPointAtLength(((start + remaining) % 100) * length / 100);
          return Math.abs(point.x - (bounds.x + bounds.width / 2)) < 0.2
            && Math.abs(point.y - bounds.y) < 0.2
            // At 99% and 98%, the growing gap must sit immediately left of the center.
            && (!(remaining >= 98 && remaining < 100) || (end.x < point.x && Math.abs(end.y - bounds.y) < 0.2));
        }), { timeoutMsg: "Quota outline must start at the top center and deplete to the left" });
      };
      const expectCompact = async (rows: [string, string, number, string][]) => {
        await expect($('button[aria-label="展开侧栏"]')).toBeDisplayed();
        await expect($('button[aria-label="查询限额"]')).not.toExist();
        await expect($('button[aria-label="额度概览"]')).not.toExist();
        for (const [id, label, remaining, tone] of rows) {
          await expectColor(id, remaining, tone, true);
          const row = $(`[data-testid="limit-row-${id}"]`);
          await expect(row).toHaveText(`${label}${remaining}%`);
          const fits = await row.execute((element) => {
            const sidebar = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth && Array.from(element.querySelectorAll('span')).every((span) => {
              const bounds = span.getBoundingClientRect();
              return bounds.left >= sidebar.left && bounds.right <= sidebar.right;
            });
          });
          expect(fits).toBe(true);
        }
      };

      for (const [session, weekly, sessionTone, weeklyTone] of [
        [100, 0, "success", "error"],
        [99, 98, "success", "success"],
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
      await expectCompact([["5-hour", "5小时限制", 75, "success"], ["weekly", "周限制", 50, "warning"]]);
      await browser.saveScreenshot("/tmp/codex-sidebar-quota-collapsed.png");
      await $('button[aria-label="展开侧栏"]').click();
      await installLimits(20, 70);
      await $('button[aria-label="收起侧栏"]').click();
      await expectCompact([["5-hour", "5小时限制", 20, "error"], ["weekly", "周限制", 70, "success"]]);
      await $('button[aria-label="展开侧栏"]').click();
      for (const width of [160, 240, 360]) {
        const resize = $('[role="separator"][aria-orientation="vertical"]');
        await resize.click();
        const current = Number(await resize.getAttribute("aria-valuenow"));
        for (let step = current; step !== width; step += step < width ? 8 : -8) {
          await browser.keys(step < width ? "ArrowRight" : "ArrowLeft");
        }
        await expect(resize).toHaveAttribute("aria-valuenow", String(width));
        await installLimits(99, 98);
        await expectColor("5-hour", 99, "success");
        await expectColor("weekly", 98, "success");
        await browser.saveScreenshot(`/tmp/codex-quota-origin-${width}.png`);
      }
      for (const [remaining, tone] of [[70, "success"], [30, "warning"], [0, "error"]] as const) {
        await installLimits(100, remaining, "free");
        await expectColor("monthly", remaining, tone);
        await expect($('[data-testid="limit-row-5-hour"]')).not.toExist();
        await expect($('[data-testid="limit-row-weekly"]')).not.toExist();
        await $('button[aria-label="收起侧栏"]').click();
        await expectCompact([["monthly", "月限制", remaining, tone]]);
        await browser.saveScreenshot(`/tmp/codex-sidebar-quota-monthly-${remaining}-collapsed.png`);
        await $('button[aria-label="展开侧栏"]').click();
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
