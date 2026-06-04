import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse, RangeKey } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { getRangeLabel } from "@/lib/usage-dashboard";
import { useTranslation } from "react-i18next";

type DailyUsageTableProps = {
  range: RangeKey;
  daily: OverviewResponse["daily"];
  onRowClick?: (date: string) => void;
};

type DailyRow = OverviewResponse["daily"][number];

type DisplayRow =
  | { type: "active"; day: DailyRow }
  | { type: "inactive"; startDate: string; endDate: string; days: DailyRow[] };

function isInactiveDay(day: DailyRow) {
  return (
    day.inputTokens === 0 &&
    day.cachedInputTokens === 0 &&
    day.outputTokens === 0 &&
    day.totalTokens === 0 &&
    day.costUSD === 0
  );
}

function getDayOrdinal(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function areConsecutiveDates(left: string, right: string) {
  return Math.abs(getDayOrdinal(left) - getDayOrdinal(right)) === 1;
}

function buildDisplayRows(daily: OverviewResponse["daily"]): DisplayRow[] {
  return daily.reduce<DisplayRow[]>((rows, day) => {
    if (!isInactiveDay(day)) {
      rows.push({ type: "active", day });
      return rows;
    }

    const previousRow = rows.at(-1);

    if (
      previousRow?.type === "inactive" &&
      areConsecutiveDates(previousRow.days[previousRow.days.length - 1].date, day.date)
    ) {
      previousRow.days.push(day);
      previousRow.startDate = day.date < previousRow.startDate ? day.date : previousRow.startDate;
      previousRow.endDate = day.date > previousRow.endDate ? day.date : previousRow.endDate;
      return rows;
    }

    rows.push({ type: "inactive", startDate: day.date, endDate: day.date, days: [day] });
    return rows;
  }, []);
}

export function DailyUsageTable({ range, daily, onRowClick }: DailyUsageTableProps) {
  const { t } = useTranslation();
  const maxDailyTokens = Math.max(...daily.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...daily.map((day) => day.costUSD), 0);
  const displayRows = buildDisplayRows(daily);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{getRangeLabel(range, t)}</CardTitle>
        <CardDescription>{t("daily.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="border-b border-border px-0 pb-3 font-medium">{t("daily.cols.date")}</th>
                <th className="border-b border-border px-4 pb-3 font-medium">{t("daily.cols.tokens")}</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">{t("project_modal.input", { defaultValue: "Input" })}</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">{t("common.cache")}</th>
                <th className="border-b border-border px-4 pb-3 text-right font-medium">{t("project_modal.output", { defaultValue: "Output" })}</th>
                <th className="border-b border-border px-0 pb-3 text-right font-medium">{t("daily.cols.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                if (row.type === "inactive") {
                  const dateLabel = row.startDate === row.endDate ? row.startDate : t("daily.date_range", { start: row.startDate, end: row.endDate, defaultValue: `${row.startDate} to ${row.endDate}` });
                  const activityLabel =
                    row.days.length === 1 
                      ? t("daily.no_activity", { defaultValue: "No activity" }) 
                      : t("daily.no_activity_days", { count: row.days.length, defaultValue: `No activity (${row.days.length} days)` });

                  return (
                    <tr key={`inactive-${row.startDate}-${row.endDate}`} className="align-top">
                      <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{dateLabel}</td>
                      <td className="border-b border-border/70 px-4 py-4">
                        <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                          {activityLabel}
                        </span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                        <span className="text-muted-foreground">--</span>
                      </td>
                      <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums">
                        <span className="text-muted-foreground">--</span>
                      </td>
                    </tr>
                  );
                }

                const { day } = row;
                const tokenBarWidth = `${Math.max((day.totalTokens / maxDailyTokens) * 100, 6)}%`;
                const cacheHitRate = day.inputTokens > 0 ? day.cachedInputTokens / day.inputTokens : 0;
                const costHeat = maxDailyCost > 0 ? day.costUSD / maxDailyCost : 0;
                const costHeatAlpha = 0.1 + costHeat * 0.22;

                return (
                  <tr
                    key={day.date}
                    className={`align-top group ${
                      onRowClick
                        ? "cursor-pointer transition-colors duration-150 hover:bg-muted/40"
                        : ""
                    }`}
                    onClick={() => onRowClick?.(day.date)}
                  >
                    <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground transition-colors group-hover:text-primary">{day.date}</td>
                    <td className="border-b border-border/70 px-4 py-4">
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
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(day.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right">
                      <div className="flex flex-col items-end gap-2">
                        <span className="tabular-nums text-muted-foreground">{formatNumber(day.cachedInputTokens)}</span>
                        <span className="rounded-full bg-secondary/10 px-2 py-1 text-[11px] font-medium text-secondary">
                          {formatPercent(cacheHitRate)}
                        </span>
                      </div>
                    </td>
                    <td className="border-b border-border/70 px-4 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(day.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums">
                      <span
                        className="inline-flex rounded-full px-3 py-1 font-medium text-foreground"
                        style={{ backgroundColor: `rgb(var(--secondary) / ${costHeatAlpha})` }}
                      >
                        {formatCurrency(day.costUSD)}
                      </span>
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
