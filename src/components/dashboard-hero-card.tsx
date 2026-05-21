import { Download, FileSpreadsheet, FileText, RefreshCcw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RangeSwitcher } from "@/components/range-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort } from "@/lib/formatters";
import { formatDuration, formatTrendDateLabel, rangeLabels } from "@/lib/usage-dashboard";

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
  const trendData = overview.daily.map((day) => ({
    date: day.date,
    shortDate: formatTrendDateLabel(day.date),
    costUSD: day.costUSD,
  }));
  const peakCostDay = overview.daily.reduce<OverviewResponse["daily"][number] | null>(
    (peak, day) => (!peak || day.costUSD > peak.costUSD ? day : peak),
    null,
  );
  const updatedLabel = overview.updatedAt
    ? `Updated ${new Date(overview.updatedAt).toLocaleString()}${
        lastRescanDurationMs === null ? "" : ` · Rescan ${formatDuration(lastRescanDurationMs)}`
      }`
    : "No cached snapshot yet";

  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-gradient-to-br from-surface via-surface to-primary/5">
      <div className="p-6 lg:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Overview</p>
            <h1 className="max-w-xl font-display text-3xl tracking-display text-foreground sm:text-4xl">
              Local Codex cost intelligence
            </h1>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              A compact local dashboard for recent Codex usage and cost.
            </p>
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

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.4fr]">
          <div className="flex flex-col justify-between gap-8">
            <div className="rounded-md border border-border/80 bg-surface/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
              <p>{scanMessage}</p>
              <p>{updatedLabel}</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Total cost ({rangeLabels[range]})</p>
              <div className="flex flex-wrap items-end gap-3">
                <p className="font-display text-5xl tracking-display text-foreground sm:text-6xl">
                  {formatCurrencyShort(overview.totals.costUSD)}
                </p>
                <p className="pb-2 text-sm font-medium text-success">
                  {formatCompactNumber(overview.totals.totalTokens)} tokens
                </p>
              </div>
            </div>
          </div>

          <div className="min-h-[260px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={trendData} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="heroCostGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="shortDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => formatCurrencyShort(Number(value))}
                />
                <Tooltip
                  formatter={(value) => formatCurrencyShort(Number(value))}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                />
                <Area
                  type="monotone"
                  dataKey="costUSD"
                  stroke="rgb(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#heroCostGradient)"
                  activeDot={{ r: 6, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
            {peakCostDay ? (
              <div className="mt-3 flex justify-end text-xs text-muted-foreground">
                Peak cost day: {peakCostDay.date} · {formatCurrencyShort(peakCostDay.costUSD)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
