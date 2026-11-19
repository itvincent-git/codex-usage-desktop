import { $, browser, expect } from "@wdio/globals";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountList, LoginTask } from "../src/lib/codex-accounts";
import { accountCredentials } from "./fixtures/codex-accounts";

function invoke<T>(command: string, args: Record<string, unknown> = {}) {
  return browser.execute((name, values) => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <R>(command: string, args: Record<string, unknown>) => Promise<R> } }).__TAURI_INTERNALS__;
    return runtime.invoke<T>(name, values);
  }, command, args);
}

async function control(values: Record<string, unknown> = {}) {
  const result = await fetch(`${process.env.CODEX_USAGE_ACCOUNTS_TEST_URL}/control`, { method: "POST", body: JSON.stringify(values) });
  return await result.json() as Record<string, number>;
}

type HeldStatus = Window & { releaseQuotaStatus?: () => void };

async function holdNextStatus() {
  await browser.execute(() => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
    const statusUrl = runtime.convertFileSrc("fetch_codex_account_status", "ipc");
    const realFetch = window.fetch;
    // Let the native call finish, then hold its reply while newer credentials and quotas arrive.
    window.fetch = async (input, options) => {
      if (String(input) !== statusUrl) return realFetch(input, options);
      window.fetch = realFetch;
      const response = await realFetch(input, options);
      return new Promise((resolve) => { (window as HeldStatus).releaseQuotaStatus = () => {
        resolve(response);
        delete (window as HeldStatus).releaseQuotaStatus;
      }; });
    };
  });
}

const waitForHeldStatus = () => browser.waitUntil(() => browser.execute(() => !!(window as HeldStatus).releaseQuotaStatus));
const releaseStatus = () => browser.execute(() => (window as HeldStatus).releaseQuotaStatus?.());

async function login(accountId: string | null) {
  const task = await invoke<LoginTask>("start_codex_account_login", { deviceAuth: false, accountId });
  await browser.waitUntil(async () => {
    const result = await invoke<LoginTask>("get_codex_account_login", { taskId: task.id });
    if (result.state === "completed") return true;
    if (result.state !== "running") throw new Error(`Fixture login ${result.state} (${result.error})`);
    return false;
  });
}

