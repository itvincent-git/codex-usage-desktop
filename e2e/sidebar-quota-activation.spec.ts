import { $, browser, expect } from "@wdio/globals";
import { readFileSync } from "node:fs";

async function quotaRequests(values = {}) {
  const response = await fetch(`${process.env.CODEX_USAGE_ACCOUNTS_TEST_URL}/control`, { method: "POST", body: JSON.stringify(values) });
  return await response.json() as Record<string, number>;
}

describe("sidebar quota activation", () => {
  const run = process.env.CODEX_USAGE_ACCOUNTS_TEST_URL ? it : it.skip;

  run("launches Luna after one quota check and displays the updated window", async () => {
    await browser.execute(() => {
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_collapsed", "false");
    });
    await browser.refresh();
    const sidebar = $(".sidebar-limits");
    const refresh = sidebar.$('button[aria-label="Check limits"]');
    const activate = sidebar.$('button[aria-label="Start limit window"]');
    const fiveHour = sidebar.$('[data-testid="limit-row-5-hour"]');
    await refresh.waitForEnabled({ timeout: 90_000 });
    await quotaRequests({ aliceUsedPercent: 0 });
    await refresh.click();
    await expect(fiveHour).toHaveText(expect.stringContaining("100%"));
    await activate.waitForEnabled();
    await browser.execute(() => { window.confirm = () => true; });

    const before = await quotaRequests();
    await activate.click();
    await expect(sidebar.$('[role="status"]')).toHaveText("The new 5-hour window was started successfully.");
    await expect(fiveHour).toHaveText(expect.stringContaining("99%"));
    await expect(activate).toBeDisabled();

    const { args, requests } = JSON.parse(readFileSync(`${process.env.CODEX_USAGE_ACCOUNTS_PROCESS_FILE}.activation`, "utf8")) as {
      args: string[];
      requests: Record<string, number>;
    };
    const after = await quotaRequests();
    const usage = "alice:/backend-api/wham/usage";
    const subscription = "alice:/backend-api/accounts/check/v4-2023-04-27";
    const resetCredits = "alice:/backend-api/wham/rate-limit-reset-credits";
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-6-luna");
    expect(requests[usage]).toBe(before[usage] + 1);
    expect(requests[subscription]).toBe(before[subscription]);
    expect(requests[resetCredits]).toBe(before[resetCredits]);
    expect(after[usage]).toBe(before[usage] + 2);
    expect(after[subscription]).toBe(before[subscription] + 1);
    expect(after[resetCredits]).toBe(before[resetCredits] + 1);
  }).timeout(120_000);
});
