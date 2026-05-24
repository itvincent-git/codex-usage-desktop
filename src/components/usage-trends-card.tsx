import { Bar, CartesianGrid, ComposedChart, Line, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatNumber } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";
import type { MetricCardData, MetricCardKind } from "@/lib/usage-dashboard";
import { cn } from "@/lib/utils";

type UsageTrendsCardProps = {
  daily: OverviewResponse["daily"];
  metrics: MetricCardData[];
  cacheHitRate: number;
};

const summaryStyles: Record<MetricCardKind, { accent: string; dot: string }> = {
  tokens: { accent: "group-hover:border-blue-500/30", dot: "bg-blue-500" },
  average: { accent: "group-hover:border-violet-500/30", dot: "bg-violet-500" },
  cache: { accent: "group-hover:border-success/30", dot: "bg-success" },
  costPerMillion: { accent: "group-hover:border-warning/30", dot: "bg-warning" },
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const input = payload.find((p: any) => p.dataKey === "inputTokens")?.value ?? 0;
    const cached = payload.find((p: any) => p.dataKey === "cachedInputTokens")?.value ?? 0;
    const output = payload.find((p: any) => p.dataKey === "outputTokens")?.value ?? 0;
    const cost = payload.find((p: any) => p.dataKey === "costUSD")?.value ?? 0;
    const total = input + cached + output;

    return (
      <div className="rounded-xl border border-border/50 bg-surface/95 backdrop-blur-md p-3.5 shadow-xl select-none min-w-[200px] transition-all duration-300">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </p>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-4 font-semibold text-foreground border-b border-border/50 pb-1.5 mb-1.5">
            <span>Total Tokens</span>
            <span>{formatNumber(total)}</span>
          </div>
          
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500/80" />
              Input Tokens
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(input)}</span>
          </div>
          
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              Cached Input
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(cached)}</span>
          </div>
          
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-500/80" />
              Output Tokens
            </span>
            <span className="font-mono font-medium text-foreground">{formatNumber(output)}</span>
          </div>
          
          <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5 mt-1.5 font-semibold text-primary">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              Estimated Cost
            </span>
            <span className="font-mono">{formatCurrencyShort(cost)}</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export function UsageTrendsCard({ daily, metrics, cacheHitRate }: UsageTrendsCardProps) {
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
    <Card className="rounded-lg h-full flex flex-col">
      <CardHeader className="flex flex-col gap-3.5 border-b border-border/80 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-4.5 shrink-0">
        <div className="space-y-1">
          <CardTitle>Usage Trends</CardTitle>
          <CardDescription>Total token and cost movement across the selected natural-day window.</CardDescription>
          <span className="sr-only">Total Token Trend</span>
          <span className="sr-only">Cost Trend</span>
        </div>
        <div className="flex gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/40 px-3.5 py-1.5 uppercase tracking-wider text-[10px]">
            Tokens & Cost
          </span>
          <span className="rounded-full border border-border bg-muted/40 px-3.5 py-1.5 uppercase tracking-wider text-[10px]">
            Daily
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-4.5 flex-1 flex flex-col justify-between">
        <div className="h-64 flex-1 min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={trendData} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(var(--primary))" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="rgb(var(--primary))" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgb(var(--border) / 0.6)" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="shortDate"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                yAxisId="tokens"
                width={tokenAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--primary) / 0.8)", fontSize: 12 }}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                width={costAxisWidth}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "rgb(var(--primary))", fontSize: 12 }}
                tickFormatter={(value) => formatCurrencyShort(Number(value))}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgb(var(--border))", strokeWidth: 1 }} />
              
              {/* Cost Background Gradient Area */}
              <Area
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                fill="url(#costGradient)"
                stroke="none"
                activeDot={false}
              />
              
              {/* Stacked Bars */}
              <Bar 
                yAxisId="tokens" 
                dataKey="inputTokens" 
                name="Input tokens" 
                stackId="tokens" 
                fill="rgb(var(--primary) / 0.8)" 
              />
              <Bar
                yAxisId="tokens"
                dataKey="cachedInputTokens"
                name="Cached input tokens"
                stackId="tokens"
                fill="rgb(var(--success) / 0.8)"
              />
              <Bar 
                yAxisId="tokens" 
                dataKey="outputTokens" 
                name="Output tokens" 
                stackId="tokens" 
                fill="rgb(168 85 247 / 0.8)" 
                radius={[4, 4, 0, 0]}
              />
              
              {/* Cost Curve Line */}
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                name="Cost (USD)"
                stroke="rgb(var(--primary))"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 1.5, fill: "rgb(var(--surface))" }}
                activeDot={{ r: 6, strokeWidth: 2, fill: "rgb(var(--surface))" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid overflow-hidden rounded-xl border border-border/80 sm:grid-cols-4 shadow-sm">
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
      "group relative border-b border-border/80 bg-surface p-3 transition-all duration-300 last:border-b-0 hover:bg-muted/10 sm:border-b-0 sm:border-r sm:p-3.5 sm:last:border-r-0",
      style.accent,
    )}>
      <div className="flex min-h-14 items-center justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", style.dot)} />
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-none">
              {metric.label}
            </p>
          </div>
          <div className="pt-0.5">
            <p className="text-lg sm:text-xl font-extrabold tracking-tight text-foreground leading-none whitespace-nowrap" title={metric.value}>
              {metric.value}
            </p>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{metric.detail}</p>
          </div>
        </div>
        {metric.kind === "cache" ? <CacheRing value={cacheHitRate} /> : null}
      </div>
    </div>
  );
}

function CacheRing({ value }: { value: number }) {
  const percent = Math.min(Math.max(value * 100, 0), 100);
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-10 w-10" role="img" aria-label={`${Math.round(percent)}% cache hit`}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgb(var(--border))" strokeWidth="8" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgb(var(--success))"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="8"
          transform="rotate(-90 32 32)"
        />
      </svg>
    </div>
  );
}
