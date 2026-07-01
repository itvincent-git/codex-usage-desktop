import { ExternalLink, Gauge, LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CodexLimitWindow, CodexLimitsResponse, CodexQuotaForecastResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

type CodexLimitsCardProps = {
  limits: CodexLimitsResponse | null;
  error: string | null;
  quotaForecast?: CodexQuotaForecastResponse | null;
  onOpenQuotaForecast?: () => void;
};

type LimitRowProps = {
  label: string;
  window: CodexLimitWindow | null;
  resetCreditsAvailableCount?: number | null;
};

type QuotaForecastTone = {
  label: string;
  className: string;
  scoreClassName: string;
  ringColor: string;
};

function isOAuthLoginError(err: string | null): boolean {
  if (!err) return false;
  const lowercaseErr = err.toLowerCase();
  return (
    lowercaseErr.includes("no such file or directory") ||
    lowercaseErr.includes("failed to read codex auth") ||
    lowercaseErr.includes("contains no tokens") ||
    lowercaseErr.includes("contains no access token") ||
    lowercaseErr.includes("unauthorized") ||
    lowercaseErr.includes("401")
  );
}

export function hasSubscription(limits: CodexLimitsResponse | null | undefined): boolean {
  if (!limits || !limits.membershipLevel) return false;
  const level = limits.membershipLevel.toLowerCase();
  return ["plus", "pro", "team", "enterprise"].includes(level);
}

export function CodexLimitsCard({ limits, error, quotaForecast, onOpenQuotaForecast }: CodexLimitsCardProps) {
  const { t } = useTranslation();
  const quotaForecastScore = quotaForecast ? Math.round(clampPercent(quotaForecast.score)) : null;
  const quotaForecastTone = quotaForecastScore === null ? null : getQuotaForecastTone(quotaForecastScore, t);

  return (
    <Card className="h-full flex flex-col rounded-lg">
      <CardHeader className="border-b border-border p-3 sm:px-4 sm:py-3 shrink-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Gauge className="h-4.5 w-4.5 text-primary" />
              {t("limits.title")}
            </CardTitle>
            <CardDescription className="text-xs">{t("limits.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            {quotaForecast && quotaForecastScore !== null && quotaForecastTone ? (
              <button
                type="button"
                className={cn(
                  "group flex min-w-[8.75rem] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  quotaForecastTone.className,
                )}
                onClick={onOpenQuotaForecast}
                aria-label={t("limits.quota_forecast_open")}
              >
                <QuotaForecastRing score={quotaForecastScore} tone={quotaForecastTone} />
                <span className="min-w-0">
                  <span className="mt-0.5 block text-[10px] font-semibold leading-none text-foreground/80">
                    {quotaForecastTone.label}
                  </span>
                </span>
                <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-55 transition-opacity group-hover:opacity-90" aria-hidden="true" />
              </button>
            ) : null}
            <p className="text-[10px] leading-5 text-muted-foreground sm:text-right">
              {limits?.updatedAt ? t("limits.updated", { time: dayjs(limits.updatedAt).format("HH:mm:ss") }) : t("limits.not_fetched")}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4 flex-1 flex flex-col justify-center">
        {error ? (
          isOAuthLoginError(error) ? (
            <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm flex flex-col justify-between h-full">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-warning font-semibold">
                  <LogIn className="h-4.5 w-4.5" />
                  <span>{t("limits.not_logged_in")} / 尚未登录</span>
                </div>
                <p className="text-xs text-muted-foreground leading-normal">
                  {t("limits.login_instruction")}
                </p>
                <div className="bg-muted/60 hover:bg-muted p-2.5 rounded-lg font-mono text-xs select-all border border-border flex items-center justify-between group transition-colors">
                  <span className="text-foreground select-all">codex auth login</span>
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">{t("limits.click_to_select")}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/80 leading-normal mt-2 pt-2 border-t border-border/40">
                {t("limits.login_hint")}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
              {t("limits.unavailable_reason")}
            </div>
          )
        ) : (
          <div className={cn(
            "grid gap-3 flex-1 justify-center",
            hasSubscription(limits) ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
          )}>
            {hasSubscription(limits) ? (
              <>
                <LimitRow label="5 hour" window={limits?.session ?? null} />
                <LimitRow
                  label="Weekly"
                  window={limits?.weekly ?? null}
                  resetCreditsAvailableCount={limits?.resetCreditsAvailableCount}
                />
              </>
            ) : (
              <LimitRow label="monthly" window={limits?.weekly ?? limits?.session ?? null} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatQuotaForecast(score: number, t: any) {
  const roundedScore = Math.round(clampPercent(score));
  if (roundedScore >= 70) {
    return t("limits.quota_forecast_likely", { score: roundedScore });
  }
  if (roundedScore >= 40) {
    return t("limits.quota_forecast_possible", { score: roundedScore });
  }
  return t("limits.quota_forecast_low", { score: roundedScore });
}

function getQuotaForecastTone(score: number, t: any): QuotaForecastTone {
  if (score >= 70) {
    return {
      label: t("limits.quota_forecast_likely_label"),
      className: "border-error/30 bg-error/10 hover:border-error/45 hover:bg-error/15",
      scoreClassName: "text-error",
      ringColor: "rgb(var(--error))",
    };
  }

  if (score >= 40) {
    return {
      label: t("limits.quota_forecast_possible_label"),
      className: "border-warning/35 bg-warning/10 hover:border-warning/50 hover:bg-warning/15",
      scoreClassName: "text-warning",
      ringColor: "rgb(var(--warning))",
    };
  }

  return {
    label: t("limits.quota_forecast_low_label"),
    className: "border-success/30 bg-success/10 hover:border-success/45 hover:bg-success/15",
    scoreClassName: "text-success",
    ringColor: "rgb(var(--success))",
  };
}

function QuotaForecastRing({ score, tone }: { score: number; tone: QuotaForecastTone }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/55">
      <svg viewBox="0 0 48 48" className="h-10 w-10" role="img" aria-label={`${score}% reset probability`}>
        <circle cx="24" cy="24" r={radius} fill="none" stroke="rgb(var(--border) / 0.65)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke={tone.ringColor}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="4"
          transform="rotate(-90 24 24)"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <span className={cn("absolute font-mono text-[11px] font-bold leading-none tabular-nums", tone.scoreClassName)}>
        {score}
      </span>
    </span>
  );
}

function LimitRow({ label, window, resetCreditsAvailableCount }: LimitRowProps) {
  const { t } = useTranslation();

  if (!window) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-2.5 sm:p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {label.toLowerCase().includes("monthly")
              ? t("limits.window_monthly")
              : label.toLowerCase().includes("weekly")
              ? t("limits.window_weekly")
              : t("limits.window_5hour")}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("limits.unavailable")}</p>
        </div>
        <div className="mt-2 h-1 rounded-full bg-border" />
        <p className="mt-1.5 text-[11px] leading-normal text-muted-foreground">
          {t("limits.no_window_returned")}
        </p>
      </div>
    );
  }

  const usedPercent = clampPercent(window.usedPercent);
  const remainingPercent = clampPercent(window.remainingPercent);
  const status = getLimitStatus(remainingPercent, t);
  const resetLabel = formatResetTime(window.resetsAt, window.windowMinutes, t);

  const friendlyLabel = label.toLowerCase().includes("monthly")
    ? t("limits.window_monthly")
    : label.toLowerCase().includes("weekly")
    ? t("limits.window_weekly")
    : t("limits.window_5hour");
  const showResetCredits = label.toLowerCase().includes("weekly") && resetCreditsAvailableCount !== null && resetCreditsAvailableCount !== undefined;

  return (
    <div className="rounded-xl border border-border bg-surface p-2.5 sm:p-3 transition-all duration-300 hover:border-border/80 hover:shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] items-center gap-3 sm:gap-4">
        <div className="flex justify-center">
          <LimitGauge remainingPercent={remainingPercent} tone={status.tone} />
        </div>
        
        <div className="space-y-1 flex flex-col items-center sm:items-stretch text-center sm:text-left">
          <div className="flex flex-col items-center sm:flex-row sm:justify-between gap-1 w-full">
            <h4 className="text-xs sm:text-sm font-semibold text-foreground leading-none">{friendlyLabel}</h4>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider w-fit", status.badgeClass)}>
              {status.label}
            </span>
          </div>

          <div className="space-y-0.5">
            <p className="text-lg sm:text-xl font-bold tracking-tight text-foreground leading-none">
              {formatLimitPercent(remainingPercent)}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">{t("limits.remaining")}</span>
            </p>
            <p className="text-[11px] font-medium text-primary leading-normal">{resetLabel}</p>
          </div>

          <div className={cn(
            "pt-1.5 grid gap-2 border-t border-border/50 text-[10px] text-left w-full",
            showResetCredits ? "grid-cols-3" : "grid-cols-2",
          )}>
            <div>
              <p className="text-[8px] sm:text-[9px] uppercase font-semibold text-muted-foreground tracking-wider mb-0.5">{t("limits.consumed")}</p>
              <p className="font-semibold text-foreground leading-none">
                {formatLimitPercent(usedPercent)}{" "}
                <span className="font-normal text-muted-foreground text-[8px] sm:text-[9px]">
                  {formatWindowUsage(window.windowMinutes, usedPercent, t)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[8px] sm:text-[9px] uppercase font-semibold text-muted-foreground tracking-wider mb-0.5">{t("limits.window")}</p>
              <p className="font-semibold text-foreground leading-none">{formatWindowMinutes(window.windowMinutes, t)}</p>
            </div>
            {showResetCredits ? (
              <div>
                <p className="text-[8px] sm:text-[9px] uppercase font-semibold text-muted-foreground tracking-wider mb-0.5">{t("limits.reset_credits")}</p>
                <p className="font-semibold text-foreground leading-none">
                  {resetCreditsAvailableCount}
                  <span className="font-normal text-muted-foreground text-[8px] sm:text-[9px]"> {t("limits.times")}</span>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LimitGauge({ remainingPercent, tone }: { remainingPercent: number; tone: "success" | "warning" | "error" }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (remainingPercent / 100) * circumference;
  const { t } = useTranslation();
  
  const color =
    tone === "success" 
      ? "rgb(var(--primary))" 
      : tone === "warning" 
      ? "rgb(var(--warning))" 
      : "rgb(var(--error))";

  // Glowing shadow based on health state
  const glowClass = 
    tone === "success" 
      ? "shadow-[0_0_8px_rgba(var(--primary),0.08)]" 
      : tone === "warning" 
      ? "shadow-[0_0_8px_rgba(var(--warning),0.08)]" 
      : "shadow-[0_0_8px_rgba(var(--error),0.08)]";

  return (
    <div className={cn("relative flex h-14 w-14 items-center justify-center rounded-full bg-muted/5 border border-border/10", glowClass)}>
      <svg viewBox="0 0 96 96" className="h-14 w-14" role="img" aria-label={`${Math.round(remainingPercent)}% remaining`}>
        {/* Background Track Ring */}
        <circle 
          cx="48" 
          cy="48" 
          r={radius} 
          fill="none" 
          stroke="rgb(var(--border) / 0.4)" 
          strokeWidth="6" 
        />
        {/* Foreground Colored Active Ring */}
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="6"
          transform="rotate(-90 48 48)"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
        <p className="font-mono text-sm font-bold tabular-nums text-foreground leading-none">{formatLimitPercent(remainingPercent)}</p>
        <p className="text-[7px] uppercase tracking-wider text-muted-foreground font-bold mt-0.5">{t("limits.left")}</p>
      </div>
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

// Ensure clean integer percentages for standard display
function formatLimitPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatWindowMinutes(windowMinutes: number | null, t?: any) {
  if (windowMinutes === 300) {
    return t ? t("limits.window_min", { count: 300 }) : "300 min";
  }
  if (windowMinutes) {
    if (windowMinutes >= 1440) {
      const days = Math.round(windowMinutes / 1440);
      return t ? t("limits.window_days", { count: days }) : `${days} days`;
    }
    if (windowMinutes >= 60) {
      return t ? t("limits.window_hours", { count: Math.round(windowMinutes / 60) }) : `${Math.round(windowMinutes / 60)} hrs`;
    }
    return t ? t("limits.window_min", { count: windowMinutes }) : `${windowMinutes} min`;
  }

  return t ? t("limits.window_unknown") : "Unknown";
}

function formatWindowUsage(windowMinutes: number | null, usedPercent: number, t?: any) {
  if (!windowMinutes) {
    return "";
  }

  const consumedMins = Math.round((windowMinutes * usedPercent) / 100);
  if (consumedMins >= 60) {
    const hrs = Math.floor(consumedMins / 60);
    const mins = consumedMins % 60;
    if (mins > 0) {
      return t ? `(${t("limits.window_hours", { count: hrs })}${t("limits.window_min", { count: mins })})` : `(${hrs}h ${mins}m)`;
    }
    return t ? `(${t("limits.window_hours", { count: hrs })})` : `(${hrs}h)`;
  }
  return t ? `(${t("limits.window_min", { count: consumedMins })})` : `(${consumedMins}m)`;
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

function getLimitStatus(remainingPercent: number, t?: any): {
  label: string;
  tone: "success" | "warning" | "error";
  badgeClass: string;
  barClass: string;
} {
  if (remainingPercent < 30) {
    return {
      label: t ? t("limits.status_near_limit") : "Near Limit",
      tone: "error",
      badgeClass: "bg-error/10 text-error border border-error/20",
      barClass: "bg-error",
    };
  }

  if (remainingPercent < 70) {
    return {
      label: t ? t("limits.status_moderate") : "Moderate",
      tone: "warning",
      badgeClass: "bg-warning/10 text-warning border border-warning/20",
      barClass: "bg-warning",
    };
  }

  return {
    label: t ? t("limits.status_healthy") : "Healthy",
    tone: "success",
    badgeClass: "bg-success/10 text-success border border-success/20",
    barClass: "bg-primary",
  };
}
