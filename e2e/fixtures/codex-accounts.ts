import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AccountStatus } from "../../src/lib/codex-accounts";
import { join, resolve } from "node:path";

export function accountCredentials(user: string, workspace = "shared-workspace") {
  const claims = { exp: 4_102_444_800, email: `${user}@example.test`, "https://api.openai.com/profile": { email: `${user}@example.test` }, "https://api.openai.com/auth": { chatgpt_user_id: user, chatgpt_account_id: workspace, chatgpt_plan_type: user === "free" ? "free" : user === "bob" ? "team" : user === "alice" || user === "archive" ? "plus" : "pro" } };
  const token = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
  return { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: token, id_token: token, refresh_token: `fixture-refresh-${user}`, account_id: workspace, future_field: { keep: true } }, last_refresh: "2026-11-06T00:00:00Z", unknown_native_field: [1, 2, 3] };
}

export async function startAccountsFixture(root: string) {
  const appData = join(root, "app-data");
  const codexHome = join(root, "codex");
  const library = join(appData, "codex-accounts");
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  mkdirSync(library, { recursive: true, mode: 0o700 });
  const accounts = ["alice", "bob", "free", "archive"].map((user) => ({ id: user, identity: { userId: user, workspaceId: "shared-workspace" }, email: `${user}@example.test`, credentialVersion: 1, credentials: accountCredentials(user), status: user === "archive" ? {
    accountId: user, identity: { userId: user, workspaceId: "shared-workspace" }, credentialVersion: 1, needsLogin: true,
    errors: { limits: "accountLoginRequired", subscription: "accountLoginRequired" },
    updatedAt: Object.fromEntries(["limits", "subscription", "resetCredits"].map((part) => [part, new Date(Date.now() - 3 * 3600_000).toISOString()])),
    data: {
      session: { usedPercent: 38, remainingPercent: 62, windowMinutes: 300, resetsAt: new Date(Date.now() - 3600_000).toISOString() },
      weekly: { usedPercent: 69, remainingPercent: 31, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400_000).toISOString() },
      membershipLevel: "plus", workspaceName: "Archived workspace", subscriptionActive: true, subscriptionWillRenew: true, subscriptionExpiresAt: "2030-01-01T00:00:00Z",
      credits: { hasCredits: true, unlimited: false, balance: "8.50" }, resetCreditsAvailableCount: 1,
      resetCredits: [{ id: "archived-reset", expiresAt: "2030-01-01T00:00:00Z" }], updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), source: "oauth",
    },
  } satisfies AccountStatus : null }));
  writeFileSync(join(library, "accounts.json"), JSON.stringify({ accounts, pending: null }), { mode: 0o600 });
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify(accountCredentials("alice")), { mode: 0o600 });
  writeFileSync(join(codexHome, "config.toml"), "# Must stay byte-for-byte unchanged\ncli_auth_credentials_store = 'file'\nmodel = 'fixture-model'\nmodel_reasoning_effort = 'xhigh'\n[mcp_servers.fixture]\ncommand = 'fixture'\n");
  writeFileSync(join(root, "login-auth.json"), JSON.stringify(accountCredentials("charlie")), { mode: 0o600 });
  const requests: Record<string, number> = {};
  let failSubscription = false;
  let limitRateLimited = false;
  const server = createServer(async (req, res) => {
    if (req.url === "/control") {
      let body = ""; for await (const chunk of req) body += chunk;
      const control = JSON.parse(body || "{}");
      if ("failSubscription" in control) failSubscription = control.failSubscription;
      if ("limitRateLimited" in control) limitRateLimited = control.limitRateLimited;
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(requests)); return;
    }
    if (req.url === "/oauth/token") {
      let body = ""; for await (const chunk of req) body += chunk;
      const grant = JSON.parse(body);
      const user = String(grant.refresh_token).split("-").at(-1)!;
      if (user === "archive") { res.writeHead(400).end('{"error":"invalid_grant"}'); return; }
      const tokens = accountCredentials(user).tokens;
      requests["refresh"] = (requests["refresh"] ?? 0) + 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ access_token: tokens.access_token, id_token: tokens.id_token, refresh_token: `fixture-rotated-${user}` })); return;
    }
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    let claims: { force401?: boolean; "https://api.openai.com/auth": { chatgpt_user_id: string; chatgpt_account_id: string } };
    try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { res.writeHead(401).end(); return; }
    const identity = claims["https://api.openai.com/auth"];
    if (req.headers["chatgpt-account-id"] !== identity.chatgpt_account_id) { res.writeHead(403).end(); return; }
    if (identity.chatgpt_user_id === "archive") { res.writeHead(401).end('{"error":"fixture"}'); return; }
    const endpoint = req.url?.split("?")[0] ?? "";
    const key = `${identity.chatgpt_user_id}:${endpoint}`;
    requests[key] = (requests[key] ?? 0) + 1;
    res.setHeader("Content-Type", "application/json");
    if (endpoint.includes("accounts/check")) {
      if (failSubscription) { res.writeHead(503).end('{"error":"fixture"}'); return; }
      res.end(JSON.stringify({ accounts: { [identity.chatgpt_account_id]: { account: { account_id: identity.chatgpt_account_id, name: identity.chatgpt_user_id === "alice" ? null : `Workspace ${identity.chatgpt_user_id}` }, entitlement: { has_active_subscription: identity.chatgpt_user_id !== "free", expires_at: "2030-01-01T00:00:00Z" }, last_active_subscription: { will_renew: true } } } }));
    } else if (endpoint.endsWith("rate-limit-reset-credits")) {
      res.end(JSON.stringify({ available_count: identity.chatgpt_user_id === "alice" ? 1 : 3, credits: [{ id: "reset-one", status: "available", expires_at: "2030-01-01T00:00:00Z" }] }));
    } else if (endpoint.endsWith("/usage")) {
      if (claims.force401) { res.writeHead(401).end('{"error":"fixture"}'); return; }
      if (limitRateLimited && identity.chatgpt_user_id === "bob") { res.writeHead(429, { "Retry-After": "60" }).end('{"error":"fixture"}'); return; }
      res.end(JSON.stringify({ plan_type: identity.chatgpt_user_id === "bob" ? "self_serve_business_prolite" : identity.chatgpt_user_id === "free" ? "free" : identity.chatgpt_user_id === "alice" ? "plus" : "pro", rate_limit: { primary_window: { used_percent: identity.chatgpt_user_id === "free" ? 15 : identity.chatgpt_user_id === "alice" ? 20 : 75, reset_at: Math.floor(Date.now() / 1000) + (identity.chatgpt_user_id === "free" ? 23 * 86400 : 4 * 3600 + 32 * 60), limit_window_seconds: identity.chatgpt_user_id === "free" ? 30 * 86400 : 18_000 }, secondary_window: identity.chatgpt_user_id === "free" ? null : { used_percent: 40, reset_at: Math.floor(Date.now() / 1000) + 3 * 86400 + 6 * 3600, limit_window_seconds: 604_800 } }, credits: { has_credits: identity.chatgpt_user_id !== "free", unlimited: false, balance: identity.chatgpt_user_id === "free" ? "0" : identity.chatgpt_user_id === "alice" ? "20" : "200" } }));
    } else { res.writeHead(404).end("{}"); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
  let cli = resolve("e2e/fixtures/mock-account-login.cjs");
  if (process.platform === "win32") {
    const script = cli; cli = join(root, "mock-account-login.cmd");
    writeFileSync(cli, `@echo off\r\nset NODE_OPTIONS=\r\nset TSX_TSCONFIG_PATH=\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const script = join(root, "mock-account-login.cjs");
    writeFileSync(script, readFileSync(cli, "utf8"), { mode: 0o755 });
    cli = join(root, "mock-account-login");
    // WDIO's relative tsconfig loader must not follow the fixture into its empty cwd.
    writeFileSync(cli, `#!/bin/sh\nunset NODE_OPTIONS TSX_TSCONFIG_PATH\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
  }
  return { url: `http://127.0.0.1:${address.port}`, codexHome, appData, cli, loginAuth: join(root, "login-auth.json"), config: readFileSync(join(codexHome, "config.toml"), "utf8"), close: () => new Promise<void>((done) => server.close(() => done())) };
}
