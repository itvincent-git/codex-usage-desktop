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
      <div className="rounded-md border border-border bg-muted/20 p-4">
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

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{resetLabel}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg leading-none tabular-nums text-foreground">{formatLimitPercent(remainingPercent)}</p>
          <p className="mt-1 text-xs text-muted-foreground">remaining</p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full",
            remainingPercent <= 10 ? "bg-error" : remainingPercent <= 30 ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatLimitPercent(remainingPercent)} remaining</span>
        <span>{formatLimitPercent(usedPercent)} consumed</span>
        <span>{formatWindowMinutes(window.windowMinutes)}</span>
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
