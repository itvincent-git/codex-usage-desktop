import { Bar, CartesianGrid, ComposedChart, Line, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatNumber } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";
import type { MetricCardData, MetricCardKind } from "@/lib/usage-dashboard";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type UsageTrendsCardProps = {
  daily: OverviewResponse["daily"];
  metrics: MetricCardData[];
  cacheHitRate: number;
  chartHeight?: number | string;
  className?: string;
  title?: string;
  compact?: boolean;
  hourly?: boolean;
};

const summaryStyles: Record<MetricCardKind, { accent: string; dot: string }> = {
  tokens: { accent: "group-hover:border-blue-500/30", dot: "bg-blue-500" },
  average: { accent: "group-hover:border-violet-500/30", dot: "bg-violet-500" },
  cache: { accent: "group-hover:border-success/30", dot: "bg-success" },
  costPerMillion: { accent: "group-hover:border-warning/30", dot: "bg-warning" },
};

const chartLegend = [
  { dataKey: "inputTokens", labelKey: "project_modal.input", defaultLabel: "Input", className: "bg-blue-600/75" },
  { dataKey: "cachedInputTokens", labelKey: "project_modal.cached", defaultLabel: "Cached", className: "bg-success/80" },
  { dataKey: "outputTokens", labelKey: "project_modal.output", defaultLabel: "Output", className: "bg-violet-600/70" },
  { dataKey: "costUSD", labelKey: "common.cost", defaultLabel: "Cost", className: "bg-primary" },
] as const;

type ChartSeriesKey = (typeof chartLegend)[number]["dataKey"];

