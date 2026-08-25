import { invoke } from "@tauri-apps/api/core";

export type RangeKey = "1d" | "2d" | "7d" | "14d" | "30d" | "60d" | "90d" | "180d" | "365d" | string;
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
    pricingStatus: "priced" | "free" | "unavailable";
    inputCostPerMillionTokens: number | null;
    cachedInputCostPerMillionTokens: number | null;
    outputCostPerMillionTokens: number | null;
    effectiveCostPerMillionTokens: number | null;
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

export type ProjectAnalyticsResponse = {
  project: string;
  displayName: string;
  range: RangeKey;
  startDate: string;
  endDate: string;
  timezone: string;
  summary: OverviewResponse["projects"][number];
  models: Array<{ model: string; totalTokens: number }>;
  daily: OverviewResponse["daily"];
};

export type ModelPricingCatalogResponse = {
  isLimited: boolean;
  models: Array<{
    model: string;
    provider: string;
    pricingStatus: "priced" | "free" | "unavailable";
    inputCostPerMillionTokens: number | null;
    cachedInputCostPerMillionTokens: number | null;
    outputCostPerMillionTokens: number | null;
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

export type CodexResetCredit = {
  id: string;
  expiresAt: string | null;
};

export type CodexLimitsResponse = {
  session: CodexLimitWindow | null;
  weekly: CodexLimitWindow | null;
  resetCreditsAvailableCount?: number | null;
  resetCredits?: CodexResetCredit[] | null;
  updatedAt: string;
  source: string;
  account?: string | null;
  membershipLevel?: string | null;
  subscriptionExpiresAt?: string | null;
  subscriptionWillRenew?: boolean | null;
};

export type CodexQuotaForecastResponse = {
  score: number;
  fetchedAt: string;
  nextRefreshAt: string;
};

export type UsageRefreshResponse = {
  scan: ScanResponse;
  limits: CodexLimitsResponse | null;
  limitsError: string | null;
  limitsSkipped: boolean;
  refreshedAt: string;
};

export async function scanUsage(): Promise<ScanResponse> {
  return invoke<ScanResponse>("scan_usage");
}

export async function refreshUsageData(forceLimits: boolean): Promise<UsageRefreshResponse> {
  return invoke<UsageRefreshResponse>("refresh_usage_data", { forceLimits });
}

export async function fetchOverview(range: RangeKey): Promise<OverviewResponse> {
  return invoke<OverviewResponse>("fetch_overview", { range });
}

export async function fetchProjectAnalytics(project: string, range: RangeKey): Promise<ProjectAnalyticsResponse> {
  return invoke<ProjectAnalyticsResponse>("fetch_project_analytics", { project, range });
}

export async function fetchModelPricingCatalog(): Promise<ModelPricingCatalogResponse> {
  return invoke<ModelPricingCatalogResponse>("fetch_model_pricing_catalog");
}

export async function fetchMonthlyUsage(): Promise<MonthlyUsageResponse> {
  return invoke<MonthlyUsageResponse>("fetch_monthly_usage");
}

export async function fetchCodexLimits(): Promise<CodexLimitsResponse> {
  return invoke<CodexLimitsResponse>("fetch_codex_limits");
}

export async function fetchCodexQuotaForecast(): Promise<CodexQuotaForecastResponse> {
  return invoke<CodexQuotaForecastResponse>("fetch_codex_quota_forecast");
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

export type UpdateInstallResponse = {
  version: string;
};

export type UpdateDownloadProgress = {
  downloaded: number;
  total: number | null;
  finished: boolean;
};

export async function checkForUpdates(etag?: string | null): Promise<UpdateCheckResponse> {
  if (etag) {
    return invoke<UpdateCheckResponse>("check_for_updates", { etag });
  }
  return invoke<UpdateCheckResponse>("check_for_updates");
}

export async function downloadAndInstallUpdate(): Promise<UpdateInstallResponse> {
  return invoke<UpdateInstallResponse>("download_and_install_update");
}

export async function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}

export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

export type SessionDailyUsageRow = {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUSD: number;
  models: string[];
  projects: string[];
  quotaUsage?: SessionQuotaUsage | null;
};

export type SessionQuotaWindowUsage = {
  windowMinutes: number;
  resetsAt: string | null;
  observedStartAt: string;
  observedEndAt: string;
  observedStartPercent: number;
  observedEndPercent: number;
  observedDeltaPercent: number;
  belowResolution: boolean;
};

export type SessionQuotaUsage = {
  fiveHour: SessionQuotaWindowUsage[];
  weekly: SessionQuotaWindowUsage[];
};

export type SessionDetailRow = {
  path: string;
  sessionId: string;
  threadName: string | null;
  threadId?: string | null;
  parentThreadId?: string | null;
  agentSessionId?: string | null;
  parentSessionId?: string | null;
  agentDepth?: number;
  agentPath?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
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
  dailyUsage: SessionDailyUsageRow[];
  quotaUsage?: SessionQuotaUsage | null;
};

export async function fetchSessionDetails(): Promise<SessionDetailRow[]> {
  return invoke<SessionDetailRow[]>("fetch_session_details");
}

export type SessionReplayDetail = {
  path: string;
  sessionId: string;
  threadName: string | null;
  modifiedAtMs: number;
  sizeBytes: number;
  rawJsonl: string;
  agents: Array<{
    path: string;
    sessionId: string;
    parentSessionId: string | null;
    depth: number;
    agentPath: string;
    nickname: string | null;
    role: string | null;
    threadName: string | null;
  }>;
  summary: {
    startTime: string | null;
    endTime: string | null;
    durationMs: number | null;
    timeToFirstTokenMs: number | null;
    cwd: string | null;
    projects: string[];
    models: string[];
    cliVersion: string | null;
    git: Record<string, string>;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    costUSD: number;
    turnCount: number;
    messageCount: number;
    toolCallCount: number;
    patchCount: number;
    errorCount: number;
  };
  turns: Array<{
    turnId: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    systemMessages: Array<{ timestamp: string | null; kind: string; text: string }>;
    userMessages: Array<{ timestamp: string | null; kind: string; text: string }>;
    assistantMessages: Array<{ timestamp: string | null; kind: string; text: string }>;
    reasoningSummaries: Array<{ timestamp: string | null; kind: string; text: string }>;
    toolCalls: Array<{
      callId: string | null;
      name: string;
      status: string | null;
      arguments: string | null;
      output: string | null;
      stderr: string | null;
      startedAt: string | null;
      completedAt: string | null;
      durationMs: number | null;
      isError: boolean;
    }>;
    patchResults: Array<{
      callId: string | null;
      success: boolean | null;
      output: string | null;
      timestamp: string | null;
      isError: boolean;
    }>;
    tokenEvents: Array<{
      timestamp: string | null;
      model: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      totalTokens: number;
    }>;
    errors: string[];
    items: Array<
      | { kind: "message"; timestamp: string | null; role: string; source: string; text: string }
      | { kind: "reasoning"; timestamp: string | null; text: string }
      | ({ kind: "toolCall" } & SessionReplayDetail["turns"][number]["toolCalls"][number])
      | ({ kind: "patch" } & SessionReplayDetail["turns"][number]["patchResults"][number])
      | ({ kind: "tokenUsage" } & SessionReplayDetail["turns"][number]["tokenEvents"][number])
      | { kind: "error"; timestamp: string | null; text: string }
      | { kind: "notice"; timestamp: string | null; label: string; text: string | null }
    >;
  }>;
};

export async function fetchSessionDetail(path: string): Promise<SessionReplayDetail> {
  return invoke<SessionReplayDetail>("fetch_session_detail", { path });
}

export type TrayMenuItemDto = {
  id: string;
  text: string;
  enabled: boolean;
};

export type TrayMenuUpdate = {
  title: string;
  items: TrayMenuItemDto[];
  show_main_text?: string;
  quit_text?: string;
};

export async function updateTray(payload: TrayMenuUpdate): Promise<void> {
  return invoke<void>("update_tray", { payload });
}
