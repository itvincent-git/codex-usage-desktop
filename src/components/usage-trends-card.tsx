import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatNumber } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";

type UsageTrendsCardProps = {
  daily: OverviewResponse["daily"];
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
    <Card className="rounded-lg">
      <CardHeader className="flex flex-col gap-4 border-b border-border/80 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="space-y-2">
          <CardTitle>Usage Trends</CardTitle>
          <CardDescription>Total token and cost movement across the selected natural-day window.</CardDescription>
          <span className="sr-only">Total Token Trend</span>
          <span className="sr-only">Cost Trend</span>
        </div>
        <div className="flex gap-2 text-xs font-medium text-muted-foreground">
          <span className="rounded-sm border border-border bg-surface px-3 py-2">Tokens & Cost</span>
          <span className="rounded-sm border border-border bg-surface px-3 py-2">Daily</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={trendData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
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
                tick={{ fill: "rgb(37 99 235)", fontSize: 12 }}
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
              <Tooltip
                formatter={(value, name) =>
                  name === "Cost (USD)" ? formatCurrencyShort(Number(value)) : formatNumber(Number(value))
                }
                labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
              />
              <Bar yAxisId="tokens" dataKey="inputTokens" name="Input tokens" stackId="tokens" fill="rgb(37 99 235)" />
              <Bar
                yAxisId="tokens"
                dataKey="cachedInputTokens"
                name="Cached input tokens"
                stackId="tokens"
                fill="rgb(var(--success))"
              />
              <Bar yAxisId="tokens" dataKey="outputTokens" name="Output tokens" stackId="tokens" fill="rgb(124 58 237)" />
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="costUSD"
                name="Cost (USD)"
                stroke="rgb(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid overflow-hidden rounded-lg border border-border/80 sm:grid-cols-4">
          <SummaryCell label="Total Tokens" value={formatCompactNumber(totalTokens)} />
          <SummaryCell label="Total Cost" value={formatCurrencyShort(totalCost)} />
          <SummaryCell
            label="Peak Token Day"
            value={peakTokenDay ? formatCompactNumber(peakTokenDay.totalTokens) : "0"}
            detail={peakTokenDay?.date}
          />
          <SummaryCell
            label="Peak Cost Day"
            value={peakCostDay ? formatCurrencyShort(peakCostDay.costUSD) : "$0.00"}
            detail={peakCostDay?.date}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCell({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="border-border/80 p-4 sm:border-r sm:last:border-r-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-xl font-medium text-foreground">{value}</p>
        {detail ? <p className="pb-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}
