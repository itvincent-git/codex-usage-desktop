import { shortcutAria, shortcutLabel } from "@/lib/keyboard-shortcuts";
import { Sparkles, RefreshCcw } from "lucide-react";
import type { OverviewResponse, UpdateCheckResponse } from "@/lib/api";
import type { UpdateInstallStatus, UpdateProgressState } from "@/hooks/use-usage-dashboard";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/usage-dashboard";
import dayjs from "dayjs";

export type DashboardView = "dashboard" | "models" | "projects" | "daily" | "monthly" | "sessions" | "settings" | "logs" | "accounts";

type DashboardHeaderProps = {
  updateInfo: UpdateCheckResponse | null;
  isUpdateDismissed: boolean;
  updateInstallStatus: UpdateInstallStatus;
  updateProgress: UpdateProgressState;
  onUpgrade: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isBusy: boolean;
  overview: OverviewResponse | null;
  scanMessage: string;
  lastRescanDurationMs: number | null;
  syncFailed?: boolean;
};

export function DashboardHeader({
  updateInfo,
  isUpdateDismissed,
  updateInstallStatus,
  updateProgress,
  onUpgrade,
  onRefresh,
  isRefreshing,
  isBusy,
  overview,
  scanMessage,
  lastRescanDurationMs,
  syncFailed = false,
}: DashboardHeaderProps) {
  const { t } = useTranslation();

  const isSynced = !!overview?.updatedAt && !syncFailed;
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
      <div className="flex min-h-10 items-center justify-between gap-4 border-b border-border/80">
        <div className="min-w-0">
          {updateInfo?.hasUpdate && isUpdateDismissed && (
            <button
              type="button"
              onClick={onUpgrade}
              disabled={isInstallingUpdate}
              className="relative z-20 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 hover:from-indigo-400 hover:to-purple-500 hover:shadow-indigo-500/30 transition-all duration-200 hover:animate-none active:scale-95 cursor-pointer mb-2"
              title={t("header.upgrade_title")}
            >
              <Sparkles className="h-3 w-3" />
              {headerUpgradeLabel}
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 pb-2">
          {overview && (
            <div className="hidden min-w-0 flex-col items-end text-right leading-tight select-none sm:flex">
              <div className="flex w-full min-w-0 items-center justify-end gap-1.5 text-xs font-medium text-foreground">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isSynced ? "bg-success" : "bg-warning"}`}></span>
                </span>
                <span className="truncate max-w-[280px]">{isSynced ? t("hero.cache_synced", { defaultValue: "Cache Synced" }) : t("hero.out_of_sync", { defaultValue: "Out of Sync" })}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground font-normal truncate max-w-[280px]">{scanMessage}</span>
              </div>
              <div className="mt-0.5 max-w-full text-xs text-muted-foreground">
                {updatedLabel}
              </div>
            </div>
          )}
          <Button variant="primary" size="sm" className="relative z-20 shrink-0" title={`${t("hero.rescan")} (${shortcutLabel("R")})`} aria-keyshortcuts={shortcutAria("R")} onClick={onRefresh} disabled={isBusy}>
            <RefreshCcw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {t("hero.rescan", { defaultValue: "Rescan local logs" })}
          </Button>
        </div>
      </div>
    </header>
  );
}
