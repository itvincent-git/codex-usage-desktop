import { createTauriCapabilities } from "@wdio/tauri-service";
import { spawnSync } from "node:child_process";

const binaryName = process.platform === "win32" ? "codex-usage-desktop.exe" : "codex-usage-desktop";
const appBinaryPath = `./src-tauri/target/debug/${binaryName}`;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const config: WebdriverIO.Config = {
  onPrepare() {
    const result = spawnSync(pnpmCommand, ["test:e2e:build"], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });

    if (result.status !== 0) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      throw result.error ?? new Error(`E2E build failed with status ${result.status}`);
    }
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
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 3,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
