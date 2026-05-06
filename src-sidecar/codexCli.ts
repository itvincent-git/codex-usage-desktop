import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { CodexDailyReport } from "./types";

const execFileAsync = promisify(execFile);

function resolveCodexBinary() {
  if (process.env.CODEX_USAGE_CODEX_BINARY) {
    return process.env.CODEX_USAGE_CODEX_BINARY;
  }

  const binaryName = process.platform === "win32" ? "ccusage-codex.cmd" : "ccusage-codex";
  return path.resolve(process.cwd(), "node_modules", ".bin", binaryName);
}

export async function runCodexDailyReport(options: { codexHome?: string; timezone: string }) {
  const binary = resolveCodexBinary();
  const args = ["daily", "--json", "--timezone", options.timezone];
  const command = process.env.CODEX_USAGE_CODEX_BINARY ? process.execPath : binary;
  const commandArgs = process.env.CODEX_USAGE_CODEX_BINARY ? [binary, ...args] : args;

  const { stdout } = await execFileAsync(
    command,
    commandArgs,
    {
      env: {
        ...process.env,
        ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return JSON.parse(stdout) as CodexDailyReport;
}
