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
  current: boolean; lastRefresh: string | null; status: AccountStatus | null;
};
export type AccountList = {
  accounts: CodexAccount[]; environment: string; authContext: string | null;
  loginTask?: LoginTask | null; currentIdentity: AccountIdentity | null; switchError: string | null; recoveryConflict: boolean;
};
export type LoginTask = {
  id: string; state: "running" | "completed" | "cancelled" | "timedOut" | "failed";
  authorizationUrl: string | null; deviceCode: string | null; accountId: string | null; error: string | null;
};

export const listCodexAccounts = () => invoke<AccountList>("list_codex_accounts");
export const importCurrentCodexAccount = () => invoke<string>("import_current_codex_account");
export const fetchCodexAccountStatus = (accountId: string) => invoke<AccountStatus>("fetch_codex_account_status", { accountId });
export const switchCodexAccount = (accountId: string, expectedAuthContext: string) => invoke<{ verified: boolean; restartRequired: boolean; authContext: string }>("switch_codex_account", { accountId, expectedAuthContext });
export const removeCodexAccount = (accountId: string) => invoke<void>("remove_codex_account", { accountId });
export const startCodexAccountLogin = (deviceAuth: boolean, accountId: string | null = null) => invoke<LoginTask>("start_codex_account_login", { deviceAuth, accountId });
export const getCodexAccountLogin = (taskId: string) => invoke<LoginTask>("get_codex_account_login", { taskId });
export const cancelCodexAccountLogin = (taskId: string) => invoke<void>("cancel_codex_account_login", { taskId });
export const currentCodexAuthContext = () => invoke<string>("current_codex_auth_context");
