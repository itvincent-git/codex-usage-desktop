import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse, RangeKey } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { rangeLabels } from "@/lib/usage-dashboard";

type DailyUsageTableProps = {
  range: RangeKey;
  daily: OverviewResponse["daily"];
};

export function DailyUsageTable({ range, daily }: DailyUsageTableProps) {
  const maxDailyTokens = Math.max(...daily.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...daily.map((day) => day.costUSD), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{rangeLabels[range]}</CardTitle>
        <CardDescription>Natural-day buckets written from the native cache after the latest scan.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="border-b border-border px-0 pb-3 font-medium">Date</th>
                <th className="border-b border-border px-4 pb-3 font-medium">Total Tokens</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Input</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Cache</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Output</th>
                <th className="border-b border-border px-0 pb-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => {
                const isInactiveDay =
                  day.inputTokens === 0 &&
                  day.cachedInputTokens === 0 &&
                  day.outputTokens === 0 &&
                  day.totalTokens === 0 &&
                  day.costUSD === 0;
                const tokenBarWidth = `${Math.max((day.totalTokens / maxDailyTokens) * 100, 6)}%`;
                const cacheHitRate = day.inputTokens > 0 ? day.cachedInputTokens / day.inputTokens : 0;
                const costHeat = maxDailyCost > 0 ? day.costUSD / maxDailyCost : 0;
                const costHeatAlpha = 0.1 + costHeat * 0.22;

                return (
                  <tr key={day.date} className="align-top">
                    <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{day.date}</td>
                    <td className="border-b border-border/70 px-4 py-4">
                      {isInactiveDay ? (
                        <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                          No activity
                        </span>
                      ) : (
                        <div className="space-y-2">
                          <div className="font-medium text-foreground">{formatNumber(day.totalTokens)}</div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              aria-hidden="true"
                              className="h-full rounded-full bg-primary/80"
                              style={{ width: tokenBarWidth }}
                            />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {isInactiveDay ? <span className="text-muted-foreground">--</span> : formatNumber(day.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right">
                      {isInactiveDay ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        <div className="flex flex-col items-end gap-2">
                          <span className="tabular-nums text-muted-foreground">
                            {formatNumber(day.cachedInputTokens)}
                          </span>
                          <span className="rounded-full bg-secondary/10 px-2 py-1 text-[11px] font-medium text-secondary">
                            {formatPercent(cacheHitRate)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {isInactiveDay ? <span className="text-muted-foreground">--</span> : formatNumber(day.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums">
                      {isInactiveDay ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        <span
                          className="inline-flex rounded-full px-3 py-1 font-medium text-foreground"
                          style={{ backgroundColor: `rgb(var(--secondary) / ${costHeatAlpha})` }}
                        >
                          {formatCurrency(day.costUSD)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
