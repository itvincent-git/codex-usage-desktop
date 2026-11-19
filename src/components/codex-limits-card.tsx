import { ChevronLeft, ChevronRight, Clock3, ExternalLink, LoaderCircle, LogIn, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LatestResetButton } from "@/components/codex-reset-history";
import type { CodexLimitWindow, CodexLimitsResponse, CodexResetAnnouncement, CodexResetCredit, CodexWindowActivationStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type CodexLimitsCardProps = {
  limits: CodexLimitsResponse | null;
  isLimitsLoading?: boolean;
  limitsError?: string | null;
  isResetLoading?: boolean;
  resetError?: string | null;
  latestReset?: CodexResetAnnouncement | null;
  recentResets?: CodexResetAnnouncement[] | null;
  onOpenResetHistory?: () => void;
  onOpenResetCredits: () => void;
};

export type CodexSidebarLimitsProps = {
  compact?: boolean;
  account?: { name: string; current: boolean; canSwitch: boolean; onPageChange: (step: number) => void };
  limits: CodexLimitsResponse | null;
  error: string | null;
  isLimitsRefreshing?: boolean;
  isWindowActivating?: boolean;
  windowActivationStatus?: CodexWindowActivationStatus | null;
  windowActivationError?: string | null;
  onRefreshLimits?: () => void;
  onActivateWindow?: () => void;
  onManageAccounts?: () => void;
};

export const RECENT_RESET_OVERVIEW_DAYS = 30;

type LimitRowProps = {
  label: string;
  window: CodexLimitWindow | null;
};

function isOAuthLoginError(err: string | null): boolean {
  if (!err) return false;
  const lowercaseErr = err.toLowerCase();
  return (
    lowercaseErr.includes("chatgptloginrequired") ||
    lowercaseErr.includes("accountloginrequired") ||
    lowercaseErr.includes("no such file or directory") ||
    lowercaseErr.includes("failed to read codex auth") ||
    lowercaseErr.includes("contains no tokens") ||
    lowercaseErr.includes("contains no access token") ||
    lowercaseErr.includes("unauthorized") ||
    lowercaseErr.includes("401")
  );
}

function quotaErrorKey(error: string): string {
  if (error.includes("codexAuthUnreadable")) return "recovery.auth_unreadable";
  if (error.includes("codexAuthInvalid")) return "recovery.auth_invalid";
  if (error.includes("chatgptQuotaNotApplicable")) return "recovery.quota_not_applicable";
  if (/\b403\b/.test(error)) return "recovery.quota_forbidden";
  if (error.includes("accountRateLimited") || /\b429\b/.test(error)) return "recovery.quota_rate_limited";
  if (/\b5\d\d\b/.test(error)) return "recovery.quota_service_error";
  if (/timed?\s*out|timeout/i.test(error)) return "recovery.quota_timeout";
  return "limits.unavailable_reason";
}

export function hasSubscription(limits: CodexLimitsResponse | null | undefined): boolean {
  if (!limits || !limits.membershipLevel) return false;
  const level = limits.membershipLevel.toLowerCase();
  return ["plus", "pro", "prolite", "promax", "team", "business", "enterprise", "self_serve_business_prolite", "self_serve_business_usage_based"].includes(level);
}

export function CodexLimitsCard({ limits, isLimitsLoading = false, limitsError = null, isResetLoading = false, resetError = null, latestReset, recentResets, onOpenResetHistory, onOpenResetCredits }: CodexLimitsCardProps) {
  return (
    <Card className="h-full flex flex-col rounded-lg">
      <CardContent className="p-3 sm:p-4">
        <ResetArea
          isLimitsLoading={isLimitsLoading}
          limitsError={limitsError}
          isResetLoading={isResetLoading}
          resetError={resetError}
          latestReset={latestReset}
          recentResets={recentResets}
          resetCreditsAvailableCount={limits?.resetCreditsAvailableCount}
          resetCredits={limits?.resetCredits}
          onOpenResetHistory={onOpenResetHistory}
          onOpenResetCredits={onOpenResetCredits}
        />
      </CardContent>
    </Card>
  );
}

export function CodexSidebarLimits({ compact = false, account, limits, error, isLimitsRefreshing = false, isWindowActivating = false, windowActivationStatus, windowActivationError, onRefreshLimits, onActivateWindow, onManageAccounts }: CodexSidebarLimitsProps) {
  const { t } = useTranslation();
  const savedAccount = account?.current === false;
  const hasShortWindows = hasSubscription(limits) || (savedAccount && (limits?.session?.windowMinutes === 300 || limits?.weekly?.windowMinutes === 10080));
  const errorLabel = error && savedAccount ? t(`accounts.errors.${error.split(":")[0]}`, { defaultValue: t("accounts.errors.generic") }) : null;
  const [, refreshCountdown] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const timer = window.setInterval(() => refreshCountdown((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="sidebar-limits space-y-3" aria-label={t("limits.sidebar_title")}>
      {!compact ? <div className="flex min-w-0 items-center justify-between gap-1 text-xs">
        <h2 className="font-semibold">{t("limits.sidebar_title")}</h2>
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground" title={limits ? t("limits.updated", { time: dayjs(limits.updatedAt).format("HH:mm") }) : undefined}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", error ? "bg-warning" : limits ? "bg-success" : "bg-muted-foreground")} />
          <span className="truncate">{t(isLimitsRefreshing ? "common.loading" : error ? (limits ? "limits.refresh_failed" : "limits.unavailable") : limits ? "limits.sidebar_updated" : "limits.not_fetched")}</span>
        </span>
      </div> : null}
      {account ? <div className={cn("relative flex min-w-0", compact ? "items-start gap-0.5" : "items-center gap-1", compact && account.current && "pb-4")}>
        <div aria-live="polite" aria-atomic="true" className={cn("min-w-0 flex-1 text-xs", compact ? "text-center" : "flex items-center gap-1")}>
          <span className={cn("block min-w-0 truncate font-medium", compact && "text-[10px] leading-6")} title={account.name}>{account.name}</span>
          {account.current ? <span className={cn("shrink-0 rounded bg-primary/10 px-1 text-primary", compact && "absolute inset-x-0 bottom-0 mx-auto w-fit")} title={t("limits.current_account")}>{t("limits.current_account")}</span> : null}
        </div>
        {account.canSwitch ? <div className={cn("flex shrink-0", compact ? "gap-0.5" : "gap-1")} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          account.onPageChange(event.key === "ArrowLeft" ? -1 : 1);
        }}>
          <Button type="button" size="icon" variant="secondary" className={cn("h-6 hover:translate-y-0", compact ? "w-4" : "w-6")} aria-label={t("limits.previous_account")} title={t("limits.previous_account")} onClick={() => account.onPageChange(-1)}><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button type="button" size="icon" variant="secondary" className={cn("h-6 hover:translate-y-0", compact ? "w-4" : "w-6")} aria-label={t("limits.next_account")} title={t("limits.next_account")} onClick={() => account.onPageChange(1)}><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </div> : null}
      </div> : null}
      {!compact && onRefreshLimits ? (
        <LimitActions
          window={limits?.session ?? null}
          showActivation={hasSubscription(limits)}
          isRefreshing={isLimitsRefreshing}
          isActivating={isWindowActivating}
          activationStatus={windowActivationStatus}
          activationError={windowActivationError}
          onRefresh={onRefreshLimits}
          onActivate={onActivateWindow}
        />
      ) : null}
      {error && !limits ? (
        compact ? <p className="break-words text-center text-xs text-warning-foreground" title={errorLabel ?? error}>{t("limits.unavailable")}</p> : !savedAccount && isOAuthLoginError(error) ? (
          <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-warning-foreground font-semibold">
                <LogIn className="h-4.5 w-4.5" />
                <span>{t("limits.not_logged_in")}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                {t("accounts.empty_login_hint")}
              </p>
              {onManageAccounts ? <Button variant="secondary" size="sm" className="w-full whitespace-normal" onClick={onManageAccounts}>{t("limits.manage_accounts")}</Button> : null}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer rounded py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t("limits.cli_login")}</summary>
                <p className="mt-2 leading-relaxed">{t("limits.login_instruction")}</p>
                <code className="mt-2 block break-all rounded border border-border bg-muted p-2 text-foreground select-all">codex auth login</code>
              </details>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
            {errorLabel ?? t(quotaErrorKey(error))}
          </div>
        )

      ) : !limits && isLimitsRefreshing ? (
        <p role="status" className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />{t("common.loading")}</p>
      ) : (
        <div className="space-y-3">
          {hasShortWindows ? (
            <>
              <LimitRow label="5 hour" window={limits?.session ?? null} now={now} compact={compact} />
              <LimitRow label="Weekly" window={limits?.weekly ?? null} now={now} compact={compact} />
            </>
          ) : (
            <LimitRow label="monthly" window={limits?.weekly ?? limits?.session ?? null} now={now} compact={compact} />
          )}
        </div>
      )}
      {error && limits ? (
        <div role="status" className={cn("break-words text-muted-foreground", compact ? "text-center text-xs" : "space-y-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-2 text-xs")}>
          {compact ? <p className="text-warning-foreground">{t("limits.refresh_failed")}</p> : <>
            <p>{t("limits.cached_data")}</p>
            <p>{errorLabel ?? t(isOAuthLoginError(error) ? "limits.login_instruction" : quotaErrorKey(error))}</p>
            {!savedAccount && isOAuthLoginError(error) ? <code className="block select-all">codex auth login</code> : null}
          </>}
          <p title={t("limits.updated", { time: dayjs(limits.updatedAt).format("YYYY-MM-DD HH:mm") })}>{t("limits.last_success", { time: dayjs(limits.updatedAt).format("MM/DD HH:mm") })}</p>
        </div>
      ) : null}
    </section>
  );
}

