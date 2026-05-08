import { invoke } from "@tauri-apps/api/core";

export type RangeKey = "1d" | "2d" | "7d" | "14d" | "30d" | "60d" | "90d";
export type ExportFormat = "xlsx" | "markdown";

export type OverviewResponse = {
  range: RangeKey;
  days: number;
  timezone: string;
  startDate: string;
  endDate: string;
  updatedAt: string | null;
  daily: Array<{
    date: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
    avgTokensPerDay: number;
    avgCostPerDay: number;
    cacheHitRate: number;
    costPerMillionTokens: number;
  };
  models: Array<{
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
};

export type ScanResponse = {
  importedDays: number;
  scannedAt: string;
  timezone: string;
};

export type ExportResponse = {
  path: string;
  format: ExportFormat;
  range: RangeKey;
  exportedAt: string;
};

export async function scanUsage(): Promise<ScanResponse> {
  return invoke<ScanResponse>("scan_usage");
}

export async function fetchOverview(range: RangeKey): Promise<OverviewResponse> {
  return invoke<OverviewResponse>("fetch_overview", { range });
}

export async function exportUsage(range: RangeKey, format: ExportFormat, path: string): Promise<ExportResponse> {
  return invoke<ExportResponse>("export_usage", { range, format, path });
}
