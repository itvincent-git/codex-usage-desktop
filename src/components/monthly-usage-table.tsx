import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyUsageResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";

type MonthlyUsageTableProps = {
  data: MonthlyUsageResponse;
};

type MonthlyRow = MonthlyUsageResponse["monthly"][number];

type DisplayRow =
  | { type: "active"; month: MonthlyRow }
  | { type: "inactive"; startMonth: string; endMonth: string; months: MonthlyRow[] };

function isInactiveMonth(month: MonthlyRow) {
  return (
    month.inputTokens === 0 &&
    month.cachedInputTokens === 0 &&
    month.outputTokens === 0 &&
    month.totalTokens === 0 &&
    month.costUSD === 0
  );
}

function getMonthOrdinal(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber;
}

function areConsecutiveMonths(left: string, right: string) {
  return Math.abs(getMonthOrdinal(left) - getMonthOrdinal(right)) === 1;
}

function buildDisplayRows(monthly: MonthlyUsageResponse["monthly"]): DisplayRow[] {
  return monthly.reduce<DisplayRow[]>((rows, month) => {
    if (!isInactiveMonth(month)) {
      rows.push({ type: "active", month });
      return rows;
    }

    const previousRow = rows.at(-1);

    if (
      previousRow?.type === "inactive" &&
      areConsecutiveMonths(previousRow.months[previousRow.months.length - 1].month, month.month)
    ) {
      previousRow.months.push(month);
      previousRow.startMonth = month.month < previousRow.startMonth ? month.month : previousRow.startMonth;
      previousRow.endMonth = month.month > previousRow.endMonth ? month.month : previousRow.endMonth;
      return rows;
    }

    rows.push({ type: "inactive", startMonth: month.month, endMonth: month.month, months: [month] });
    return rows;
  }, []);
}

export function MonthlyUsageTable({ data }: MonthlyUsageTableProps) {
  const displayRows = buildDisplayRows(data.monthly);

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
              {displayRows.map((row) => {
                if (row.type === "inactive") {
                  const monthLabel =
                    row.startMonth === row.endMonth ? row.startMonth : `${row.startMonth} to ${row.endMonth}`;
                  const usageLabel = row.months.length === 1 ? "No usage" : `No usage (${row.months.length} months)`;

                  return (
                    <tr key={`inactive-${row.startMonth}-${row.endMonth}`} className="align-top">
                      <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{monthLabel}</td>
                      <td className="border-b border-border/70 px-4 py-4 text-right">
                        <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                          {usageLabel}
                        </span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-muted-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums font-medium text-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                    </tr>
                  );
                }

                const { month } = row;

                return (
                  <tr key={month.month} className="align-top">
                    <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{month.month}</td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(month.totalTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(month.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-muted-foreground">
                      {formatNumber(month.cachedInputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(month.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(month.costUSD)}
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
