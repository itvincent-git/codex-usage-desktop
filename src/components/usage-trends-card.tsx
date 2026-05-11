import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";

type UsageTrendsCardProps = {
  daily: OverviewResponse["daily"];
};

export function UsageTrendsCard({ daily }: UsageTrendsCardProps) {
  const trendData = daily.map((day) => ({
    date: day.date,
    shortDate: formatTrendDateLabel(day.date),
    totalTokens: day.totalTokens,
    costUSD: day.costUSD,
  }));
  const maxDailyTokens = Math.max(...daily.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...daily.map((day) => day.costUSD), 0);
  const tokenAxisWidth = getYAxisWidth(maxDailyTokens, formatNumber, 72);
  const costAxisWidth = getYAxisWidth(maxDailyCost, formatCurrency, 80);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Trends</CardTitle>
        <CardDescription>Total token and cost movement across the selected natural-day window.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Total Token Trend</p>
            <p className="text-sm text-muted-foreground">Daily total tokens from the native SQLite cache.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="shortDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  width={tokenAxisWidth}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => formatNumber(Number(value))}
                />
                <Tooltip
                  formatter={(value) => formatNumber(Number(value))}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                />
                <Line
                  type="monotone"
                  dataKey="totalTokens"
                  stroke="rgb(var(--primary))"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Cost Trend</p>
            <p className="text-sm text-muted-foreground">Estimated USD spend by day for the same window.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="shortDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  width={costAxisWidth}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => formatCurrency(Number(value))}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                />
                <Line
                  type="monotone"
                  dataKey="costUSD"
                  stroke="rgb(var(--secondary))"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
