import { $, browser, expect } from "@wdio/globals";
import type { CodexLimitsResponse } from "../src/lib/api";

describe("sidebar quota refresh recovery", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("retains successful quotas through pending, failed, and recovered updates", async () => {
    const previous = await browser.execute(() => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "zh");
      localStorage.setItem("sidebar_width", "160");
      localStorage.setItem("sidebar_collapsed", "false");
      return previous;
    });
    // Only substitute the remote quota response; run the real Tauri app and local commands.
    const reply = async (payload: CodexLimitsResponse | string, held = false) => {
      await browser.execute(({ payload, held }) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
        const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, options) => {
          if (String(input) !== url) return originalFetch(input, options);
          const respond = () => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json", "Tauri-Response": typeof payload === "string" ? "error" : "ok" } });
          return held ? new Promise<Response>((resolve) => {
            Object.assign(window, { releaseQuotaReply: () => resolve(respond()) });
          }) : Promise.resolve(respond());
        };
      }, { payload, held });
    };
    const refresh = $('button[aria-label="查询限额"]');
    const sidebar = $('section[aria-label="额度概览"]');
    const session = $('[data-testid="limit-row-5-hour"]');
    const weekly = $('[data-testid="limit-row-weekly"]');
    const warning = sidebar.$('[role="status"]');
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 25, remainingPercent: 75, windowMinutes: 300, resetsAt: new Date(Date.now() + 4 * 3_600_000).toISOString() },
      weekly: { usedPercent: 50, remainingPercent: 50, windowMinutes: 10080, resetsAt: new Date(Date.now() + 6 * 86_400_000).toISOString() },
      membershipLevel: "plus", updatedAt: new Date().toISOString(), source: "quota-refresh-mock",
    };
    try {
      await browser.refresh();
      await refresh.waitForEnabled({ timeout: 90_000 });
      await reply("request timeout");
      await refresh.click();
      await refresh.waitForEnabled();
      await expect(sidebar).toHaveText(expect.stringContaining("额度查询超时"));
      await expect(session).not.toExist();

      await reply(limits);
      await refresh.click();
      await refresh.waitForEnabled();
      await expect(session).toHaveText(expect.stringContaining("75%"));
      await expect(weekly).toHaveText(expect.stringContaining("50%"));

      await reply("request timeout", true);
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(sidebar).toHaveText(expect.stringContaining("加载"));
      await expect(session).toHaveText(expect.stringContaining("75%"));
      await browser.waitUntil(() => browser.execute(() => typeof (window as unknown as Record<string, unknown>).releaseQuotaReply === "function"));
      await browser.execute(() => (window as unknown as { releaseQuotaReply: () => void }).releaseQuotaReply());
      await refresh.waitForEnabled();
      await expect(sidebar).toHaveText(expect.stringContaining("更新失败"));
      await expect(warning).toHaveText(expect.stringContaining("上次成功："));
      await expect(session).toHaveText(expect.stringContaining("75%"));
      await expect(weekly).toHaveText(expect.stringContaining("50%"));
      expect(await sidebar.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await browser.saveScreenshot("/tmp/codex-quota-refresh-failed.png");

      await $('button[aria-label="收起侧栏"]').click();
      await expect(warning).toHaveText(expect.stringContaining("更新失败"));
      await expect(warning).toHaveText(expect.stringContaining("上次成功："));
      await expect(session).toHaveText(expect.stringContaining("75%"));
      expect(await sidebar.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await browser.saveScreenshot("/tmp/codex-quota-refresh-failed-compact.png");
      await $('button[aria-label="展开侧栏"]').click();

      await reply({ ...limits, updatedAt: new Date().toISOString(), session: { ...limits.session!, usedPercent: 40, remainingPercent: 60 } });
      await refresh.click();
      await refresh.waitForEnabled();
      await expect(session).toHaveText(expect.stringContaining("60%"));
      await expect(warning).not.toExist();
      await expect(sidebar).not.toHaveText(expect.stringContaining("更新失败"));

      await reply({ ...limits, session: { ...limits.session!, resetsAt: new Date(Date.now() - 60_000).toISOString() } });
      await refresh.click();
      await refresh.waitForEnabled();
      await expect(session).toHaveText(expect.stringContaining("已过期，待更新"));
      await expect(session).toHaveText(expect.stringContaining("75%"));
      await expect(session.$('[data-quota-countdown]')).not.toExist();
      await expect(weekly).not.toHaveText(expect.stringContaining("已过期"));

      await reply("401 Unauthorized");
      await refresh.click();
      await refresh.waitForEnabled();
      await expect(warning).toHaveText(expect.stringContaining("codex auth login"));
      await expect(session).toHaveText(expect.stringContaining("75%"));
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
