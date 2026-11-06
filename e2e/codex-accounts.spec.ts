import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountCredentials } from "./fixtures/codex-accounts";
import type { AccountList, AccountStatus, LoginTask } from "../src/lib/codex-accounts";

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const serialized = await browser.execute(async (name, values) => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <R>(command: string, args: Record<string, unknown>) => Promise<R> } }).__TAURI_INTERNALS__;
    return JSON.stringify(await runtime.invoke<T>(name, values));
  }, command, args);
  return JSON.parse(serialized) as T;
}
const control = async (values: Record<string, unknown> = {}) => (await fetch(`${process.env.CODEX_USAGE_ACCOUNTS_TEST_URL}/control`, { method: "POST", body: JSON.stringify(values) })).json() as Promise<Record<string, number>>;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("native saved Codex accounts", () => {
  const run = process.env.CODEX_USAGE_ACCOUNTS_TEST_URL ? it : it.skip;
  run("compares isolated accounts, preserves stale values, and switches complete authentication", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    const tab = $('[data-testid="accounts-nav-tab"]');
    await tab.waitForDisplayed({ timeout: 90_000 });
    await tab.click();
    const alice = $('[data-account-id="alice"]');
    const bob = $('[data-account-id="bob"]');
    await alice.waitForDisplayed();
    await $('button=Refresh all').click();
    await expect(alice).toHaveText(expect.stringContaining("80% remaining"));
    await expect(bob).toHaveText(expect.stringContaining("25% remaining"));
    await expect(alice).toHaveText(expect.stringContaining("plus"));
    await expect(bob).toHaveText(expect.stringContaining("pro"));
    await expect(alice).toHaveText(expect.stringContaining("Current Codex sign-in"));
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const configPath = join(process.env.CODEX_HOME!, "config.toml");
    const original = readFileSync(authPath, "utf8");
    const config = readFileSync(configPath, "utf8");
    await bob.$("button=Refresh").click();
    await bob.$("button=Refresh").waitForEnabled();
    expect(readFileSync(authPath, "utf8")).toBe(original);
    await control({ failSubscription: true, limitRateLimited: true });
    const status = await invoke<AccountStatus>("fetch_codex_account_status", { accountId: "bob" });
    expect(status.data?.session?.remainingPercent).toBe(25);
    expect(status.data?.subscriptionActive).toBe(true);
    expect(status.errors.subscription).toBe("accountHttpError:503");
    expect(status.errors.limits).toBe("accountRateLimited");
    const before = await control();
    await invoke("fetch_codex_account_status", { accountId: "bob" });
    const after = await control();
    expect(after["bob:/backend-api/wham/usage"]).toBe(before["bob:/backend-api/wham/usage"]);
    await control({ failSubscription: false, limitRateLimited: false });
    await bob.$("button=Refresh").click();
    await expect(bob).toHaveText(expect.stringContaining("Stale data"));
    await expect(alice).toHaveText(expect.stringContaining("80% remaining"));

    await bob.$("button=Switch Codex sign-in").click();
    await expect(alice).not.toHaveText(expect.stringContaining("Current Codex sign-in"));
    await expect(bob).toHaveText(expect.stringContaining("Current Codex sign-in"));
    await expect($('section[aria-label="Accounts"]')).toHaveText(expect.stringContaining("Restart related Codex CLI"));
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(accountCredentials("bob"));
    expect(readFileSync(configPath, "utf8")).toBe(config);
    await alice.$("button=Switch Codex sign-in").click();
    await expect(alice).toHaveText(expect.stringContaining("Current Codex sign-in"));
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(accountCredentials("alice"));
    expect(readFileSync(configPath, "utf8")).toBe(config);
    const list = await invoke<AccountList>("list_codex_accounts");
    expect(JSON.stringify(list)).not.toContain("fixture-refresh");
    expect(JSON.stringify(list)).not.toContain("access_token");
    const sidebar = $('.sidebar-limits');
    await expect(sidebar).toHaveText(expect.stringContaining("80%"));
    await browser.saveScreenshot("/tmp/codex-accounts-e2e.png");
  }).timeout(120_000);

  run("delegates login to an empty home and rejects a mismatched re-login", async () => {
    const original = readFileSync(join(process.env.CODEX_HOME!, "auth.json"), "utf8");
    await $('button=Add account').click();
    await expect($('section[aria-label="Accounts"]')).toHaveText(expect.stringContaining("Login completed"));
    const list = await invoke<AccountList>("list_codex_accounts");
    const charlie = list.accounts.find((account) => account.email === "charlie@example.test");
    expect(charlie).toBeDefined();
    expect(charlie?.current).toBe(false);
    expect(readFileSync(join(process.env.CODEX_HOME!, "auth.json"), "utf8")).toBe(original);
    const task = await invoke<LoginTask>("start_codex_account_login", { deviceAuth: false, accountId: "bob" });
    let result: LoginTask;
    await browser.waitUntil(async () => { result = await invoke<LoginTask>("get_codex_account_login", { taskId: task.id }); return result.state !== "running"; });
    expect(result!.error).toBe("accountLoginIdentityMismatch");
    expect((await invoke<AccountList>("list_codex_accounts")).accounts.find((account) => account.id === "bob")?.email).toBe("bob@example.test");
  });

  run("cancels and times out login while reaping its process tree", async () => {
    for (const action of ["cancel", "timeout"]) {
      const task = await invoke<LoginTask>("start_codex_account_login", { deviceAuth: true, accountId: null });
      let processInfo: { pid: number; child: number; home: string };
      await browser.waitUntil(async () => {
        const result = await invoke<LoginTask>("get_codex_account_login", { taskId: task.id });
        return result.deviceCode === "ABCD-1234";
      });
      processInfo = JSON.parse(readFileSync(process.env.CODEX_USAGE_ACCOUNTS_PROCESS_FILE!, "utf8"));
      if (action === "cancel") await invoke("cancel_codex_account_login", { taskId: task.id });
      await browser.waitUntil(async () => (await invoke<LoginTask>("get_codex_account_login", { taskId: task.id })).state === (action === "cancel" ? "cancelled" : "timedOut"), { timeout: 15_000 });
      await browser.waitUntil(() => !alive(processInfo.pid) && !alive(processInfo.child) && !existsSync(processInfo.home), { timeoutMsg: "Login process tree and isolated credentials should be reclaimed" });
    }
  });

  run("persists rotated tokens before returning and retries a 401 once", async () => {
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const config = readFileSync(join(process.env.CODEX_HOME!, "config.toml"), "utf8");
    const before = await control();
    for (const force401 of [false, true]) {
      const credentials = JSON.parse(readFileSync(authPath, "utf8"));
      const claims = JSON.parse(Buffer.from(credentials.tokens.access_token.split(".")[1], "base64url").toString());
      claims.exp = force401 ? 4_102_444_800 : 1;
      claims.force401 = force401;
      credentials.tokens.access_token = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
      credentials.last_refresh = new Date(Date.now() + 1_000).toISOString();
      writeFileSync(authPath, JSON.stringify(credentials));
      const status = await invoke<AccountStatus>("fetch_codex_account_status", { accountId: "alice" });
      expect(status.errors).toEqual({});
      const native = JSON.parse(readFileSync(authPath, "utf8"));
      const store = JSON.parse(readFileSync(join(process.env.CODEX_USAGE_TEST_DATA_DIR!, "codex-accounts/accounts.json"), "utf8"));
      expect(native.tokens.refresh_token).toBe("fixture-rotated-alice");
      expect(store.accounts.find((account: { id: string }) => account.id === "alice").credentials).toEqual(native);
      expect(native.unknown_native_field).toEqual([1, 2, 3]);
      expect(native.tokens.future_field).toEqual({ keep: true });
      expect(store.pending).toBeNull();
    }
    expect((await control()).refresh - (before.refresh ?? 0)).toBe(2);
    expect(readFileSync(join(process.env.CODEX_HOME!, "config.toml"), "utf8")).toBe(config);
  });
});
