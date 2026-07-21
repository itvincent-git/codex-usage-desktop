import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OverviewResponse, RangeKey } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { getRangeLabel } from "@/lib/usage-dashboard";
import { ArrowDown, ArrowUp } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type DailyUsageTableProps = {
  range: RangeKey;
  daily: OverviewResponse["daily"];
  onRowClick?: (date: string) => void;
};

type DailyRow = OverviewResponse["daily"][number];
type SortField = "date" | "totalTokens" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "costUSD";
type SortDirection = "asc" | "desc";

type DisplayRow =
  | { type: "active"; day: DailyRow }
  | { type: "inactive"; startDate: string; endDate: string; days: DailyRow[] };

const sortFields: SortField[] = ["date", "totalTokens", "inputTokens", "cachedInputTokens", "outputTokens", "costUSD"];

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

function groupInactiveDays(rows: DailyRow[]): DisplayRow[] {
  return rows.reduce<DisplayRow[]>((displayRows, day) => {
    if (!isInactiveDay(day)) {
      displayRows.push({ type: "active", day });
      return displayRows;
    }

    const previousRow = displayRows.at(-1);
    if (
      previousRow?.type === "inactive" &&
      areConsecutiveDates(previousRow.days[previousRow.days.length - 1].date, day.date)
    ) {
      previousRow.days.push(day);
      previousRow.startDate = day.date < previousRow.startDate ? day.date : previousRow.startDate;
      previousRow.endDate = day.date > previousRow.endDate ? day.date : previousRow.endDate;
      return displayRows;
    }

    displayRows.push({ type: "inactive", startDate: day.date, endDate: day.date, days: [day] });
    return displayRows;
  }, []);
}

function buildDisplayRows(daily: OverviewResponse["daily"], field: SortField, direction: SortDirection): DisplayRow[] {
  const dateDescending = (left: DailyRow, right: DailyRow) => right.date.localeCompare(left.date);

  if (field === "date") {
    const sorted = [...daily].sort((left, right) => {
      const comparison = left.date.localeCompare(right.date);
      return direction === "asc" ? comparison : -comparison;
    });
    return groupInactiveDays(sorted);
  }

  const active = daily.filter((day) => !isInactiveDay(day)).sort((left, right) => {
    const comparison = left[field] - right[field];
    return comparison === 0 ? dateDescending(left, right) : direction === "asc" ? comparison : -comparison;
  });
  const inactive = daily.filter(isInactiveDay).sort(dateDescending);
  return [...active.map((day): DisplayRow => ({ type: "active", day })), ...groupInactiveDays(inactive)];
}

function PeakBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
      {label}
    </span>
  );
}

