import { Cpu, Download, FileSpreadsheet, FileText, FolderGit2, Gauge, Info, RefreshCcw } from "lucide-react";
import { RangeSwitcher } from "@/components/range-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatPercent } from "@/lib/formatters";
import { formatDuration, rangeLabels } from "@/lib/usage-dashboard";

type DashboardHeroCardProps = {
  overview: OverviewResponse;
  range: RangeKey;
  scanMessage: string;
  isBusy: boolean;
  isRefreshing: boolean;
  isExporting: ExportFormat | null;
  lastRescanDurationMs: number | null;
  onRangeChange: (range: RangeKey) => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => void;
};

export function DashboardHeroCard({
  overview,
  range,
  scanMessage,
  isBusy,
  isRefreshing,
  isExporting,
  lastRescanDurationMs,
  onRangeChange,
  onRefresh,
  onExport,
}: DashboardHeroCardProps) {
  const totalCost = overview.totals.costUSD;
  const models = overview.models ?? [];
  const projects = overview.projects ?? [];
  const topModel = [...models].sort((left, right) => right.costUSD - left.costUSD)[0] ?? null;
  const topProject = [...projects].sort((left, right) => right.costUSD - left.costUSD)[0] ?? null;
  const billableInputTokens = Math.max(overview.totals.inputTokens - overview.totals.cachedInputTokens, 0);
  const tokenMixTotal = billableInputTokens + overview.totals.cachedInputTokens + overview.totals.outputTokens;
  const costShare = (costUSD: number) => (totalCost > 0 ? costUSD / totalCost : 0);
  const tokenShare = (tokens: number) => (tokenMixTotal > 0 ? tokens / tokenMixTotal : 0);

  const formatUpdatedTime = (timestamp: string) => {
    const d = new Date(timestamp);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    if (isToday) {
      return `Today at ${timeStr}`;
    }
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    return `${dateStr} ${timeStr}`;
  };

  const isSynced = !!overview.updatedAt;
  const updatedLabel = overview.updatedAt
    ? `Updated ${formatUpdatedTime(overview.updatedAt)}${
        lastRescanDurationMs === null ? "" : ` · Rescan ${formatDuration(lastRescanDurationMs)}`
      }`
    : "No cached snapshot yet";

  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-gradient-to-br from-surface via-surface to-primary/5">
      <div className="p-5 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Overview</p>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-display text-foreground sm:text-3xl">
                Codex Cost Intelligence
              </h1>
              <div className="group relative flex items-center">
                <Info className="h-4 w-4 text-muted-foreground/50 transition-colors hover:text-muted-foreground cursor-help" />
                <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2.5 w-64 rounded-md border border-border bg-surface p-3 text-xs text-foreground opacity-0 shadow-card transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
                  <p className="font-semibold text-foreground">Codex Cost Intelligence</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">A compact local dashboard for recent Codex usage and cost.</p>
                  <div className="absolute right-1 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-border bg-surface sm:left-1/2 sm:right-auto" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <RangeSwitcher value={range} onChange={onRangeChange} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="lg" disabled={isBusy}>
                  <Download className="h-4 w-4" />
                  {isExporting === null ? "Export" : "Exporting"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExport("xlsx")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("markdown")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Markdown (.md)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="primary" size="lg" onClick={onRefresh} disabled={isBusy}>
              <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Rescan local logs
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.4fr] lg:gap-6">
          <div className="flex flex-col justify-center gap-3 lg:gap-4">
            <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-surface/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <span className="relative flex h-1.5 w-1.5">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75 ${isSynced ? "" : "hidden"}`}></span>
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isSynced ? "bg-success" : "bg-warning"}`}></span>
                </span>
                <span>{isSynced ? "Cache Synced" : "Out of Sync"}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground font-normal">{scanMessage}</span>
              </div>
              <div className="text-[11px] text-muted-foreground/75">
                {updatedLabel}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Total cost ({rangeLabels[range]})</p>
              <div className="flex flex-wrap items-end gap-2.5">
                <p className="font-display text-4xl font-bold tracking-display text-foreground sm:text-5xl">
                  {formatCurrencyShort(overview.totals.costUSD)}
                </p>
                <p className="pb-1 text-sm font-medium text-success">
                  {formatCompactNumber(overview.totals.totalTokens)} tokens
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/70 bg-surface/55 p-4 shadow-sm sm:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cost Drivers</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Where the selected-window spend comes from</p>
              </div>

              <div className="grid gap-2">
                <DriverRow
                  icon={Cpu}
                  label="Top model"
                  value={topModel?.model ?? "No model data"}
                  amount={topModel ? formatCurrencyShort(topModel.costUSD) : "$0.00"}
                  percent={formatPercent(topModel ? costShare(topModel.costUSD) : 0)}
                  width={topModel ? costShare(topModel.costUSD) : 0}
                />
                <DriverRow
                  icon={FolderGit2}
                  label="Top project"
                  value={topProject?.displayName ?? "No project data"}
                  amount={topProject ? formatCurrencyShort(topProject.costUSD) : "$0.00"}
                  percent={formatPercent(topProject ? costShare(topProject.costUSD) : 0)}
                  width={topProject ? costShare(topProject.costUSD) : 0}
                />
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 rounded-md border border-border/60 bg-background/45 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Token mix</p>
                  <span className="text-xs font-medium text-foreground">{formatCompactNumber(tokenMixTotal)}</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="bg-primary"
                    style={{ width: `${tokenShare(billableInputTokens) * 100}%` }}
                    aria-label={`Billable input ${formatPercent(tokenShare(billableInputTokens))}`}
                  />
                  <span
                    className="bg-success"
                    style={{ width: `${tokenShare(overview.totals.cachedInputTokens) * 100}%` }}
                    aria-label={`Cached input ${formatPercent(tokenShare(overview.totals.cachedInputTokens))}`}
                  />
                  <span
                    className="bg-violet-500"
                    style={{ width: `${tokenShare(overview.totals.outputTokens) * 100}%` }}
                    aria-label={`Output ${formatPercent(tokenShare(overview.totals.outputTokens))}`}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <TokenMixLegend label="Input" value={formatPercent(tokenShare(billableInputTokens))} className="bg-primary" />
                  <TokenMixLegend label="Cached" value={formatPercent(tokenShare(overview.totals.cachedInputTokens))} className="bg-success" />
                  <TokenMixLegend label="Output" value={formatPercent(tokenShare(overview.totals.outputTokens))} className="bg-violet-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DriverStat icon={Gauge} label="Cache hit" value={formatPercent(overview.totals.cacheHitRate)} />
                <DriverStat icon={Gauge} label="Cost / 1M" value={formatCurrencyShort(overview.totals.costPerMillionTokens)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DriverRow({
  icon: Icon,
  label,
  value,
  amount,
  percent,
  width,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  amount: string;
  percent: string;
  width: number;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/45 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className="font-mono text-xs font-semibold text-foreground">{amount}</p>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-foreground" title={value}>{value}</p>
            <p className="shrink-0 text-xs text-muted-foreground">{percent}</p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(width, 0), 1) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenMixLegend({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${className}`} />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DriverStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-surface/70 p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
