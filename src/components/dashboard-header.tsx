import { Download, FileSpreadsheet, FileText, RefreshCcw, Sparkles } from "lucide-react";
import { RangeSwitcher } from "@/components/range-switcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportFormat, OverviewResponse, RangeKey, UpdateCheckResponse } from "@/lib/api";

export type DashboardView = "dashboard" | "monthly" | "settings" | "logs";

type DashboardHeaderProps = {
  view: DashboardView;
  range: RangeKey;
  overview: OverviewResponse | null;
  scanMessage: string;
  isLoading: boolean;
  isRefreshing: boolean;
  isResetting: boolean;
  isExporting: ExportFormat | null;
  onViewChange: (view: DashboardView) => void;
  onRangeChange: (range: RangeKey) => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => void;
  updateInfo: UpdateCheckResponse | null;
  isUpdateDismissed: boolean;
  onUpgrade: () => void;
};

export function DashboardHeader({
  view,
  range,
  overview,
  scanMessage,
  isLoading,
  isRefreshing,
  isResetting,
  isExporting,
  onViewChange,
  onRangeChange,
  onRefresh,
  onExport,
  updateInfo,
  isUpdateDismissed,
  onUpgrade,
}: DashboardHeaderProps) {
  const isBusy = isLoading || isRefreshing || isResetting || isExporting !== null;

  return (
    <header className="flex flex-col gap-4 border-b border-border pb-2">
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
            className={`border-b-2 px-0 pb-3 pt-1 text-sm font-medium transition ${
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
            aria-selected={view === "monthly"}
            className={`border-b-2 px-0 pb-3 pt-1 text-sm font-medium transition ${
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
            className={`border-b-2 px-0 pb-3 pt-1 text-sm font-medium transition ${
              view === "settings"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onViewChange("settings")}
          >
            Settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "logs"}
            className={`border-b-2 px-0 pb-3 pt-1 text-sm font-medium transition ${
              view === "logs"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onViewChange("logs")}
          >
            Logs
          </button>
          </nav>
          </div>
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-end">
          {view === "dashboard" ? (
            <>
              <RangeSwitcher value={range} onChange={onRangeChange} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="lg" disabled={!overview || isBusy}>
                    <Download className="h-4 w-4" />
                    {isExporting === null ? "Export" : "Exporting"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onExport("xlsx")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onExport("markdown")}>
                    <FileText className="mr-2 h-4 w-4" />
                    Markdown (.md)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          <Button variant="primary" size="lg" onClick={onRefresh} disabled={isBusy}>
            <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Rescan local logs
          </Button>
      </div>
      {view !== "dashboard" ? <p className="text-sm text-muted-foreground">{scanMessage}</p> : null}
    </header>
  );
}
