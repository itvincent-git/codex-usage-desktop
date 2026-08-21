import { save } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  exportUsage,
  fetchCodexLimits,
  fetchCodexQuotaForecast,
  fetchMonthlyUsage,
  fetchOverview,
  resetUsageState,
  type CodexLimitsResponse,
  type CodexQuotaForecastResponse,
  type ExportFormat,
  type MonthlyUsageResponse,
  type OverviewResponse,
  type RangeKey,
  checkForUpdates,
  downloadAndInstallUpdate,
  openUrl,
  restartApp,
  type UpdateCheckResponse,
  type UpdateDownloadProgress,
  fetchSessionDetails,
  type CodexLimitWindow,
  type SessionDetailRow,
  updateTray,
  type TrayMenuItemDto,
  refreshUsageData,
  type UsageRefreshResponse,
} from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatCurrencyShort, formatNumber } from "@/lib/formatters";
import type { DashboardView } from "@/components/dashboard-header";
import { getExportDialogOptions, getExportFileName, getRangeLabel } from "@/lib/usage-dashboard";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { formatResetTime, hasSubscription } from "@/components/codex-limits-card";

function isNewerVersion(current: string, target: string): boolean {
  const parse = (v: string) => {
    const cleaned = v.replace(/^(app-v|v)/, "");
    const parts = cleaned.split(".").map(p => parseInt(p, 10));
    return parts.length >= 3 ? parts.slice(0, 3) : [0, 0, 0];
  };
  const [cMaj, cMin, cPat] = parse(current);
  const [tMaj, tMin, tPat] = parse(target);
  if (tMaj !== cMaj) return tMaj > cMaj;
  if (tMin !== cMin) return tMin > cMin;
  return tPat > cPat;
}

const AUTO_RESCAN_MS = 5 * 60_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
const UPDATE_CHECK_RETRY_MS = 60 * 60_000;
const CODEX_QUOTA_FORECAST_URL = "https://www.willcodexquotareset.com/";
const CHATGPT_USAGE_URL = "https://chatgpt.com/#settings/Usage";

