import { $, $$, browser, expect } from "@wdio/globals";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import type { CodexLimitsResponse } from "../src/lib/api";

type NativeState = { onActiveSpace: boolean; visibleOnScreen: boolean; frontmostPid: number; appPid: number };

async function waitForOverlayOnApp(pid: number, message: string, activate?: () => void) {
  let stable = 0;
  let lastActivation = 0;
  let lastState: NativeState | undefined;
  await browser.waitUntil(async () => {
    lastState = await browser.tauri.execute(({ core }) => core.invoke("quota_native_state")) as NativeState;
    if (lastState.frontmostPid !== pid && activate && Date.now() - lastActivation > 1_000) {
      activate();
      lastActivation = Date.now();
    }
    stable = lastState.frontmostPid === pid && lastState.onActiveSpace && lastState.visibleOnScreen ? stable + 1 : 0;
    return stable >= 5;
  }, { timeout: 15_000, interval: 250, timeoutMsg: message }).catch((error) => {
    console.log("[quota native state]", lastState);
    throw error;
  });
}

async function startFullscreenApp(apps: ChildProcessWithoutNullStreams[]) {
  const app = spawn("swift", [resolve("e2e/fixtures/fullscreen-app.swift")], { stdio: ["pipe", "pipe", "pipe"] });
  apps.push(app);
  await new Promise<void>((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error("Fullscreen fixture did not start")), 30_000);
    let output = "";
    app.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("FULLSCREEN_READY")) {
        clearTimeout(timeout);
        ready();
      }
    });
    app.on("error", (error) => { clearTimeout(timeout); reject(error); });
    app.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Fullscreen fixture exited: ${code}`)); });
    app.stderr.on("data", (chunk) => console.log(`[fullscreen fixture] ${chunk}`));
  });
  return app;
}

async function verifyFullscreenSpaces() {
  await browser.tauri.execute(async ({ core }) => {
    await core.invoke("plugin:window|show", { label: "main" });
    await core.invoke("plugin:window|set_focus", { label: "main" });
  });
  const { appPid } = await browser.tauri.execute(({ core }) => core.invoke("quota_native_state")) as NativeState;
  const apps: ChildProcessWithoutNullStreams[] = [];
  try {
    const first = await startFullscreenApp(apps);
    first.stdin.write("activate\n");
    await waitForOverlayOnApp(first.pid!, "Quota disappeared on the first fullscreen Space", () => first.stdin.write("activate\n"));
    const second = await startFullscreenApp(apps);
    second.stdin.write("activate\n");
    await waitForOverlayOnApp(second.pid!, "Quota disappeared on the second fullscreen Space", () => second.stdin.write("activate\n"));
    for (let round = 0; round < 2; round++) {
      first.stdin.write("activate\n");
      await waitForOverlayOnApp(first.pid!, "Quota disappeared switching back to the first fullscreen Space", () => first.stdin.write("activate\n"));
      second.stdin.write("activate\n");
      await waitForOverlayOnApp(second.pid!, "Quota disappeared switching to the second fullscreen Space", () => second.stdin.write("activate\n"));
      await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
      await waitForOverlayOnApp(appPid, "Quota disappeared when returning to the dashboard Space");
    }
  } finally {
    await Promise.all(apps.map((app) => new Promise<void>((done) => {
      if (app.exitCode !== null) { done(); return; }
      const timeout = setTimeout(() => { app.kill(); done(); }, 3_000);
      app.once("exit", () => { clearTimeout(timeout); done(); });
      app.stdin.write("quit\n");
    })));
    await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
  }
}

describe("quota floating window", () => {
  const run = process.env.CODEX_USAGE_QUOTA_E2E === "1" ? it : it.skip;
  run("shows quota, stays on top, moves independently, and preserves its position when reopened", async () => {
    await browser.tauri.switchWindow("main");
    await browser.execute(() => localStorage.setItem("language", "en"));
    await browser.refresh();
    const open = $("button=Quota overlay");
    await open.waitForDisplayed({ timeout: 90_000 });
    const fixture = await browser.tauri.execute(({ core }) => core.invoke("fetch_codex_limits")) as CodexLimitsResponse;
    await open.click();
    await browser.tauri.switchWindow("quota");
    await $('[data-quota-window="session"]').waitForDisplayed();
    await expect($('[data-quota-window="session"]')).toHaveText(expect.stringContaining("72%"));
    await expect($('[data-quota-window="weekly"]')).toHaveText(expect.stringContaining("35%"));
    const reset = await browser.execute((value) => new Date(value).toLocaleString("en", { hour: "2-digit", minute: "2-digit", hour12: false }), fixture.session!.resetsAt!);
    await expect($('[data-quota-window="session"]')).toHaveText(expect.stringContaining(reset));
    expect(await browser.tauri.execute(async ({ core }) => {
      return {
        visible: await core.invoke("plugin:window|is_visible", { label: "quota" }),
        top: await core.invoke("plugin:window|is_always_on_top", { label: "quota" }),
        decorated: await core.invoke("plugin:window|is_decorated", { label: "quota" }),
      };
    })).toEqual({ visible: true, top: true, decorated: false });
    if (process.platform === "darwin") {
      const native = await browser.tauri.execute(({ core }) => core.invoke("quota_native_state")) as { isPanel: boolean; nonActivating: boolean; canJoinAllSpaces: boolean };
      expect(native.isPanel).toBe(true);
      expect(native.nonActivating).toBe(true);
      expect(native.canJoinAllSpaces).toBe(true);
    }
    expect(await $("header[data-tauri-drag-region]").isExisting()).toBe(true);

    // Exercise the native move path and retain the exact position across hide/show.
    const position = await browser.tauri.execute(async ({ core }) => {
      const before = await core.invoke("plugin:window|outer_position", { label: "quota" }) as { x: number; y: number };
      await core.invoke("plugin:window|set_position", { label: "quota", value: { Physical: { x: before.x + 80, y: before.y + 60 } } });
      return { before, after: await core.invoke("plugin:window|outer_position", { label: "quota" }) as { x: number; y: number } };
    });
    expect(position.after.x).toBe(position.before.x + 80);
    expect(position.after.y).toBe(position.before.y + 60);

    await browser.tauri.switchWindow("main");
    await browser.tauri.execute(({ core }) => core.invoke("plugin:window|hide", { label: "main" }));
    await browser.tauri.switchWindow("quota");
    expect(await browser.tauri.execute(({ core }) => core.invoke("plugin:window|is_visible", { label: "quota" }))).toBe(true);
    await $('button[aria-label="Check limits"]').waitForEnabled();
    await browser.tauri.execute(({ core }, payload) => core.invoke("plugin:event|emit", { event: "codex-limits-updated", payload }), { ...fixture, session: { ...fixture.session, remainingPercent: 61 } });
    await expect($('[data-quota-window="session"]')).toHaveText(expect.stringContaining("61%"));
    // Keep a screenshot of the real native WebView for visual inspection.
    if (process.env.CODEX_USAGE_QUOTA_SCREENSHOT) await browser.saveScreenshot(process.env.CODEX_USAGE_QUOTA_SCREENSHOT);

    await $('button[aria-label="Collapse to quota ball"]').click();
    await $('[data-quota-mode="collapsed"]').waitForDisplayed();
    await expect($$('[role="meter"]')).toBeElementsArrayOfSize(2);
    await expect($('[role="meter"][aria-label="5-Hour Limit"]')).toHaveAttribute("aria-valuenow", "61");
    await expect($('[role="meter"][aria-label="5-hour time remaining"]')).toExist();
    const ballSize = await browser.tauri.execute(async ({ core }) => ({
      size: await core.invoke("plugin:window|inner_size", { label: "quota" }) as { width: number; height: number },
      scale: await core.invoke("plugin:window|scale_factor", { label: "quota" }) as number,
    }));
    expect(ballSize.size.width / ballSize.scale).toBe(88);
    expect(ballSize.size.height / ballSize.scale).toBe(88);
    if (process.env.CODEX_USAGE_QUOTA_SCREENSHOT) await browser.saveScreenshot(process.env.CODEX_USAGE_QUOTA_SCREENSHOT.replace(".png", "-ball.png"));

    if (process.platform === "darwin") await verifyFullscreenSpaces();

    await $('button[aria-label="Expand quota overlay"]').click();
    await $('[data-quota-mode="expanded"]').waitForDisplayed();
    await expect($$('[role="meter"]')).toBeElementsArrayOfSize(3);
    expect(await browser.tauri.execute(({ core }) => core.invoke("plugin:window|is_always_on_top", { label: "quota" }))).toBe(true);
    const expandedSize = await browser.tauri.execute(async ({ core }) => ({
      size: await core.invoke("plugin:window|inner_size", { label: "quota" }) as { width: number; height: number },
      scale: await core.invoke("plugin:window|scale_factor", { label: "quota" }) as number,
    }));
    expect(expandedSize.size.width / expandedSize.scale).toBe(352);
    expect(expandedSize.size.height / expandedSize.scale).toBe(178);
    if (process.platform === "darwin") {
      const native = await browser.tauri.execute(({ core }) => core.invoke("quota_native_state")) as { onActiveSpace: boolean; visibleOnScreen: boolean };
      expect(native.onActiveSpace).toBe(true);
      expect(native.visibleOnScreen).toBe(true);
      await verifyFullscreenSpaces();
    }
    await $('button[aria-label="Close"]').click();
    expect(await browser.tauri.execute(({ core }) => core.invoke("plugin:window|is_visible", { label: "quota" }))).toBe(false);
    await browser.tauri.switchWindow("main");
    await browser.tauri.execute(({ core }) => core.invoke("plugin:window|show", { label: "main" }));
    await open.click();
    await browser.tauri.switchWindow("quota");
    expect(await browser.tauri.execute(({ core }) => core.invoke("plugin:window|outer_position", { label: "quota" }))).toEqual(position.after);
    expect(await browser.tauri.execute(({ core }) => core.invoke("plugin:window|is_always_on_top", { label: "quota" }))).toBe(true);
    await expect($('[data-quota-window="session"]')).toHaveText(expect.stringContaining("72%"));
    await $('button[aria-label="Close"]').click();
    await browser.tauri.switchWindow("main");
  }).timeout(180_000);
});
