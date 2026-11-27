import { invoke } from "@tauri-apps/api/core";
import type { CodexLimitsResponse } from "@/lib/api";

export type AccountIdentity = { userId: string; workspaceId: string };
export type AccountStatus = {
  accountId: string; identity: AccountIdentity; credentialVersion: number;
  data: CodexLimitsResponse | null; errors: Record<string, string>;
  updatedAt: Record<string, string>; needsLogin: boolean;
};
export type CodexAccount = {
  id: string; identity: AccountIdentity; email: string | null; credentialVersion: number;
  authMode?: "chatgpt" | "apikey"; baseUrl?: string | null;
  current: boolean; lastRefresh: string | null; status: AccountStatus | null;
};
export type AccountList = {
  accounts: CodexAccount[]; environment: string; authContext: string | null;
  currentCredentialVersion?: number | null;
  currentChatgpt: { email: string | null } | null;
  loginTask?: LoginTask | null; currentIdentity: AccountIdentity | null; switchError: string | null; recoveryConflict: boolean;
};
export type LoginTask = {
  id: string; state: "running" | "completed" | "cancelled" | "timedOut" | "failed";
  authorizationUrl: string | null; deviceCode: string | null; accountId: string | null; error: string | null;
};

export function getAccountQuota(account: CodexAccount | null | undefined) {
  const snapshot = account?.status;
  const status = snapshot && account && snapshot.accountId === account.id
    && snapshot.identity.userId === account.identity.userId && snapshot.identity.workspaceId === account.identity.workspaceId
    && snapshot.credentialVersion <= account.credentialVersion ? snapshot : null;
  const updatedAt = status?.updatedAt.limits;
  const cached = status?.data;
  const limits = cached && (updatedAt || cached.session || cached.weekly) ? { ...cached, updatedAt: updatedAt ?? cached.updatedAt } : null;
  return { status, limits };
}

export function getCurrentCodexQuota(list: AccountList | null, live: CodexLimitsResponse | null) {
  const current = list?.accounts.find((account) => account.current && account.authMode !== "apikey"
    && account.credentialVersion === list.currentCredentialVersion);
  const { status, limits: cached } = getAccountQuota(current);
  const matches = !list || !live?.authContext || live.authContext === list.authContext;
  const liveLimits = matches ? live : null;
  const newerLive = !!liveLimits && (!cached || Date.parse(liveLimits.updatedAt) > Date.parse(cached.updatedAt));
  const showLive = newerLive || !!liveLimits && liveLimits.updatedAt === cached?.updatedAt;
  return { status, limits: showLive ? liveLimits : cached, newerLive, showLive };
}

export const listCodexAccounts = () => invoke<AccountList>("list_codex_accounts");
export const importCurrentCodexAccount = () => invoke<string>("import_current_codex_account");
export const fetchCodexAccountStatus = (accountId: string, reuseRecent: boolean) =>
  invoke<AccountStatus>("fetch_codex_account_status", reuseRecent ? { accountId, reuseRecent } : { accountId });
export const switchCodexAccount = (accountId: string, expectedAuthContext: string) => invoke<{ verified: boolean; restartRequired: boolean; authContext: string }>("switch_codex_account", { accountId, expectedAuthContext });
export const removeCodexAccount = (accountId: string) => invoke<void>("remove_codex_account", { accountId });
export const startCodexAccountLogin = (deviceAuth: boolean, accountId: string | null = null) => invoke<LoginTask>("start_codex_account_login", { deviceAuth, accountId });
export const getCodexAccountLogin = (taskId: string) => invoke<LoginTask>("get_codex_account_login", { taskId });
export const cancelCodexAccountLogin = (taskId: string) => invoke<void>("cancel_codex_account_login", { taskId });
export const currentCodexAuthContext = () => invoke<string>("current_codex_auth_context");

export const addCodexApiKey = (name: string, apiKey: string, baseUrl: string) => invoke<string>("add_codex_api_key", { name, apiKey, baseUrl });
