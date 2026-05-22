import { Sparkles } from "lucide-react";
import type { UpdateCheckResponse } from "@/lib/api";

export type DashboardView = "dashboard" | "daily" | "monthly" | "settings" | "logs";

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
  return (
    <header className="flex flex-col gap-3 pb-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-secondary">Codex Usage Desktop</p>
          {updateInfo?.hasUpdate && isUpdateDismissed && (
            <button
              type="button"
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-md shadow-indigo-500/20 hover:from-indigo-400 hover:to-purple-500 hover:shadow-indigo-500/30 transition-all duration-200 animate-pulse hover:animate-none active:scale-95 cursor-pointer"
              title="Click to upgrade your application"
            >
              <Sparkles className="h-3 w-3 animate-pulse" />
              Upgrade v{updateInfo.latestVersion}
            </button>
          )}
        </div>

        <nav className="flex items-center gap-8 border-b border-border/80" aria-label="Usage view">
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
            Dashboard
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
            Daily
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
            Monthly
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
            Settings
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
              Logs
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
