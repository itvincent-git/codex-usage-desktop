import { useEffect, useEffectEvent } from "react";
import { CodexSidebarLimits, type CodexSidebarLimitsProps } from "@/components/codex-limits-card";
import { accountVersionKey, type CodexAccounts } from "@/hooks/use-codex-accounts";
import type { CodexAccount } from "@/lib/codex-accounts";

type QuotaAccount = { id: string; name: string; saved: CodexAccount | null; current: boolean };

export function CodexSidebarAccounts({ accounts, selectedId, onSelect, ...live }: CodexSidebarLimitsProps & {
  accounts: CodexAccounts;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { list, listError, refresh, refreshing, refreshError } = accounts;
  const pages: QuotaAccount[] = (list?.accounts ?? [])
    .filter((account) => account.authMode !== "apikey")
    .map((account) => ({ id: account.id, name: account.email ?? account.identity.userId, saved: account, current: account.current }));
  const currentIndex = pages.findIndex((page) => page.current);
  if (currentIndex > 0) pages.unshift(pages.splice(currentIndex, 1)[0]);
  if (currentIndex < 0 && list?.currentChatgpt) {
    const identity = list.currentIdentity;
    pages.unshift({
      id: `current:${JSON.stringify(identity ?? list.authContext)}`,
      name: list.currentChatgpt.email ?? identity?.userId ?? "ChatGPT",
      saved: null,
      current: true,
    });
  }

  const selectedIndex = pages.findIndex((page) => page.id === selectedId);
  useEffect(() => {
    if (selectedId && selectedIndex < 0) onSelect(null);
  }, [selectedId, selectedIndex, onSelect]);
  const index = Math.max(0, selectedIndex);
  const page = pages[index];
  const saved = page?.saved && (!page.current || page.saved.credentialVersion === list?.currentCredentialVersion) ? page.saved : null;
  const cachedStatus = saved?.status;
  const status = cachedStatus && saved && cachedStatus.accountId === saved.id
    && cachedStatus.identity.userId === saved.identity.userId && cachedStatus.identity.workspaceId === saved.identity.workspaceId
    && cachedStatus.credentialVersion <= saved.credentialVersion ? cachedStatus : null;
  const failure = saved && refreshError(saved);
  const needsQuota = !!saved && !page?.current && !failure && (!status || status.credentialVersion < saved.credentialVersion);
  const versionKey = saved && accountVersionKey(saved);
  const fetchMissing = useEffectEvent(() => { if (saved && needsQuota) void refresh(saved, true); });
  useEffect(() => { fetchMissing(); }, [needsQuota, versionKey]);

  const account = page && {
    name: page.name,
    current: page.current,
    canSwitch: pages.length > 1,
    onPageChange: (step: number) => onSelect(pages[(index + step + pages.length) % pages.length].id),
  };
  const error = failure || status?.errors.credentials || status?.errors.limits || (needsQuota ? listError : null);
  const updatedAt = status?.updatedAt.limits;
  const cached = status?.data;
  const limits = cached && (updatedAt || cached.session || cached.weekly) ? { ...cached, updatedAt: updatedAt ?? cached.updatedAt } : null;
  if (!saved || page?.current) {
    const matches = !list || !live.limits?.authContext || live.limits.authContext === list.authContext;
    const liveLimits = matches ? live.limits : null;
    const newerLive = !!liveLimits && (!limits || Date.parse(liveLimits.updatedAt) > Date.parse(limits.updatedAt));
    const showLive = newerLive || !!liveLimits && liveLimits.updatedAt === limits?.updatedAt;
    return <CodexSidebarLimits
      {...live}
      account={account}
      limits={showLive ? liveLimits : limits}
      error={newerLive ? live.error : error || (showLive || !status ? live.error : null)}
      isLimitsRefreshing={live.isLimitsRefreshing || !!versionKey && refreshing.has(versionKey)}
    />;
  }

  return <CodexSidebarLimits
    compact={live.compact}
    account={account}
    limits={limits}
    error={error}
    isLimitsRefreshing={!!versionKey && (refreshing.has(versionKey) || needsQuota && !listError)}
    onRefreshLimits={() => void refresh(saved)}
  />;
}
