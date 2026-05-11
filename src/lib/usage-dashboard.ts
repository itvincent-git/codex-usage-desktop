import type { ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";

export const rangeLabels: Record<RangeKey, string> = {
  "1d": "Last 1 Day",
  "2d": "Last 2 Days",
  "7d": "Last 7 Days",
  "14d": "Last 14 Days",
  "30d": "Last 30 Days",
  "60d": "Last 60 Days",
  "90d": "Last 90 Days",
};

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

export function buildMetricCards(overview: OverviewResponse, range: RangeKey) {
  return [
    {
      label: "Total Tokens",
      value: formatNumber(overview.totals.totalTokens),
      detail: `${rangeLabels[range]} across ${overview.startDate} to ${overview.endDate}`,
    },
    {
      label: "Total Cost",
      value: formatCurrency(overview.totals.costUSD),
      detail: `Estimated local-first spend for ${overview.timezone}`,
    },
    {
      label: "Avg / Day",
      value: `${formatNumber(overview.totals.avgTokensPerDay)} / ${formatCurrency(overview.totals.avgCostPerDay)}`,
      detail: "Normalized by the selected natural-day window.",
    },
    {
      label: "Cache Hit",
      value: formatPercent(overview.totals.cacheHitRate),
      detail: `${formatNumber(overview.totals.cachedInputTokens)} cached input tokens`,
    },
    {
      label: "Cost / 1M",
      value: formatCurrency(overview.totals.costPerMillionTokens),
      detail: "Effective blended cost over all billable tokens.",
    },
  ];
}
