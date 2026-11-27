import { AccountsPage } from "@/components/accounts-page";
import { UsageRecoveryCard } from "@/components/usage-recovery-card";
import { ScanWaitNotice } from "@/components/scan-wait-notice";
import { CodexForecastCard } from "@/components/codex-forecast-card";
import { CodexLimitsCard } from "@/components/codex-limits-card";
import { CodexSidebarAccounts } from "@/components/codex-sidebar-accounts";
import { CodexResetHistoryModal } from "@/components/codex-reset-history";
import { DailyUsageTable } from "@/components/daily-usage-table";
import { DashboardHeroCard } from "@/components/dashboard-hero-card";
import { AppSidebar, clampSidebarWidth } from "@/components/app-sidebar";
import { DashboardHeader, type DashboardView } from "@/components/dashboard-header";
import { LoadingState } from "@/components/loading-state";
import { LogPanel } from "@/components/log-panel";
import { ModelsPage } from "@/components/models-page";
import { MonthlyUsageTable } from "@/components/monthly-usage-table";
import { ProjectUsageCard } from "@/components/project-usage-card";
import { SettingsPage } from "@/components/settings-page";
import { SessionUsageTable } from "@/components/session-usage-table";
import { SessionDetailModal } from "@/components/session-detail-modal";
import { SessionTabs, type SessionTab, type SessionTabCloseAction } from "@/components/session-tabs";
import { ProjectSessionsModal } from "@/components/project-sessions-modal";
import { RangeSwitcher } from "@/components/range-switcher";
import { useRefreshShortcut } from "@/hooks/use-refresh-shortcut";
import { isPrimaryShortcut } from "@/lib/keyboard-shortcuts";
import { useUsageDashboard } from "@/hooks/use-usage-dashboard";
import { buildMetricCards, getRangeLabel } from "@/lib/usage-dashboard";
import { getReleaseNotes } from "@/lib/release-notes";
import type { ScanResponse, SessionDetailRow } from "@/lib/api";
import { useCodexAccounts } from "@/hooks/use-codex-accounts";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, ChevronDown, ChevronUp, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

