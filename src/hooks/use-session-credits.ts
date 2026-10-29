import { useEffect, useRef, useState } from "react";
import { fetchSessionCredits, sessionCreditsIdentity, setSessionCreditsScope, type SessionCreditThread, type SessionCreditsRow } from "@/lib/api";

export function useSessionCredits(enabled: boolean, threads: SessionCreditThread[]) {
  const [scope] = useState(() => crypto.randomUUID());
  const revision = useRef(0);
  const identity = useRef<string | null>(null);
  const forceNext = useRef(false);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    rows: Record<string, SessionCreditsRow>; loading: boolean; error: string | null;
  }>({ rows: {}, loading: false, error: null });
  const unique = new Map<string, number>();
  for (const thread of threads) unique.set(thread.threadId, Math.max(unique.get(thread.threadId) ?? 0, thread.modifiedAtMs));
  const key = JSON.stringify([...unique].sort(([a], [b]) => a.localeCompare(b)));

  useEffect(() => {
    const generation = ++revision.current;
    const requested = (JSON.parse(key) as [string, number][]).map(([threadId, modifiedAtMs]) => ({ threadId, modifiedAtMs }));
    const active = enabled && requested.length > 0;
    let current = true;
    const force = forceNext.current;
    forceNext.current = false;
    if (!active) {
      identity.current = null;
      setState({ rows: {}, loading: false, error: null });
      return;
    }
    const valid = () => current && revision.current === generation;
    void (async () => {
      await setSessionCreditsScope(scope, generation, active);
      if (!active || !valid()) return;
      setState((previous) => ({ ...previous, loading: true, error: null }));
      const account = await sessionCreditsIdentity();
      if (!valid()) return;
      if (identity.current !== account) {
        identity.current = account;
        setState({ rows: {}, loading: true, error: null });
      }
      for (let offset = 0; offset < requested.length; offset += 1_000) {
        const batch = requested.slice(offset, offset + 1_000);
        for (const cacheOnly of [true, false]) {
          if (!valid()) return;
          const result = await fetchSessionCredits(batch, force, cacheOnly, scope, generation);
          if (!valid()) return;
          if (result.identity !== account) {
            identity.current = null;
            setState({ rows: {}, loading: false, error: result.requestStatus ?? "identityChanged" });
            return;
          }
          setState((previous) => ({
            rows: { ...previous.rows, ...Object.fromEntries(result.rows.map((row) => [row.threadId, row])) },
            loading: true, error: result.requestStatus,
          }));
        }
      }
      if (valid()) setState((previous) => ({ ...previous, loading: false }));
    })().catch((error) => {
      if (!valid()) return;
      const status = typeof error === "string" && ["chatgptLoginRequired", "identityUnavailable"].includes(error) ? error : "loadFailed";
      if (status !== "loadFailed") identity.current = null;
      setState((previous) => ({
        rows: status === "loadFailed" ? Object.fromEntries(Object.entries(previous.rows).map(([id, row]) => [id, { ...row, stale: true }])) : {},
        loading: false, error: status,
      }));
    });
    return () => {
      current = false;
      void setSessionCreditsScope(scope, ++revision.current, false).catch(() => {});
    };
  }, [enabled, key, reload, scope]);

  useEffect(() => {
    if (!enabled) return;
    const revalidate = () => { if (document.visibilityState !== "hidden") setReload((value) => value + 1); };
    window.addEventListener("focus", revalidate);
    window.addEventListener("session-credits-revalidate", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("session-credits-revalidate", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [enabled]);

  return {
    rows: enabled ? state.rows : {}, loading: enabled && state.loading, error: enabled ? state.error : null,
    refresh: () => { forceNext.current = true; setReload((value) => value + 1); },
  };
}
