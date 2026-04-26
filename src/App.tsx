import { RefreshCcw } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard } from "@/components/metric-card";
import { RangeSwitcher } from "@/components/range-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchOverview, scanUsage, type OverviewResponse, type RangeKey } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";

const rangeLabels: Record<RangeKey, string> = {
  "1d": "Last 1 Day",
  "2d": "Last 2 Days",
  "7d": "Last 7 Days",
  "14d": "Last 14 Days",
  "30d": "Last 30 Days",
};

function formatTrendDateLabel(date: string) {
  return date.slice(5);
}

export default function App() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [scanMessage, setScanMessage] = useState("Sync local Codex usage into the desktop cache.");
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasBootstrappedRef = useRef(false);

  const loadOverview = useEffectEvent(async (nextRange: RangeKey) => {
    const data = await fetchOverview(nextRange);
    setOverview(data);
    setError(null);
  });

  const bootstrap = useEffectEvent(async () => {
    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    setIsLoading(true);

    try {
      const scan = await scanUsage();
      setScanMessage(`Imported ${scan.importedDays} day buckets into the local cache.`);
      await loadOverview(range);
      setBootstrapped(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load overview.");
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function handleRangeChange(nextRange: RangeKey) {
    setRange(nextRange);

    if (!bootstrapped) {
      return;
    }

    setIsLoading(true);

    try {
      await loadOverview(nextRange);
    } catch (rangeError) {
      setError(rangeError instanceof Error ? rangeError.message : "Failed to switch range.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);

    try {
      const scan = await scanUsage();
      setScanMessage(`Imported ${scan.importedDays} day buckets into the local cache.`);
      await loadOverview(range);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  const metrics = overview
    ? [
        {
          label: "Total Tokens",
          value: formatNumber(overview.totals.totalTokens),
          detail: `${rangeLabels[range]} across ${overview.startDate} to ${overview.endDate}`,
        },
        {
          label: "Total Cost",
          value: formatCurrency(overview.totals.costUSD),
          detail: `Estimated local-first spend for ${overview.timezone}`,
        },
        {
          label: "Avg / Day",
          value: `${formatNumber(overview.totals.avgTokensPerDay)} / ${formatCurrency(overview.totals.avgCostPerDay)}`,
          detail: "Normalized by the selected natural-day window.",
        },
        {
          label: "Cache Hit",
          value: formatPercent(overview.totals.cacheHitRate),
          detail: `${formatNumber(overview.totals.cachedInputTokens)} cached input tokens`,
        },
        {
          label: "Cost / 1M",
          value: formatCurrency(overview.totals.costPerMillionTokens),
          detail: "Effective blended cost over all billable tokens.",
        },
      ]
    : [];

  const trendData =
    overview?.daily.map((day) => ({
      date: day.date,
      shortDate: formatTrendDateLabel(day.date),
      totalTokens: day.totalTokens,
      costUSD: day.costUSD,
    })) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative mx-auto flex min-h-screen w-full max-w-layout flex-col px-6 py-8 sm:px-8 lg:px-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-10 top-8 h-40 w-40 rounded-full bg-[radial-gradient(circle,_rgba(10,10,10,0.08)_1px,_transparent_1px)] bg-[length:14px_14px] opacity-60"
        />

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
              <RangeSwitcher value={range} onChange={handleRangeChange} />
              <Button variant="primary" size="lg" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Rescan local logs
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{scanMessage}</span>
            <span>{overview?.updatedAt ? `Last update ${new Date(overview.updatedAt).toLocaleString()}` : "No cached snapshot yet"}</span>
          </div>
        </header>

        <main className="flex-1 py-8">
          {error ? (
            <Card className="border-error/30">
              <CardHeader>
                <CardTitle className="text-2xl">Data sync failed</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {isLoading && !overview ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Preparing local cache</CardTitle>
                <CardDescription>Scanning Codex usage and building the recent dashboard.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {!isLoading && overview ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {metrics.map((metric) => (
                  <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Usage Trends</CardTitle>
                  <CardDescription>Total token and cost movement across the selected natural-day window.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 xl:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Total Token Trend</p>
                      <p className="text-sm text-muted-foreground">Daily total tokens from the local sidecar cache.</p>
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="shortDate"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                          />
                          <YAxis
                            width={72}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                            tickFormatter={(value) => formatNumber(Number(value))}
                          />
                          <Tooltip
                            formatter={(value) => formatNumber(Number(value))}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                          />
                          <Line
                            type="monotone"
                            dataKey="totalTokens"
                            stroke="rgb(var(--primary))"
                            strokeWidth={2.5}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Cost Trend</p>
                      <p className="text-sm text-muted-foreground">Estimated USD spend by day for the same window.</p>
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="shortDate"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                          />
                          <YAxis
                            width={80}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                            tickFormatter={(value) => formatCurrency(Number(value))}
                          />
                          <Tooltip
                            formatter={(value) => formatCurrency(Number(value))}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                          />
                          <Line
                            type="monotone"
                            dataKey="costUSD"
                            stroke="rgb(var(--secondary))"
                            strokeWidth={2.5}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>{rangeLabels[range]}</CardTitle>
                    <CardDescription>Natural-day buckets written from the sidecar cache after the latest scan.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {overview.daily.map((day) => (
                      <div
                        key={day.date}
                        className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium text-foreground">{day.date}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatNumber(day.totalTokens)} total tokens with {formatNumber(day.cachedInputTokens)} cache reads
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-medium text-foreground">{formatCurrency(day.costUSD)}</p>
                          <p className="text-sm text-muted-foreground">
                            In {formatNumber(day.inputTokens)} / Out {formatNumber(day.outputTokens)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Foundation Scope</CardTitle>
                    <CardDescription>This first version intentionally stays narrow.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
                    <p>Source of truth: local Codex logs analyzed through the ccusage Codex companion CLI.</p>
                    <p>Storage: SQLite cache in the sidecar so the UI reads a normalized local snapshot.</p>
                    <p>UI scope: 1-day, 2-day, 7-day, 14-day, and 30-day overview only. Session, project, export, and alerts come later.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