function isSameSession(first: SessionDetailRow, second: SessionDetailRow) {
  return first.threadId && second.threadId ? first.threadId === second.threadId : first.path === second.path;
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [showNotes, setShowNotes] = useState(false);
  const accounts = useCodexAccounts();
  const [selectedQuotaAccountId, setSelectedQuotaAccountId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("sidebar_width");
      return saved !== null && Number.isFinite(Number(saved)) ? clampSidebarWidth(Number(saved)) : 240;
    } catch {
      return 240;
    }
  });
  const [settingsReturnView, setSettingsReturnView] = useState<DashboardView>("dashboard");
  const [selectedSessionDate, setSelectedSessionDate] = useState<string | null>(null);
  const [selectedProjectForModal, setSelectedProjectForModal] = useState<{
    project: string;
    displayName: string;
    codexProjectId?: string;
    codexProjectName?: string;
    codexProjectRoot?: string;
    totalTokens: number;
    costUSD: number;
  } | null>(null);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const clearProjectFilter = useCallback(() => setSelectedProjectFilter(null), []);
  const [projectDataRevision, setProjectDataRevision] = useState(0);
  const [sessionTabs, setSessionTabs] = useState<{ tabs: SessionTab[]; selectedId: number | null }>({ tabs: [], selectedId: null });
  const nextTabId = useRef(0);
  const sessionListFocus = useRef<HTMLElement | null>(null);
  const [isResetHistoryOpen, setIsResetHistoryOpen] = useState(false);
  const {
    view,
    range,
    overview,
    monthlyUsage,
    codexLimits,
    currentQuota,
    codexLimitsError,
    isLimitsRefreshing,
    isWindowActivating,
    windowActivationStatus,
    windowActivationError,
    forecast,
    isScanning,
    hasScanned,
    scanError,
    diagnostics,
    diagnosticsError,
    isLimitsLoading,
    isResetLoading,
    resetError,
    handleCodexHomeChange,
    latestCodexReset,
    recentCodexResets,
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
    showSessionCredits,
    setShowSessionCredits,
    showLogsTab,
    setShowLogsTab,
    autoRefreshIntervalMinutes,
    setAutoRefreshIntervalMinutes,
    sessions,
    isSessionsLoading,
    handleViewChange,
    handleRangeChange,
    handlePricingRefreshed,
    handleLocalScanComplete,
    handleRefresh,
    handleLimitsRefresh,
    handleActivateCodexWindow,
    handleReset,
    handleExport,
    handleDismissUpdate,
    handleManualUpdateCheck,
    handleUpgrade,
    handleOpenUpdateRelease,
    handleOpenResetCredits,
    handleLaunchAtLoginChange,
    trayTitleShow,
    handleTrayTitleShowChange,
    trayMenuShow,
    handleTrayMenuShowChange,
    trayCountdownUnits,
    handleTrayCountdownUnitChange,
  } = useUsageDashboard(accounts.list, sessionTabs.tabs.length > 0);

  const activeSessionId = view === "settings" ? null : sessionTabs.selectedId;
  const showSessionTabs = view !== "settings" && sessionTabs.tabs.length > 0;
  const projectActive = !!selectedProjectForModal && view !== "settings" && activeSessionId === null && !isResetHistoryOpen;

  useEffect(() => {
    setSessionTabs((current) => {
      if (!current.tabs.length || !sessions.length) return current;
      const byPath = new Map(sessions.map((session) => [session.path, session]));
      const byThread = new Map(sessions.map((session) => [session.threadId, session]));
      const tabs = current.tabs.map((tab) => {
        const session = (tab.session.threadId ? byThread.get(tab.session.threadId) : undefined) ?? byPath.get(tab.session.path);
        return session && session !== tab.session && isSameSession(tab.session, session) ? { ...tab, session } : tab;
      });
      return tabs.some((tab, index) => tab !== current.tabs[index]) ? { ...current, tabs } : current;
    });
  }, [sessions]);

  useLayoutEffect(() => {
    const opener = sessionListFocus.current;
    if (activeSessionId !== null || view === "settings" || !opener?.isConnected) return;
    opener.focus({ preventScroll: true });
    if (document.activeElement === opener) return;
    // Let WebKit lay out the project list after the tab strip changes height.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => opener.focus({ preventScroll: true }));
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSessionId, view]);

  const openSession = useCallback((session: SessionDetailRow) => {
    if (document.activeElement instanceof HTMLElement) sessionListFocus.current = document.activeElement;
    const id = ++nextTabId.current;
    setSessionTabs((current) => {
      const existing = current.tabs.find((tab) => isSameSession(tab.session, session));
      return existing
        ? { ...current, selectedId: existing.id }
        : { tabs: [...current.tabs, { id, session }], selectedId: id };
    });
  }, []);

  const selectSessionTab = (selectedId: number | null) => {
    setSessionTabs((current) => ({ ...current, selectedId }));
  };

  const closeSessionTab = useCallback((id?: number, action: SessionTabCloseAction = "close") => {
    setSessionTabs((current) => {
      const closingId = id ?? current.selectedId;
      const index = current.tabs.findIndex((tab) => tab.id === closingId);
      if (index < 0) return current;
      let tabs: SessionTab[];
      switch (action) {
        case "close": tabs = current.tabs.filter((tab) => tab.id !== closingId); break;
        case "others": tabs = [current.tabs[index]]; break;
        case "after": tabs = current.tabs.slice(0, index + 1); break;
        case "all": tabs = []; break;
      }
      const keepSelection = current.selectedId === null || tabs.some((tab) => tab.id === current.selectedId);
      return { tabs, selectedId: keepSelection ? current.selectedId : (tabs[index] ?? tabs.at(-1))?.id ?? null };
    });
  }, []);

  const handleSessionScanComplete = useCallback(async (session: SessionDetailRow, previousPath: string, scan: ScanResponse) => {
    setSessionTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => tab.session.path === previousPath || isSameSession(tab.session, session) ? { ...tab, session } : tab),
    }));
    setProjectDataRevision((value) => value + 1);
    await handleLocalScanComplete(scan, session, previousPath);
  }, [handleLocalScanComplete]);

  const syncAccountsWithLiveLimits = useEffectEvent(() => {
    if (codexLimits?.authContext && codexLimits.authContext !== accounts.list?.authContext) void accounts.reload();
  });
  useEffect(() => { syncAccountsWithLiveLimits(); }, [codexLimits?.authContext]);

  useEffect(() => {
    try {
      localStorage.setItem("sidebar_collapsed", String(sidebarCollapsed));
      localStorage.setItem("sidebar_width", String(sidebarWidth));
    } catch {
      // Keep the sidebar usable when local storage is unavailable.
    }
  }, [sidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  const isRateLimitError = !!(
    updateInfo?.releaseNotes?.includes("GitHub API rate limit exceeded") ||
    updateInfo?.releaseNotes?.includes("GitHub API 访问受限")
  );

  const parsedReleaseNotes = useMemo(() => {
    if (!updateInfo?.releaseNotes) return "";
    return getReleaseNotes(updateInfo.releaseNotes, i18n.resolvedLanguage ?? i18n.language);
  }, [updateInfo?.releaseNotes, i18n.language, i18n.resolvedLanguage]);

  const metrics = overview ? buildMetricCards(overview, range, t) : [];
  const projects = overview?.projects ?? [];
  const loadingTitle = overview ? t("loading.loading_range", { range: getRangeLabel(range, t) }) : t("loading.preparing_cache");
  const loadingDescription = overview
    ? t("loading.selected_window_desc")
    : t("loading.cached_snapshot_desc");
  const awaitingFirstScan = !hasScanned && !overview?.updatedAt;
  const showRecovery = !isLoading && (awaitingFirstScan || !!scanError || !!error || (view === "dashboard" && (!overview || overview.totals.totalTokens === 0)));
  const showDashboard = !isLoading && !awaitingFirstScan && overview && (overview.totals.totalTokens > 0 || overview.models.length > 0);
  const isInstallingUpdate = updateInstallStatus === "downloading";
  const isUpdateInstalled = updateInstallStatus === "installed";
  const updateButtonLabel = isUpdateInstalled
    ? t("update.restart_now")
    : isInstallingUpdate
      ? updateProgress.percent === null
        ? t("update.downloading")
        : t("update.downloading_progress", { percent: updateProgress.percent })
      : t("update.upgrade_now");

  const navigate = (nextView: DashboardView) => {
    if (nextView === "settings") {
      if (view !== "settings") setSettingsReturnView(view);
    } else if (view !== "settings" || nextView !== settingsReturnView) {
      if (nextView !== "sessions") {
        setSelectedSessionDate(null);
        setSelectedProjectFilter(null);
      }
      sessionListFocus.current = null;
      setSelectedProjectForModal(null);
      selectSessionTab(null);
    }
    setIsResetHistoryOpen(false);
    void handleViewChange(nextView);
  };

  const hasModal = projectActive || activeSessionId !== null || isResetHistoryOpen;
  const hasOpenDialog = () => document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [role="menu"], [role="listbox"]');
  useRefreshShortcut(() => {
    if (!hasModal && !hasOpenDialog() && view !== "settings" && view !== "accounts" && !isLoading && !isScanning && !isRefreshing && !isResetting && isExporting === null) {
      void handleRefresh();
    }
  });

  const handleNavigationKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey) return;
    const pages: DashboardView[] = ["dashboard", "sessions", "models", "daily", "monthly", "projects"];
    const nextView = isPrimaryShortcut(event) ? (event.key === "," ? "settings" : pages[Number(event.key) - 1]) : undefined;
    const toggleSidebar = isPrimaryShortcut(event, true) && event.key.toLowerCase() === "l";
    if (!nextView && !toggleSidebar) return;
    event.preventDefault();
    if (event.repeat || hasModal || hasOpenDialog()) return;
    if (toggleSidebar && view !== "settings") setSidebarCollapsed((collapsed) => !collapsed);
    else if (nextView) navigate(nextView);
  });
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => handleNavigationKey(event);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <div data-tauri-drag-region data-session-tabs-open={showSessionTabs || undefined} aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-[var(--window-controls-height)] select-none" />
      {view !== "settings" ? (
        <AppSidebar
          view={view}
          onViewChange={navigate}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          showLogsTab={showLogsTab}
          limits={
            <CodexSidebarAccounts
              accounts={accounts}
              selectedId={selectedQuotaAccountId}
              onSelect={setSelectedQuotaAccountId}
              compact={sidebarCollapsed}
              currentQuota={currentQuota}
              error={codexLimitsError}
              isLimitsRefreshing={isLimitsRefreshing || isLimitsLoading}
              isWindowActivating={isWindowActivating}
              windowActivationStatus={windowActivationStatus}
              windowActivationError={windowActivationError}
              onRefreshLimits={() => void handleLimitsRefresh()}
              onActivateWindow={() => void handleActivateCodexWindow()}
              onManageAccounts={() => navigate("accounts")}
            />
          }
        />
      ) : null}
      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
      {showSessionTabs ? (
        <SessionTabs
          tabs={sessionTabs.tabs}
          selectedId={activeSessionId}
          onSelect={selectSessionTab}
          onClose={closeSessionTab}
          onBack={() => selectSessionTab(null)}
        />
      ) : (
        <div aria-hidden="true" className="h-[var(--window-controls-height)] shrink-0" />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden [container-type:inline-size] [container-name:app-content]" data-app-content>
      {view === "settings" ? (
        <div className="mx-auto w-full max-w-layout shrink-0 px-6 pt-4 content-sm:px-8 content-lg:px-10">
          <header className="flex items-center gap-3 border-b border-border/80 pb-3">
            <Button variant="secondary" size="sm" onClick={() => navigate(settingsReturnView === "logs" && !showLogsTab ? "dashboard" : settingsReturnView)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("common.back")}
            </Button>
          </header>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        aria-hidden={hasModal || undefined}
        inert={hasModal || undefined}
      >
      <div className={`relative mx-auto flex min-h-full w-full max-w-layout flex-col px-6 pb-8 content-sm:px-8 content-lg:px-10 ${view === "settings" ? "pt-0" : "pt-4"}`}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-10 top-3 h-40 w-40 rounded-full bg-[radial-gradient(circle,_rgba(10,10,10,0.08)_1px,_transparent_1px)] bg-[length:14px_14px] opacity-60"
        />

        {view !== "settings" ? <DashboardHeader
          updateInfo={updateInfo}
          isUpdateDismissed={isUpdateDismissed}
          updateInstallStatus={updateInstallStatus}
          updateProgress={updateProgress}
          onUpgrade={() => void handleUpgrade()}
          onRefresh={() => void handleRefresh()}
          isRefreshing={isRefreshing || isScanning}
          isBusy={isLoading || isScanning || isRefreshing || isResetting || isExporting !== null}
          overview={overview}
          scanMessage={scanError ? t("recovery.last_scan_failed") : scanMessage}
          syncFailed={!!scanError}
          lastRescanDurationMs={lastRescanDurationMs}
        /> : null}

        <main id={`page-${view}`} role={view === "settings" ? undefined : "tabpanel"} aria-labelledby={view === "settings" ? undefined : `${view}-nav-tab`} className={view === "dashboard" ? "flex-1 py-3" : "flex-1 py-6"}>
          {updateInfo?.hasUpdate && !isUpdateDismissed ? (
            <div className="mb-6 overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-indigo-50/20 p-5 text-card-foreground shadow-sm backdrop-blur-md transition-all duration-300 hover:border-indigo-200 hover:shadow-md dark:border-indigo-500/20 dark:bg-gradient-to-r dark:from-indigo-950/35 dark:via-purple-950/20 dark:to-indigo-950/10 dark:hover:border-indigo-500/30">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                    <Sparkles className="h-5 w-5 animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      {t("update.new_version", { version: updateInfo.latestVersion })}
                      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300">
                        {t("update.latest_badge")}
                      </span>
                    </h3>
                    <p className="text-sm text-muted-foreground leading-normal">
                      {t("update.banner_text", { currentVersion: updateInfo.currentVersion })}
                      {updateInfo.releaseName ? ` "${updateInfo.releaseName}"` : ""}
                    </p>
                    
                    {updateInfo.releaseNotes ? (
                      <div className="pt-2">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition"
                          onClick={() => setShowNotes(!showNotes)}
                        >
                          {showNotes ? (
                            <>
                              {t("update.hide_release_notes")} <ChevronUp className="h-3 w-3" />
                            </>
                          ) : (
                            <>
                              {t("update.view_release_notes")} <ChevronDown className="h-3 w-3" />
                            </>
                          )}
                        </button>
                        
                        {showNotes ? (
                          isRateLimitError ? (
                            <div className="mt-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 leading-normal flex items-start gap-2 select-text font-sans">
                              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                              <div className="whitespace-pre-wrap">
                                {t("update.rate_limit_error")}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-indigo-50/50 dark:bg-black/25 p-3 text-xs text-muted-foreground border border-indigo-100 dark:border-white/5 font-mono whitespace-pre-wrap leading-relaxed select-text">
                              {parsedReleaseNotes}
                            </div>
                          )
                        ) : null}
                      </div>
                    ) : null}
                    {updateInstallError ? (
                      <div className="pt-2 text-xs text-error dark:text-red-400">
                        {updateInstallError}
                        {updateInfo.releaseUrl ? (
                          <button
                            type="button"
                            className="ml-2 font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                            onClick={() => void handleOpenUpdateRelease()}
                          >
                            {t("update.view_release")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {isInstallingUpdate ? (
                      <div className="pt-2">
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/15"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={updateProgress.percent ?? undefined}
                        >
                          <div
                            className={`h-full rounded-full bg-indigo-600 transition-all duration-300 dark:bg-indigo-400 ${
                              updateProgress.percent === null ? "w-1/2 animate-pulse" : ""
                            }`}
                            style={updateProgress.percent === null ? undefined : { width: `${updateProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                    onClick={() => void handleUpgrade()}
                    disabled={isInstallingUpdate}
                  >
                    {updateButtonLabel}
                  </Button>
                  <button
                    type="button"
                    onClick={handleDismissUpdate}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-indigo-100/50 dark:hover:bg-white/5 hover:text-foreground transition"
                    aria-label={t("update.dismiss_aria")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <ScanWaitNotice active={view !== "accounts" && (isLoading || isScanning)} diagnostics={diagnostics} />
          {showRecovery && view !== "settings" && view !== "accounts" ? (
            <UsageRecoveryCard
              scanning={isScanning}
              pending={awaitingFirstScan && isScanning}
              error={scanError || error}
              diagnostics={diagnostics}
              diagnosticsError={diagnosticsError}
              hasCachedData={!!overview?.updatedAt}
              busy={isRefreshing || isResetting}
              onRetry={() => void handleRefresh()}
              onDetect={() => void handleCodexHomeChange(false)}
              onChoose={() => void handleCodexHomeChange(true)}
              onExpandRange={() => void handleRangeChange("365d")}
            />
          ) : null}

          {isLoading && view !== "accounts" ? <LoadingState title={loadingTitle} description={loadingDescription} /> : null}

          {view === "accounts" ? <AccountsPage {...accounts} /> : null}

          {view === "monthly" && isMonthlyLoading ? (
            <LoadingState title={t("loading.loading_monthly")} description={t("loading.natural_month_desc")} />
          ) : null}

          {view === "sessions" && isSessionsLoading ? (
            <LoadingState title={t("loading.loading_sessions")} description={t("loading.session_logs_desc")} />
          ) : null}

          {showDashboard && view === "dashboard" && overview ? (
            <div className="space-y-5">
              <DashboardHeroCard
                overview={overview}
                range={range}
                isBusy={isLoading || isRefreshing || isResetting || isExporting !== null}
                isExporting={isExporting}
                onRangeChange={handleRangeChange}
                onExport={(format) => void handleExport(format)}
                metrics={metrics}
                codexLimits={codexLimits}
              />

              <div className="min-w-0">
                <CodexLimitsCard
                  limits={codexLimits}
                  isLimitsLoading={isLimitsLoading}
                  limitsError={codexLimitsError}
                  isResetLoading={isResetLoading}
                  resetError={resetError}
                  latestReset={latestCodexReset}
                  recentResets={recentCodexResets}
                  onOpenResetHistory={() => setIsResetHistoryOpen(true)}
                  onOpenResetCredits={() => void handleOpenResetCredits()}
                />
              </div>
              <CodexForecastCard {...forecast} resets={recentCodexResets} onRefresh={() => void forecast.refresh()} />
            </div>
          ) : null}

          {!isLoading && view === "models" && overview ? (
            <ModelsPage models={overview.models} range={range} onRangeChange={handleRangeChange} onPricingRefreshed={handlePricingRefreshed} />
          ) : null}

          {!isLoading && view === "projects" && overview ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">{t("projects.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("projects.subtitle")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <RangeSwitcher value={range} onChange={handleRangeChange} />
                </div>
              </div>
              <ProjectUsageCard
                projects={projects}
                projectDaily={overview.projectDaily}
                onProjectClick={(proj) => setSelectedProjectForModal(proj)}
              />
            </div>
          ) : null}

          {!isLoading && view === "daily" && overview ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">{t("daily.title", { defaultValue: "Daily Usage Details" })}</h2>
                  <p className="text-sm text-muted-foreground">{t("daily.subtitle")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <RangeSwitcher value={range} onChange={handleRangeChange} />
                </div>
              </div>
              <DailyUsageTable
                range={range}
                daily={overview.daily}
                onRowClick={(date) => {
                  setSelectedSessionDate(date);
                  void handleViewChange("sessions");
                }}
              />
            </div>
          ) : null}

          {!isLoading && view === "monthly" && !isMonthlyLoading && monthlyUsage ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">{t("monthly.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("monthly.subtitle", { start: monthlyUsage.startMonth, end: monthlyUsage.endMonth, tz: monthlyUsage.timezone })}
                </p>
              </div>
              <MonthlyUsageTable data={monthlyUsage} />
            </div>
          ) : null}

          {!isLoading && view === "sessions" && !isSessionsLoading ? (
            <SessionUsageTable
              sessions={sessions}
              showSessionCredits={showSessionCredits}
              creditsActive={!hasModal}
              initialExpandedDate={selectedSessionDate}
              selectedProject={selectedProjectFilter}
              onClearProjectFilter={clearProjectFilter}
              onSessionClick={openSession}
            />
          ) : null}

          {!isLoading && view === "settings" ? (
            <SettingsPage
              isResetting={isResetting}
              isDisabled={isLoading || isMonthlyLoading || isRefreshing || isResetting || isExporting !== null}
              onReset={() => void handleReset()}
              updateInfo={updateInfo}
              isUpdateChecking={isUpdateChecking}
              updateCheckError={updateCheckError}
              updateInstallStatus={updateInstallStatus}
              updateProgress={updateProgress}
              updateInstallError={updateInstallError}
              onCheckUpdates={() => void handleManualUpdateCheck()}
              onUpgrade={() => void handleUpgrade()}
              onOpenUpdateRelease={() => void handleOpenUpdateRelease()}
              launchAtLogin={launchAtLogin}
              launchAtLoginError={launchAtLoginError}
              isLaunchAtLoginUpdating={isLaunchAtLoginUpdating}
              onLaunchAtLoginChange={(enabled) => void handleLaunchAtLoginChange(enabled)}
              showSessionCredits={showSessionCredits}
              onShowSessionCreditsChange={setShowSessionCredits}
              showLogsTab={showLogsTab}
              onShowLogsTabChange={setShowLogsTab}
              autoRefreshIntervalMinutes={autoRefreshIntervalMinutes}
              onAutoRefreshIntervalChange={setAutoRefreshIntervalMinutes}
              trayTitleShow={trayTitleShow}
              onTrayTitleShowChange={handleTrayTitleShowChange}
              trayMenuShow={trayMenuShow}
              onTrayMenuShowChange={handleTrayMenuShowChange}
              trayCountdownUnits={trayCountdownUnits}
              onTrayCountdownUnitChange={handleTrayCountdownUnitChange}
              codexLimits={currentQuota.limits}
            />
          ) : null}

          <div className={!isLoading && view === "logs" ? "block" : "hidden"}>
            <LogPanel isActive={!isLoading && view === "logs"} />
          </div>


        </main>
      </div>
      </div>
      {selectedProjectForModal && (
        <ProjectSessionsModal
          project={selectedProjectForModal}
          showSessionCredits={showSessionCredits}
          range={range}
          onSessionClick={openSession}
          isActive={projectActive}
          dataRevision={projectDataRevision}
          onScanComplete={handleLocalScanComplete}
          onClose={() => setSelectedProjectForModal(null)}
          onGoToSessions={(projectPath) => {
            setSelectedProjectForModal(null);
            setSelectedProjectFilter(projectPath);
            setSelectedSessionDate(null);
            void handleViewChange("sessions");
          }}
        />
      )}
      {sessionTabs.tabs.map(({ id, session }) => (
        <div key={id} id={`session-panel-${id}`} role="tabpanel" aria-labelledby={`session-tab-${id}`} aria-hidden={id !== activeSessionId} inert={id !== activeSessionId} className={`absolute inset-0 z-50 ${id === activeSessionId ? "" : "invisible"}`}>
          <SessionDetailModal
            session={session}
            isActive={id === activeSessionId}
            showSessionCredits={showSessionCredits}
            onScanComplete={handleSessionScanComplete}
            onClose={closeSessionTab}
          />
        </div>
      ))}
      {isResetHistoryOpen ? (
        <CodexResetHistoryModal onClose={() => setIsResetHistoryOpen(false)} />
      ) : null}
      </div>
      </div>
    </div>
  );
}