function LimitActions({
  window,
  showActivation,
  isRefreshing,
  isActivating,
  activationStatus,
  activationError,
  onRefresh,
  onActivate,
}: {
  window: CodexLimitWindow | null;
  showActivation: boolean;
  isRefreshing: boolean;
  isActivating: boolean;
  activationStatus?: CodexWindowActivationStatus | null;
  activationError?: string | null;
  onRefresh: () => void;
  onActivate?: () => void;
}) {
  const { t } = useTranslation();
  const canActivate = window !== null && window.usedPercent <= 0;
  const busy = isRefreshing || isActivating;
  const activationAlreadyRequested = activationStatus === "started" || activationStatus === "recentlyRequested";
  const statusText = activationError
    ? activationError
    : activationStatus
      ? t(`limits.activate_status_${activationStatus}`)
      : t(showActivation ? (canActivate ? "limits.activate_ready" : "limits.activate_active") : "limits.query_desc");

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="secondary" className="h-8 min-w-0 flex-1 gap-1 px-1.5 text-xs" aria-label={t("limits.query_action")} title={t("limits.query_desc")} disabled={busy} onClick={onRefresh}>
          {isRefreshing ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" /> : <RefreshCw className="h-3 w-3 shrink-0" />}
          <span className="truncate">{t("limits.query_action")}</span>
        </Button>
        {showActivation && onActivate ? (
          <Button type="button" size="sm" className="h-8 min-w-0 flex-1 gap-1 px-1.5 text-xs" aria-label={t(isActivating ? "limits.activating_action" : "limits.activate_action")} title={statusText} disabled={busy || !canActivate || activationAlreadyRequested} onClick={onActivate}>
            {isActivating ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" /> : <Play className="h-3 w-3 shrink-0" />}
            <span className="truncate">{t(isActivating ? "limits.activating_action" : "limits.sidebar_activate")}</span>
          </Button>
        ) : null}
      </div>
      {activationStatus || activationError ? <p role="status" className={cn("text-xs leading-normal", activationError ? "text-error-foreground" : "text-muted-foreground")}>{statusText}</p> : null}
    </div>
  );
}

function ResetArea({
  isLimitsLoading,
  limitsError,
  isResetLoading,
  resetError,
  latestReset,
  recentResets,
  resetCreditsAvailableCount,
  resetCredits,
  onOpenResetHistory,
  onOpenResetCredits,
}: {
  isLimitsLoading: boolean;
  limitsError: string | null;
  isResetLoading: boolean;
  resetError: string | null;
  latestReset?: CodexResetAnnouncement | null;
  recentResets?: CodexResetAnnouncement[] | null;
  resetCreditsAvailableCount?: number | null;
  resetCredits?: CodexResetCredit[] | null;
  onOpenResetHistory?: () => void;
  onOpenResetCredits: () => void;
}) {
  const { t } = useTranslation();
  const showResetCredits = resetCreditsAvailableCount !== null && resetCreditsAvailableCount !== undefined;

  return (
    <div
      data-testid="reset-area"
      className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-2.5 sm:p-3 content-md:grid-cols-2"
    >
      <div className="grid grid-cols-1 gap-2">
        {latestReset ? (
          <LatestResetButton
            reset={latestReset}
            recentResets={recentResets}
            recentDays={RECENT_RESET_OVERVIEW_DAYS}
            onOpen={() => onOpenResetHistory?.()}
          />
        ) : !isResetLoading ? (
          <div data-testid="latest-reset-empty" className="space-y-2 rounded-lg border border-border px-2.5 py-3 text-xs">
            <p className="font-semibold text-muted-foreground">{t("limits.latest_reset")}</p>
            <p className="leading-5 text-muted-foreground">{t(resetError ? "recovery.reset_failed" : "recovery.reset_empty")}</p>
          </div>
        ) : (
          <div data-testid="latest-reset-skeleton" role="status" aria-label={t("limits.latest_reset")} className="space-y-3 rounded-lg border border-border px-2.5 py-3">
            <p className="text-xs font-semibold text-muted-foreground">{t("limits.latest_reset")}</p>
            <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-2.5 w-1/2 rounded bg-muted" />
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 35 }, (_, index) => <span key={index} className="h-2.5 rounded-[3px] bg-muted" />)}
              </div>
            </div>
          </div>
        )}
      </div>
      {showResetCredits ? (
        <ResetCreditsPanel
          availableCount={resetCreditsAvailableCount}
          credits={resetCredits}
          onOpen={onOpenResetCredits}
          separated
        />
      ) : !isLimitsLoading ? (
        <div data-testid="reset-credits-empty" className="space-y-2 border-t border-border/60 pt-2.5 text-xs content-md:border-l content-md:border-t-0 content-md:pl-3 content-md:pt-0">
          <p className="font-semibold text-muted-foreground">{t("limits.reset_credits")}</p>
          <p className="leading-5 text-muted-foreground">{t(limitsError ? "recovery.credits_failed" : "recovery.credits_empty")}</p>
        </div>
      ) : (
        <div data-testid="reset-credits-skeleton" role="status" aria-label={t("limits.reset_credits")} className="space-y-3 border-t border-border/60 pt-2.5 content-md:border-l content-md:border-t-0 content-md:pl-3 content-md:pt-0">
          <p className="text-xs font-semibold text-muted-foreground">{t("limits.reset_credits")}</p>
          <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
            <div className="h-4 w-16 rounded-full bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-4/5 rounded bg-muted" />
            <div className="h-3 w-3/5 rounded bg-muted" />
          </div>
        </div>
      )}
    </div>
  );
}

