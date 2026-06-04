import { Sparkles } from "lucide-react";
import type { UpdateCheckResponse } from "@/lib/api";
import { useTranslation } from "react-i18next";

export type DashboardView = "dashboard" | "models" | "projects" | "daily" | "monthly" | "sessions" | "settings" | "logs";

type DashboardHeaderProps = {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  updateInfo: UpdateCheckResponse | null;
  isUpdateDismissed: boolean;
  onUpgrade: () => void;
  showLogsTab?: boolean;
};

export function DashboardHeader({
  view,
  onViewChange,
  updateInfo,
  isUpdateDismissed,
  onUpgrade,
  showLogsTab = false,
}: DashboardHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex flex-col gap-3 pb-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-secondary">{t("header.app_title")}</p>
          {updateInfo?.hasUpdate && isUpdateDismissed && (
            <button
              type="button"
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-md shadow-indigo-500/20 hover:from-indigo-400 hover:to-purple-500 hover:shadow-indigo-500/30 transition-all duration-200 animate-pulse hover:animate-none active:scale-95 cursor-pointer"
              title={t("header.upgrade_title")}
            >
              <Sparkles className="h-3 w-3 animate-pulse" />
              {t("header.upgrade", { version: updateInfo.latestVersion })}
            </button>
          )}
        </div>

        <nav className="flex max-w-full items-center gap-6 overflow-x-auto border-b border-border/80 sm:gap-8" aria-label={t("range_switcher.aria_select_range")}>
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
      </div>
    </header>
  );
}
