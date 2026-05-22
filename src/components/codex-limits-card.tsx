import { Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CodexLimitWindow, CodexLimitsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

type CodexLimitsCardProps = {
  limits: CodexLimitsResponse | null;
  error: string | null;
};

type LimitRowProps = {
  label: string;
  window: CodexLimitWindow | null;
};

export function CodexLimitsCard({ limits, error }: CodexLimitsCardProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b border-border p-4 sm:p-4.5 shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
              <Gauge className="h-5 w-5 text-primary" />
              Codex Limits
            </CardTitle>
            <CardDescription>Live account limits from the local Codex CLI.</CardDescription>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {limits?.updatedAt ? `Updated ${new Date(limits.updatedAt).toLocaleString()}` : "Not fetched yet"}
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-4.5 flex-1 flex flex-col justify-center">
        {error ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
            Codex limits unavailable: {error}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 flex-1 justify-center">
            <LimitRow label="5 hour" window={limits?.session ?? null} />
            <LimitRow label="Weekly" window={limits?.weekly ?? null} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LimitRow({ label, window }: LimitRowProps) {
  if (!window) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">
            {label.toLowerCase().includes("weekly") ? "Weekly Limit" : "5-Hour Limit"}
          </p>
          <p className="text-xs text-muted-foreground">Unavailable</p>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-border" />
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          No rate-limit window returned by Codex.
        </p>
      </div>
    );
  }

  const usedPercent = clampPercent(window.usedPercent);
  const remainingPercent = clampPercent(window.remainingPercent);
  const status = getLimitStatus(remainingPercent);
  const resetLabel = formatResetTime(window.resetsAt, window.windowMinutes);

  const friendlyLabel = label.toLowerCase().includes("weekly") ? "Weekly Limit" : "5-Hour Limit";

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5 sm:p-4 transition-all duration-300 hover:border-border/80 hover:shadow-md">
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] items-center gap-4 sm:gap-5">
        <div className="flex justify-center">
          <LimitGauge remainingPercent={remainingPercent} tone={status.tone} />
        </div>
        
        <div className="space-y-1.5 flex flex-col items-center sm:items-stretch text-center sm:text-left">
          <div className="flex flex-col items-center sm:flex-row sm:justify-between gap-1.5 w-full">
            <h4 className="text-sm sm:text-base font-semibold text-foreground leading-none">{friendlyLabel}</h4>
            <span className={cn("rounded-full px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider w-fit", status.badgeClass)}>
              {status.label}
            </span>
          </div>

          <div className="space-y-0.5">
            <p className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-none">
              {formatLimitPercent(remainingPercent)}{" "}
              <span className="text-xs font-normal text-muted-foreground">remaining</span>
            </p>
            <p className="text-xs sm:text-sm font-medium text-primary leading-normal">{resetLabel}</p>
          </div>

          <div className="pt-2 grid grid-cols-2 gap-3 border-t border-border/50 text-xs text-left w-full">
            <div>
              <p className="text-[9px] sm:text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-0.5">Consumed</p>
              <p className="font-semibold text-foreground leading-normal">
                {formatLimitPercent(usedPercent)}{" "}
                <span className="font-normal text-muted-foreground text-[9px] sm:text-[10px]">
                  {formatWindowUsage(window.windowMinutes, usedPercent)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-0.5">Window</p>
              <p className="font-semibold text-foreground leading-normal">{formatWindowMinutes(window.windowMinutes)}</p>
            </div>
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
  
  const color =
    tone === "success" 
      ? "rgb(var(--primary))" 
      : tone === "warning" 
      ? "rgb(var(--warning))" 
      : "rgb(var(--error))";

  // Glowing shadow based on health state
  const glowClass = 
    tone === "success" 
      ? "shadow-[0_0_12px_rgba(var(--primary),0.12)]" 
      : tone === "warning" 
      ? "shadow-[0_0_12px_rgba(var(--warning),0.12)]" 
      : "shadow-[0_0_12px_rgba(var(--error),0.12)]";

  return (
    <div className={cn("relative flex h-20 w-20 items-center justify-center rounded-full bg-muted/5 border border-border/10", glowClass)}>
      <svg viewBox="0 0 96 96" className="h-20 w-20" role="img" aria-label={`${Math.round(remainingPercent)}% remaining`}>
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
        <p className="font-mono text-lg font-bold tabular-nums text-foreground leading-none">{formatLimitPercent(remainingPercent)}</p>
        <p className="text-[8px] uppercase tracking-wider text-muted-foreground font-bold mt-0.5">Left</p>
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

function formatWindowMinutes(windowMinutes: number | null) {
  if (windowMinutes === 300) {
    return "300 min";
  }
  if (windowMinutes === 10080) {
    return "7 days";
  }
  if (windowMinutes) {
    if (windowMinutes >= 60) {
      return `${Math.round(windowMinutes / 60)} hrs`;
    }
    return `${windowMinutes} min`;
  }

  return "Unknown";
}

function formatWindowUsage(windowMinutes: number | null, usedPercent: number) {
  if (!windowMinutes) {
    return "";
  }

  const consumedMins = Math.round((windowMinutes * usedPercent) / 100);
  if (consumedMins >= 60) {
    const hrs = Math.floor(consumedMins / 60);
    const mins = consumedMins % 60;
    if (mins > 0) {
      return `(${hrs}h ${mins}m)`;
    }
    return `(${hrs}h)`;
  }
  return `(${consumedMins}m)`;
}

export function formatResetTime(resetsAtStr: string | null, windowMinutes: number | null): string {
  if (!resetsAtStr) return "Reset unavailable";
  
  const resetsAt = new Date(resetsAtStr);
  const now = new Date();
  const diffMs = resetsAt.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return "Resetting soon";
  }
  
  // If session (windowMinutes <= 300, i.e., 5 hours)
  if (windowMinutes && windowMinutes <= 300) {
    const hoursStr = String(resetsAt.getHours()).padStart(2, "0");
    const minsStr = String(resetsAt.getMinutes()).padStart(2, "0");
    return `Reset at ${hoursStr}:${minsStr}`;
  }
  
  // For weekly limit
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = weekdays[resetsAt.getDay()];
  const hoursStr = String(resetsAt.getHours()).padStart(2, "0");
  const minsStr = String(resetsAt.getMinutes()).padStart(2, "0");
  return `Reset ${dayName} ${hoursStr}:${minsStr}`;
}

function getLimitStatus(remainingPercent: number): {
  label: string;
  tone: "success" | "warning" | "error";
  badgeClass: string;
  barClass: string;
} {
  if (remainingPercent < 30) {
    return {
      label: "Near Limit",
      tone: "error",
      badgeClass: "bg-error/10 text-error border border-error/20",
      barClass: "bg-error",
    };
  }

  if (remainingPercent < 70) {
    return {
      label: "Moderate",
      tone: "warning",
      badgeClass: "bg-warning/10 text-warning border border-warning/20",
      barClass: "bg-warning",
    };
  }

  return {
    label: "Healthy",
    tone: "success",
    badgeClass: "bg-success/10 text-success border border-success/20",
    barClass: "bg-primary",
  };
}
