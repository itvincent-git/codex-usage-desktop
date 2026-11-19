import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchCodexAccountStatus, listCodexAccounts, type AccountList, type CodexAccount } from "@/lib/codex-accounts";

export function accountVersionKey(account: CodexAccount) {
  return JSON.stringify([account.id, account.identity.userId, account.identity.workspaceId, account.credentialVersion]);
}

export function useCodexAccounts() {
  const [list, setList] = useState<AccountList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [refreshErrors, setRefreshErrors] = useState<Record<string, { message: string; updatedAt?: string }>>({});
  const generation = useRef(0);
  const inFlight = useRef(new Map<string, Promise<void>>());

  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await listCodexAccounts();
      if (request !== generation.current) return;
      setList(result);
      setListError(null);
    } catch (error) {
      if (request === generation.current) setListError(String(error));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const subscriptions = ["codex-accounts-changed", "codex-account-statuses-updated"].map((event) =>
      listen(event, () => { if (active) return reload(); }),
    );
    void Promise.allSettled(subscriptions).then(() => { if (active) void reload(); });
    return () => {
      active = false;
      generation.current++;
      for (const stop of subscriptions) void stop.then((unlisten) => unlisten(), () => {});
    };
  }, [reload]);

  const refresh = useCallback((account: CodexAccount) => {
    const key = accountVersionKey(account);
    const pending = inFlight.current.get(key);
    if (pending) return pending;
    const request = (async () => {
      try {
        await fetchCodexAccountStatus(account.id);
        setRefreshErrors((errors) => {
          if (!errors[key]) return errors;
          const next = { ...errors };
          delete next[key];
          return next;
        });
      } catch (error) {
        setRefreshErrors((errors) => ({ ...errors, [key]: { message: String(error), updatedAt: account.status?.updatedAt.limits } }));
      } finally {
        // The native store validates identity and credential version before committing.
        // Read it back so an old command response cannot replace a newer snapshot.
        await reload();
        inFlight.current.delete(key);
        setRefreshing(new Set(inFlight.current.keys()));
      }
    })();
    inFlight.current.set(key, request);
    setRefreshing(new Set(inFlight.current.keys()));
    return request;
  }, [reload]);

  const refreshError = (account: CodexAccount) => {
    const failure = refreshErrors[accountVersionKey(account)];
    return failure?.updatedAt === account.status?.updatedAt.limits ? failure?.message : undefined;
  };

  return { list, listError, reload, refresh, refreshing, refreshError };
}

export type CodexAccounts = ReturnType<typeof useCodexAccounts>;