export function DailyUsageTable({ range, daily, onRowClick }: DailyUsageTableProps) {
  const { t, i18n } = useTranslation();
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { displayRows, peaks } = useMemo(() => {
    const nextPeaks = {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
    };
    for (const day of daily) {
      nextPeaks.totalTokens = Math.max(nextPeaks.totalTokens, day.totalTokens);
      nextPeaks.inputTokens = Math.max(nextPeaks.inputTokens, day.inputTokens);
      nextPeaks.cachedInputTokens = Math.max(nextPeaks.cachedInputTokens, day.cachedInputTokens);
      nextPeaks.outputTokens = Math.max(nextPeaks.outputTokens, day.outputTokens);
      nextPeaks.costUSD = Math.max(nextPeaks.costUSD, day.costUSD);
    }
    return {
      displayRows: buildDisplayRows(daily, sortField, sortDirection),
      peaks: nextPeaks,
    };
  }, [daily, sortDirection, sortField]);

  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: "short", timeZone: "UTC" }),
    [i18n.language, i18n.resolvedLanguage],
  );
  const peakLabel = t("daily.peak");

  const openDay = (day: DailyRow) => onRowClick?.(day.date);
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, day: DailyRow) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDay(day);
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>{t("daily.comparison_range", { range: getRangeLabel(range, t) })}</span>
            <span className="inline-flex items-center gap-3" aria-label={t("daily.token_legend_label")}>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />{t("daily.uncached_input")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t("daily.cached_input")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" />{t("daily.output")}</span>
            </span>
            <span aria-label={t("daily.cost_legend_label")}>
              {t("daily.cost_scale")} <span className="text-emerald-600">●</span> ≤⅓ <span className="text-amber-500">●</span> ≤⅔ <span className="text-rose-500">●</span> &gt;⅔
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground" htmlFor="daily-sort">{t("daily.sort.label")}</label>
            <Select
              value={sortField}
              onValueChange={(value) => {
                setSortField(value as SortField);
                setSortDirection("desc");
              }}
            >
              <SelectTrigger id="daily-sort" className="h-9 w-[150px]" aria-label={t("daily.sort.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortFields.map((field) => <SelectItem key={field} value={field}>{t(`daily.sort.${field}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-foreground transition hover:bg-muted focus:ring-2 focus:ring-indigo-500"
              aria-label={sortDirection === "desc" ? t("daily.sort.desc") : t("daily.sort.asc")}
              title={sortDirection === "desc" ? t("daily.sort.desc") : t("daily.sort.asc")}
              onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")}
            >
              {sortDirection === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {displayRows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("daily.no_data")}</p>
        ) : (
          <div className="overflow-x-auto px-4 sm:px-6">
            <table className="min-w-[680px] w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="w-40 border-b border-border py-3 font-medium">{t("daily.cols.date")}</th>
                  <th className="border-b border-border px-4 py-3 font-medium">{t("daily.cols.tokens")}</th>
                  <th className="w-52 border-b border-border py-3 text-right font-medium">{t("daily.cols.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  if (row.type === "inactive") {
                    const dateLabel = row.startDate === row.endDate
                      ? row.startDate
                      : t("daily.date_range", { start: row.startDate, end: row.endDate });
                    const activityLabel = row.days.length === 1
                      ? t("daily.no_activity")
                      : t("daily.no_activity_days", { count: row.days.length });
                    return (
                      <tr key={`inactive-${row.startDate}-${row.endDate}`} className="daily-usage-row align-top">
                        <td className="border-b border-border/70 py-4 font-medium text-foreground">{dateLabel}</td>
                        <td className="border-b border-border/70 px-4 py-4"><span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{activityLabel}</span></td>
                        <td className="border-b border-border/70 py-4 text-right text-muted-foreground">--</td>
                      </tr>
                    );
                  }

                  const { day } = row;
                  const nonCachedInput = Math.max(day.inputTokens - day.cachedInputTokens, 0);
                  const totalWidth = peaks.totalTokens > 0 ? day.totalTokens / peaks.totalTokens * 100 : 0;
                  const segmentTotal = nonCachedInput + day.cachedInputTokens + day.outputTokens;
                  const cacheHitRate = day.inputTokens > 0 ? day.cachedInputTokens / day.inputTokens : 0;
                  const costRatio = peaks.costUSD > 0 ? day.costUSD / peaks.costUSD : 0;
                  const costTone = day.costUSD === 0
                    ? "zero"
                    : costRatio <= 1 / 3 + Number.EPSILON * 4
                      ? "low"
                      : costRatio <= 2 / 3 + Number.EPSILON * 4
                        ? "medium"
                        : "high";
                  const weekday = weekdayFormatter.format(new Date(`${day.date}T00:00:00Z`));

                  return (
                    <tr
                      key={day.date}
                      className={`daily-usage-row group align-top ${onRowClick ? "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none" : ""}`}
                      data-daily-row={day.date}
                      onClick={() => openDay(day)}
                      onKeyDown={(event) => handleRowKeyDown(event, day)}
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-label={onRowClick ? t("daily.open_sessions", { date: day.date }) : undefined}
                    >
                      <td className="border-b border-border/70 py-4 font-medium text-foreground transition-colors group-hover:text-primary">
                        <div>{day.date}</div><div className="mt-1 text-xs font-normal text-muted-foreground">{weekday}</div>
                      </td>
                      <td className="border-b border-border/70 px-4 py-4">
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2 font-semibold text-foreground" data-metric="totalTokens">
                            {formatNumber(day.totalTokens)}
                            {day.totalTokens > 0 && day.totalTokens === peaks.totalTokens ? <PeakBadge label={peakLabel} /> : null}
                          </div>
                          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-label={t("daily.total_bar_label", { total: formatNumber(day.totalTokens), percent: formatPercent(totalWidth / 100) })}>
                            <div className="flex h-full overflow-hidden rounded-full" data-token-bar style={{ width: `${totalWidth}%` }}>
                              <span className="h-full bg-blue-500" data-token-segment="uncached" style={{ width: `${segmentTotal > 0 ? nonCachedInput / segmentTotal * 100 : 0}%` }} />
                              <span className="h-full bg-emerald-500" data-token-segment="cached" style={{ width: `${segmentTotal > 0 ? day.cachedInputTokens / segmentTotal * 100 : 0}%` }} />
                              <span className="h-full bg-violet-500" data-token-segment="output" style={{ width: `${segmentTotal > 0 ? day.outputTokens / segmentTotal * 100 : 0}%` }} />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label={t("daily.token_bar_label", { input: formatNumber(nonCachedInput), cached: formatNumber(day.cachedInputTokens), output: formatNumber(day.outputTokens), total: formatNumber(day.totalTokens) })}>
                            <span className="inline-flex items-center gap-1.5" data-metric="inputTokens">{t("daily.input_including_cache")} <strong className="font-medium text-foreground">{formatNumber(day.inputTokens)}</strong>{day.inputTokens > 0 && day.inputTokens === peaks.inputTokens ? <PeakBadge label={peakLabel} /> : null}</span>
                            <span className="inline-flex items-center gap-1.5" data-metric="cachedInputTokens">{t("daily.cached_with_rate", { rate: formatPercent(cacheHitRate) })} <strong className="font-medium text-foreground">{formatNumber(day.cachedInputTokens)}</strong>{day.cachedInputTokens > 0 && day.cachedInputTokens === peaks.cachedInputTokens ? <PeakBadge label={peakLabel} /> : null}</span>
                            <span className="inline-flex items-center gap-1.5" data-metric="outputTokens">{t("daily.output")} <strong className="font-medium text-foreground">{formatNumber(day.outputTokens)}</strong>{day.outputTokens > 0 && day.outputTokens === peaks.outputTokens ? <PeakBadge label={peakLabel} /> : null}</span>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-border/70 py-4 text-right tabular-nums">
                        <div className="ml-auto w-full max-w-44 space-y-2">
                          <div className="flex items-center justify-end gap-2 font-medium text-foreground" data-metric="costUSD">{formatCurrency(day.costUSD)}{day.costUSD > 0 && day.costUSD === peaks.costUSD ? <PeakBadge label={peakLabel} /> : null}</div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={t("daily.cost_bar_label", { cost: formatCurrency(day.costUSD), percent: formatPercent(costRatio) })}>
                            <div
                              className={`h-full rounded-full ${costTone === "low" ? "bg-emerald-500" : costTone === "medium" ? "bg-amber-500" : costTone === "high" ? "bg-rose-500" : "bg-muted-foreground/25"}`}
                              data-cost-bar
                              data-cost-tone={costTone}
                              style={{ width: `${costRatio * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
