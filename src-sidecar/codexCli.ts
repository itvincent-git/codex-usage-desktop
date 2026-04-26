import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CodexDailyReport } from "./types";

const execFileAsync = promisify(execFile);

function resolveCodexBinary() {
  const binaryName = process.platform === "win32" ? "ccusage-codex.cmd" : "ccusage-codex";
  return path.resolve(process.cwd(), "node_modules", ".bin", binaryName);
}

export async function runCodexDailyReport(options: { codexHome?: string; timezone: string }) {
  const { stdout } = await execFileAsync(
    resolveCodexBinary(),
    ["daily", "--json", "--timezone", options.timezone],
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

