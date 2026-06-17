import { Sparkles, RefreshCcw } from "lucide-react";
import type { OverviewResponse, UpdateCheckResponse } from "@/lib/api";
import type { UpdateInstallStatus, UpdateProgressState } from "@/hooks/use-usage-dashboard";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/usage-dashboard";
import dayjs from "dayjs";

export type DashboardView = "dashboard" | "models" | "projects" | "daily" | "monthly" | "sessions" | "settings" | "logs";

type DashboardHeaderProps = {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  updateInfo: UpdateCheckResponse | null;
  isUpdateDismissed: boolean;
  updateInstallStatus: UpdateInstallStatus;
  updateProgress: UpdateProgressState;
  onUpgrade: () => void;
  showLogsTab?: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  isBusy: boolean;
  overview: OverviewResponse | null;
  scanMessage: string;
  lastRescanDurationMs: number | null;
};

export function DashboardHeader({
  view,
  onViewChange,
  updateInfo,
  isUpdateDismissed,
  updateInstallStatus,
  updateProgress,
  onUpgrade,
  showLogsTab = false,
  onRefresh,
  isRefreshing,
  isBusy,
  overview,
  scanMessage,
  lastRescanDurationMs,
}: DashboardHeaderProps) {
  const { t } = useTranslation();

  const isSynced = overview ? !!overview.updatedAt : false;
  const isInstallingUpdate = updateInstallStatus === "downloading";
  const headerUpgradeLabel = updateInstallStatus === "installed"
    ? t("header.restart_update")
    : isInstallingUpdate
      ? updateProgress.percent === null
        ? t("header.downloading_update")
        : t("header.downloading_update_progress", { percent: updateProgress.percent })
      : t("header.upgrade", { version: updateInfo?.latestVersion });

  const formatUpdatedTime = (timestamp: string) => {
    const updatedAt = dayjs(timestamp);
    const timeStr = updatedAt.format("HH:mm:ss");
    if (updatedAt.isSame(dayjs(), "day")) {
      return t("hero.updated_today", { time: timeStr, defaultValue: `Today at ${timeStr}` });
    }
    return `${updatedAt.format("YYYY-MM-DD")} ${timeStr}`;
  };

  const updatedLabel = overview?.updatedAt
      ? t("hero.last_updated", {
        time: formatUpdatedTime(overview.updatedAt),
        duration: lastRescanDurationMs === null ? "" : ` · ${t("hero.rescan_duration", { duration: formatDuration(lastRescanDurationMs) })}`
      })
      : t("hero.last_updated_never");

  return (
    <header className="pb-2">
      <div className="flex items-end justify-between border-b border-border/80">
        <div className="flex items-center gap-4 -mb-px min-w-0">
          <nav className="flex max-w-full items-center gap-6 overflow-x-auto sm:gap-8" aria-label={t("range_switcher.aria_select_range")}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "dashboard"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "dashboard"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("dashboard")}
            >
              {t("common.dashboard")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "models"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "models"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("models")}
            >
              {t("common.model")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "daily"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "daily"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("daily")}
            >
              {t("common.daily")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "projects"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "projects"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("projects")}
            >
              {t("common.project")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "monthly"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "monthly"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("monthly")}
            >
              {t("common.monthly")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "sessions"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "sessions"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("sessions")}
            >
              {t("common.sessions")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "settings"}
              className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                view === "settings"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("settings")}
            >
              {t("common.settings")}
            </button>
            {showLogsTab && (
              <button
                type="button"
                role="tab"
                aria-selected={view === "logs"}
                className={`border-b-2 px-0 pb-2 pt-1 text-sm font-medium transition ${
                  view === "logs"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onViewChange("logs")}
              >
                {t("common.logs")}
              </button>
            )}
          </nav>
          {updateInfo?.hasUpdate && isUpdateDismissed && (
            <button
              type="button"
              onClick={onUpgrade}
              disabled={isInstallingUpdate}
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-md shadow-indigo-500/20 hover:from-indigo-400 hover:to-purple-500 hover:shadow-indigo-500/30 transition-all duration-200 animate-pulse hover:animate-none active:scale-95 cursor-pointer mb-2"
              title={t("header.upgrade_title")}
            >
              <Sparkles className="h-3 w-3 animate-pulse" />
              {headerUpgradeLabel}
            </button>
          )}
        </div>

        <div className="pb-2 shrink-0 flex items-center gap-3">
          {overview && (
            <div className="hidden sm:flex flex-col items-end text-right leading-tight select-none">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75 ${isSynced ? "" : "hidden"}`}></span>
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isSynced ? "bg-success" : "bg-warning"}`}></span>
                </span>
                <span className="truncate max-w-[280px]">{isSynced ? t("hero.cache_synced", { defaultValue: "Cache Synced" }) : t("hero.out_of_sync", { defaultValue: "Out of Sync" })}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground font-normal truncate max-w-[280px]">{scanMessage}</span>
              </div>
              <div className="text-[10px] text-muted-foreground/75 mt-0.5">
                {updatedLabel}
              </div>
            </div>
          )}
          <Button variant="primary" size="sm" onClick={onRefresh} disabled={isBusy}>
            <RefreshCcw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {t("hero.rescan", { defaultValue: "Rescan local logs" })}
          </Button>
        </div>
      </div>
    </header>
  );
}
