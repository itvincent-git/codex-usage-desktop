import { Bar, CartesianGrid, ComposedChart, Line, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatNumber } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";
import { cn } from "@/lib/utils";
import { Activity, Coins, TrendingUp, Sparkles } from "lucide-react";

type UsageTrendsCardProps = {
  daily: OverviewResponse["daily"];
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

export function UsageTrendsCard({ daily }: UsageTrendsCardProps) {
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
  const totalTokens = daily.reduce((sum, day) => sum + day.totalTokens, 0);
  const totalCost = daily.reduce((sum, day) => sum + day.costUSD, 0);

  const peakTokenDay = daily.reduce<OverviewResponse["daily"][number] | null>(
    (peak, day) => (!peak || day.totalTokens > peak.totalTokens ? day : peak),
    null,
  );
  const peakCostDay = daily.reduce<OverviewResponse["daily"][number] | null>(
    (peak, day) => (!peak || day.costUSD > peak.costUSD ? day : peak),
    null,
  );

  return (
    <Card className="rounded-lg h-full flex flex-col">
      <CardHeader className="flex flex-col gap-4 border-b border-border/80 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6 shrink-0">
        <div className="space-y-2">
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
      <CardContent className="space-y-5 p-5 sm:p-6 flex-1 flex flex-col justify-between">
        <div className="h-80 flex-1 min-h-[320px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={trendData} margin={{ top: 20, right: 20, left: 20, bottom: 8 }}>
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
          <SummaryCell 
            label="Total Tokens" 
            value={formatCompactNumber(totalTokens)} 
            icon={Activity}
            iconColor="text-indigo-500 bg-indigo-500/10"
          />
          <SummaryCell 
            label="Total Cost" 
            value={formatCurrencyShort(totalCost)} 
            icon={Coins}
            iconColor="text-emerald-500 bg-emerald-500/10"
          />
          <SummaryCell
            label="Peak Token"
            value={peakTokenDay ? formatCompactNumber(peakTokenDay.totalTokens) : "0"}
            detail={peakTokenDay ? formatTrendDateLabel(peakTokenDay.date) : undefined}
            icon={TrendingUp}
            iconColor="text-purple-500 bg-purple-500/10"
            badgeClass="text-purple-500 bg-purple-500/10 border-purple-500/20"
          />
          <SummaryCell
            label="Peak Cost"
            value={peakCostDay ? formatCurrencyShort(peakCostDay.costUSD) : "$0.00"}
            detail={peakCostDay ? formatTrendDateLabel(peakCostDay.date) : undefined}
            icon={Sparkles}
            iconColor="text-amber-500 bg-amber-500/10"
            badgeClass="text-amber-500 bg-amber-500/10 border-amber-500/20"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  icon: Icon,
  iconColor,
  badgeClass,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  badgeClass?: string;
}) {
  return (
    <div className="group relative border-b last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 border-border/80 p-4 sm:p-5 bg-surface transition-all duration-300 hover:bg-muted/10">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="space-y-1.5 flex-1 min-w-0">
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-none">{label}</p>
          <div className="pt-0.5">
            <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground leading-none whitespace-nowrap" title={value}>{value}</p>
            {detail ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-none whitespace-nowrap">Peak:</span>
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded leading-none uppercase tracking-wider whitespace-nowrap border border-transparent",
                  badgeClass || "text-muted-foreground bg-muted/50 border-border/50"
                )}>
                  {detail}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className={cn("p-2 sm:p-2.5 rounded-lg group-hover:scale-110 transition-all duration-300 shrink-0", iconColor)}>
          <Icon className="h-4 sm:h-4.5 w-4 sm:w-4.5" />
        </div>
      </div>
    </div>
  );
}
