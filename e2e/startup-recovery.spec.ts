import { $, browser, expect } from "@wdio/globals";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse } from "../src/lib/api";

describe("startup diagnostics and recovery through native scanning", () => {
  const run = process.env.CODEX_USAGE_RECOVERY_E2E === "1" ? it : it.skip;

  run("explains a missing directory, recovers and preserves cached usage after a scan failure", async () => {
    const home = process.env.CODEX_HOME!;
    const backups = join(process.env.CODEX_USAGE_TEST_DATA_DIR!, "cache-backups");
    const startupBackup = join(backups, readdirSync(backups)[0]);
    expect(readFileSync(join(startupBackup, "codex-usage-desktop.db"), "utf8")).toBe("startup corrupt cache fixture");
    expect(readFileSync(join(startupBackup, "codex-usage-desktop.db-wal"), "utf8")).toBe("startup wal fixture");
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
    const broken = join(home, "sessions", "broken.jsonl");
    writeFileSync(broken, "{invalid json}\n");
    await recovery.$('button=重新扫描').click();
    await expect(recovery).toHaveText(expect.stringContaining("会话日志解析失败"));
    await expect(recovery.$("details")).toHaveAttribute("open");
    await expect(recovery).toHaveText(expect.stringContaining("broken.jsonl"));
    await expect(recovery).toHaveText(expect.stringContaining("line 1"));
    await expect(recovery.$('button=选择 Codex 目录')).not.toExist();
    await browser.saveScreenshot("/tmp/codex-session-parse-failed.png");
    unlinkSync(broken);
    const timestamp = new Date().toISOString();
    writeFileSync(join(home, "sessions", "recovery.jsonl"), [
      { timestamp, type: "session_meta", payload: { cwd: "/startup-recovery" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5", cwd: "/startup-recovery" } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1200, output_tokens: 34, total_tokens: 1234 } } } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await recovery.$('button=重新扫描').click();
    await recovery.waitForExist({ reverse: true });
    const inspect = () => browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      return await runtime.invoke<OverviewResponse>("fetch_overview", { range: "30d" });
    });
    expect((await inspect()).totals.totalTokens).toBe(1234);
    await expect($('[data-testid="dashboard-hero"]')).toHaveText(expect.stringContaining("1,234"));

    // A pending IPC response does not clear cached usage or start a duplicate native scan.
    await browser.execute(() => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const url = runtime.convertFileSrc("scan_usage", "ipc");
      const original = window.fetch.bind(window);
      let release: (() => void) | undefined;
      window.fetch = (input, options) => String(input) === url
        ? new Promise<Response>((resolve, reject) => { release = () => { original(input, options).then(resolve, reject); }; })
        : original(input, options);
      Object.assign(window, { releaseLocalScan: () => { window.fetch = original; release?.(); } });
    });
    try {
      await $('button=重新扫描本地日志').click();
      await $('[data-testid="scan-wait-notice"]').waitForDisplayed({ timeout: 40_000 });
      await expect($('[data-testid="scan-wait-notice"]').$('button=复制诊断信息')).toBeEnabled();
      await expect($('[data-testid="dashboard-hero"]')).toHaveText(expect.stringContaining("1,234"));
      await expect($('button=重新扫描本地日志')).toBeDisabled();
      await browser.saveScreenshot("/tmp/codex-local-scan-waiting.png");
    } finally {
      await browser.execute(() => (window as unknown as { releaseLocalScan: () => void }).releaseLocalScan());
    }
    await $('[data-testid="scan-wait-notice"]').waitForExist({ reverse: true });
    await $('button=重新扫描本地日志').waitForEnabled();

    writeFileSync(join(home, "sessions", "broken.jsonl.zst"), "invalid compressed session");
    await $('button=重新扫描本地日志').click();
    await expect(recovery).toHaveText(expect.stringContaining("无法读取会话文件"));
    await expect(recovery).toHaveText(expect.stringContaining("broken.jsonl.zst"));
    expect((await inspect()).totals.totalTokens).toBe(1234);
    await browser.saveScreenshot("/tmp/codex-compressed-session-failed.png");
    unlinkSync(join(home, "sessions", "broken.jsonl.zst"));
    await recovery.$('button=重新扫描').click();
    await recovery.waitForExist({ reverse: true });

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

    // Damage only this isolated app cache; verify native diagnostics and the deferred recovery command.
    const data = process.env.CODEX_USAGE_TEST_DATA_DIR!;
    const database = join(data, "codex-usage-desktop.db");
    const backup = join(data, "healthy-cache");
    mkdirSync(backup);
    const moved: string[] = [];
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(database + suffix)) {
        renameSync(database + suffix, join(backup, "cache" + suffix));
        moved.push(suffix);
      }
    }
    try {
      writeFileSync(database, "invalid sqlite cache");
      await $('button=重新扫描本地日志').click();
      await expect(recovery).toHaveText(expect.stringContaining("用量缓存已损坏"));
      await expect(recovery.$('button=选择 Codex 目录')).not.toExist();
      await expect($('[data-testid="dashboard-hero"]')).toHaveText(expect.stringContaining("1,234"));
      await browser.saveScreenshot("/tmp/codex-cache-corrupt.png");
      await browser.execute(() => { window.confirm = () => true; });
      await recovery.$('button=备份并重建缓存').click();
      await expect(recovery).toHaveText(expect.stringContaining("已安排恢复"));
      expect(existsSync(join(data, "codex-usage-desktop.rebuild-on-start"))).toBe(true);
      expect(readFileSync(database, "utf8")).toBe("invalid sqlite cache");
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(database + suffix)) unlinkSync(database + suffix);
      }
      for (const suffix of moved) renameSync(join(backup, "cache" + suffix), database + suffix);
      const marker = join(data, "codex-usage-desktop.rebuild-on-start");
      if (existsSync(marker)) unlinkSync(marker);
      await browser.refresh();
    }
  }).timeout(180_000);
});
