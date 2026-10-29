import { $, $$, browser, expect } from "@wdio/globals";
import { creditId, writeCreditAuth } from "./fixtures/session-credits-server";

type Request = { ids: string[]; account: string; authorization: string; path: string };
const stats = async (): Promise<Request[]> => (await fetch(`${process.env.CODEX_USAGE_SESSION_CREDITS_URL}/stats`)).json();
const control = async (status: number, delay = 0) => {
  await fetch(`${process.env.CODEX_USAGE_SESSION_CREDITS_URL}/control`, { method: "POST", body: JSON.stringify({ status, delay }) });
};

describe("optional native session credits", () => {
  const run = process.env.CODEX_USAGE_SESSION_CREDITS_URL ? it : it.skip;
  run("queries only displayed sessions, reuses cache, isolates accounts and contains errors", async () => {
    await browser.execute(() => {
      localStorage.clear(); localStorage.setItem("language", "en"); localStorage.setItem("sidebar_collapsed", "false");
    });
    await browser.refresh();
    const sessionsTab = $('[data-testid="sessions-nav-tab"]');
    await sessionsTab.waitForDisplayed({ timeout: 90_000 });
    await sessionsTab.click();
    await $('[data-testid="session-card"]').waitForDisplayed({ timeout: 30_000 });
    expect(await stats()).toHaveLength(0);
    await $('[data-testid="session-card"] h3').click();
    const detailDialog = $('[aria-labelledby="session-detail-title"]');
    await detailDialog.waitForDisplayed();
    await expect(detailDialog.$('[data-testid="session-credits"]')).not.toBeExisting();
    expect(await stats()).toHaveLength(0);
    await browser.keys("Escape");
    await detailDialog.waitForExist({ reverse: true });
    await $('button[aria-label="Settings"]').click();
    const toggle = $('[role="switch"][aria-label="Show session credits debited"]');
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await stats()).toHaveLength(0);

    await $('button=Back').click();
    await browser.waitUntil(async () => (await stats()).length === 1);
    await expect($('[data-testid="session-credits"]')).toHaveText(expect.stringContaining("session total"));
    const first = (await stats())[0];
    expect(first.ids.length).toBeGreaterThan(1);
    expect(new Set(first.ids).size).toBe(first.ids.length);
    expect(first.authorization).toBe("Bearer fixture-token");
    expect(first.path).toBe("/backend-api/wham/usage/thread_usage/query_v2");
    expect(first.ids).not.toContain(creditId(36));
    await $('button=Refresh session credits').waitForEnabled();
    const card = $('[data-testid="session-card"]');
    const listCredits = await card.$('[data-testid="session-credits"]').getText();
    await card.$("h3").click();
    const enabledDetailDialog = $('[aria-labelledby="session-detail-title"]');
    await enabledDetailDialog.waitForDisplayed();
    const detailCredits = enabledDetailDialog.$('[data-testid="session-credits"]');
    await expect(detailCredits).toHaveText(listCredits);
    const summaryOrder = await enabledDetailDialog.$('[aria-label="Session summary"]').getText();
    expect(summaryOrder.indexOf("Balance debits · session total")).toBeGreaterThan(summaryOrder.indexOf("Observed quota usage"));
    for (const width of [1440, 1100]) {
      await browser.setWindowSize(width, 760);
      await browser.waitUntil(async () => browser.execute(() => {
        const summary = document.querySelector('[aria-labelledby="session-detail-title"] [aria-label="Session summary"]')!;
        const quota = summary.querySelector("#session-quota-title")!.getBoundingClientRect();
        const credits = summary.querySelector('[data-testid="session-credits"]')!.getBoundingClientRect();
        return Math.abs(credits.top - quota.top) < 4 && credits.left > quota.right
          && credits.right <= summary.getBoundingClientRect().right && summary.scrollWidth <= summary.clientWidth;
      }), { timeoutMsg: `Session credits should be beside the quota heading without overflow at ${width}px` });
    }
    await browser.setWindowSize(1440, 960);
    expect(await stats()).toHaveLength(1);
    await browser.keys("Escape");
    await enabledDetailDialog.waitForExist({ reverse: true });
    // Read through the native command to assert cross-day rows share one UUID.
    const rows = await browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string) => Promise<T> } }).__TAURI_INTERNALS__;
      return runtime.invoke<{ threadId: string; dailyUsage: unknown[] }[]>("fetch_session_details");
    });
    expect(rows.find((row) => row.threadId === creditId(1))!.dailyUsage.length).toBe(2);

    const dates = await $$('[id^="date-group-"] > button[aria-expanded]');
    await dates[1].click();
    await browser.waitUntil(async () => (await stats()).length === 2);
    expect((await stats())[1].ids).toEqual([creditId(36)]);
    await $('[data-testid="session-cost"]').scrollIntoView({ block: "center" });
    await expect($('[data-testid="session-cost"]')).toHaveText(expect.stringContaining("$"));

    await $('button[aria-label="Settings"]').click();
    await $('button=Back').click();
    await $('button=Refresh session credits').waitForEnabled();
    expect(await stats()).toHaveLength(2);

    // Same local files, a different account: no old debit values may survive.
    writeCreditAuth(process.env.CODEX_HOME!, "account-b");
    await $('button=Refresh session credits').scrollIntoView({ block: "center" });
    await $('button=Refresh session credits').click();
    await browser.waitUntil(async () => (await stats()).some((request) => request.account === "account-b"));
    await browser.waitUntil(async () => (await $('[data-testid="session-credits"]').getText()).includes("98.76"));

    await control(429);
    await $('button=Refresh session credits').waitForEnabled();
    await $('button=Refresh session credits').click();
    await expect($('[data-testid="session-credits"]')).toHaveText(expect.stringContaining("Cached data"));
    await expect($('[data-testid="session-credits"]')).toHaveText(expect.stringContaining("98.76"));
    await expect($('span[role="status"]')).toHaveText(expect.stringContaining("cooldown"));

    // A new user in the same workspace is independently authenticated and cached.
    writeCreditAuth(process.env.CODEX_HOME!, "account-b", "second-user");
    await control(503);
    await $('button=Refresh session credits').waitForEnabled();
    await $('button=Refresh session credits').click();
    await expect($('[data-testid="session-card"]')).toBeExisting();
    await expect($('span[role="status"]')).toHaveText(expect.stringContaining("temporarily unavailable"));
    const failedCount = (await stats()).length;
    await $('button=Refresh session credits').click();
    await $('button=Refresh session credits').waitForEnabled();
    expect(await stats()).toHaveLength(failedCount);

    await $('button[aria-label="Settings"]').click();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await $('button=Back').click();
    await expect($('[data-testid="session-credits"]')).not.toBeExisting();
    await (await $$('[id^="date-group-"] > button[aria-expanded]'))[1].click();
    expect(await stats()).toHaveLength(failedCount);

    writeCreditAuth(process.env.CODEX_HOME!, "ignored", "ignored", true);
    await $('button[aria-label="Settings"]').click();
    await toggle.click();
    await $('button=Back').click();
    await expect($('span[role="status"]')).toHaveText("Sign in with ChatGPT to read session credits.");
    expect(await stats()).toHaveLength(failedCount);
  }).timeout(180_000);

  run("loads project pages incrementally and reuses cross-component cache", async () => {
    writeCreditAuth(process.env.CODEX_HOME!, "project-account");
    await control(200);
    await browser.execute(() => localStorage.setItem("show_session_credits", "true"));
    await browser.refresh();
    await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    const initial = (await stats()).length;
    await $('[data-testid="projects-nav-tab"]').click();
    await $('tr[role="button"]').waitForDisplayed();
    await $('tr[role="button"]').click();
    const dialog = $('[aria-labelledby="modal-project-title"]');
    await dialog.waitForDisplayed();
    const more = dialog.$('button=Load more sessions');
    await more.waitForDisplayed();
    await browser.waitUntil(async () => (await stats()).length > initial);
    await dialog.$('button=Refresh session credits').waitForEnabled();
    const first = (await stats()).slice(initial);
    expect(first).toHaveLength(1);
    expect(first[0].ids.length).toBeLessThan(35);
    await more.click();
    await browser.waitUntil(async () => (await stats()).length > initial + 1);
    await dialog.$('button=Refresh session credits').waitForEnabled();
    const requests = (await stats()).slice(initial);
    const ids = requests.flatMap((request) => request.ids);
    expect(new Set(ids).size).toBe(ids.length);
    await browser.keys("Escape");
    await dialog.waitForExist({ reverse: true });
    await $('[data-testid="sessions-nav-tab"]').click();
    await $('button=Refresh session credits').waitForEnabled();
    expect(await stats()).toHaveLength(initial + 2);
  }).timeout(90_000);

  run("deduplicates concurrent native batches, bounds 401 recovery and stops queued batches", async () => {
    await browser.refresh();
    await $('button[aria-label="Settings"]').waitForDisplayed({ timeout: 90_000 });
    await $('button[aria-label="Settings"]').click();
    writeCreditAuth(process.env.CODEX_HOME!, "batch-account");
    const initial = (await stats()).length;
    const results = await browser.execute(async (ids) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      await runtime.invoke("set_session_credits_scope", { scope: "batch-contract", revision: 1, active: true });
      const args = { threads: [...ids, ids[0]].map((threadId) => ({ threadId, modifiedAtMs: 0 })), scope: "batch-contract", revision: 1, force: false, cacheOnly: false };
      return Promise.all([runtime.invoke<{ rows: unknown[] }>("fetch_session_credits", args), runtime.invoke<{ rows: unknown[] }>("fetch_session_credits", args)]);
    }, Array.from({ length: 101 }, (_, index) => creditId(index + 100)));
    expect(results.map((result) => result.rows.length)).toEqual([101, 101]);
    expect((await stats()).slice(initial).map((request) => request.ids.length)).toEqual([100, 1]);

    writeCreditAuth(process.env.CODEX_HOME!, "unauthorized-account");
    await control(401);
    const before401 = (await stats()).length;
    const failed = await browser.execute(async (threadId) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      return runtime.invoke<{ requestStatus: string }>("fetch_session_credits", { threads: [{ threadId, modifiedAtMs: 0 }], scope: "batch-contract", revision: 1, force: false, cacheOnly: false });
    }, creditId(100));
    expect(failed.requestStatus).toBe("chatgptLoginRequired");
    expect((await stats()).length - before401).toBe(2);

    writeCreditAuth(process.env.CODEX_HOME!, "stop-account");
    await control(200, 2_000);
    const beforeStop = (await stats()).length;
    await browser.execute((ids) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      (window as unknown as { creditsPending: Promise<unknown> }).creditsPending = runtime.invoke("fetch_session_credits", { threads: ids.map((threadId) => ({ threadId, modifiedAtMs: 0 })), scope: "batch-contract", revision: 1, force: false, cacheOnly: false });
    }, Array.from({ length: 101 }, (_, index) => creditId(index + 300)));
    await browser.waitUntil(async () => (await stats()).length === beforeStop + 1, { interval: 50 });
    await browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      await runtime.invoke("set_session_credits_scope", { scope: "batch-contract", revision: 2, active: false });
      await (window as unknown as { creditsPending: Promise<unknown> }).creditsPending;
    });
    expect(await stats()).toHaveLength(beforeStop + 1);
  }).timeout(90_000);
});
