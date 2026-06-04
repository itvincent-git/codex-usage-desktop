import type { ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatNumber, formatPercent } from "@/lib/formatters";

export type MetricCardKind = "tokens" | "average" | "cache" | "costPerMillion";

export type MetricCardData = {
  kind: MetricCardKind;
  label: string;
  value: string;
  detail: string;
};

export const rangeLabels: Record<string, string> = {
  "1d": "Last 1 Day",
  "2d": "Last 2 Days",
  "7d": "Last 7 Days",
  "14d": "Last 14 Days",
  "30d": "Last 30 Days",
  "60d": "Last 60 Days",
  "90d": "Last 90 Days",
  "180d": "Last 180 Days",
  "365d": "Last 365 Days",
};

export function getRangeLabel(range: RangeKey, t?: (key: string, options?: any) => string): string {
  if (range.startsWith("custom:")) {
    const dates = range.slice("custom:".length).split("_");
    if (dates.length === 2) {
      return `${dates[0]} ~ ${dates[1]}`;
    }
    return range;
  }
  if (t) {
    return t(`ranges.${range}`, { defaultValue: rangeLabels[range] || `Last ${range}` });
  }
  return rangeLabels[range] || `Last ${range}`;
}

export function formatTrendDateLabel(date: string) {
  return date.slice(5);
}

export function getYAxisWidth(maxValue: number, formatter: (value: number) => string, minWidth: number) {
  return Math.max(minWidth, formatter(maxValue).length * 8 + 12);
}

export function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${Math.max(Math.round(ms), 1)}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

export function getExportFileName(range: RangeKey, overview: OverviewResponse, format: ExportFormat) {
  const extension = format === "xlsx" ? "xlsx" : "md";

  return `codex-usage-${range}-${overview.startDate}_to_${overview.endDate}.${extension}`;
}

export function getExportDialogOptions(format: ExportFormat, defaultPath: string) {
  if (format === "xlsx") {
    return {
      title: "Export Codex usage to Excel",
      defaultPath,
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    };
  }

  return {
    title: "Export Codex usage to Markdown",
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
}

export function buildMetricCards(
  overview: OverviewResponse,
  range: RangeKey,
  t?: (key: string, options?: any) => string,
): MetricCardData[] {
  const formatDays = t ? t("metrics.tokens.detail", { days: overview.days }) : `${overview.days}-day total`;
  const formatAvg = t ? t("metrics.average.detail") : "Tokens & cost per day";
  const formatCache = t ? t("metrics.cache.detail", { tokens: formatCompactNumber(overview.totals.cachedInputTokens) }) : `${formatCompactNumber(overview.totals.cachedInputTokens)} cached tokens`;
  const formatCostM = t ? t("metrics.costPerMillion.detail") : "Blended cost per million";

  return [
    {
      kind: "tokens",
      label: t ? t("metrics.tokens.label") : "Token Breakdown",
      value: formatCompactNumber(overview.totals.totalTokens),
      detail: formatDays,
    },
    {
      kind: "average",
      label: t ? t("metrics.average.label") : "Avg / Day",
      value: `${formatCompactNumber(overview.totals.avgTokensPerDay)} / ${formatCurrencyShort(overview.totals.avgCostPerDay)}`,
      detail: formatAvg,
    },
    {
      kind: "cache",
      label: t ? t("metrics.cache.label") : "Cache Hit",
      value: formatPercent(overview.totals.cacheHitRate),
      detail: formatCache,
    },
    {
      kind: "costPerMillion",
      label: t ? t("metrics.costPerMillion.label") : "Cost / 1M",
      value: `${formatCurrencyShort(overview.totals.costPerMillionTokens)}`,
      detail: formatCostM,
    },
  ];
}