export const UsageTrendTooltip = ({ active, payload, label, t, compact = false }: any) => {
  if (active && payload && payload.length) {
    const input = payload.find((p: any) => p.dataKey === "inputTokens")?.value ?? 0;
    const cached = payload.find((p: any) => p.dataKey === "cachedInputTokens")?.value ?? 0;
    const output = payload.find((p: any) => p.dataKey === "outputTokens")?.value ?? 0;
    const cost = payload.find((p: any) => p.dataKey === "costUSD")?.value ?? 0;
    const total = payload.find((p: any) => p.dataKey === "totalTokens")?.value ?? input + cached + output;

    return (
      <div className={cn("select-none rounded-lg border border-border/70 bg-surface shadow-xl", compact ? "min-w-36 p-2" : "min-w-[220px] p-3.5")}>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="space-y-1.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 font-semibold text-foreground">
            <span>{t("trends.total_tokens", { defaultValue: "Total Tokens" })}</span>
            <span>{formatNumber(total)}</span>
          </div>

          {!compact ? <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-blue-600/75" />
              {t("project_modal.input", { defaultValue: "Input" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(input)}</span>
          </div> : null}

          {!compact ? <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-success/80" />
              {t("project_modal.cached", { defaultValue: "Cached" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(cached)}</span>
          </div> : null}

          {!compact ? <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-violet-600/70" />
              {t("project_modal.output", { defaultValue: "Output" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(output)}</span>
          </div> : null}

          <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-border/60 pt-1.5 font-semibold text-primary">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {t("common.cost", { defaultValue: "Cost" })}
            </span>
            <span className="font-mono">{formatCurrencyShort(cost)}</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export function UsageTrendsCard({ daily, metrics, cacheHitRate, chartHeight = 300, className, title, compact = false, hourly = false }: UsageTrendsCardProps) {
  const { t } = useTranslation();
  const gradientId = useId().replace(/:/g, "");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<Set<ChartSeriesKey>>(() => new Set());
  const trendData = daily.map((day) => ({
    date: day.date,
    shortDate: formatTrendDateLabel(day.date, hourly),
    inputTokens: Math.max(day.inputTokens - day.cachedInputTokens, 0),
    cachedInputTokens: day.cachedInputTokens,
    outputTokens: day.outputTokens,
    totalTokens: day.totalTokens,
    costUSD: day.costUSD,
  }));

  const maxDailyTokens = Math.max(...daily.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...daily.map((day) => day.costUSD), 0);
  const tokenAxisWidth = getYAxisWidth(maxDailyTokens, formatCompactNumber, 64);
  const costAxisWidth = getYAxisWidth(maxDailyCost, formatCurrencyShort, 72);

  const toggleSeries = (dataKey: ChartSeriesKey) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const card = (
    <Card
      data-testid="usage-trends-card"
      data-chart-granularity={hourly ? "hour" : "day"}
      data-chart-points={trendData.length}
      className={cn(
        "rounded-lg h-full flex flex-col",
        className,
        isFullscreen && "w-full border-border bg-surface hover:translate-y-0 hover:shadow-none",
      )}
    >
      {compact ? <div className="flex items-center gap-3 px-1 text-[10px] text-muted-foreground"><span className="sr-only">{title}</span><span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-success/80" />{t("trends.total_tokens")}</span><span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-primary" />{t("common.cost")}</span></div> : <CardHeader className="flex shrink-0 flex-row items-center justify-end border-b border-border/80 p-2 sm:px-3 sm:py-1.5">
        {title ? <span className="mr-auto text-xs font-semibold text-foreground">{title}</span> : null}
        <span className="sr-only">{t("trends.total_token_trend", { defaultValue: "Total Token Trend" })}</span>
        <span className="sr-only">{t("trends.cost_trend", { defaultValue: "Cost Trend" })}</span>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {chartLegend.map((item) => (
            <button
              key={item.dataKey}
              type="button"
              aria-pressed={!hiddenSeries.has(item.dataKey)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm transition-opacity focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
                hiddenSeries.has(item.dataKey) && "opacity-35",
              )}
              onClick={() => toggleSeries(item.dataKey)}
            >
              <span className={cn("h-2 w-2 rounded-full", item.className)} />
              {t(item.labelKey, { defaultValue: item.defaultLabel })}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          aria-label={t(isFullscreen ? "trends.exit_fullscreen" : "trends.enter_fullscreen")}
          title={t(isFullscreen ? "trends.exit_fullscreen" : "trends.enter_fullscreen")}
          onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </CardHeader>}
      <CardContent className={cn("flex flex-1 flex-col justify-between", compact ? "p-0" : "space-y-3 p-3 sm:p-3.5")}>
        <div
          style={
            typeof chartHeight === "number"
              ? { height: chartHeight, minHeight: chartHeight }
              : { height: chartHeight }
          }
          className={cn("min-w-0", typeof chartHeight === "string" && "flex-1 min-h-[145px]")}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={trendData} barGap={4} barCategoryGap={compact ? "10%" : "32%"} margin={compact ? { top: 8, right: 4, left: 4, bottom: 0 } : { top: 18, right: 10, left: 4, bottom: 6 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.1} />
                  <stop offset="80%" stopColor="rgb(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              {!compact ? <CartesianGrid stroke="rgb(var(--border) / 0.45)" strokeDasharray="3 8" vertical={false} /> : null}
              <XAxis
                dataKey="shortDate"
                dy={compact ? 2 : 10}
                interval="preserveStartEnd"
                minTickGap={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--muted-foreground) / 0.72)", fontSize: compact ? 9 : 11 }}
              />
              <YAxis
                yAxisId="tokens"
                hide={compact}
                width={tokenAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--muted-foreground) / 0.7)", fontSize: 11 }}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
              />
              <YAxis
                yAxisId="cost"
                hide={compact}
                orientation="right"
                width={costAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--primary) / 0.78)", fontSize: 11 }}
                tickFormatter={(value) => formatCurrencyShort(Number(value))}
              />
              <Tooltip
                content={<UsageTrendTooltip t={t} compact={compact} />}
                cursor={{ stroke: "rgb(var(--primary) / 0.22)", strokeDasharray: "4 4", strokeWidth: 1 }}
                wrapperStyle={{ zIndex: 10 }}
              />

              {!compact ? <Area
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                fill={`url(#${gradientId})`}
                stroke="none"
                activeDot={false}
                hide={hiddenSeries.has("costUSD")}
                isAnimationActive={false}
              /> : null}

              {compact ? <Bar
                yAxisId="tokens"
                dataKey="totalTokens"
                fill="rgb(var(--success) / 0.78)"
                maxBarSize={20}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              /> : null}
              {!compact ? <Bar
                yAxisId="tokens"
                dataKey="inputTokens"
                name="Input tokens"
                stackId="tokens"
                fill="rgb(37 99 235 / 0.72)"
                maxBarSize={24}
                hide={hiddenSeries.has("inputTokens")}
                isAnimationActive={false}
              /> : null}
              {!compact ? <Bar
                yAxisId="tokens"
                dataKey="cachedInputTokens"
                name="Cached input tokens"
                stackId="tokens"
                fill="rgb(var(--success) / 0.78)"
                maxBarSize={24}
                hide={hiddenSeries.has("cachedInputTokens")}
                isAnimationActive={false}
              /> : null}
              {!compact ? <Bar
                yAxisId="tokens"
                dataKey="outputTokens"
                name="Output tokens"
                stackId="tokens"
                fill="rgb(124 58 237 / 0.72)"
                maxBarSize={24}
                radius={[5, 5, 0, 0]}
                hide={hiddenSeries.has("outputTokens")}
                isAnimationActive={false}
              /> : null}

              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                name="Cost (USD)"
                stroke="rgb(var(--primary))"
                strokeWidth={compact ? 2.5 : 2.75}
                dot={compact ? false : { r: 2.8, strokeWidth: 1.5, fill: "rgb(var(--surface))" }}
                activeDot={compact ? { r: 3 } : { r: 5.5, strokeWidth: 2.25, fill: "rgb(var(--surface))" }}
                hide={hiddenSeries.has("costUSD")}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {metrics.length > 0 ? <div className="trend-metrics grid grid-cols-2 gap-px sm:grid-cols-4 overflow-hidden rounded-lg border border-border/70 bg-border/70">
          {metrics.map((metric) => (
            <SummaryCell key={metric.label} metric={metric} cacheHitRate={cacheHitRate} />
          ))}
        </div> : null}
      </CardContent>
    </Card>
  );

  return isFullscreen
    ? createPortal(
        <div
          className="absolute inset-0 z-[100] flex bg-background p-3 sm:p-5"
          role="dialog"
          aria-label={title ?? t("trends.title")}
        >
          {card}
        </div>,
        document.querySelector("[data-app-content]") ?? document.body,
      )
    : card;
}

function SummaryCell({
  metric,
  cacheHitRate,
}: {
  metric: MetricCardData;
  cacheHitRate: number;
}) {
  const style = summaryStyles[metric.kind];

  return (
    <div className={cn(
      "group relative min-w-0 bg-surface p-2 sm:p-2.5 transition-all duration-300 hover:bg-muted",
      style.accent,
    )}>
      <div className="flex min-h-[56px] items-center justify-between gap-3">
        <div className="space-y-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", style.dot)} />
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-none">
              {metric.label}
            </p>
          </div>
          <div className="pt-0.5">
            <p className="truncate text-base sm:text-lg font-extrabold tracking-tight text-foreground leading-none" title={metric.value}>
              {metric.value}
            </p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{metric.detail}</p>
          </div>
        </div>
        {metric.kind === "cache" ? <CacheRing value={cacheHitRate} /> : null}
      </div>
    </div>
  );
}

function CacheRing({ value }: { value: number }) {
  const percent = Math.min(Math.max(value * 100, 0), 100);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-9 w-9" role="img" aria-label={`${Math.round(percent)}% cache hit`}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgb(var(--border))" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgb(var(--success))"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="7"
          transform="rotate(-90 32 32)"
        />
      </svg>
    </div>
  );
}
