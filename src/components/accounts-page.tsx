import { useEffect, useEffectEvent, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openUrl } from "@/lib/api";
import { formatResetTime, hasSubscription } from "@/components/codex-limits-card";
import { cancelCodexAccountLogin, fetchCodexAccountStatus, getCodexAccountLogin, importCurrentCodexAccount, listCodexAccounts, removeCodexAccount, startCodexAccountLogin, switchCodexAccount, type AccountList, type CodexAccount, type LoginTask } from "@/lib/codex-accounts";

export function AccountsPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<AccountList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [task, setTask] = useState<LoginTask | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const message = (code: string) => t(`accounts.errors.${code.split(":")[0]}`, { defaultValue: t("accounts.errors.generic") });

  const reload = useEffectEvent(async () => {
    const request = ++generation.current;
    const result = await listCodexAccounts();
    if (mounted.current && request === generation.current) { setList(result); if (result.loginTask) setTask(result.loginTask); }
  });
  useEffect(() => {
    mounted.current = true;
    void reload().catch((e: unknown) => setError(String(e)));
    const stops = ["codex-accounts-changed", "codex-account-statuses-updated"].map((event) => listen(event, () => { void reload().catch((e: unknown) => setError(String(e))); }));
    return () => { mounted.current = false; generation.current++; for (const stop of stops) void stop.then((unlisten) => unlisten()); };
  }, []);

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key); setError(null); setNotice(null);
    try { await action(); await reload(); } catch (e) { setError(String(e)); await reload().catch(() => {}); }
    finally { if (mounted.current) setBusy(null); }
  };
  const refresh = async (account: CodexAccount) => {
    if (inFlight.current.has(account.id)) return;
    inFlight.current.add(account.id);
    setRefreshing(new Set(inFlight.current));
    try {
      const status = await fetchCodexAccountStatus(account.id);
      if (!mounted.current) return;
      setList((previous) => previous ? { ...previous, accounts: previous.accounts.map((a) => a.id === status.accountId && a.identity.userId === status.identity.userId && a.identity.workspaceId === status.identity.workspaceId && status.credentialVersion >= a.credentialVersion ? { ...a, status, credentialVersion: status.credentialVersion } : a) } : previous);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { inFlight.current.delete(account.id); if (mounted.current) setRefreshing(new Set(inFlight.current)); }
  };
  const refreshAll = async () => {
    // Three workers also bound command submissions, independently of backend limits.
    const queue = [...(list?.accounts ?? [])];
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await refresh(queue.shift()!); }));
    await reload().catch((e: unknown) => setError(String(e)));
  };
  const missingAccounts = (list?.accounts ?? []).filter((account) => !account.status).map((account) => account.id).join("|");
  const refreshMissing = useEffectEvent(() => { for (const account of list?.accounts ?? []) if (!account.status) void refresh(account); });
  useEffect(() => { refreshMissing(); }, [missingAccounts]);
  const login = (device: boolean, id: string | null = null) => run("login", async () => { setTask(await startCodexAccountLogin(device, id)); });

  useEffect(() => {
    if (task?.state !== "running") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getCodexAccountLogin(task.id);
        if (!active) return;
        setTask(next);
        if (next.state === "completed") { setNotice(t("accounts.added")); await reload(); }
        if (next.state === "running") timer = setTimeout(() => void poll(), 750);
      } catch (e) { if (active) setError(String(e)); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [task?.id, task?.state, t]);

  const loginRunning = task?.state === "running";
  return <section className="space-y-5" aria-label={t("common.accounts")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t("common.accounts")}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("accounts.description")}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!!busy || loginRunning} onClick={() => void login(false)}>{t("accounts.add")}</Button>
        <Button variant="secondary" disabled={!!busy || loginRunning} onClick={() => void login(true)}>{t("accounts.device_login")}</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => void run("import", importCurrentCodexAccount)}>{t("accounts.import")}</Button>
        <Button variant="secondary" disabled={!list?.accounts.length || refreshing.size > 0} onClick={() => void refreshAll()}>{t("accounts.refresh_all")}</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground break-all">{list?.environment}</p>
    <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t("accounts.storage_notice")}</p>
    {list?.switchError ? <p role="status" className="text-sm text-warning">{message(list.switchError)}</p> : null}
    {list?.recoveryConflict ? <p role="status" className="text-sm text-warning">{t("accounts.recovery_conflict")}</p> : null}
    {error ? <p role="alert" className="text-sm text-error">{message(error)}</p> : null}
    {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
    {task ? <div className="space-y-2 rounded-xl border border-border p-4" aria-live="polite">
      <p>{t(`accounts.login_${task.state}`)}</p>
      {task.authorizationUrl && loginRunning ? <Button variant="secondary" onClick={() => void openUrl(task.authorizationUrl!)}>{t("accounts.open_authorization")}</Button> : null}
      {task.deviceCode && loginRunning ? <p className="font-mono text-lg select-text">{task.deviceCode}</p> : null}
      {task.error ? <p role="alert">{message(task.error)}</p> : null}
      {loginRunning ? <Button variant="secondary" onClick={() => void run("cancel", async () => { await cancelCodexAccountLogin(task.id); setTask(await getCodexAccountLogin(task.id)); })}>{t("accounts.cancel")}</Button> : null}
    </div> : null}
    {list && list.accounts.length === 0 ? <p className="py-10 text-center text-muted-foreground">{t("accounts.empty")}</p> : null}
    <div className="grid items-start gap-4 content-lg:grid-cols-2">
      {list?.accounts.map((account) => {
        const status = account.status;
        const data = status?.data;
        const windows = data?.membershipLevel && !hasSubscription(data)
          ? [{ name: "limits.window_monthly", window: data.weekly ?? data.session }]
          : [{ name: "limits.window_5hour", window: data?.session }, { name: "limits.window_weekly", window: data?.weekly }];
        const stale = !!status && (Object.keys(status.errors).length > 0 || Object.values(status.updatedAt).some((at) => Date.now() - Date.parse(at) > 10 * 60_000));
        return <article key={account.id} data-account-id={account.id} className="space-y-4 rounded-xl border border-border bg-card p-5">
          <header><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold break-all">{account.email ?? account.identity.userId}</h2>{account.current ? <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{t("accounts.current")}</span> : null}</div>
            <p className="mt-1 text-sm text-muted-foreground">{data?.workspaceName ?? account.identity.workspaceId}</p>
          </header>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>{t("accounts.plan")}</dt><dd>{data?.membershipLevel ?? t("accounts.unknown")}</dd>
            <dt>{t("accounts.subscription")}</dt><dd>{data?.subscriptionActive == null ? t("accounts.unknown") : t(data.subscriptionActive ? "accounts.active" : "accounts.inactive")}</dd>
            <dt>{t("accounts.expires")}</dt><dd>{data?.subscriptionExpiresAt ? new Date(data.subscriptionExpiresAt).toLocaleString() : t("accounts.unknown")}</dd>
            <dt>{t("accounts.renews")}</dt><dd>{data?.subscriptionWillRenew == null ? t("accounts.unknown") : t(data.subscriptionWillRenew ? "accounts.yes" : "accounts.no")}</dd>
          </dl>
          {windows.map(({ name, window }) => <div key={name} className="text-sm">
            <div className="flex justify-between gap-2"><span>{t(name)}</span><span>{window ? `${Math.round(window.remainingPercent)}% ${t("limits.remaining")} · ${Math.round(window.usedPercent)}% ${t("limits.consumed")}` : t("accounts.unknown")}</span></div>
            {window ? <><progress className="mt-2 h-2 w-full accent-primary" max={100} value={window.usedPercent} aria-label={t(name)} /><p className="mt-1 text-xs text-muted-foreground">{formatResetTime(window.resetsAt, window.windowMinutes, t)}</p></> : null}
          </div>)}
          <dl className="grid grid-cols-2 gap-2 text-sm"><dt>{t("accounts.credits")}</dt><dd>{data?.credits ? data.credits.unlimited ? t("accounts.unlimited") : data.credits.balance ?? t("accounts.unknown") : t("accounts.unknown")}</dd><dt>{t("accounts.reset_credits")}</dt><dd>{data?.resetCreditsAvailableCount ?? t("accounts.unknown")}</dd></dl>
          {data?.resetCredits?.map((credit) => <p key={credit.id} className="text-xs text-muted-foreground">{t("accounts.reset_credit_expiry", { time: credit.expiresAt ? new Date(credit.expiresAt).toLocaleString() : t("accounts.unknown") })}</p>)}
          <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
            {refreshing.has(account.id) ? <p>{t("accounts.refreshing")}</p> : null}
            {stale ? <p className="text-warning">{t("accounts.stale")}</p> : null}
            {status?.needsLogin ? <p className="text-warning">{t("accounts.needs_login")}</p> : null}
            {Object.entries(status?.updatedAt ?? {}).map(([part, at]) => <p key={part}>{t(`accounts.part_${part}`)} · {new Date(at).toLocaleString()}</p>)}
            {Object.entries(status?.errors ?? {}).map(([part, code]) => <p key={part} className="text-error">{t(`accounts.part_${part}`)}: {message(code)}</p>)}
          </div>
          <footer className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={refreshing.has(account.id)} onClick={() => void refresh(account)}>{t("accounts.refresh")}</Button>
            <Button size="sm" disabled={!!busy || !!list.switchError || !list.authContext || account.current} onClick={() => void run(account.id, async () => { const result = await switchCodexAccount(account.id, list.authContext!); if (result.verified && result.restartRequired) setNotice(t("accounts.restart_required")); })}>{t("accounts.switch")}</Button>
            <Button size="sm" variant="secondary" disabled={!!busy || loginRunning} onClick={() => void login(false, account.id)}>{t("accounts.relogin")}</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { if (window.confirm(t(account.current ? "accounts.remove_current_confirm" : "accounts.remove_confirm"))) void run(account.id, () => removeCodexAccount(account.id)); }}>{t("accounts.remove")}</Button>
          </footer>
        </article>;
      })}
    </div>
    <p className="text-sm text-muted-foreground">{t("accounts.history_scope")}</p>
  </section>;
}