export function formatSidebarCountdown(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const diff = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return "0m";
  // Never round across the one-day threshold: minutes are shown only below 24 hours.
  if (diff >= 86_400_000) return `${Math.floor(diff / 86_400_000)}d${Math.floor(diff / 3_600_000) % 24}h`;
  const minutes = Math.ceil(diff / 60_000);
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function LimitRow({ label, window, now, compact }: LimitRowProps & { now: number; compact: boolean }) {
  const { t } = useTranslation();
  const outlineTrackRef = useRef<SVGRectElement>(null);
  useLayoutEffect(() => {
    const track = outlineTrackRef.current!;
    const updateStart = () => {
      const { width, height } = track.getBBox();
      if (!width || !height) return;
      // Shift the clockwise dash to the top center so its gap grows to the left.
      const offset = -100 * (width / 2 - 11) / track.getTotalLength();
      track.parentElement!.style.setProperty("--quota-start-offset", String(offset));
    };
    updateStart();
    const observer = new ResizeObserver(updateStart);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const friendlyLabel = t(label === "monthly" ? "limits.sidebar_monthly" : label === "Weekly" ? "limits.sidebar_weekly" : "limits.sidebar_5hour");
  const remaining = window && Number.isFinite(window.remainingPercent) ? Math.min(100, Math.max(0, window.remainingPercent)) : 0;
  const outlineClass = remaining < 30 ? "stroke-error" : remaining < 70 ? "stroke-warning" : "stroke-success";
  const countdown = formatSidebarCountdown(window?.resetsAt ?? null, now);
  const expired = countdown === "0m";
  const reset = countdown !== null ? dayjs(window!.resetsAt).format(label === "5 hour" ? "HH:mm" : "MM/DD HH:mm") : null;

  return (
    <div data-testid={`limit-row-${label.toLowerCase().replaceAll(" ", "-")}`} className={cn("relative rounded-xl bg-primary/[0.025]", compact ? "px-1 py-2 text-center" : "px-3 pb-2.5 pt-3.5")}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible fill-none">
        <rect ref={outlineTrackRef} x="1" y="1" rx="11" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} className="stroke-border" strokeWidth="1.5" />
        {window ? <rect data-quota-outline x="1" y="1" rx="11" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)", strokeDashoffset: "var(--quota-start-offset)" }} pathLength="100" strokeDasharray={`${remaining} ${100 - remaining}`} className={cn("transition-[stroke-dasharray] duration-300", expired ? "stroke-muted-foreground" : outlineClass)} strokeWidth="1.5" /> : null}
      </svg>
      <span data-quota-label className={cn("text-xs font-medium text-primary", compact ? "relative block leading-tight" : "absolute -top-1 right-2 rounded-md border border-primary/20 bg-surface px-1.5 py-0.5 leading-none")}>{friendlyLabel}</span>
      <div className={cn("flex items-baseline gap-1.5", compact && "mt-1 justify-center")}>
        {!compact ? <span className="text-xs">{t("limits.remaining")}</span> : null}
        <span className={cn("text-xl font-bold tabular-nums tracking-tight", expired ? "text-muted-foreground" : "text-primary")}>{window ? `${Math.round(remaining)}%` : "—"}</span>
      </div>
      {!compact ? <div className="quota-reset-row mt-1 flex items-center justify-between gap-1 whitespace-nowrap text-xs tabular-nums">
        <span className="min-w-0 text-muted-foreground" title={reset ? t("limits.sidebar_reset_at", { time: dayjs(window!.resetsAt).format("YYYY-MM-DD HH:mm") }) : t("limits.no_window_returned")}>
          {reset ? <>{reset}<span className="quota-reset-word"> {t("limits.sidebar_reset")}</span></> : t("limits.reset_unavailable")}
        </span>
        {countdown !== null && !expired ? <span className="flex shrink-0 items-center gap-1 font-medium text-primary" title={t("limits.sidebar_countdown")}><Clock3 className="h-3 w-3" aria-hidden="true" /><span data-quota-countdown>{countdown}</span></span> : null}
      </div> : null}
      {expired ? <p className="mt-1 break-words text-xs text-muted-foreground">{t("limits.window_expired")}</p> : null}
    </div>
  );
}

function ResetCreditsPanel({
  availableCount,
  credits,
  onOpen,
  separated,
}: {
  availableCount: number;
  credits?: CodexResetCredit[] | null;
  onOpen: () => void;
  separated: boolean;
}) {
  const { t } = useTranslation();
  const count = Math.max(0, Math.trunc(availableCount));
  const sortedCredits = [...(credits ?? [])]
    .sort((left, right) => {
      if (left.expiresAt === null) return right.expiresAt === null ? 0 : 1;
      if (right.expiresAt === null) return -1;
      return new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime();
    })
    .slice(0, count);

  return (
    <div className={cn(separated && "border-t border-border/60 pt-2.5 content-md:border-l content-md:border-t-0 content-md:pl-3 content-md:pt-0")}>
      <div className="flex w-full items-center gap-1">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("limits.reset_credits_open")}
          onClick={onOpen}
        >
          <span className="flex items-center gap-1.5 text-muted-foreground transition-colors group-hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-semibold">{t("limits.reset_credits")}</span>
            <ExternalLink className="h-3 w-3 opacity-55 transition-opacity group-hover:opacity-90" aria-hidden="true" />
          </span>
          <span
            data-testid="reset-credit-count"
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors group-hover:text-foreground"
          >
            {t("limits.reset_credits_available", { count })}
          </span>
        </button>
      </div>
      <div
        role="region"
        aria-label={t("limits.reset_credits")}
        tabIndex={0}
        className="mt-2 max-h-40 overflow-y-auto overscroll-contain border-t border-border/40 text-xs leading-normal text-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {count === 0 ? (
          <p className="pt-2 text-muted-foreground">{t("limits.reset_credits_none")}</p>
        ) : sortedCredits.length === 0 ? (
          <p className="pt-2 text-muted-foreground">{t("limits.reset_credits_details_unavailable")}</p>
        ) : (
          <>
            {sortedCredits.map((credit, index) => (
              <div
                key={credit.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-border/40 py-2 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <span className="font-medium text-foreground">{t("limits.reset_credit_number", { index: index + 1 })}</span>
                {credit.expiresAt ? (
                  <>
                    <span className="min-w-0 tabular-nums text-muted-foreground">
                      {t("limits.reset_credit_expires_at", { date: dayjs(credit.expiresAt).format("YYYY-MM-DD HH:mm") })}
                    </span>
                    <span className="col-start-2 tabular-nums text-muted-foreground sm:col-start-3 sm:row-start-1 sm:text-right">
                      {t("limits.reset_credit_time_left", { timeLeft: formatResetCreditTimeLeft(credit.expiresAt, t) })}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("limits.reset_credit_no_expiry")}</span>
                )}
              </div>
            ))}
            {sortedCredits.length < count ? (
              <p className="border-t border-border/40 pt-2 text-muted-foreground">
                {t("limits.reset_credits_details_partial", { count: count - sortedCredits.length })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function formatResetCreditTimeLeft(expiresAt: string, t: any): string {
  const diffMs = dayjs(expiresAt).diff(dayjs());
  if (diffMs <= 0) return t("limits.resetting_soon");

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return t(minutes === 1 ? "limits.mins_left_one" : "limits.mins_left_other", { count: minutes });

  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours < 24) return t(hours === 1 ? "limits.hours_left_one" : "limits.hours_left_other", { count: hours });

  const days = Math.ceil(diffMs / 86_400_000);
  return t(days === 1 ? "limits.days_left_one" : "limits.days_left_other", { count: days });
}

export function formatResetTime(resetsAtStr: string | null, windowMinutes: number | null, t?: any): string {
  if (!resetsAtStr) return t ? t("limits.reset_unavailable") : "Reset unavailable";
  
  const resetsAt = dayjs(resetsAtStr);
  const diffMs = resetsAt.diff(dayjs());
  
  if (diffMs <= 0) {
    return t ? t("limits.resetting_soon") : "Resetting soon";
  }
  
  const diffHours = diffMs / (1000 * 60 * 60);
  let timeLeftText = "";
  if (diffHours < 1) {
    const mins = Math.ceil(diffMs / (1000 * 60));
    timeLeftText = t ? (mins === 1 ? t("limits.mins_left_one") : t("limits.mins_left_other", { count: mins })) : (mins === 1 ? "1 min left" : `${mins} mins left`);
  } else if (diffHours < 24) {
    const hours = Math.ceil(diffHours);
    timeLeftText = t ? (hours === 1 ? t("limits.hours_left_one") : t("limits.hours_left_other", { count: hours })) : (hours === 1 ? "1 hour left" : `${hours} hours left`);
  } else {
    const days = Math.round(diffHours / 24);
    timeLeftText = t ? (days === 1 ? t("limits.days_left_one") : t("limits.days_left_other", { count: days })) : (days === 1 ? "1 day left" : `${days} days left`);
  }
  
  // If session (windowMinutes <= 300, i.e., 5 hours)
  if (windowMinutes && windowMinutes <= 300) {
    return t ? t("limits.reset_at", { time: resetsAt.format("HH:mm"), timeLeft: timeLeftText }) : `Reset at ${resetsAt.format("HH:mm")} (${timeLeftText})`;
  }
  
  // For weekly limit
  const resetDate = resetsAt.format("YYYY-MM-DD h:mm A");
  return t ? t("limits.resets_at", { time: resetDate, timeLeft: timeLeftText }) : `Resets ${resetDate} (${timeLeftText})`;
}
