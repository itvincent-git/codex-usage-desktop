import { Download, FileSpreadsheet, FileText, Info, RefreshCcw, Cpu, FolderGit2, CalendarDays, User, Sparkles } from "lucide-react";
import { RangeSwitcher } from "@/components/range-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CodexLimitsResponse, ExportFormat, OverviewResponse, RangeKey } from "@/lib/api";
import { formatCompactNumber, formatCurrencyShort, formatPercent } from "@/lib/formatters";
import { formatDuration, getRangeLabel } from "@/lib/usage-dashboard";
import type { MetricCardData } from "@/lib/usage-dashboard";
import { UsageTrendsCard } from "@/components/usage-trends-card";
import { useState } from "react";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

type DashboardHeroCardProps = {
  overview: OverviewResponse;
  range: RangeKey;
  isBusy: boolean;
  isExporting: ExportFormat | null;
  onRangeChange: (range: RangeKey) => void;
  onExport: (format: ExportFormat) => void;
  metrics: MetricCardData[];
  codexLimits: CodexLimitsResponse | null;
};

export function DashboardHeroCard({
  overview,
  range,
  isBusy,
  isExporting,
  onRangeChange,
  onExport,
  metrics,
  codexLimits,
}: DashboardHeroCardProps) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<"projects" | "models" | "dates">("projects");

  const totalCost = overview.totals.costUSD;
  const models = overview.models ?? [];
  const projects = overview.projects ?? [];

  const buildCostDrivers = (items: Array<{ label: string; costUSD: number }>) =>
    [...items]
      .sort((left, right) => right.costUSD - left.costUSD)
      .slice(0, 3)
      .map((item) => ({
        label: item.label,
        costUSD: item.costUSD,
        share: totalCost > 0 ? item.costUSD / totalCost : 0,
      }));

  const topModels = buildCostDrivers(models.map((model) => ({ label: model.model, costUSD: model.costUSD })));
  const topProjects = buildCostDrivers(projects.map((project) => ({ label: project.displayName, costUSD: project.costUSD })));
  const topDates = buildCostDrivers(overview.daily.map((day) => ({ label: day.date, costUSD: day.costUSD })));
  const subscriptionExpiryLabel = formatSubscriptionExpiry(codexLimits?.subscriptionExpiresAt ?? null, t);

  const activeTabDrivers = activeTab === "models" 
    ? topModels 
    : activeTab === "projects" 
    ? topProjects 
    : topDates;

  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-gradient-to-br from-surface via-surface to-primary/5">
      <div className="p-4 lg:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{t("hero.overview_label", { defaultValue: "Overview" })}</p>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2.5xl font-bold tracking-display text-foreground sm:text-3xl">
                {t("hero.title")}
              </h1>
              <div className="group relative flex items-center">
                <Info className="h-4 w-4 text-muted-foreground/50 transition-colors hover:text-muted-foreground cursor-help" />
                <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2.5 w-64 rounded-md border border-border bg-surface p-3 text-xs text-foreground opacity-0 shadow-card transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
                  <p className="font-semibold text-foreground">{t("hero.title")}</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{t("hero.subtitle")}</p>
                  <div className="absolute right-1 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-border bg-surface sm:left-1/2 sm:right-auto" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <RangeSwitcher value={range} onChange={onRangeChange} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="lg" disabled={isBusy}>
                  <Download className="h-4 w-4" />
                  {isExporting === null ? t("hero.export") : t("hero.exporting")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExport("xlsx")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  {t("hero.export_excel")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("markdown")}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("hero.export_markdown")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3.5 grid gap-4 lg:grid-cols-[0.8fr_1.4fr] lg:gap-5">
          <div className="flex flex-col justify-between gap-3.5">
            <div className="space-y-3.5">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("hero.total_cost_label", { defaultValue: "Total cost" })} ({getRangeLabel(range, t)})</p>
                <div className="flex flex-wrap items-end gap-2.5">
                  <p className="font-display text-4xl font-bold tracking-display text-foreground sm:text-5xl">
                    {formatCurrencyShort(overview.totals.costUSD)}
                  </p>
                  <p className="pb-1 text-sm font-medium text-success">
                    {formatCompactNumber(overview.totals.totalTokens)} tokens
                  </p>
                </div>
              </div>

              {/* Account and Membership Info */}
              {(codexLimits?.account || codexLimits?.membershipLevel || subscriptionExpiryLabel) && (
                <div className="pt-2 flex flex-wrap items-center gap-3 border-t border-border/30 text-xs">
                  {codexLimits?.account && (
                    <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                      <User className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span>{codexLimits.account}</span>
                    </div>
                  )}
                  {codexLimits?.membershipLevel && (
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 border",
                        codexLimits.membershipLevel.toLowerCase() === "plus" || codexLimits.membershipLevel.toLowerCase() === "pro"
                          ? "bg-indigo-500/10 border-indigo-500/25 text-indigo-400"
                          : codexLimits.membershipLevel.toLowerCase() === "team" || codexLimits.membershipLevel.toLowerCase() === "enterprise"
                          ? "bg-purple-500/10 border-purple-500/25 text-purple-400"
                          : "bg-muted/50 border-border/40 text-muted-foreground"
                      )}>
                        <Sparkles className="h-2.5 w-2.5" />
                        {codexLimits.membershipLevel}
                      </span>
                    </div>
                  )}
                  {subscriptionExpiryLabel && (
                    <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span>{subscriptionExpiryLabel}</span>
                      {codexLimits?.subscriptionWillRenew === false && (
                        <span className="text-muted-foreground/50">· {t("limits.auto_renew_off", { defaultValue: "Auto-renew off" })}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Cost Drivers tabbed view */}
            <div className="rounded-lg border border-border/60 bg-surface/55 p-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">{t("hero.cost_drivers", { defaultValue: "Cost Drivers" })}</span>
                </div>
                
                {/* Tabs */}
                <div className="flex p-0.5 bg-muted/40 rounded-md border border-border/40 text-[10px] font-medium">
                  {(["projects", "models", "dates"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "px-2 py-0.5 rounded-sm capitalize transition-all",
                        activeTab === tab 
                          ? "bg-background text-foreground shadow-sm font-semibold" 
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "projects" ? t("common.project") : tab === "models" ? t("common.model") : t("common.date")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Contents */}
              <div className="space-y-2">
                {activeTabDrivers.length > 0 ? (
                  activeTabDrivers.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="flex items-center gap-2">
                      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border/40 text-[9px] font-bold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-foreground" title={item.label}>
                            {item.label}
                          </p>
                          <p className="shrink-0 font-mono text-xs font-bold text-foreground">
                            {formatCurrencyShort(item.costUSD)}
                          </p>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/60">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary to-indigo-500 transition-all duration-500" style={{ width: `${Math.min(Math.max(item.share, 0), 1) * 100}%` }} />
                          </div>
                          <span className="w-8 shrink-0 text-right text-[10px] font-semibold text-muted-foreground">
                            {formatPercent(item.share)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-center text-xs text-muted-foreground">{t("project_modal.no_sessions")}</p>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <UsageTrendsCard
              daily={overview.daily}
              metrics={metrics}
              cacheHitRate={overview.totals.cacheHitRate}
              chartHeight={145}
              className="border-border/70 bg-surface/55 hover:translate-y-0 hover:shadow-none shadow-sm"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function formatSubscriptionExpiry(expiresAt: string | null, t?: any) {
  if (!expiresAt) {
    return null;
  }

  // ChatGPT's API includes a 24-hour grace period on the token entitlement.
  // Subtract 1 day to match the user's actual billing cycle date.
  const expiresDate = dayjs(expiresAt).subtract(1, "day");
  if (!expiresDate.isValid()) {
    return null;
  }

  const daysLeft = Math.max(0, Math.ceil(expiresDate.diff(dayjs(), "day", true)));
  const daysLeftLabel = t
    ? (daysLeft === 1 ? t("limits.days_left_one") : t("limits.days_left_other", { count: daysLeft }))
    : (daysLeft === 1 ? "1 day left" : `${daysLeft} days left`);

  return t
    ? t("limits.subscription_expires", { date: expiresDate.format("YYYY-MM-DD"), timeLeft: daysLeftLabel })
    : `Expires ${expiresDate.format("YYYY-MM-DD")} (${daysLeftLabel})`;
}
