import { $, browser, expect } from "@wdio/globals";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse } from "../src/lib/api";

describe("startup diagnostics and recovery through native scanning", () => {
  const run = process.env.CODEX_USAGE_RECOVERY_E2E === "1" ? it : it.skip;

  run("explains a missing directory, recovers and preserves cached usage after a scan failure", async () => {
    const home = process.env.CODEX_HOME!;
    await browser.execute(() => {
      localStorage.setItem("language", "zh");
      localStorage.setItem("auto_refresh_interval_minutes", "60");
      localStorage.setItem("sidebar_collapsed", "false");
    });
    await browser.refresh();
    await browser.setWindowSize(1440, 1000);
    const recovery = $('[data-testid="usage-recovery"]');
    await expect(recovery).toHaveText(expect.stringContaining("未找到 Codex 目录"));
    await expect(recovery.$('[data-testid="diagnostic-directory"]')).toHaveText(home);
    await expect(recovery.$('button=重新检测')).toBeEnabled();
    await expect(recovery.$('button=选择 Codex 目录')).toBeEnabled();
    await recovery.$("summary").click();
    await browser.saveScreenshot("/tmp/codex-startup-missing-directory.png");

    // Re-detection reruns the native environment selection; it does not require a restart.
    await recovery.$('button=重新检测').click();
    await expect(recovery.$('button=重新检测')).toBeEnabled();
    await expect(recovery).toHaveText(expect.stringContaining("未找到 Codex 目录"));

    mkdirSync(join(home, "sessions"), { recursive: true });
    await recovery.$('button=重新扫描').click();
    await expect(recovery).toHaveText(expect.stringContaining("未找到 Codex 会话日志"));
    const timestamp = new Date().toISOString();
    writeFileSync(join(home, "sessions", "recovery.jsonl"), [
      { timestamp, type: "session_meta", payload: { cwd: "/startup-recovery" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5", cwd: "/startup-recovery" } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1200, output_tokens: 34, total_tokens: 1234 } } } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await recovery.$('button=重新扫描').click();
    await recovery.waitForExist({ reverse: true });
    const inspect = () => browser.tauri.execute<OverviewResponse>(({ core }) => core.invoke("fetch_overview", { range: "30d" }));
    expect((await inspect()).totals.totalTokens).toBe(1234);
    await expect($('[data-testid="dashboard-hero"]')).toHaveText(expect.stringContaining("1,234"));

    const unavailable = home + "-temporarily-unavailable";
    renameSync(home, unavailable);
    try {
      await $('button=重新扫描本地日志').click();
      await expect(recovery).toHaveText(expect.stringContaining("未找到 Codex 目录"));
      await expect(recovery).toHaveText(expect.stringContaining("本次扫描失败未覆盖已有用量缓存"));
      await expect($('header')).toHaveText(expect.stringContaining("上次扫描失败"));
      expect((await inspect()).totals.totalTokens).toBe(1234);
      await expect($('[data-testid="dashboard-hero"]')).toHaveText(expect.stringContaining("1,234"));
      await $('[data-testid="latest-reset-skeleton"]').waitForExist({ reverse: true });
      await $('[data-testid="reset-credits-skeleton"]').waitForExist({ reverse: true });
      await $('[data-testid="forecast-skeleton"]').waitForExist({ reverse: true });
      await recovery.$("summary").click();
      await browser.setWindowSize(1440, 1350);
      await browser.saveScreenshot("/tmp/codex-scan-failed-cache-preserved.png");
    } finally {
      renameSync(unavailable, home);
    }
    await recovery.$('button=重新扫描').click();
    await recovery.waitForExist({ reverse: true });
    expect((await inspect()).totals.totalTokens).toBe(1234);

    const chosenHome = home + "-chosen";
    mkdirSync(join(chosenHome, "sessions"), { recursive: true });
    await browser.tauri.execute(({ core }, chosenHome) => core.invoke("configure_codex_home", { home: chosenHome }), chosenHome);
    const savedSelection = join(process.env.CODEX_USAGE_TEST_DATA_DIR!, "codex-home.json");
    expect(JSON.parse(readFileSync(savedSelection, "utf8"))).toBe(chosenHome);
    await browser.refresh();
    await expect(recovery).toHaveText(expect.stringContaining("未找到 Codex 会话日志"));
    await expect(recovery.$('[data-testid="diagnostic-directory"]')).toHaveText(chosenHome);
    await recovery.$('button=重新检测').click();
    await recovery.waitForExist({ reverse: true });
    expect(existsSync(savedSelection)).toBe(false);
    expect((await inspect()).totals.totalTokens).toBe(1234);
  }).timeout(180_000);
});
