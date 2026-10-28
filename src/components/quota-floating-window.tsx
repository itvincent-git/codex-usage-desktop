import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, GripHorizontal, Minus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchCodexLimits, type CodexLimitWindow, type CodexLimitsResponse, type UsageRefreshResponse } from "@/lib/api";

function QuotaRing({ quota, label, large = false, timeRemaining }: { quota: CodexLimitWindow | null; label: string; large?: boolean; timeRemaining?: number | null }) {
  const { t } = useTranslation();
  const remaining = quota && Number.isFinite(quota.remainingPercent) ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;
  const tone = remaining !== null && remaining <= 10 ? "text-error" : remaining !== null && remaining <= 65 ? "text-warning" : "text-primary";
  return (
    <div className={`relative shrink-0 ${large ? "h-[76px] w-[76px]" : "h-[60px] w-[60px]"}`}>
      {timeRemaining !== undefined && (
        <svg role="meter" aria-label={t("floating.time_remaining")} aria-valuenow={timeRemaining ?? undefined} aria-valuemin={0} aria-valuemax={100} viewBox="0 0 80 80" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90 text-cyan-500">
          <title>{t("floating.time_remaining")}: {timeRemaining === null ? "--" : `${Math.round(timeRemaining)}%`}</title>
          <circle cx="40" cy="40" r="38" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" />
          <circle cx="40" cy="40" r="38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength="100" strokeDasharray={`${timeRemaining ?? 0} 100`} opacity={timeRemaining !== null && timeRemaining > 0 ? 1 : 0} />
        </svg>
      )}
      <svg aria-hidden="true" viewBox="0 0 80 80" className={`h-full w-full -rotate-90 ${tone}`}>
        <circle cx="40" cy="40" r="33" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" />
        <circle cx="40" cy="40" r="33" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray={`${remaining ?? 0} 100`} />
      </svg>
      <div role="meter" aria-label={label} aria-valuenow={remaining ?? undefined} aria-valuemin={0} aria-valuemax={100} className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-semibold leading-none tracking-tight tabular-nums ${large ? "text-[21px]" : "text-[16px]"}`}>{remaining === null ? "--" : `${Math.round(remaining)}%`}</span>
        <span className={`mt-1 leading-none text-muted-foreground ${large ? "text-[9px]" : "text-[8px]"}`}>{t("limits.remaining")}</span>
      </div>
    </div>
  );
}

export function QuotaFloatingWindow() {
  const { t, i18n } = useTranslation();
  const [limits, setLimits] = useState<CodexLimitsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const modeInFlight = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  async function changeMode(next: boolean) {
    if (modeInFlight.current) return;
    modeInFlight.current = true;
    setResizing(true);
    try {
      await invoke("set_quota_collapsed", { collapsed: next });
      setCollapsed(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      modeInFlight.current = false;
      setResizing(false);
    }
  }

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNow(Date.now());
    setRefreshing(true);
    try {
      setLimits(await fetchCodexLimits());
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const subscriptions = [
      listen<CodexLimitsResponse>("codex-limits-updated", ({ payload }) => {
        setLimits(payload);
        setNow(Date.now());
        setError(null);
      }),
      listen<UsageRefreshResponse>("background-refresh-completed", ({ payload }) => {
        if (payload.limits) {
          setLimits(payload.limits);
          setNow(Date.now());
          setError(null);
        } else if (payload.limitsError) {
          setError(payload.limitsError);
        }
      }),
      listen("quota-window-shown", () => void refresh()),
    ];
    let disposed = false;
    async function refreshIfVisible() {
      if (await getCurrentWindow().isVisible() && !disposed) await refresh();
    }
    void Promise.all(subscriptions).then(() => refreshIfVisible()).catch((cause) => {
      if (!disposed) setError(String(cause));
    });
    const timer = window.setInterval(() => {
      void refreshIfVisible().catch((cause) => setError(String(cause)));
    }, 60_000);
    // localStorage changes in the main window also apply to this WebView.
    const syncLanguage = (event: StorageEvent) => {
      if (event.key === "language" && event.newValue) void i18n.changeLanguage(event.newValue);
    };
    window.addEventListener("storage", syncLanguage);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("storage", syncLanguage);
      subscriptions.forEach((subscription) => void subscription.then((unlisten) => unlisten()).catch(() => {}));
    };
  }, [refresh, i18n]);

  const formatTime = (value: string | null | undefined, date: boolean) => {
    if (!value || !Number.isFinite(Date.parse(value))) return "--";
    return new Date(value).toLocaleString(i18n.language, {
      ...(date ? { month: "2-digit", day: "2-digit" } as const : {}), hour: "2-digit", minute: "2-digit", hour12: false,
    });
  };

  const rows: Array<{ key: string; label: string; window: CodexLimitWindow | null }> = [
    { key: "session", label: t("limits.window_5hour"), window: limits?.session ?? null },
    { key: "weekly", label: limits?.weekly?.windowMinutes === 43_200 ? t("limits.window_monthly") : t("limits.window_weekly"), window: limits?.weekly ?? null },
  ];
  const resetTime = limits?.session?.resetsAt ? Date.parse(limits.session.resetsAt) : NaN;
  const timeRemaining = Number.isFinite(resetTime) ? Math.max(0, Math.min(100, (resetTime - now) / (5 * 60 * 60 * 1_000) * 100)) : null;

  const errorIndicator = error ? (
    <span role="alert" className="text-warning" title={error}>
      <AlertCircle className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{t("floating.refresh_failed")}</span>
    </span>
  ) : null;

  if (collapsed) {
    return (
      <main data-quota-mode="collapsed" className="flex h-screen select-none items-center justify-center p-1 text-foreground">
        <button
          type="button" aria-label={t("floating.expand")} disabled={resizing}
          title={t("floating.ball_hint")}
          className="relative flex h-20 w-20 touch-none cursor-grab items-center justify-center rounded-full border border-border/80 bg-surface shadow-sm active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragged.current = false;
            pointerStart.current = { x: event.screenX, y: event.screenY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = pointerStart.current;
            if (!start || dragged.current || Math.hypot(event.screenX - start.x, event.screenY - start.y) < 4) return;
            dragged.current = true;
            pointerStart.current = null;
            void getCurrentWindow().startDragging().catch((cause) => setError(String(cause)));
          }}
          onPointerUp={() => { pointerStart.current = null; }}
          onPointerCancel={() => { pointerStart.current = null; }}
          onClick={(event) => { if (event.detail === 0 || !dragged.current) void changeMode(false); }}
        >
          <QuotaRing quota={limits?.session ?? null} label={t("limits.window_5hour")} timeRemaining={timeRemaining} large />
          <span className="absolute right-0 top-0">{errorIndicator}</span>
        </button>
      </main>
    );
  }

  return (
    <main data-quota-mode="expanded" className="h-screen select-none p-1 text-foreground" aria-label={t("floating.title")}>
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm">
      <header data-tauri-drag-region className="flex h-8 shrink-0 cursor-move items-center gap-1.5 px-3" title={t("floating.drag")}>
        <GripHorizontal data-tauri-drag-region className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
        <span data-tauri-drag-region className="flex-1 text-[11px] font-medium text-muted-foreground">{t("floating.title")}</span>
        {errorIndicator}
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" aria-label={t("floating.collapse")} disabled={resizing} onClick={() => void changeMode(true)}>
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary" aria-label={t("limits.query_action")} disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" aria-label={t("common.close")} onClick={() => void getCurrentWindow().hide().catch((cause) => setError(String(cause)))}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 px-2 pb-2">
        {rows.map(({ key, label, window: quota }) => {
          return (
            <section key={key} data-quota-window={key} aria-label={label} className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-surface px-2 py-2">
              <h2 className="text-[11px] font-semibold leading-tight">{label}</h2>
              <QuotaRing quota={quota} label={label} timeRemaining={key === "session" ? timeRemaining : undefined} />
              <p className="max-w-full truncate text-[10px] font-medium tabular-nums text-muted-foreground" title={quota?.resetsAt ? new Date(quota.resetsAt).toLocaleString(i18n.language) : t("limits.no_window_returned")}>
                {quota ? t("floating.resets", { time: formatTime(quota.resetsAt, key !== "session") }) : "--"}
              </p>
            </section>
          );
        })}
      </div>
      </div>
    </main>
  );
}
