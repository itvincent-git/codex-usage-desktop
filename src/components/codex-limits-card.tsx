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
    <Card>
      <CardHeader className="border-b border-border p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-2xl">
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

      <CardContent className="p-5 sm:p-6">
        {error ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
            Codex limits unavailable: {error}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
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
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">Unavailable</p>
        </div>
        <div className="mt-4 h-2 rounded-full bg-border" />
        <p className="mt-3 text-xs leading-5 text-muted-foreground">No rate-limit window returned by Codex.</p>
      </div>
    );
  }

  const usedPercent = clampPercent(window.usedPercent);
  const remainingPercent = clampPercent(window.remainingPercent);
  const resetLabel = window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}` : "Reset unavailable";
  const status = getLimitStatus(remainingPercent);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            <span>{label}</span>
            <span> window</span>
          </p>
          <p className="text-sm font-medium text-primary">{resetLabel}</p>
        </div>
        <span className={cn("rounded-sm px-2.5 py-1 text-xs font-semibold", status.badgeClass)}>{status.label}</span>
      </div>

      <div className="mt-5 grid grid-cols-[8rem_1fr] items-center gap-4">
        <LimitGauge remainingPercent={remainingPercent} tone={status.tone} />
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Consumed</p>
            <p className="font-medium text-foreground">
              {formatLimitPercent(usedPercent)} {formatWindowUsage(window.windowMinutes, usedPercent)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Window</p>
            <p className="font-medium text-foreground">{formatWindowMinutes(window.windowMinutes)}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full", status.barClass)} style={{ width: `${remainingPercent}%` }} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatLimitPercent(remainingPercent)} remaining</span>
        <span>{formatLimitPercent(usedPercent)} consumed</span>
      </div>
    </div>
  );
}

function LimitGauge({ remainingPercent, tone }: { remainingPercent: number; tone: "success" | "warning" | "error" }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (remainingPercent / 100) * circumference;
  const color =
    tone === "success" ? "rgb(var(--primary))" : tone === "warning" ? "rgb(var(--warning))" : "rgb(var(--error))";

  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 112 112" className="h-32 w-32" role="img" aria-label={`${Math.round(remainingPercent)}% remaining`}>
        <circle cx="56" cy="56" r={radius} fill="none" stroke="rgb(var(--border))" strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="10"
          transform="rotate(-90 56 56)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-mono text-2xl font-medium tabular-nums text-foreground">{formatLimitPercent(remainingPercent)}</p>
        <p className="text-xs text-muted-foreground">remaining</p>
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

function formatLimitPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatWindowMinutes(windowMinutes: number | null) {
  if (windowMinutes === 300) {
    return "300 min window";
  }
  if (windowMinutes === 10080) {
    return "10080 min window";
  }
  if (windowMinutes) {
    return `${windowMinutes} min window`;
  }

  return "Window unknown";
}

function formatWindowUsage(windowMinutes: number | null, usedPercent: number) {
  if (!windowMinutes) {
    return "";
  }

  return `(${Math.round((windowMinutes * usedPercent) / 100).toLocaleString()} min)`;
}

function getLimitStatus(remainingPercent: number): {
  label: string;
  tone: "success" | "warning" | "error";
  badgeClass: string;
  barClass: string;
} {
  if (remainingPercent < 30) {
    return {
      label: "Near limit",
      tone: "error",
      badgeClass: "bg-error/10 text-error",
      barClass: "bg-error",
    };
  }

  if (remainingPercent < 70) {
    return {
      label: "Moderate",
      tone: "warning",
      badgeClass: "bg-warning/10 text-warning",
      barClass: "bg-warning",
    };
  }

  return {
    label: "Healthy",
    tone: "success",
    badgeClass: "bg-success/10 text-success",
    barClass: "bg-primary",
  };
}
