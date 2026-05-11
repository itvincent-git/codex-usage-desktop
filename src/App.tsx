import { DailyUsageTable } from "@/components/daily-usage-table";
import { DashboardHeader } from "@/components/dashboard-header";
import { LoadingState } from "@/components/loading-state";
import { MetricCard } from "@/components/metric-card";
import { ModelUsageCard } from "@/components/model-usage-card";
import { MonthlyUsageTable } from "@/components/monthly-usage-table";
import { ProjectUsageCard } from "@/components/project-usage-card";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageTrendsCard } from "@/components/usage-trends-card";
import { useUsageDashboard } from "@/hooks/use-usage-dashboard";
import { buildMetricCards, rangeLabels } from "@/lib/usage-dashboard";
import { useMemo } from "react";

export default function App() {
  const {
    view,
    range,
    overview,
    monthlyUsage,
    scanMessage,
    error,
    isLoading,
    isMonthlyLoading,
    isRefreshing,
    isExporting,
    lastRescanDurationMs,
    handleViewChange,
    handleRangeChange,
    handleRefresh,
    handleExport,
  } = useUsageDashboard();

  const metrics = overview ? buildMetricCards(overview, range) : [];
  const projects = overview?.projects ?? [];
  const sortedDailyUsage = useMemo(
    () => (overview ? [...overview.daily].sort((left, right) => right.date.localeCompare(left.date)) : []),
    [overview],
  );
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
  const loadingTitle = overview ? `Loading ${rangeLabels[range]}` : "Preparing local cache";
  const loadingDescription = overview
    ? "Loading usage and cost data for the selected window."
    : "Loading the cached dashboard snapshot.";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative mx-auto flex min-h-screen w-full max-w-layout flex-col px-6 py-8 sm:px-8 lg:px-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-10 top-8 h-40 w-40 rounded-full bg-[radial-gradient(circle,_rgba(10,10,10,0.08)_1px,_transparent_1px)] bg-[length:14px_14px] opacity-60"
        />

        <DashboardHeader
          view={view}
          range={range}
          overview={overview}
          scanMessage={scanMessage}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          isExporting={isExporting}
          lastRescanDurationMs={lastRescanDurationMs}
          onViewChange={(nextView) => void handleViewChange(nextView)}
          onRangeChange={handleRangeChange}
          onRefresh={() => void handleRefresh()}
          onExport={(format) => void handleExport(format)}
        />

        <main className="flex-1 py-8">
          {error ? (
            <Card className="border-error/30">
              <CardHeader>
                <CardTitle className="text-2xl">Data sync failed</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {isLoading ? <LoadingState title={loadingTitle} description={loadingDescription} /> : null}

          {view === "monthly" && isMonthlyLoading ? (
            <LoadingState title="Loading Monthly Usage" description="Aggregating natural-month totals." />
          ) : null}

          {!isLoading && view === "dashboard" && overview ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {metrics.map((metric) => (
                  <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
                ))}
              </div>

              <UsageTrendsCard daily={overview.daily} />

              <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                <DailyUsageTable range={range} daily={sortedDailyUsage} />

                <div className="space-y-4">
                  <ModelUsageCard models={overview.models} />
                  <ProjectUsageCard projects={projects} />
                </div>
              </div>
            </div>
          ) : null}

          {!isLoading && view === "monthly" && !isMonthlyLoading && sortedMonthlyUsage ? (
            <MonthlyUsageTable data={sortedMonthlyUsage} />
          ) : null}
        </main>
      </div>
    </div>
  );
}
