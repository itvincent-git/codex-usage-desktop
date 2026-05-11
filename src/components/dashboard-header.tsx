import { Download, FileSpreadsheet, FileText, RefreshCcw } from "lucide-react";
import { RangeSwitcher } from "@/components/range-switcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatDuration } from "@/lib/usage-dashboard";

export type DashboardView = "dashboard" | "monthly";

type DashboardHeaderProps = {
  view: DashboardView;
  range: RangeKey;
  overview: OverviewResponse | null;
  scanMessage: string;
  isLoading: boolean;
  isRefreshing: boolean;
  isExporting: ExportFormat | null;
  lastRescanDurationMs: number | null;
  onViewChange: (view: DashboardView) => void;
  onRangeChange: (range: RangeKey) => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => void;
};

export function DashboardHeader({
  view,
  range,
  overview,
  scanMessage,
  isLoading,
  isRefreshing,
  isExporting,
  lastRescanDurationMs,
  onViewChange,
  onRangeChange,
  onRefresh,
  onExport,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-secondary">
            Codex Usage Desktop
          </p>
          <div className="space-y-3">
            <h1 className="font-display text-3xl tracking-display sm:text-2xl">Local Codex cost intelligence.</h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              A compact local dashboard for recent Codex usage and cost.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-sm border border-border bg-surface p-1" role="tablist" aria-label="Usage view">
            <button
              type="button"
              role="tab"
              aria-selected={view === "dashboard"}
              className={`rounded-sm px-4 py-2 text-sm font-medium transition ${
                view === "dashboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "monthly"}
              className={`rounded-sm px-4 py-2 text-sm font-medium transition ${
                view === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onViewChange("monthly")}
            >
              Monthly
            </button>
          </div>
          {view === "dashboard" ? (
            <>
              <RangeSwitcher value={range} onChange={onRangeChange} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="lg" disabled={!overview || isLoading || isExporting !== null}>
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
          <Button variant="primary" size="lg" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Rescan local logs
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{scanMessage}</span>
        <span>
          {overview?.updatedAt
            ? `Last update ${new Date(overview.updatedAt).toLocaleString()}${
                lastRescanDurationMs === null ? "" : ` · Rescan ${formatDuration(lastRescanDurationMs)}`
              }`
            : "No cached snapshot yet"}
        </span>
      </div>
    </header>
  );
}
