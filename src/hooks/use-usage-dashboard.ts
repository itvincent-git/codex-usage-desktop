import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  exportUsage,
  fetchCodexLimits,
  fetchMonthlyUsage,
  fetchOverview,
  resetUsageState,
  type CodexLimitsResponse,
  scanUsage,
  type ExportFormat,
  type MonthlyUsageResponse,
  type OverviewResponse,
  type RangeKey,
} from "@/lib/api";
import type { DashboardView } from "@/components/dashboard-header";
import { getExportDialogOptions, getExportFileName, rangeLabels } from "@/lib/usage-dashboard";

export function useUsageDashboard() {
  const [view, setView] = useState<DashboardView>("dashboard");
  const [range, setRange] = useState<RangeKey>("30d");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [monthlyUsage, setMonthlyUsage] = useState<MonthlyUsageResponse | null>(null);
  const [codexLimits, setCodexLimits] = useState<CodexLimitsResponse | null>(null);
  const [codexLimitsError, setCodexLimitsError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState("Sync local Codex usage into the desktop cache.");
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMonthlyLoading, setIsMonthlyLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);
  const [lastRescanDurationMs, setLastRescanDurationMs] = useState<number | null>(null);
  const hasBootstrappedRef = useRef(false);

  const loadOverview = useEffectEvent(async (nextRange: RangeKey) => {
    const data = await fetchOverview(nextRange);
    setOverview(data);
    setError(null);
  });

  const loadMonthlyUsage = useEffectEvent(async () => {
    const data = await fetchMonthlyUsage();
    setMonthlyUsage(data);
    setError(null);
  });

  const loadCodexLimits = useEffectEvent(async () => {
    try {
      const data = await fetchCodexLimits();
      setCodexLimits(data);
      setCodexLimitsError(null);
    } catch (limitsError) {
      setCodexLimitsError(errorMessage(limitsError, "Failed to load Codex limits."));
    }
  });

  const scanAndReloadOverview = useEffectEvent(async (startedAt: number) => {
    const scan = await scanUsage();
    const cacheMessage = scan.metrics
      ? ` Parsed ${scan.metrics.filesParsed}, reused ${scan.metrics.filesReused}.`
      : "";
    setScanMessage(`Imported ${scan.importedDays} day buckets into the local cache.${cacheMessage}`);
    
    await Promise.all([loadOverview(range), loadCodexLimits()]);
    
    if (view === "monthly") {
      await loadMonthlyUsage();
    }
    setLastRescanDurationMs(performance.now() - startedAt);
  });

  const bootstrap = useEffectEvent(async () => {
    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    setIsLoading(true);

    try {
      // Do not block initial render on limits fetch
      void loadCodexLimits();
      await loadOverview(range);
      setBootstrapped(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load overview.");
      return;
    } finally {
      setIsLoading(false);
    }

    const startedAt = performance.now();
    void scanAndReloadOverview(startedAt).catch((scanError: unknown) => {
      setError(scanError instanceof Error ? scanError.message : "Background refresh failed.");
    });
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function handleViewChange(nextView: DashboardView) {
    setView(nextView);

    if (nextView !== "monthly" || monthlyUsage || !bootstrapped) {
      return;
    }

    setIsMonthlyLoading(true);

    try {
      await loadMonthlyUsage();
    } catch (monthlyError) {
      setError(monthlyError instanceof Error ? monthlyError.message : "Failed to load monthly usage.");
    } finally {
      setIsMonthlyLoading(false);
    }
  }

  async function handleRangeChange(nextRange: RangeKey) {
    setRange(nextRange);

    if (!bootstrapped) {
      return;
    }

    setIsLoading(true);

    try {
      await loadOverview(nextRange);
    } catch (rangeError) {
      setError(rangeError instanceof Error ? rangeError.message : "Failed to switch range.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    const startedAt = performance.now();

    try {
      await scanAndReloadOverview(startedAt);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(
      "Reset cached usage and pricing data, then rebuild it from local Codex logs? Source logs will not be deleted.",
    );
    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    setMonthlyUsage(null);
    setScanMessage("Resetting local cache and rebuilding usage data.");
    const startedAt = performance.now();

    try {
      await resetUsageState();
      await scanAndReloadOverview(startedAt);
      setScanMessage("Reset local cache and rebuilt usage data from local Codex logs.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Reset failed.");
    } finally {
      setIsResetting(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!overview || isLoading || isResetting) {
      return;
    }

    const selectedPath = await save(getExportDialogOptions(format, getExportFileName(range, overview, format)));
    if (!selectedPath) {
      return;
    }

    setIsExporting(format);

    try {
      const exported = await exportUsage(range, format, selectedPath);
      setScanMessage(`Exported ${rangeLabels[range]} to ${exported.path}.`);
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setIsExporting(null);
    }
  }

  return {
    view,
    range,
    overview,
    monthlyUsage,
    codexLimits,
    codexLimitsError,
    scanMessage,
    error,
    isLoading,
    isMonthlyLoading,
    isRefreshing,
    isResetting,
    isExporting,
    lastRescanDurationMs,
    handleViewChange,
    handleRangeChange,
    handleRefresh,
    handleReset,
    handleExport,
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}
