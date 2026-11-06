#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
if (process.argv.includes("--version")) { console.log("codex-cli 0.167.0"); process.exit(0); }
const home = process.env.CODEX_HOME;
if (!home || realpathSync(process.cwd()) !== realpathSync(home) || existsSync(join(home, "auth.json")) || !process.argv.includes('cli_auth_credentials_store="file"')) process.exit(2);
if (process.argv.includes("--device-auth")) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(process.env.CODEX_USAGE_ACCOUNTS_PROCESS_FILE, JSON.stringify({ pid: process.pid, child: child.pid, home }));
  process.stdout.write("https://auth.openai.com/codex/device\nABCD-1234\n");
  setInterval(() => {}, 1000);
} else {
  writeFileSync(join(home, "auth.json"), readFileSync(process.env.CODEX_USAGE_ACCOUNTS_LOGIN_AUTH), { mode: 0o600 });
}
