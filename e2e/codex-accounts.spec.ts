import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  run("shows credits balances without currency symbols in English and Chinese", async () => {
    for (const [language, label, cachedLabel] of [
      ["en", "Credits balance", "Last credits balance"],
      ["zh", "Credits 余额", "上次 Credits 余额"],
    ]) {
      await browser.execute((locale) => { localStorage.clear(); localStorage.setItem("language", locale); }, language);
      await browser.refresh();
      await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
      await $('[data-testid="accounts-nav-tab"]').click();
      for (const [id, title, value] of [["alice", label, "20"], ["free", label, "0"], ["archive", cachedLabel, "8.50"]]) {
        const balance = $(`[data-account-id="${id}"] .account-resources > div:first-child`);
        await expect(balance.$("dt")).toHaveText(title);
        await expect(balance.$("dd")).toHaveText(value);
      }
      await expect($('[data-account-id="free"] [role="meter"][aria-label="' + (language === "en" ? "Monthly quota" : "月额度") + '"]')).toHaveAttribute("aria-valuenow", "85");
    }
    await browser.saveScreenshot("/tmp/codex-accounts-credits-balance.png");
  });

  run("combines matching data refresh timestamps and keeps subscription status and renewal in the header", async () => {
    for (const [language, active, renewal, source, expires, updated] of [
      ["en", "Active", "Auto-renews", "Source", "Expires", "Data updated"],
      ["zh", "订阅有效", "自动续订", "数据来源", "到期时间", "数据更新于"],
    ]) {
      await browser.execute((locale) => { localStorage.clear(); localStorage.setItem("language", locale); }, language);
      await browser.refresh();
      await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
      await $('[data-testid="accounts-nav-tab"]').click();
      const alice = $('[data-account-id="alice"]');
      await expect(alice.$(".account-membership")).toHaveText(expect.stringContaining(active));
      await expect(alice.$(".account-membership")).toHaveText(expect.stringContaining(renewal));
      const details = alice.$(".account-details .account-detail-body");
      await expect(details).not.toBeDisplayed();
      await alice.$(".account-details summary").click();
      await expect(details).toBeDisplayed();
      const status = (await invoke<AccountList>("list_codex_accounts")).accounts.find((account) => account.id === "alice")!.status!;
      const timestamp = (at: string) => browser.execute((value, locale) => new Date(value).toLocaleString(locale), at, language);
      await expect(details.$$("p")).toBeElementsArrayOfSize(3);
      await expect(details.$(`p=${source} · oauth`)).toBeDisplayed();
      await expect(details.$(`p=${expires} · ${await timestamp(status.data!.subscriptionExpiresAt!)}`)).toBeDisplayed();
      await expect(details.$(`p=${updated} · ${await timestamp(status.updatedAt.subscription)}`)).toBeDisplayed();
      await expect(details).not.toHaveText(expect.stringContaining(active));
      await expect(details).not.toHaveText(expect.stringContaining(renewal));
    }
    await browser.saveScreenshot("/tmp/codex-accounts-data-details.png");
  });

  run("shows and copies the nine-digit device code and explains where to enter it", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "zh"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const page = $('section[aria-label="账号"]');
    const code = page.$("p=1234-56789");
    await expect(code).not.toExist();
    await expect(page.$("button=复制授权码")).not.toExist();
    const deviceLogin = page.$("button=设备码登录");
    await expect(deviceLogin).toBeDisplayed();
    await deviceLogin.click();
    await expect(code).toBeDisplayed();
    await expect(page).toHaveText(expect.stringContaining("在打开的授权网页中输入此设备码，完成后账号将自动保存。"));
    await expect(page.$("button=打开授权页面")).toBeDisplayed();
    await page.$("button=复制授权码").click();
    await expect(page.$("button=已复制")).toBeDisplayed();
    if (process.platform === "darwin") expect(execFileSync("/usr/bin/pbpaste", { encoding: "utf8" }) === "1234-56789").toBe(true);
    await browser.saveScreenshot("/tmp/codex-accounts-device-code.png");
    await page.$("button=取消登录").click();
    await expect(page).toHaveText(expect.stringContaining("登录已取消"));
    await expect(code).not.toExist();
    await expect(page.$("button=已复制")).not.toExist();
    await expect(page.$("button=打开授权页面")).not.toExist();
  });

  run("highlights the current account card and moves the highlight when switching", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const alice = $('[data-account-id="alice"]');
    const bob = $('[data-account-id="bob"]');
    const appearance = (id: string) => browser.execute((accountId) => {
      const style = getComputedStyle(document.querySelector(`[data-account-id="${accountId}"]`)!);
      return { border: style.borderTopColor, background: style.backgroundImage, shadow: style.boxShadow };
    }, id);
    await expect(alice).toHaveAttribute("aria-current", "true");
    await expect(bob).not.toHaveAttribute("aria-current");
    const current = await appearance("alice");
    const inactive = await appearance("bob");
    expect(current.border).not.toBe(inactive.border);
    expect(current.background).not.toBe(inactive.background);
    expect(current.shadow).not.toBe("none");
    await browser.saveScreenshot("/tmp/codex-accounts-current.png");

    await bob.$("button=Switch Codex sign-in").click();
    await expect(bob).toHaveAttribute("aria-current", "true");
    await expect(alice).not.toHaveAttribute("aria-current");
    expect(await appearance("bob")).toEqual(current);
    expect(await appearance("alice")).toEqual(inactive);

    await alice.$("button=Switch Codex sign-in").click();
    await expect(alice).toHaveAttribute("aria-current", "true");
    await expect(bob).not.toHaveAttribute("aria-current");
    expect(await appearance("alice")).toEqual(current);
    expect(await appearance("bob")).toEqual(inactive);
  });

  run("shows seat levels and workspace labels and expands reset credits from the count", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const alice = $('[data-account-id="alice"]');
    const bob = $('[data-account-id="bob"]');
    await expect(alice.$(".account-workspace")).toHaveText("Personal workspace");
    await expect(bob.$(".account-workspace")).toHaveText("Workspace bob");
    await expect(bob.$(".account-plan")).toHaveText("Team · Premium seat");
    await expect($(".accounts-environment")).not.toExist();
    await expect($('section[aria-label="Accounts"]')).not.toHaveText(expect.stringContaining("Credentials are stored locally"));
    const details = alice.$(".account-reset-details");
    await expect(details.$("summary")).toHaveText("1 available");
    await expect(details.$(".account-detail-body")).not.toBeDisplayed();
    await details.$("summary").click();
    await expect(details.$(".account-detail-body")).toBeDisplayed();
    await expect(details.$(".account-detail-body")).toHaveText(expect.stringContaining("Reset credit expires"));
    await details.$("summary").click();
    await expect(details.$(".account-detail-body")).not.toBeDisplayed();
    await browser.execute(() => { localStorage.setItem("language", "zh"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed();
    await $('[data-testid="accounts-nav-tab"]').click();
    await expect(bob.$(".account-plan")).toHaveText("Team · 高级席位");
    await expect(alice.$(".account-workspace")).toHaveText("个人工作区");
    await expect(alice.$(".account-resources")).toHaveText(expect.stringContaining("额度重置"));
    await expect(alice.$(".account-reset-details summary")).toHaveText("1 次可用");
    await alice.$(".account-reset-details summary").click();
    await expect(alice.$(".account-reset-details .account-detail-body")).toBeDisplayed();
    await browser.saveScreenshot("/tmp/codex-accounts-reset-details.png");
    await browser.execute(() => { localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed();
    await $('[data-testid="accounts-nav-tab"]').click();
  });

  run("lays out account cards, cached states, details, and menus at wide and narrow widths", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const page = $('section[aria-label="Accounts"]');
    const alice = $('[data-account-id="alice"]');
    const bob = $('[data-account-id="bob"]');
    const free = $('[data-account-id="free"]');
    const archive = $('[data-account-id="archive"]');
    await browser.setWindowSize(1440, 1000);
    await expect(bob.$(".account-quota-low")).toHaveText(expect.stringContaining("Low remaining quota"));
    await expect(free.$('[role="meter"][aria-label="Monthly quota"]')).toHaveAttribute("aria-valuenow", "85");
    await expect(free.$$('[role="meter"]')).toBeElementsArrayOfSize(1);
    await expect(archive.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "62");
    await expect(archive.$(".account-membership")).toHaveText(expect.stringContaining("Subscription unconfirmed"));
    await expect(archive.$(".account-warning")).toBeDisplayed();
    await expect(archive.$("button=Sign in again")).toBeDisplayed();
    await expect(archive.$(".account-quota-stale")).toExist();
    await expect(alice.$(".account-details .account-detail-body")).not.toBeDisplayed();
    await alice.$(".account-details summary").click();
    await expect(alice.$(".account-details .account-detail-body")).toBeDisplayed();
    await expect(alice.$(".account-details .account-detail-body")).toHaveText(expect.stringContaining("Data updated"));
    await alice.$(".account-details summary").click();
    const more = bob.$('button[aria-label="More"]');
    await expect(more).toHaveText("");
    await expect(more).toHaveAttribute("title", "More");
    await expect(more.$("svg.lucide-ellipsis")).toBeDisplayed();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    // The embedded driver does not emit the pointerdown event Radix menus require.
    await more.execute((element) => element.focus());
    await browser.keys("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await browser.saveScreenshot("/tmp/codex-accounts-menu.png");
    await expect($('//*[@role="menuitem" and normalize-space(.)="Sign in again"]')).toBeDisplayed();
    await expect($('//*[@role="menuitem" and normalize-space(.)="Remove"]')).toBeDisplayed();
    await browser.keys("Escape");
    await page.$("button=More").execute((element) => element.focus());
    await browser.keys("Enter");
    await expect($('//*[@role="menuitem" and normalize-space(.)="Device code login"]')).toBeDisplayed();
    await browser.keys("Escape");
    const layout = () => browser.execute(() => {
      const grid = document.querySelector(".accounts-grid")!;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        heights: Array.from(grid.children).map((card) => card.getBoundingClientRect().height),
      };
    });
    expect((await layout()).columns).toBe(2);
    for (const height of (await layout()).heights.slice(0, 3)) {
      expect(height).toBeGreaterThanOrEqual(280);
      expect(height).toBeLessThanOrEqual(360);
    }
    await browser.execute(() => document.querySelector('[data-app-content] > .overflow-y-auto')?.scrollTo(0, 0));
    await browser.saveScreenshot("/tmp/codex-accounts-wide.png");
    // Respect the native 1100px minimum and narrow the content with the resizable sidebar.
    await browser.setWindowSize(1100, 1000);
    await browser.execute(() => { localStorage.setItem("sidebar_width", "360"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed();
    await $('[data-testid="accounts-nav-tab"]').click();
    await expect(alice).toBeDisplayed();
    await expect(page.$$("article")).toBeElementsArrayOfSize(4);
    await expect(alice.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "80");
    await browser.waitUntil(async () => (await layout()).columns === 1);
    expect((await layout()).overflow).toBe(false);
    await browser.saveScreenshot("/tmp/codex-accounts-narrow.png");
    await browser.setWindowSize(1250, 1000);
    await browser.execute(() => { localStorage.setItem("language", "zh"); localStorage.setItem("sidebar_width", "240"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed();
    await $('[data-testid="accounts-nav-tab"]').click();
    await expect($('[data-account-id="free"]')).toHaveText(expect.stringContaining("月额度"));
    await browser.saveScreenshot("/tmp/codex-accounts-zh.png");
    await browser.execute(() => { localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed();
    await $('[data-testid="accounts-nav-tab"]').click();
  });

  run("compares isolated accounts, preserves stale values, and switches complete authentication", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    const tab = $('[data-testid="accounts-nav-tab"]');
    await tab.waitForDisplayed({ timeout: 90_000 });
    await tab.click();
    const alice = $('[data-account-id="alice"]');
    const bob = $('[data-account-id="bob"]');
    await alice.waitForDisplayed();
    const refreshAll = $('button=Refresh all');
    await expect(refreshAll.$("svg.lucide-refresh-cw")).toBeDisplayed();
    await refreshAll.click();
    await expect(alice.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "80");
    await expect(bob.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "25");
    await expect(alice).toHaveText(expect.stringContaining("plus"));
    await expect(bob).toHaveText(expect.stringContaining("Team · Premium seat"));
    await expect(alice).toHaveText(expect.stringContaining("Current Codex sign-in"));
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const configPath = join(process.env.CODEX_HOME!, "config.toml");
    const original = readFileSync(authPath, "utf8");
    const config = readFileSync(configPath, "utf8");
    const refresh = bob.$('button[aria-label="Refresh"]');
    await expect(refresh).toHaveText("");
    await expect(refresh).toHaveAttribute("title", "Refresh");
    await expect(refresh.$("svg.lucide-refresh-cw")).toBeDisplayed();
    await refresh.waitForEnabled();
    const beforeRefresh = await control();
    await refresh.click();
    await browser.waitUntil(async () => (await control())["bob:/backend-api/wham/usage"] > beforeRefresh["bob:/backend-api/wham/usage"]);
    await refresh.waitForEnabled();
    await expect(refresh).toHaveAttribute("aria-busy", "false");
    expect(readFileSync(authPath, "utf8")).toBe(original);
    await control({ failSubscription: true, limitRateLimited: true });
    const status = await invoke<AccountStatus>("fetch_codex_account_status", { accountId: "bob" });
    expect(status.data?.session?.remainingPercent).toBe(25);
    expect(status.data?.subscriptionActive).toBe(true);
    expect(status.data?.membershipLevel).toBe("self_serve_business_prolite");
    expect(status.errors.subscription).toBe("accountHttpError:503");
    expect(status.errors.limits).toBe("accountRateLimited");
    const before = await control();
    await invoke("fetch_codex_account_status", { accountId: "bob" });
    const after = await control();
    expect(after["bob:/backend-api/wham/usage"]).toBe(before["bob:/backend-api/wham/usage"]);
    await control({ failSubscription: false, limitRateLimited: false });
    await refresh.click();
    await expect(bob).toHaveText(expect.stringContaining("Stale data"));
    await expect(alice.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "80");

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
    await $('button=Browser login').click();
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
        return result.deviceCode === "1234-56789";
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

  run("refreshes a readded current account with newer credentials and preserves them when switching", async () => {
    await browser.execute(() => { localStorage.setItem("language", "en"); });
    await browser.refresh();
    const tab = $('[data-testid="accounts-nav-tab"]');
    await tab.waitForDisplayed({ timeout: 90_000 });
    await tab.click();
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const old = accountCredentials("charlie");
    writeFileSync(authPath, JSON.stringify(old));
    const newer = accountCredentials("charlie");
    newer.tokens.refresh_token = "fixture-new-login-charlie";
    newer.last_refresh = new Date().toISOString();
    writeFileSync(process.env.CODEX_USAGE_ACCOUNTS_LOGIN_AUTH!, JSON.stringify(newer));
    await invoke("import_current_codex_account");
    const list = await invoke<AccountList>("list_codex_accounts");
    const removed = list.accounts.find((account) => account.email === "charlie@example.test")!;
    const oldCard = $(`[data-account-id="${removed.id}"]`);
    await expect(oldCard).toBeDisplayed();
    await invoke("remove_codex_account", { accountId: removed.id });
    await oldCard.waitForExist({ reverse: true });
    await $('button=Browser login').click();
    let addedId: string;
    await browser.waitUntil(async () => {
      const next = await invoke<AccountList>("list_codex_accounts");
      const added = next.accounts.find((account) => account.email === "charlie@example.test");
      if (added) addedId = added.id;
      return !!added && added.id !== removed.id;
    });
    const card = $(`[data-account-id="${addedId!}"]`);
    await expect(card.$('[role="meter"][aria-label="5-hour quota"]')).toHaveAttribute("aria-valuenow", "25");
    await expect(card).toHaveText(expect.stringContaining("Current Codex sign-in"));
    await expect(card).not.toHaveText(expect.stringContaining("Stale data"));
    const status = (await invoke<AccountList>("list_codex_accounts")).accounts.find((account) => account.id === addedId!)!.status;
    expect(status?.errors).toEqual({});
    expect(readFileSync(authPath, "utf8")).toBe(JSON.stringify(old));
    await $('[data-account-id="bob"]').$("button=Switch Codex sign-in").click();
    await expect(card).not.toHaveText(expect.stringContaining("Current Codex sign-in"));
    await card.$("button=Switch Codex sign-in").click();
    await expect(card).toHaveText(expect.stringContaining("Current Codex sign-in"));
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(newer);
  });

  run("requires confirmation before removing saved accounts", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "zh"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const alice = $('[data-account-id="alice"]');
    if (!(await invoke<AccountList>("list_codex_accounts")).accounts.find((account) => account.id === "alice")!.current) {
      await alice.$("button=切换到此账号").click();
    }
    await expect(alice).toHaveAttribute("aria-current", "true");
    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const credentials = readFileSync(authPath, "utf8");
    for (const id of ["free", "alice"]) {
      const card = $(`[data-account-id="${id}"]`);
      let dialog = $('[role="alertdialog"]');
      const openRemoval = async () => {
        await expect(card).toBeDisplayed();
        await card.$('button[aria-label="更多"]').execute((element) => element.focus());
        await browser.keys("Enter");
        const remove = $('//*[@role="menuitem" and normalize-space(.)="移除"]');
        await expect(remove).toBeDisplayed();
        await remove.execute((element) => element.focus());
        await browser.keys("Enter");
        dialog = $('[role="alertdialog"]');
        await expect(dialog).toBeDisplayed();
        await expect(dialog).toHaveText(expect.stringContaining(`${id}@example.test`));
        expect((await invoke<AccountList>("list_codex_accounts")).accounts.some((account) => account.id === id)).toBe(true);
      };
      await openRemoval();
      await expect(dialog).toHaveText(expect.stringContaining(id === "alice" ? "Codex 仍会保持此账号的登录。" : "删除此账号的托管凭据与缓存？"));
      await expect(dialog.$("button=取消")).toBeFocused();
      const centerOffset = await dialog.execute((element) => {
        const rect = element.getBoundingClientRect();
        return Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
      });
      expect(centerOffset).toBeLessThan(2);
      await browser.saveScreenshot(`/tmp/codex-account-removal-${id}.png`);
      await dialog.$("button=取消").click();
      await expect(dialog).not.toExist();
      await expect(card).toBeDisplayed();
      expect((await invoke<AccountList>("list_codex_accounts")).accounts.some((account) => account.id === id)).toBe(true);
      await openRemoval();
      await browser.keys("Escape");
      await expect(dialog).not.toExist();
      await expect(card).toBeDisplayed();
      expect((await invoke<AccountList>("list_codex_accounts")).accounts.some((account) => account.id === id)).toBe(true);
      await openRemoval();
      await dialog.$("button=移除").click();
      await expect(dialog).not.toExist();
      await expect(card).not.toExist();
      expect((await invoke<AccountList>("list_codex_accounts")).accounts.some((account) => account.id === id)).toBe(false);
      expect(readFileSync(authPath, "utf8")).toBe(credentials);
    }
  });

  run("offers three direct account methods and adapts the recommendation after importing", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "zh"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const page = $('section[aria-label="账号"]');
    const methods = page.$('[role="group"][aria-label="添加账号"]');
    const browserLogin = methods.$("button=浏览器登录");
    const deviceLogin = methods.$("button=设备码登录");
    const importCurrent = methods.$("button=导入当前账号");
    const order = async () => methods.$$("button").map((button) => button.getText());
    const waitForPrimary = async (button: typeof browserLogin) => browser.waitUntil(() => button.execute((element) => {
      const style = getComputedStyle(element);
      return style.backgroundColor === `rgb(${style.getPropertyValue("--primary").trim().split(/\s+/).join(", ")})`;
    }), { timeoutMsg: "The recommended button should finish its color transition" });
    const expectedOrder = ["浏览器登录", "设备码登录", "导入当前账号"];
    await expect(browserLogin).toHaveElementClass("bg-primary");
    expect(await order()).toEqual(expectedOrder);
    await expect(deviceLogin).toBeDisplayed();
    await expect(methods.$("button=刷新全部")).not.toExist();
    await expect(page).toHaveText(expect.stringContaining("添加其他账号，可使用浏览器登录或设备码登录。"));
    await waitForPrimary(browserLogin);
    await browser.saveScreenshot("/tmp/codex-accounts-methods-saved.png");

    const saved = await invoke<AccountList>("list_codex_accounts");
    // Removing saved records leaves the native Codex sign-in available to import.
    for (const account of saved.accounts) await invoke("remove_codex_account", { accountId: account.id });
    await expect(importCurrent).toHaveElementClass("bg-primary");
    await expect(browserLogin).not.toHaveElementClass("bg-primary");
    await expect(page).toHaveText(expect.stringContaining("已在本机 Codex 登录？直接导入即可。"));
    expect(await order()).toEqual(expectedOrder);
    await waitForPrimary(importCurrent);
    await browser.saveScreenshot("/tmp/codex-accounts-methods-empty.png");

    const authPath = join(process.env.CODEX_HOME!, "auth.json");
    const backupPath = `${authPath}.methods-backup`;
    renameSync(authPath, backupPath);
    try {
      await browser.refresh();
      await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
      await $('[data-testid="accounts-nav-tab"]').click();
      await expect(browserLogin).toHaveElementClass("bg-primary");
      await expect(importCurrent).not.toHaveElementClass("bg-primary");
      await expect(page).toHaveText(expect.stringContaining("使用浏览器登录或设备码登录，添加第一个账号。"));
      expect(await order()).toEqual(expectedOrder);
    } finally { renameSync(backupPath, authPath); }

    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    await expect(importCurrent).toHaveElementClass("bg-primary");
    await importCurrent.click();
    await expect(page.$("h2=alice@example.test")).toBeDisplayed();
    await expect(browserLogin).toHaveElementClass("bg-primary");
    await expect(importCurrent).not.toHaveElementClass("bg-primary");
    expect(await order()).toEqual(expectedOrder);
    await expect(page).toHaveText(expect.stringContaining("导入当前账号：读取本机 Codex 当前登录的账号。"));
    await browserLogin.click();
    await expect(page).toHaveText(expect.stringContaining("登录完成"));
    await expect(page.$("h2=charlie@example.test")).toBeDisplayed();
  });
});