describe("sidebar quota accounts", () => {
  const run = process.env.CODEX_USAGE_ACCOUNTS_TEST_URL ? it : it.skip;

  run("pages through account quotas without switching Codex sign-in", async () => {
    await browser.execute(() => {
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "160");
      localStorage.setItem("sidebar_collapsed", "false");
    });
    await browser.refresh();
    const sidebar = $(".sidebar-limits");
    const identity = sidebar.$("[aria-live=polite]");
    const previous = sidebar.$('button[aria-label="Previous quota account"]');
    const next = sidebar.$('button[aria-label="Next quota account"]');
    const refresh = sidebar.$('button[aria-label="Check limits"]');
    const activate = sidebar.$('button[aria-label="Start limit window"]');
    const fiveHour = sidebar.$('[data-testid="limit-row-5-hour"]');
    const weekly = sidebar.$('[data-testid="limit-row-weekly"]');
    const monthly = sidebar.$('[data-testid="limit-row-monthly"]');
    const assertAccount = async (user: string) => {
      await expect(identity.$(`span[title="${user}@example.test"]`)).toBeDisplayed();
    };
    const assertSwitchRow = async (user: string, current = false) => {
      const name = `${user}@example.test`;
      const row = await browser.execute((element, name) => {
        const header = element.parentElement!;
        const controls = header.querySelectorAll(`span[title="${name}"], button`);
        const centers = Array.from(controls, (control) => {
          const rect = control.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        return { text: header.textContent, controls: centers.length, offset: Math.max(...centers) - Math.min(...centers) };
      }, await identity, name);
      expect(row.controls).toBe(3);
      expect(row.offset).toBeLessThan(1);
      expect(row.text).toBe(current ? `${name}Current` : name);
    };
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const configPath = join(process.env.CODEX_HOME!, "config.toml");
    const auth = readFileSync(authPath, "utf8");
    const config = readFileSync(configPath, "utf8");

    try {
      await next.waitForDisplayed({ timeout: 90_000 });
      await assertAccount("alice");
      await assertSwitchRow("alice", true);
      await expect(identity).toHaveText(expect.stringContaining("Current"));
      await expect(fiveHour).toHaveText(expect.stringContaining("80%"));
      await expect(activate).toBeDisplayed();
      await expect($(".accounts-page")).not.toExist();

      await previous.click();
      await assertAccount("archive");
      await expect(fiveHour).toHaveText(expect.stringContaining("62%"));
      await next.click();
      await assertAccount("alice");
      await next.click();
      await assertAccount("bob");
      await expect(fiveHour).toHaveText(expect.stringContaining("25%"));
      await expect(weekly).toHaveText(expect.stringContaining("60%"));
      await expect(activate).not.toExist();

      await $('button[aria-label="Collapse sidebar"]').click();
      await next.execute((button) => button.focus());
      await browser.keys("ArrowRight");
      await assertAccount("free");
      await assertSwitchRow("free");
      await expect(monthly).toHaveText(expect.stringContaining("85%"));
      expect(await sidebar.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await previous.click();
      await assertAccount("bob");
      await $('button[aria-label="Expand sidebar"]').click();

      const before = await control();
      await holdNextStatus();
      await refresh.click();
      await waitForHeldStatus();
      await expect(refresh).toBeDisabled();
      const after = await control();
      const bobUsage = "bob:/backend-api/wham/usage";
      expect(after[bobUsage]).toBe(before[bobUsage] + 1);
      for (const user of ["alice", "free", "archive"]) {
        const usage = `${user}:/backend-api/wham/usage`;
        expect(after[usage]).toBe(before[usage]);
      }

      await control({ bobUsedPercent: 45 });
      writeFileSync(process.env.CODEX_USAGE_ACCOUNTS_LOGIN_AUTH!, JSON.stringify(accountCredentials("bob")));
      await login("bob");
      await expect(fiveHour).toHaveText(expect.stringContaining("55%"));
      await expect(refresh).toBeEnabled();

      await $('[data-testid="accounts-nav-tab"]').click();
      const refreshAll = $(".accounts-page").$("button=Refresh all");
      await expect(refreshAll).toBeDisabled();
      await releaseStatus();
      await expect(refreshAll).toBeEnabled();
      await expect(fiveHour).toHaveText(expect.stringContaining("55%"));
      await $('[data-testid="dashboard-nav-tab"]').click();
      // A newer failed check still uses Bob's last successful limit after the old reply.
      await control({ limitRateLimited: true });
      await refresh.click();
      await expect(sidebar).toHaveText(expect.stringContaining("Update failed"));
      await expect(sidebar).toHaveText(expect.stringContaining("Last success:"));
      await expect(fiveHour).toHaveText(expect.stringContaining("55%"));

      writeFileSync(process.env.CODEX_USAGE_ACCOUNTS_LOGIN_AUTH!, JSON.stringify(accountCredentials("charlie")));
      await login(null);
      await assertAccount("bob");
      expect((await control())["charlie:/backend-api/wham/usage"]).toBeUndefined();
      await next.click();
      await assertAccount("free");
      await next.click();
      await assertAccount("archive");
      await holdNextStatus();
      await next.click();
      await assertAccount("charlie");
      await waitForHeldStatus();
      await expect(sidebar).toHaveText(expect.stringContaining("Loading"));
      await releaseStatus();
      await expect(fiveHour).toHaveText(expect.stringContaining("25%"));

      const charlie = (await invoke<AccountList>("list_codex_accounts")).accounts.find((account) => account.email === "charlie@example.test")!;
      await invoke("remove_codex_account", { accountId: charlie.id });
      await assertAccount("alice");
      for (const id of ["alice", "bob", "free", "archive"]) await invoke("remove_codex_account", { accountId: id });
      await expect(previous).not.toExist();
      await expect(next).not.toExist();
      await expect(identity).toHaveText(expect.stringContaining("alice@example.test"));
      await expect(identity.$('[title="Current"]')).toBeDisplayed();
      await expect(fiveHour).toHaveText(expect.stringContaining("80%"));
      expect(readFileSync(authPath, "utf8")).toBe(auth);
      expect(readFileSync(configPath, "utf8")).toBe(config);
    } finally {
      await releaseStatus();
    }
  }).timeout(120_000);
});
