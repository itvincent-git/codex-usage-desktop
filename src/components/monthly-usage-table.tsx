import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyUsageResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";

type MonthlyUsageTableProps = {
  data: MonthlyUsageResponse;
};

export function MonthlyUsageTable({ data }: MonthlyUsageTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Usage</CardTitle>
        <CardDescription>
          Natural-month totals from {data.startMonth} to {data.endMonth} in {data.timezone}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="border-b border-border px-0 pb-3 font-medium">Month</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Total Tokens</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Input</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Cache</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">Output</th>
                <th className="border-b border-border px-0 pb-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((month) => {
                const isInactiveMonth =
                  month.inputTokens === 0 &&
                  month.cachedInputTokens === 0 &&
                  month.outputTokens === 0 &&
                  month.totalTokens === 0 &&
                  month.costUSD === 0;

                return (
                  <tr key={month.month} className="align-top">
                    <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{month.month}</td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {isInactiveMonth ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        formatNumber(month.totalTokens)
                      )}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {isInactiveMonth ? <span className="text-muted-foreground">--</span> : formatNumber(month.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-muted-foreground">
                      {isInactiveMonth ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        formatNumber(month.cachedInputTokens)
                      )}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {isInactiveMonth ? <span className="text-muted-foreground">--</span> : formatNumber(month.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums font-medium text-foreground">
                      {isInactiveMonth ? <span className="text-muted-foreground">--</span> : formatCurrency(month.costUSD)}
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
