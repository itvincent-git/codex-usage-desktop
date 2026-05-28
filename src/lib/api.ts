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
  projects: Array<{
    project: string;
    displayName: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
};

export type MonthlyUsageResponse = {
  timezone: string;
  startMonth: string;
  endMonth: string;
  updatedAt: string | null;
  monthly: Array<{
    month: string;
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
  metrics?: {
    totalMs: number;
    pricingMs: number;
    parseMs: number;
    dbMs: number;
    filesScanned: number;
    filesParsed: number;
    filesReused: number;
    bytesRead: number;
  };
};

export type ExportResponse = {
  path: string;
  format: ExportFormat;
  range: RangeKey;
  exportedAt: string;
};

export type CodexLimitWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
};

export type CodexLimitsResponse = {
  session: CodexLimitWindow | null;
  weekly: CodexLimitWindow | null;
  updatedAt: string;
  source: string;
  account?: string | null;
  membershipLevel?: string | null;
  subscriptionExpiresAt?: string | null;
  subscriptionWillRenew?: boolean | null;
};

export async function scanUsage(): Promise<ScanResponse> {
  return invoke<ScanResponse>("scan_usage");
}

export async function fetchOverview(range: RangeKey): Promise<OverviewResponse> {
  return invoke<OverviewResponse>("fetch_overview", { range });
}

export async function fetchMonthlyUsage(): Promise<MonthlyUsageResponse> {
  return invoke<MonthlyUsageResponse>("fetch_monthly_usage");
}

export async function fetchCodexLimits(): Promise<CodexLimitsResponse> {
  return invoke<CodexLimitsResponse>("fetch_codex_limits");
}

export async function resetUsageState(): Promise<void> {
  return invoke<void>("reset_usage_state");
}

export async function exportUsage(range: RangeKey, format: ExportFormat, path: string): Promise<ExportResponse> {
  return invoke<ExportResponse>("export_usage", { range, format, path });
}

export type UpdateCheckResponse = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  latestTag: string;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string;
  etag?: string | null;
  notModified?: boolean | null;
};

export async function checkForUpdates(etag?: string | null): Promise<UpdateCheckResponse> {
  if (etag) {
    return invoke<UpdateCheckResponse>("check_for_updates", { etag });
  }
  return invoke<UpdateCheckResponse>("check_for_updates");
}

export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

export type SessionDetailRow = {
  path: string;
  sessionId: string;
  modifiedAtMs: number;
  sizeBytes: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUSD: number;
  models: string[];
  projects: string[];
};

export async function fetchSessionDetails(): Promise<SessionDetailRow[]> {
  return invoke<SessionDetailRow[]>("fetch_session_details");
}

