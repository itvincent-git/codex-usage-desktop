import { CodexLimitsCard } from "@/components/codex-limits-card";
import { DailyUsageTable } from "@/components/daily-usage-table";
import { DashboardHeroCard } from "@/components/dashboard-hero-card";
import { DashboardHeader } from "@/components/dashboard-header";
import { LoadingState } from "@/components/loading-state";
import { LogPanel } from "@/components/log-panel";
import { ModelUsageCard } from "@/components/model-usage-card";
import { MonthlyUsageTable } from "@/components/monthly-usage-table";
import { ProjectUsageCard } from "@/components/project-usage-card";
import { SettingsPage } from "@/components/settings-page";
import { SessionUsageTable } from "@/components/session-usage-table";
import { SessionDetailModal } from "@/components/session-detail-modal";
import { ProjectSessionsModal } from "@/components/project-sessions-modal";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeSwitcher } from "@/components/range-switcher";
import { useUsageDashboard } from "@/hooks/use-usage-dashboard";
import { buildMetricCards, getRangeLabel } from "@/lib/usage-dashboard";
import type { SessionDetailRow } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, X, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export default function App() {
  const { t, i18n } = useTranslation();
  const [showNotes, setShowNotes] = useState(false);
  const [selectedSessionDate, setSelectedSessionDate] = useState<string | null>(null);
  const [selectedProjectForModal, setSelectedProjectForModal] = useState<{
    project: string;
    displayName: string;
    totalTokens: number;
    costUSD: number;
  } | null>(null);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionDetailRow | null>(null);
  const {
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
  } = useUsageDashboard();

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
    try {
      const parsed = JSON.parse(updateInfo.releaseNotes);
      if (parsed && typeof parsed === "object") {
        const lang = i18n.language?.startsWith("zh") ? "zh" : "en";
        return parsed[lang] || parsed["en"] || updateInfo.releaseNotes;
      }
    } catch (e) {
      // Ignored: not a JSON object
    }
    return updateInfo.releaseNotes;
  }, [updateInfo?.releaseNotes, i18n.language]);

  const metrics = overview ? buildMetricCards(overview, range, t) : [];
  const projects = overview?.projects ?? [];
  const sortedMonthlyUsage = useMemo(
    () =>
      monthlyUsage
        ? {
            ...monthlyUsage,
            monthly: [...monthlyUsage.monthly].sort((left, right) => right.month.localeCompare(left.month)),
          }
        : null,
    [monthlyUsage],
  );
  const loadingTitle = overview ? t("loading.loading_range", { range: getRangeLabel(range, t) }) : t("loading.preparing_cache");
  const loadingDescription = overview
    ? t("loading.selected_window_desc")
    : t("loading.cached_snapshot_desc");
  const isInstallingUpdate = updateInstallStatus === "downloading";
  const isUpdateInstalled = updateInstallStatus === "installed";
  const updateButtonLabel = isUpdateInstalled
    ? t("update.restart_now")
    : isInstallingUpdate
      ? updateProgress.percent === null
        ? t("update.downloading")
        : t("update.downloading_progress", { percent: updateProgress.percent })
      : t("update.upgrade_now");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        className="relative mx-auto flex min-h-screen w-full max-w-layout flex-col px-6 pb-8 pt-3 sm:px-8 lg:px-10"
        aria-hidden={selectedSession ? "true" : undefined}
        inert={selectedSession ? true : undefined}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-10 top-3 h-40 w-40 rounded-full bg-[radial-gradient(circle,_rgba(10,10,10,0.08)_1px,_transparent_1px)] bg-[length:14px_14px] opacity-60"
        />

        <DashboardHeader
          view={view}
          onViewChange={(nextView) => {
            if (nextView !== "sessions") {
              setSelectedSessionDate(null);
              setSelectedProjectFilter(null);
            }
            setSelectedProjectForModal(null);
            setSelectedSession(null);
            void handleViewChange(nextView);
          }}
          updateInfo={updateInfo}
          isUpdateDismissed={isUpdateDismissed}
          updateInstallStatus={updateInstallStatus}
          updateProgress={updateProgress}
          onUpgrade={() => void handleUpgrade()}
          showLogsTab={showLogsTab}
          onRefresh={() => void handleRefresh()}
          isRefreshing={isRefreshing}
          isBusy={isLoading || isRefreshing || isResetting || isExporting !== null}
          overview={overview}
          scanMessage={scanMessage}
          lastRescanDurationMs={lastRescanDurationMs}
        />

        <main className={view === "dashboard" ? "flex-1 py-3" : "flex-1 py-6"}>
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

          {error ? (
            <Card className="border-error/30">
              <CardHeader>
                <CardTitle className="text-2xl">{t("error.sync_failed")}</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {isLoading ? <LoadingState title={loadingTitle} description={loadingDescription} /> : null}

          {view === "monthly" && isMonthlyLoading ? (
            <LoadingState title={t("loading.loading_monthly")} description={t("loading.natural_month_desc")} />
          ) : null}

          {view === "sessions" && isSessionsLoading ? (
            <LoadingState title={t("loading.loading_sessions")} description={t("loading.session_logs_desc")} />
          ) : null}

          {!isLoading && view === "dashboard" && overview ? (
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
                  error={codexLimitsError}
                  quotaForecast={codexQuotaForecast}
                  onOpenQuotaForecast={() => void handleOpenCodexQuotaForecast()}
                  onOpenResetCredits={() => void handleOpenResetCredits()}
                />
              </div>
            </div>
          ) : null}

          {!isLoading && view === "models" && overview ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">{t("models.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("models.subtitle")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <RangeSwitcher value={range} onChange={handleRangeChange} />
                </div>
              </div>
              <ModelUsageCard models={overview.models} />
            </div>
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

          {!isLoading && view === "monthly" && !isMonthlyLoading && sortedMonthlyUsage ? (
            <MonthlyUsageTable data={sortedMonthlyUsage} />
          ) : null}

          {!isLoading && view === "sessions" && !isSessionsLoading ? (
            <SessionUsageTable
              sessions={sessions}
              initialExpandedDate={selectedSessionDate}
              selectedProject={selectedProjectFilter}
              onClearProjectFilter={() => setSelectedProjectFilter(null)}
              onSessionClick={setSelectedSession}
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
              showLogsTab={showLogsTab}
              onShowLogsTabChange={setShowLogsTab}
              trayTitleShow={trayTitleShow}
              onTrayTitleShowChange={handleTrayTitleShowChange}
              trayMenuShow={trayMenuShow}
              onTrayMenuShowChange={handleTrayMenuShowChange}
              codexLimits={codexLimits}
            />
          ) : null}

          <div className={!isLoading && view === "logs" ? "block" : "hidden"}>
            <LogPanel />
          </div>

          {selectedProjectForModal && (
            <ProjectSessionsModal
              project={selectedProjectForModal}
              onClose={() => setSelectedProjectForModal(null)}
              onGoToSessions={(projectPath) => {
                setSelectedProjectForModal(null);
                setSelectedProjectFilter(projectPath);
                setSelectedSessionDate(null);
                void handleViewChange("sessions");
              }}
            />
          )}

        </main>
      </div>
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
