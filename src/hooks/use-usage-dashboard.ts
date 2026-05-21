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
  checkForUpdates,
  openUrl,
  type UpdateCheckResponse,
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
  
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [isUpdateChecking, setIsUpdateChecking] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [isUpdateDismissed, setIsUpdateDismissed] = useState(false);

  const hasBootstrappedRef = useRef(false);
  const hiddenSinceRef = useRef<number | null>(null);
  const lastLimitsFetchTimeRef = useRef<number>(0);

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

  const loadCodexLimits = useEffectEvent(async (options?: { force?: boolean }) => {
    const now = Date.now();
    const isManual = options?.force === true;
    if (!isManual && now - lastLimitsFetchTimeRef.current < 5000) {
      return;
    }

    lastLimitsFetchTimeRef.current = now;

    try {
      const data = await fetchCodexLimits();
      setCodexLimits(data);
      setCodexLimitsError(null);
    } catch (limitsError) {
      setCodexLimitsError(errorMessage(limitsError, "Failed to load Codex limits."));
    }
  });

  const scanAndReloadOverview = useEffectEvent(async (startedAt: number, options?: { force?: boolean }) => {
    const scan = await scanUsage();
    const cacheMessage = scan.metrics
      ? ` Parsed ${scan.metrics.filesParsed}, reused ${scan.metrics.filesReused}.`
      : "";
    setScanMessage(`Imported ${scan.importedDays} day buckets into the local cache.${cacheMessage}`);
    
    await Promise.all([loadOverview(range), loadCodexLimits(options)]);
    
    if (view === "monthly") {
      await loadMonthlyUsage();
    }
    setLastRescanDurationMs(performance.now() - startedAt);
  });

  const runBackgroundUpdateCheck = useEffectEvent(async () => {
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      if (info.hasUpdate) {
        const dismissedTag = localStorage.getItem("dismissed_update_tag");
        if (dismissedTag === info.latestTag) {
          setIsUpdateDismissed(true);
        }
      }
    } catch (e) {
      console.warn("Background update check failed", e);
    }
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

    void runBackgroundUpdateCheck();
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Re-fetch limits when the page/window regains focus or visibility after being inactive ≥60 s.
  useEffect(() => {
    if (!bootstrapped) return;

    const STALE_MS = 60_000;

    function handleInactive() {
      if (hiddenSinceRef.current === null) {
        hiddenSinceRef.current = Date.now();
      }
    }

    function handleActive() {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const inactiveDuration = hiddenSinceRef.current;
        hiddenSinceRef.current = null;
        if (inactiveDuration !== null && Date.now() - inactiveDuration >= STALE_MS) {
          void loadCodexLimits();
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        handleInactive();
      } else {
        handleActive();
      }
    }

    window.addEventListener("focus", handleActive);
    window.addEventListener("blur", handleInactive);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.visibilityState === "hidden" || !document.hasFocus()) {
      hiddenSinceRef.current = Date.now();
    }

    return () => {
      window.removeEventListener("focus", handleActive);
      window.removeEventListener("blur", handleInactive);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [bootstrapped, loadCodexLimits]);

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
      await scanAndReloadOverview(startedAt, { force: true });
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
      await scanAndReloadOverview(startedAt, { force: true });
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

  const handleDismissUpdate = () => {
    if (updateInfo) {
      localStorage.setItem("dismissed_update_tag", updateInfo.latestTag);
      setIsUpdateDismissed(true);
    }
  };

  const handleManualUpdateCheck = async () => {
    setIsUpdateChecking(true);
    setUpdateCheckError(null);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      if (info.hasUpdate) {
        setIsUpdateDismissed(false); // Reset dismissal on manual trigger
      }
    } catch (e) {
      setUpdateCheckError(errorMessage(e, "Failed to check for updates."));
    } finally {
      setIsUpdateChecking(false);
    }
  };

  const handleUpgrade = async () => {
    if (updateInfo?.releaseUrl) {
      try {
        await openUrl(updateInfo.releaseUrl);
      } catch (e) {
        console.error("Failed to open release URL", e);
      }
    }
  };

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
    updateInfo,
    isUpdateChecking,
    updateCheckError,
    isUpdateDismissed,
    handleViewChange,
    handleRangeChange,
    handleRefresh,
    handleReset,
    handleExport,
    handleDismissUpdate,
    handleManualUpdateCheck,
    handleUpgrade,
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
