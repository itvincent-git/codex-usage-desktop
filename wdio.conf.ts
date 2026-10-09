import { createTauriCapabilities } from "@wdio/tauri-service";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binaryName = process.platform === "win32" ? "codex-usage-desktop.exe" : "codex-usage-desktop";
const appBinaryPath = `./src-tauri/target/debug/${binaryName}`;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let archivedSessionsHome: string | undefined;

export const config: WebdriverIO.Config = {
  onPrepare() {
    const buildArgs = ["test:e2e:build"];
    if (process.env.CODEX_USAGE_REFRESH_E2E === "1") {
      archivedSessionsHome = mkdtempSync(join(tmpdir(), "codex-usage-refresh-e2e-"));
      process.env.CODEX_HOME = archivedSessionsHome;
      buildArgs.push("--config", JSON.stringify({ identifier: `com.codexusage.desktop.e2e.refresh${Date.now()}` }));
    } else if (process.env.CODEX_USAGE_ARCHIVE_E2E === "1") {
      archivedSessionsHome = mkdtempSync(join(tmpdir(), "codex-usage-archive-e2e-"));
      process.env.CODEX_HOME = archivedSessionsHome;
      buildArgs.push("--config", JSON.stringify({ identifier: "com.codexusage.desktop.e2e.archives" }));
    }
    const started = Date.now();
    console.log("[e2e] Building the native test app...");
    const result = spawnSync(pnpmCommand, buildArgs, {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw result.error ?? new Error(`E2E build failed with status ${result.status}`);
    }
    console.log(`[e2e] Build completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  },
  onComplete() {
    if (archivedSessionsHome) rmSync(archivedSessionsHome, { recursive: true, force: true });
  },
  runner: "local",
  tsConfigPath: "./tsconfig.e2e.json",
  specs: ["./e2e/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [createTauriCapabilities(appBinaryPath)],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        logLevel: "error",
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "error",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 15_000,
  connectionRetryCount: 0,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
