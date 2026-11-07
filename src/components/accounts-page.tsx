import { useEffect, useEffectEvent, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Check, Ellipsis, Info, Plus, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./accounts-page.css";
import { Button } from "@/components/ui/button";
import { openUrl } from "@/lib/api";
import { cancelCodexAccountLogin, fetchCodexAccountStatus, getCodexAccountLogin, importCurrentCodexAccount, listCodexAccounts, removeCodexAccount, startCodexAccountLogin, switchCodexAccount, type AccountList, type CodexAccount, type LoginTask } from "@/lib/codex-accounts";

export function AccountsPage() {
  const { t, i18n } = useTranslation();
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
  const locale = i18n.language;
  const relativeUpdate = (at: string | undefined) => {
    if (!at) return t("accounts.not_updated");
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000));
    if (minutes < 1) return t("accounts.just_updated");
    const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(minutes / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1)), unit);
  };
  const resetTime = (at: string | null) => {
    if (!at) return t("limits.reset_unavailable");
    let minutes = Math.ceil((Date.parse(at) - Date.now()) / 60_000);
    if (minutes <= 0) return t("limits.resetting_soon");
    const parts: string[] = [];
    for (const [unit, size] of [["day", 1440], ["hour", 60], ["minute", 1]] as const) {
      const value = Math.floor(minutes / size);
      if (value) parts.push(new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short" }).format(value));
      minutes %= size;
      if (parts.length === 2) break;
    }
    return t("accounts.reset_in", { time: parts.join(" ") });
  };
  return <section className="accounts-page space-y-4" aria-label={t("common.accounts")}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{t("common.accounts")}</h1><p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t("accounts.description")}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!!busy || loginRunning} onClick={() => void login(false)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("accounts.add")}</Button>
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void run("import", importCurrentCodexAccount)}>{t("accounts.import")}</Button>
        <Button size="sm" variant="secondary" disabled={!list?.accounts.length || refreshing.size > 0} onClick={() => void refreshAll()}><RefreshCw className={`h-3.5 w-3.5${refreshing.size > 0 ? " animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />{t("accounts.refresh_all")}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="secondary">{t("accounts.more")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem disabled={!!busy || loginRunning} onSelect={() => void login(true)}>{t("accounts.device_login")}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <div className="accounts-context"><ShieldCheck aria-hidden="true" /><div>{t("accounts.storage_notice")} <details className="accounts-environment"><summary>{t("accounts.environment")} <span className="font-mono">{list?.environment.split(/[/\\]/).at(-1)}</span></summary><p className="font-mono break-all">{list?.environment}</p></details></div></div>
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
    <div className="accounts-grid">
      {list?.accounts.map((account) => {
        const status = account.status;
        const data = status?.data;
        const free = data?.membershipLevel?.toLowerCase() === "free";
        const windows = free
          ? [{ name: "accounts.window_monthly", window: data.weekly ?? data.session }]
          : [{ name: "accounts.window_5hour", window: data?.session }, { name: "accounts.window_weekly", window: data?.weekly }];
        const partStale = (part: string) => !!status && (status.needsLogin || !!status.errors[part] || !!status.updatedAt[part] && Date.now() - Date.parse(status.updatedAt[part]) > 10 * 60_000);
        const limitsStale = partStale("limits");
        const subscriptionStale = partStale("subscription");
        const resetStale = partStale("resetCredits");
        const stale = limitsStale || subscriptionStale || resetStale || Object.keys(status?.errors ?? {}).length > 0;
        const updatedAt = Object.values(status?.updatedAt ?? {}).sort()[0];
        const switchAccount = () => void run(account.id, async () => { const result = await switchCodexAccount(account.id, list.authContext!); if (result.verified && result.restartRequired) setNotice(t("accounts.restart_required")); });
        const switchDisabled = !!busy || !!list.switchError || !list.authContext || account.current;
        return <article key={account.id} data-account-id={account.id} aria-current={account.current ? "true" : undefined} className="account-card">
          <header>
            <div className="account-identity"><h2>{account.email ?? account.identity.userId}</h2>{account.current ? <span className="account-current"><Check aria-hidden="true" />{t("accounts.current")}</span> : null}</div>
            <p className="account-workspace">{data?.workspaceName ?? account.identity.workspaceId}</p>
          </header>
          <div className="account-membership">
            <span className="account-plan">{data?.membershipLevel ?? t("accounts.unknown")}</span>
            <span className={!subscriptionStale && !free && data?.subscriptionActive ? "account-active" : undefined}>
              {!subscriptionStale && !free && data?.subscriptionActive ? <span className="account-dot" /> : null}
              {t(subscriptionStale ? "accounts.subscription_pending" : free ? "accounts.not_subscribed" : data?.subscriptionActive == null ? "accounts.unknown" : data.subscriptionActive ? "accounts.active" : "accounts.inactive")}
            </span>
            {free ? <span>· {t("accounts.free_quota")}</span> : <>
              {data?.subscriptionExpiresAt ? <span>{t("accounts.expires_on", { date: new Date(data.subscriptionExpiresAt).toLocaleDateString(locale, { month: "2-digit", day: "2-digit" }) })}{subscriptionStale ? ` · ${t("accounts.last_data")}` : ""}</span> : null}
              {!subscriptionStale && data?.subscriptionWillRenew != null ? <span>· {t(data.subscriptionWillRenew ? "accounts.auto_renew" : "accounts.no_renew")}</span> : null}
            </>}
          </div>
          <div className={`account-quotas${free ? " account-quotas-free" : ""}`}>
            {windows.map(({ name, window }) => {
              const remaining = window ? Math.max(0, Math.min(100, Math.round(window.remainingPercent))) : null;
              const low = !limitsStale && !!window && window.remainingPercent < 30;
              return <section key={name} aria-label={t(name)} className={limitsStale ? "account-quota-stale" : low ? "account-quota-low" : undefined}>
                <div className="account-quota-name">{t(name)}{limitsStale ? ` · ${t("accounts.last_data")}` : low ? ` · ${t("accounts.low_quota")}` : ""}</div>
                <div className="account-amount"><span className="account-number">{remaining ?? "—"}{remaining != null ? <small>%</small> : null}</span><span className="account-remaining">{remaining != null ? t("limits.remaining") : t("accounts.unknown")}</span></div>
                <div className="account-meter" role="meter" aria-label={t(name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining ?? undefined} aria-valuetext={remaining == null ? t("accounts.unknown") : `${remaining}% ${t("limits.remaining")}`}><span style={{ width: `${remaining ?? 0}%` }} /></div>
                <p className="account-reset">{limitsStale ? t("accounts.reset_pending") : resetTime(window?.resetsAt ?? null)}</p>
              </section>;
            })}
          </div>
          <dl className="account-resources">
            <div><dt>{t(limitsStale ? "accounts.last_balance" : "accounts.credits")}</dt><dd>{data?.credits ? data.credits.unlimited ? t("accounts.unlimited") : data.credits.balance != null ? new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).format(Number(data.credits.balance)) : t("accounts.unknown") : t("accounts.unknown")}</dd></div>
            <div><dt>{t(resetStale ? "accounts.last_reset_credits" : "accounts.reset_credits")}</dt><dd>{data?.resetCreditsAvailableCount ?? t("accounts.unknown")} <small>{data?.resetCreditsAvailableCount != null ? t(resetStale ? "accounts.reset_count" : "accounts.reset_available") : ""}</small></dd></div>
          </dl>
          {status?.needsLogin || stale ? <p role="status" className="account-warning"><TriangleAlert aria-hidden="true" />{t(status?.needsLogin ? "accounts.needs_login" : "accounts.stale")}{Object.keys(status?.errors ?? {}).length ? ` · ${Object.keys(status!.errors).map((part) => t(`accounts.part_${part}`)).join(" / ")}` : ""}</p> : null}
          <footer className="account-footer">
            <details className="account-details">
              <summary>{refreshing.has(account.id) ? t("accounts.refreshing") : relativeUpdate(updatedAt)} · {t("accounts.data_details")}</summary>
              <div className="account-detail-body">
                {data ? <p>{t("accounts.data_source")} · {data.source}</p> : null}
                {data?.subscriptionActive != null ? <p>{t("accounts.subscription")}{subscriptionStale ? ` · ${t("accounts.last_data")}` : ""} · {t(data.subscriptionActive ? "accounts.active" : "accounts.inactive")}</p> : null}
                {data?.subscriptionWillRenew != null ? <p>{t("accounts.renews")}{subscriptionStale ? ` · ${t("accounts.last_data")}` : ""} · {t(data.subscriptionWillRenew ? "accounts.yes" : "accounts.no")}</p> : null}
                {data?.subscriptionExpiresAt ? <p>{t("accounts.expires")} · {new Date(data.subscriptionExpiresAt).toLocaleString(locale)}</p> : null}
                {Object.entries(status?.updatedAt ?? {}).map(([part, at]) => <p key={part}>{t(`accounts.part_${part}`)} · {new Date(at).toLocaleString(locale)}</p>)}
                {data?.resetCredits?.map((credit) => <p key={credit.id}>{t("accounts.reset_credit_expiry", { time: credit.expiresAt ? new Date(credit.expiresAt).toLocaleString(locale) : t("accounts.unknown") })}</p>)}
                {Object.entries(status?.errors ?? {}).map(([part, code]) => <p key={part} className="text-error">{t(`accounts.part_${part}`)}: {message(code)}</p>)}
              </div>
            </details>
            <div className="account-actions">
              <Button size="sm" variant="ghost" className="account-icon-button" aria-label={t("accounts.refresh")} title={t("accounts.refresh")} aria-busy={refreshing.has(account.id)} disabled={refreshing.has(account.id)} onClick={() => void refresh(account)}><RefreshCw className={`h-3.5 w-3.5${refreshing.has(account.id) ? " animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" /></Button>
              {status?.needsLogin ? <Button size="sm" variant="secondary" disabled={!!busy || loginRunning} onClick={() => void login(false, account.id)}>{t("accounts.relogin")}</Button> : <Button size="sm" variant={account.current ? "secondary" : "primary"} disabled={switchDisabled} onClick={switchAccount}>{t(account.current ? "accounts.current_account" : "accounts.switch")}</Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="account-icon-button" aria-label={t("accounts.more")} title={t("accounts.more")}><Ellipsis className="h-3.5 w-3.5" aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {status?.needsLogin ? <DropdownMenuItem disabled={switchDisabled} onSelect={switchAccount}>{t("accounts.switch")}</DropdownMenuItem> : <DropdownMenuItem disabled={!!busy || loginRunning} onSelect={() => void login(false, account.id)}>{t("accounts.relogin")}</DropdownMenuItem>}
                  <DropdownMenuItem className="text-error" disabled={!!busy} onSelect={() => { if (window.confirm(t(account.current ? "accounts.remove_current_confirm" : "accounts.remove_confirm"))) void run(account.id, () => removeCodexAccount(account.id)); }}>{t("accounts.remove")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </footer>
        </article>;
      })}
    </div>
    <p className="accounts-context"><Info aria-hidden="true" /><span>{t("accounts.history_scope")}</span></p>
  </section>;
}
