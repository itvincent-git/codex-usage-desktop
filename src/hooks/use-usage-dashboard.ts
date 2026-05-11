import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { exportUsage, fetchOverview, scanUsage, type ExportFormat, type OverviewResponse, type RangeKey } from "@/lib/api";
import { getExportDialogOptions, getExportFileName, rangeLabels } from "@/lib/usage-dashboard";

export function useUsageDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [scanMessage, setScanMessage] = useState("Sync local Codex usage into the desktop cache.");
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);
  const [lastRescanDurationMs, setLastRescanDurationMs] = useState<number | null>(null);
  const hasBootstrappedRef = useRef(false);

  const loadOverview = useEffectEvent(async (nextRange: RangeKey) => {
    const data = await fetchOverview(nextRange);
    setOverview(data);
    setError(null);
  });

  const scanAndReloadOverview = useEffectEvent(async (startedAt: number) => {
    const scan = await scanUsage();
    setScanMessage(`Imported ${scan.importedDays} day buckets into the local cache.`);
    await loadOverview(range);
    setLastRescanDurationMs(performance.now() - startedAt);
  });

  const bootstrap = useEffectEvent(async () => {
    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    setIsLoading(true);

    try {
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

  async function handleExport(format: ExportFormat) {
    if (!overview || isLoading) {
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
    range,
    overview,
    scanMessage,
    error,
    isLoading,
    isRefreshing,
    isExporting,
    lastRescanDurationMs,
    handleRangeChange,
    handleRefresh,
    handleExport,
  };
}