function formatCompactResetCountdown(resetsAt: string | null): string | null {
  if (!resetsAt) return null;

  const resetTime = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return null;

  const diffMs = resetTime - Date.now();
  if (diffMs <= 0) return "soon";

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.ceil(hours / 24)}d`;
}

function formatTrayLimitTitle(prefix: string, window: CodexLimitWindow | null | undefined): string {
  if (!window) return `${prefix}: -`;

  const remaining = `${Math.round(window.remainingPercent)}%`;
  const resetCountdown = formatCompactResetCountdown(window.resetsAt);
  return resetCountdown ? `${prefix}: ${remaining}/${resetCountdown}` : `${prefix}: ${remaining}`;
}

function hasExpiredLimitWindow(window: CodexLimitWindow | null | undefined): boolean {
  if (!window?.resetsAt) return false;

  const resetTime = new Date(window.resetsAt).getTime();
  return Number.isFinite(resetTime) && resetTime <= Date.now();
}

function hasExpiredCodexLimitWindow(limits: CodexLimitsResponse | null): boolean {
  return hasExpiredLimitWindow(limits?.session) || hasExpiredLimitWindow(limits?.weekly);
}

export type UpdateInstallStatus = "idle" | "downloading" | "installed";

export type UpdateProgressState = {
  downloaded: number;
  total: number | null;
  percent: number | null;
  finished: boolean;
};

const emptyUpdateProgress: UpdateProgressState = {
  downloaded: 0,
  total: null,
  percent: null,
  finished: false,
};

function toUpdateProgressState(progress: UpdateDownloadProgress): UpdateProgressState {
  const total = typeof progress.total === "number" && progress.total > 0 ? progress.total : null;
  const percent = total === null
    ? null
    : Math.max(0, Math.min(100, Math.round((progress.downloaded / total) * 100)));

  return {
    downloaded: progress.downloaded,
    total,
    percent,
    finished: progress.finished,
  };
}

export function useUsageDashboard() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<DashboardView>("dashboard");
  const [range, setRange] = useState<RangeKey>("30d");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [monthlyUsage, setMonthlyUsage] = useState<MonthlyUsageResponse | null>(null);
  const [codexLimits, setCodexLimits] = useState<CodexLimitsResponse | null>(null);
  const [codexLimitsError, setCodexLimitsError] = useState<string | null>(null);
  const [codexQuotaForecast, setCodexQuotaForecast] = useState<CodexQuotaForecastResponse | null>(null);
  const [scanMessage, setScanMessage] = useState(() => t("hero.sync_logs_to_cache_desc", { defaultValue: "Sync local logs to cache" }));
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMonthlyLoading, setIsMonthlyLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionDetailRow[]>([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);
  const [lastRescanDurationMs, setLastRescanDurationMs] = useState<number | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchAtLoginError, setLaunchAtLoginError] = useState<string | null>(null);
  const [isLaunchAtLoginUpdating, setIsLaunchAtLoginUpdating] = useState(false);
  
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [isUpdateChecking, setIsUpdateChecking] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateInstallStatus, setUpdateInstallStatus] = useState<UpdateInstallStatus>("idle");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressState>(emptyUpdateProgress);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [isUpdateDismissed, setIsUpdateDismissed] = useState(false);
  const [trayClockMinute, setTrayClockMinute] = useState(() => Math.floor(Date.now() / 60_000));

  const [showLogsTab, setShowLogsTabState] = useState(() => {
    return localStorage.getItem("show_logs_tab") === "true";
  });

  const setShowLogsTab = (show: boolean) => {
    localStorage.setItem("show_logs_tab", show.toString());
    setShowLogsTabState(show);
    if (!show && view === "logs") {
      setView("dashboard");
    }
  };

  const [trayTitleShow, setTrayTitleShowState] = useState(() => {
    try {
      const saved = localStorage.getItem("tray_title_show");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return { limit5h: true, limitWeekly: true, tokens: false, cost: false };
  });

  const [trayMenuShow, setTrayMenuShowState] = useState(() => {
    try {
      const saved = localStorage.getItem("tray_menu_show");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return { limit5h: true, limitWeekly: true, tokens: true, cost: true };
  });

  const handleTrayTitleShowChange = (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => {
    const next = { ...trayTitleShow, [key]: value };
    localStorage.setItem("tray_title_show", JSON.stringify(next));
    setTrayTitleShowState(next);
  };

  const handleTrayMenuShowChange = (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => {
    const next = { ...trayMenuShow, [key]: value };
    localStorage.setItem("tray_menu_show", JSON.stringify(next));
    setTrayMenuShowState(next);
  };

  useEffect(() => {
    if (!bootstrapped) return;

    const timer = window.setInterval(() => {
      setTrayClockMinute(Math.floor(Date.now() / 60_000));
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [bootstrapped]);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    void listen<UpdateDownloadProgress>("update-download-progress", (event) => {
      if (!isMounted) return;
      setUpdateProgress(toUpdateProgressState(event.payload));
    }).then((cleanup) => {
      if (isMounted) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    }).catch((err) => {
      console.warn("Failed to listen for update download progress", err);
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void isAutostartEnabled()
      .then((enabled) => {
        if (!isMounted) return;
        setLaunchAtLogin(enabled);
        setLaunchAtLoginError(null);
      })
      .catch((err) => {
        if (!isMounted) return;
        setLaunchAtLoginError(errorMessage(err, "Failed to read login item setting."));
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const hasBootstrappedRef = useRef(false);
  const lastLimitsFetchTimeRef = useRef<number>(0);
  const lastAutoScanTimeRef = useRef<number>(0);
  const scanInFlightRef = useRef<Promise<void> | null>(null);
  const updateCheckInFlightRef = useRef<Promise<void> | null>(null);

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

  const loadSessions = useEffectEvent(async () => {
    const data = await fetchSessionDetails();
    setSessions(data);
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

  const loadCodexQuotaForecast = useEffectEvent(async () => {
    try {
      const data = await fetchCodexQuotaForecast();
      setCodexQuotaForecast(data);
    } catch (_) {
      setCodexQuotaForecast(null);
    }
  });

  const scanAndReloadOverview = useEffectEvent(async (startedAt: number, options?: { force?: boolean }) => {
    if (scanInFlightRef.current) {
      await scanInFlightRef.current;
      return;
    }

    const scanPromise = (async () => {
      const refresh = await refreshUsageData(options?.force === true);
      const scan = refresh.scan;
      const filesReused = scan.metrics?.filesReused ?? 0;
      const filesParsed = scan.metrics?.filesParsed ?? 0;
      setScanMessage(t("hero.synced_message", {
        days: scan.importedDays,
        reused: filesReused,
        parsed: filesParsed,
        defaultValue: `Synced ${scan.importedDays} days (${filesReused} cached, ${filesParsed} parsed)`
      }));

      if (refresh.limits) {
        setCodexLimits(refresh.limits);
        setCodexLimitsError(null);
        lastLimitsFetchTimeRef.current = Date.now();
      } else if (refresh.limitsError) {
        setCodexLimitsError(refresh.limitsError);
        lastLimitsFetchTimeRef.current = Date.now();
      }

      const isForeground = document.visibilityState === "visible" || options?.force === true;
      if (isForeground || filesParsed > 0) {
        await loadOverview(range);

        if (view === "monthly") {
          await loadMonthlyUsage();
        }
        if (view === "sessions") {
          await loadSessions();
        }
      }
      setLastRescanDurationMs(performance.now() - startedAt);
    })();

    scanInFlightRef.current = scanPromise;
    try {
      await scanPromise;
    } finally {
      scanInFlightRef.current = null;
    }
  });

  const runAutoRescan = useEffectEvent(async () => {
    if (isResetting) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoScanTimeRef.current < AUTO_RESCAN_MS) {
      return;
    }

    lastAutoScanTimeRef.current = now;
    const startedAt = performance.now();
    try {
      await scanAndReloadOverview(startedAt, { force: hasExpiredCodexLimitWindow(codexLimits) });
    } catch (scanError) {
      setError(errorMessage(scanError, "Background refresh failed."));
    }
  });

  const performBackgroundUpdateCheck = useEffectEvent(async () => {
    let cachedInfo: UpdateCheckResponse | null = null;
    try {
      const now = Date.now();
      const lastCheckTimeStr = localStorage.getItem("last_update_check_time");
      const lastCheckResultStr = localStorage.getItem("last_update_check_result");
      const lastCheckFailedTimeStr = localStorage.getItem("last_update_check_failed_time");
      
      if (lastCheckResultStr) {
        try {
          cachedInfo = JSON.parse(lastCheckResultStr) as UpdateCheckResponse;
          if (cachedInfo) {
            const currentRunningVersion = tauriConfig.version;
            if (!isNewerVersion(currentRunningVersion, cachedInfo.latestVersion)) {
              // The running version is equal to or newer than the cached latest version,
              // meaning we've successfully updated. Mark as no update available.
              cachedInfo = {
                ...cachedInfo,
                hasUpdate: false,
                currentVersion: currentRunningVersion,
              };
              localStorage.setItem("last_update_check_result", JSON.stringify(cachedInfo));
            }
          }
        } catch (jsonErr) {
          console.warn("Failed to parse cached update check result", jsonErr);
        }
      }

      // 1. If we recently failed, enforce a 1-hour cooldown before trying again
      if (lastCheckFailedTimeStr) {
        const lastCheckFailedTime = parseInt(lastCheckFailedTimeStr, 10);
        if (now - lastCheckFailedTime < 3600000) {
          if (cachedInfo) {
            setUpdateInfo(cachedInfo);
            if (cachedInfo.hasUpdate) {
              const dismissedTag = localStorage.getItem("dismissed_update_tag");
              if (dismissedTag === cachedInfo.latestTag) {
                setIsUpdateDismissed(true);
              }
            }
          }
          return;
        }
      }

      // 2. If we had a successful check within the last 24 hours, use it
      if (lastCheckTimeStr && cachedInfo) {
        const lastCheckTime = parseInt(lastCheckTimeStr, 10);
        // Cache for 24 hours to prevent hitting GitHub API rate limit during hot reloads or frequent restarts
        if (now - lastCheckTime < 86400000) {
          setUpdateInfo(cachedInfo);
          if (cachedInfo.hasUpdate) {
            const dismissedTag = localStorage.getItem("dismissed_update_tag");
            if (dismissedTag === cachedInfo.latestTag) {
              setIsUpdateDismissed(true);
            }
          }
          return;
        }
      }

      // If we are calling the API, pass the cached ETag (if available) to leverage conditional 304 responses
      const etag = cachedInfo?.etag || null;
      const info = await checkForUpdates(etag);

      // Clear any prior failure timestamp on success
      localStorage.removeItem("last_update_check_failed_time");

      if (info.notModified && cachedInfo) {
        // GitHub API returned 304 Not Modified. Reuse our cached result but refresh the check timestamp.
        setUpdateInfo(cachedInfo);
        localStorage.setItem("last_update_check_time", now.toString());
        
        if (cachedInfo.hasUpdate) {
          const dismissedTag = localStorage.getItem("dismissed_update_tag");
          if (dismissedTag === cachedInfo.latestTag) {
            setIsUpdateDismissed(true);
          }
        }
        return;
      }

      setUpdateInfo(info);
      localStorage.setItem("last_update_check_time", now.toString());
      localStorage.setItem("last_update_check_result", JSON.stringify(info));

      if (info.hasUpdate) {
        const dismissedTag = localStorage.getItem("dismissed_update_tag");
        if (dismissedTag === info.latestTag) {
          setIsUpdateDismissed(true);
        }
      }
    } catch (e) {
      console.warn("Background update check failed", e);
      localStorage.setItem("last_update_check_failed_time", Date.now().toString());
      
      // If we had a previously cached success result, still display it
      if (cachedInfo) {
        setUpdateInfo(cachedInfo);
        if (cachedInfo.hasUpdate) {
          const dismissedTag = localStorage.getItem("dismissed_update_tag");
          if (dismissedTag === cachedInfo.latestTag) {
            setIsUpdateDismissed(true);
          }
        }
      }
    }
  });

  const runBackgroundUpdateCheck = useEffectEvent(async () => {
    if (!updateCheckInFlightRef.current) {
      const checkPromise = performBackgroundUpdateCheck();
      updateCheckInFlightRef.current = checkPromise;
      void checkPromise.finally(() => {
        if (updateCheckInFlightRef.current === checkPromise) {
          updateCheckInFlightRef.current = null;
        }
      });
    }

    await updateCheckInFlightRef.current;
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
      void loadCodexQuotaForecast();
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
      setError(errorMessage(scanError, "Background refresh failed."));
    });

    void runBackgroundUpdateCheck();
  });

  const handleBackgroundRefreshCompleted = useEffectEvent(async (refresh: UsageRefreshResponse) => {
    if (refresh.limits) {
      setCodexLimits(refresh.limits);
      setCodexLimitsError(null);
      lastLimitsFetchTimeRef.current = Date.now();
    } else if (refresh.limitsError) {
      setCodexLimitsError(refresh.limitsError);
      lastLimitsFetchTimeRef.current = Date.now();
    } else if (refresh.limitsSkipped && hasExpiredCodexLimitWindow(codexLimits)) {
      await loadCodexLimits({ force: true });
    }

    // Reload overview to keep UI fresh
    const filesParsed = refresh.scan?.metrics?.filesParsed ?? 0;
    const isForeground = document.visibilityState === "visible";
    if (isForeground || filesParsed > 0) {
      await loadOverview(range);
      if (view === "monthly") {
        await loadMonthlyUsage();
      }
      if (view === "sessions") {
        await loadSessions();
      }
    }
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!bootstrapped) return;

    let cancelled = false;
    let timer: number | null = null;

    const readTimestamp = (key: string) => {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : null;
    };

    const scheduleNextCheck = () => {
      const now = Date.now();
      const lastSuccess = localStorage.getItem("last_update_check_result")
        ? readTimestamp("last_update_check_time")
        : null;
      const lastFailure = readTimestamp("last_update_check_failed_time");
      const nextCheckAt = Math.max(
        lastSuccess ? lastSuccess + UPDATE_CHECK_INTERVAL_MS : now + UPDATE_CHECK_RETRY_MS,
        lastFailure ? lastFailure + UPDATE_CHECK_RETRY_MS : now,
      );

      timer = window.setTimeout(() => {
        void runBackgroundUpdateCheck().finally(() => {
          if (!cancelled) {
            scheduleNextCheck();
          }
        });
      }, Math.max(0, nextCheckAt - now));
    };

    scheduleNextCheck();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [bootstrapped, runBackgroundUpdateCheck]);

  // Re-fetch usage when the page/window regains focus after being inactive ≥5 min.
  useEffect(() => {
    if (!bootstrapped) return;

    let hiddenSince: number | null = null;

    function handleInactive() {
      if (hiddenSince === null) {
        hiddenSince = Date.now();
      }
    }

    function handleActive() {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const inactiveDuration = hiddenSince;
        hiddenSince = null;
        if (inactiveDuration !== null && Date.now() - inactiveDuration >= AUTO_RESCAN_MS) {
          void runAutoRescan();
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
      hiddenSince = Date.now();
    }

    return () => {
      window.removeEventListener("focus", handleActive);
      window.removeEventListener("blur", handleInactive);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [bootstrapped, runAutoRescan]);

  // Listen for background refresh events emitted from the Rust backend
  useEffect(() => {
    if (!bootstrapped) return;

    let unlistenFn: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const unsubscribe = await listen<UsageRefreshResponse>("background-refresh-completed", async (event) => {
          await handleBackgroundRefreshCompleted(event.payload);
        });
        unlistenFn = unsubscribe;
      } catch (err) {
        console.error("Failed to setup background refresh listener:", err);
      }
    };

    void setupListener();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [bootstrapped, handleBackgroundRefreshCompleted]);

  // Update tray icon whenever limits, overview, translation, or tray settings change
  useEffect(() => {
    if (!bootstrapped) return;

    const tz = overview?.timezone;
    const todayStr = getTodayDateString(tz);
    const todayRow = overview?.daily?.find((d) => d.date === todayStr) || overview?.daily?.[overview.daily.length - 1];
    const todayTokens = todayRow ? todayRow.totalTokens : 0;
    const todayCost = todayRow ? todayRow.costUSD : 0;

    const hasSub = hasSubscription(codexLimits);

    const titleParts: string[] = [];
    if (hasSub) {
      if (trayTitleShow.limit5h) {
        titleParts.push(formatTrayLimitTitle("5h", codexLimits?.session));
      }
      if (trayTitleShow.limitWeekly) {
        titleParts.push(formatTrayLimitTitle("W", codexLimits?.weekly));
      }
    } else {
      if (trayTitleShow.limit5h || trayTitleShow.limitWeekly) {
        const activeWindow = codexLimits?.weekly ?? codexLimits?.session;
        titleParts.push(formatTrayLimitTitle("M", activeWindow));
      }
    }

    if (trayTitleShow.tokens) {
      titleParts.push(`T: ${formatCompactNumber(todayTokens)}`);
    }
    if (trayTitleShow.cost) {
      titleParts.push(formatCurrencyShort(todayCost));
    }
    const title = titleParts.join(" | ");

    const items: TrayMenuItemDto[] = [];

    if (hasSub) {
      if (trayMenuShow.limit5h) {
        const text = codexLimits?.session
          ? `${t("limits.window_5hour")}: ${Math.round(codexLimits.session.remainingPercent)}% ${t("limits.remaining")} (${t("limits.consumed")}: ${Math.round(codexLimits.session.usedPercent)}%); ${formatResetTime(codexLimits.session.resetsAt, codexLimits.session.windowMinutes, t)}`
          : `${t("limits.window_5hour")}: ${t("limits.unavailable")}`;
        items.push({ id: "status_5h", text, enabled: false });
      }

      if (trayMenuShow.limitWeekly) {
        const text = codexLimits?.weekly
          ? `${t("limits.window_weekly")}: ${Math.round(codexLimits.weekly.remainingPercent)}% ${t("limits.remaining")} (${t("limits.consumed")}: ${Math.round(codexLimits.weekly.usedPercent)}%); ${formatResetTime(codexLimits.weekly.resetsAt, codexLimits.weekly.windowMinutes, t)}`
          : `${t("limits.window_weekly")}: ${t("limits.unavailable")}`;
        items.push({ id: "status_weekly", text, enabled: false });
      }
    } else {
      if (trayMenuShow.limit5h || trayMenuShow.limitWeekly) {
        const activeWindow = codexLimits?.weekly ?? codexLimits?.session;
        const text = activeWindow
          ? `${t("limits.window_monthly")}: ${Math.round(activeWindow.remainingPercent)}% ${t("limits.remaining")} (${t("limits.consumed")}: ${Math.round(activeWindow.usedPercent)}%)`
          : `${t("limits.window_monthly")}: ${t("limits.unavailable")}`;
        items.push({ id: "status_monthly", text, enabled: false });
      }
    }

    if ((trayMenuShow.limit5h || trayMenuShow.limitWeekly) && (trayMenuShow.tokens || trayMenuShow.cost)) {
      items.push({ id: "separator", text: "", enabled: false });
    }

    if (trayMenuShow.tokens) {
      const text = `${t("settings.menu_bar_opt_tokens")}: ${formatNumber(todayTokens)}`;
      items.push({ id: "status_tokens", text, enabled: false });
    }

    if (trayMenuShow.cost) {
      const text = `${t("settings.menu_bar_opt_cost")}: ${formatCurrency(todayCost)}`;
      items.push({ id: "status_cost", text, enabled: false });
    }

    void updateTray({
      title,
      items,
      show_main_text: t("settings.menu_bar_show_main", { defaultValue: "Show Main Window" }),
      quit_text: t("settings.menu_bar_quit", { defaultValue: "Quit" }),
    }).catch((err) => {
      console.warn("Failed to update tray", err);
    });
  }, [
    bootstrapped,
    codexLimits,
    overview,
    trayTitleShow,
    trayMenuShow,
    trayClockMinute,
    t,
    i18n.language,
  ]);

  async function handleViewChange(nextView: DashboardView) {
    setView(nextView);

    if (nextView === "monthly" && !monthlyUsage && bootstrapped) {
      setIsMonthlyLoading(true);
      try {
        await loadMonthlyUsage();
      } catch (monthlyError) {
        setError(monthlyError instanceof Error ? monthlyError.message : "Failed to load monthly usage.");
      } finally {
        setIsMonthlyLoading(false);
      }
    }

    if (nextView === "sessions" && bootstrapped) {
      setIsSessionsLoading(true);
      try {
        await loadSessions();
      } catch (sessionsError) {
        setError(sessionsError instanceof Error ? sessionsError.message : "Failed to load sessions.");
      } finally {
        setIsSessionsLoading(false);
      }
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
      await loadCodexQuotaForecast();
    } catch (refreshError) {
      setError(errorMessage(refreshError, "Refresh failed."));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(
      t("settings.reset_confirm", { defaultValue: "Reset cached usage and pricing data, then rebuild it from local Codex logs? Source logs will not be deleted." })
    );
    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    setMonthlyUsage(null);
    setScanMessage(t("hero.resetting_message", { defaultValue: "Resetting local cache and rebuilding usage data." }));
    const startedAt = performance.now();

    try {
      await resetUsageState();
      await scanAndReloadOverview(startedAt, { force: true });
      setScanMessage(t("hero.reset_rebuilt_message", { defaultValue: "Reset local cache and rebuilt usage data from local Codex logs." }));
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

    const selectedPath = await save(getExportDialogOptions(format, getExportFileName(range, overview, format), t));
    if (!selectedPath) {
      return;
    }

    setIsExporting(format);

    try {
      const exported = await exportUsage(range, format, selectedPath);
      setScanMessage(t("hero.exported_message", {
        range: getRangeLabel(range, t),
        path: exported.path,
        defaultValue: `Exported ${getRangeLabel(range, t)} to ${exported.path}.`
      }));
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setIsExporting(null);
    }
  }

  async function handleLaunchAtLoginChange(enabled: boolean) {
    const previous = launchAtLogin;
    setLaunchAtLogin(enabled);
    setLaunchAtLoginError(null);
    setIsLaunchAtLoginUpdating(true);

    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
    } catch (autostartError) {
      setLaunchAtLogin(previous);
      setLaunchAtLoginError(errorMessage(autostartError, "Failed to update login item setting."));
    } finally {
      setIsLaunchAtLoginUpdating(false);
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
      
      localStorage.setItem("last_update_check_time", Date.now().toString());
      localStorage.setItem("last_update_check_result", JSON.stringify(info));
      localStorage.removeItem("last_update_check_failed_time");

      if (info.hasUpdate) {
        setIsUpdateDismissed(false); // Reset dismissal on manual trigger
        setUpdateInstallStatus("idle");
        setUpdateInstallError(null);
      }
    } catch (e) {
      setUpdateCheckError(errorMessage(e, "Failed to check for updates."));
    } finally {
      setIsUpdateChecking(false);
    }
  };

  const handleUpgrade = async () => {
    if (updateInstallStatus === "installed") {
      try {
        localStorage.removeItem("last_update_check_result");
        localStorage.removeItem("last_update_check_time");
        await restartApp();
      } catch (e) {
        setUpdateInstallError(errorMessage(e, "Failed to restart the app."));
      }
      return;
    }

    if (!updateInfo?.hasUpdate || updateInstallStatus === "downloading") {
      return;
    }

    setUpdateInstallStatus("downloading");
    setUpdateProgress(emptyUpdateProgress);
    setUpdateInstallError(null);
    try {
      await downloadAndInstallUpdate();
      setUpdateProgress((progress) => ({ ...progress, percent: 100, finished: true }));
      setUpdateInstallStatus("installed");
    } catch (e) {
      setUpdateInstallStatus("idle");
      setUpdateProgress(emptyUpdateProgress);
      setUpdateInstallError(errorMessage(e, "Failed to download and install the update."));
    }
  };

  const handleOpenUpdateRelease = async () => {
    if (updateInfo?.releaseUrl) {
      try {
        await openUrl(updateInfo.releaseUrl);
      } catch (e) {
        console.error("Failed to open release URL", e);
      }
    }
  };

  const handleOpenCodexQuotaForecast = async () => {
    try {
      await openUrl(CODEX_QUOTA_FORECAST_URL);
    } catch (e) {
      console.error("Failed to open Codex quota forecast URL", e);
    }
  };

  const handleOpenResetCredits = async () => {
    try {
      await openUrl(CHATGPT_USAGE_URL);
    } catch (e) {
      console.error("Failed to open ChatGPT Usage URL", e);
    }
  };

  return {
    view,
    range,
    overview,
    monthlyUsage,
    codexLimits,
    codexLimitsError,
    codexQuotaForecast,
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
    updateInstallStatus,
    updateProgress,
    updateInstallError,
    isUpdateDismissed,
    launchAtLogin,
    launchAtLoginError,
    isLaunchAtLoginUpdating,
    showLogsTab,
    setShowLogsTab,
    sessions,
    isSessionsLoading,
    handleViewChange,
    handleRangeChange,
    handleRefresh,
    handleReset,
    handleExport,
    handleDismissUpdate,
    handleManualUpdateCheck,
    handleUpgrade,
    handleOpenUpdateRelease,
    handleOpenCodexQuotaForecast,
    handleOpenResetCredits,
    handleLaunchAtLoginChange,
    trayTitleShow,
    handleTrayTitleShowChange,
    trayMenuShow,
    handleTrayMenuShowChange,
  };
}

function getTodayDateString(tz?: string) {
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    if (tz) {
      options.timeZone = tz;
    }
    const formatter = new Intl.DateTimeFormat("en-US", options);
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (_) {}
  return new Date().toLocaleDateString("sv-SE");
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
