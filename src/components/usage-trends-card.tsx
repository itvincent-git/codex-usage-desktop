import { Bar, CartesianGrid, ComposedChart, Line, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
};

const summaryStyles: Record<MetricCardKind, { accent: string; dot: string }> = {
  tokens: { accent: "group-hover:border-blue-500/30", dot: "bg-blue-500" },
  average: { accent: "group-hover:border-violet-500/30", dot: "bg-violet-500" },
  cache: { accent: "group-hover:border-success/30", dot: "bg-success" },
  costPerMillion: { accent: "group-hover:border-warning/30", dot: "bg-warning" },
};

const chartLegend = [
  { labelKey: "project_modal.input", defaultLabel: "Input", className: "bg-blue-600/75" },
  { labelKey: "project_modal.cached", defaultLabel: "Cached", className: "bg-success/80" },
  { labelKey: "project_modal.output", defaultLabel: "Output", className: "bg-violet-600/70" },
  { labelKey: "common.cost", defaultLabel: "Cost", className: "bg-primary" },
];

export const UsageTrendTooltip = ({ active, payload, label, t }: any) => {
  if (active && payload && payload.length) {
    const input = payload.find((p: any) => p.dataKey === "inputTokens")?.value ?? 0;
    const cached = payload.find((p: any) => p.dataKey === "cachedInputTokens")?.value ?? 0;
    const output = payload.find((p: any) => p.dataKey === "outputTokens")?.value ?? 0;
    const cost = payload.find((p: any) => p.dataKey === "costUSD")?.value ?? 0;
    const total = input + cached + output;

    return (
      <div className="min-w-[220px] select-none rounded-lg border border-border/70 bg-surface p-3.5 shadow-xl">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="space-y-1.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 font-semibold text-foreground">
            <span>{t("trends.total_tokens", { defaultValue: "Total Tokens" })}</span>
            <span>{formatNumber(total)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-blue-600/75" />
              {t("project_modal.input", { defaultValue: "Input" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(input)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-success/80" />
              {t("project_modal.cached", { defaultValue: "Cached" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(cached)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-violet-600/70" />
              {t("project_modal.output", { defaultValue: "Output" })}
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(output)}</span>
          </div>

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

export function UsageTrendsCard({ daily, metrics, cacheHitRate, chartHeight = 300, className }: UsageTrendsCardProps) {
  const { t } = useTranslation();
  const trendData = daily.map((day) => ({
    date: day.date,
    shortDate: formatTrendDateLabel(day.date),
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

  return (
    <Card data-testid="usage-trends-card" className={cn("rounded-lg h-full flex flex-col", className)}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-end border-b border-border/80 p-2 sm:px-3 sm:py-1.5">
        <span className="sr-only">{t("trends.total_token_trend", { defaultValue: "Total Token Trend" })}</span>
        <span className="sr-only">{t("trends.cost_trend", { defaultValue: "Cost Trend" })}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {chartLegend.map((item) => (
            <span key={item.labelKey} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", item.className)} />
              {t(item.labelKey, { defaultValue: item.defaultLabel })}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between space-y-3 p-3 sm:p-3.5">
        <div
          style={
            typeof chartHeight === "number"
              ? { height: chartHeight, minHeight: chartHeight }
              : { height: chartHeight }
          }
          className={cn("min-w-0", typeof chartHeight === "string" && "flex-1 min-h-[145px]")}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={trendData} barGap={4} barCategoryGap="32%" margin={{ top: 18, right: 10, left: 4, bottom: 6 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.1} />
                  <stop offset="80%" stopColor="rgb(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgb(var(--border) / 0.45)" strokeDasharray="3 8" vertical={false} />
              <XAxis
                dataKey="shortDate"
                dy={10}
                interval="preserveStartEnd"
                minTickGap={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--muted-foreground) / 0.72)", fontSize: 11 }}
              />
              <YAxis
                yAxisId="tokens"
                width={tokenAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--muted-foreground) / 0.7)", fontSize: 11 }}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                width={costAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--primary) / 0.78)", fontSize: 11 }}
                tickFormatter={(value) => formatCurrencyShort(Number(value))}
              />
              <Tooltip
                content={<UsageTrendTooltip t={t} />}
                cursor={{ stroke: "rgb(var(--primary) / 0.22)", strokeDasharray: "4 4", strokeWidth: 1 }}
              />

              <Area
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                fill="url(#costGradient)"
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
              />

              <Bar
                yAxisId="tokens"
                dataKey="inputTokens"
                name="Input tokens"
                stackId="tokens"
                fill="rgb(37 99 235 / 0.72)"
                maxBarSize={24}
                isAnimationActive={false}
              />
              <Bar
                yAxisId="tokens"
                dataKey="cachedInputTokens"
                name="Cached input tokens"
                stackId="tokens"
                fill="rgb(var(--success) / 0.78)"
                maxBarSize={24}
                isAnimationActive={false}
              />
              <Bar
                yAxisId="tokens"
                dataKey="outputTokens"
                name="Output tokens"
                stackId="tokens"
                fill="rgb(124 58 237 / 0.72)"
                maxBarSize={24}
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />

              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                name="Cost (USD)"
                stroke="rgb(var(--primary))"
                strokeWidth={2.75}
                dot={{ r: 2.8, strokeWidth: 1.5, fill: "rgb(var(--surface))" }}
                activeDot={{ r: 5.5, strokeWidth: 2.25, fill: "rgb(var(--surface))" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid overflow-hidden rounded-lg border border-border/70 bg-surface/70 sm:grid-cols-4">
          {metrics.map((metric) => (
            <SummaryCell key={metric.label} metric={metric} cacheHitRate={cacheHitRate} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
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
      "group relative border-b border-border/70 p-2 sm:p-2.5 transition-all duration-300 last:border-b-0 hover:bg-muted/10 sm:border-b-0 sm:border-r sm:last:border-r-0",
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
            <p className="text-base sm:text-lg font-extrabold tracking-tight text-foreground leading-none whitespace-nowrap" title={metric.value}>
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
