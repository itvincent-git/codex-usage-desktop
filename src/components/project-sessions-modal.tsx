import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { ArrowRight, Coins, Database, Folder, RefreshCw, Search, Terminal, X } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchProjectAnalytics,
  rescanProject,
  fetchProjectSessionDays,
  type ProjectSessionDaysResponse,
  type OverviewResponse,
  type ProjectAnalyticsResponse,
  type RangeKey,
  type ScanResponse,
  type SessionDetailRow,
} from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatCurrencyShort, formatNumber, formatPercent } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { projectLabel } from "@/lib/project-reference";
import { projectTokenBreakdown } from "@/lib/project-analytics";
import { MetricBadge } from "./metric-badge";
import { ProjectSessionDayView } from "./project-session-day";
import { useModalFocus } from "@/hooks/use-modal-focus";

type ProjectSessionsModalProps = {
  project: Pick<OverviewResponse["projects"][number], "project" | "displayName" | "codexProjectId" | "codexProjectName" | "codexProjectRoot" | "totalTokens" | "costUSD">;
  range: RangeKey;
  onClose: () => void;
  onSessionClick?: (session: SessionDetailRow) => void;
  isActive?: boolean;
  dataRevision?: number;
  onScanComplete?: (scan: ScanResponse) => Promise<void>;
  onGoToSessions: (projectPath: string) => void;
};

function TrendTooltip({ active, payload, label, t }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ProjectAnalyticsResponse["daily"][number] & { nonCachedInputTokens: number };
  return <div className="min-w-[220px] select-none rounded-lg border border-border/70 bg-surface p-3.5 text-xs shadow-xl">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <div className="space-y-1.5">
      <p className="mb-1.5 flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 font-semibold text-foreground"><span>{t("project_modal.total_tokens")}</span><span>{formatNumber(row.totalTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-blue-600/75" />{t("project_modal.input")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.nonCachedInputTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-success/80" />{t("project_modal.cached")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.cachedInputTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-violet-600/70" />{t("project_modal.output")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.outputTokens)}</span></p>
      <p className="mt-1.5 flex items-center justify-between gap-4 border-t border-border/60 pt-1.5 font-semibold text-primary"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />{t("common.cost")}</span><span className="font-mono">{formatCurrencyShort(row.costUSD)}</span></p>
    </div>
  </div>;
}

export function ProjectSessionsModal({ project, range, onClose, onGoToSessions, onSessionClick, isActive = true, dataRevision = 0, onScanComplete }: ProjectSessionsModalProps) {
  const { t } = useTranslation();
  const [sessionDays, setSessionDays] = useState<ProjectSessionDaysResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const daysRequest = useRef<{ key: string; promise: Promise<ProjectSessionDaysResponse> } | null>(null);
  const loadedRange = useRef({ project: project.project, initialRange: range, range });
  const requestGeneration = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [dayRevision, setDayRevision] = useState(0);
  const loadedRevision = useRef(dataRevision);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus(dialogRef, closeButtonRef, onClose, isActive);

  useEffect(() => {
    let active = true;
    setAnalytics(null);
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    void fetchProjectAnalytics(project.project, range).then((data) => {
      if (active) setAnalytics(data);
    }).catch((error) => {
      if (active) setAnalyticsError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [project.project, range]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    setSessionDays(null);
    setSessionsLoading(true);
    setSessionsError(null);
    setLoadingMore(false);
    setMoreError(null);
    const requestedRange = loadedRange.current.project === project.project && loadedRange.current.initialRange === range ? loadedRange.current.range : range;
    loadedRange.current = { project: project.project, initialRange: range, range: requestedRange };
    const key = JSON.stringify([project.project, requestedRange, query]);
    if (daysRequest.current?.key !== key) {
      daysRequest.current = { key, promise: fetchProjectSessionDays(project.project, requestedRange, query) };
    }
    void daysRequest.current.promise.then((data) => {
      if (active) setSessionDays(data);
    }).catch((error) => {
      if (active) setSessionsError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; requestGeneration.current += 1; };
  }, [project.project, range, query]);

  async function reloadProjectData(scan: boolean) {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const generation = ++requestGeneration.current;
    const revision = dataRevision;
    setRefreshing(true);
    setRefreshError(null);
    try {
      if (scan) {
        const result = await rescanProject(project.project);
        await onScanComplete?.(result);
      }
      if (generation !== requestGeneration.current) return;
      const requestedRange = loadedRange.current.range;
      const [nextAnalytics, days] = await Promise.all([
        fetchProjectAnalytics(project.project, requestedRange),
        fetchProjectSessionDays(project.project, requestedRange, query),
      ]);
      if (generation !== requestGeneration.current) return;
      loadedRevision.current = revision;
      daysRequest.current = null;
      setAnalytics(nextAnalytics);
      setSessionDays(days);
      setAnalyticsError(null);
      setSessionsError(null);
      setDayRevision((value) => value + 1);
    } catch (error) {
      if (generation === requestGeneration.current) setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (isActive && !refreshing && loadedRevision.current !== dataRevision) {
      loadedRevision.current = dataRevision;
      void reloadProjectData(false);
    }
  }, [isActive, dataRevision, refreshing]);

  async function loadMoreDays() {
    if (!sessionDays || loadingMore || analyticsLoading || refreshing) return;
    const generation = requestGeneration.current;
    const days = dayjs(sessionDays.endDate).diff(dayjs(sessionDays.startDate), "day") + 1;
    const start = dayjs(sessionDays.startDate).subtract(days, "day").format("YYYY-MM-DD");
    const nextRange = `custom:${start}_${sessionDays.endDate}`;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const [data, nextAnalytics] = await Promise.all([
        fetchProjectSessionDays(project.project, nextRange, query),
        fetchProjectAnalytics(project.project, nextRange),
      ]);
      if (generation === requestGeneration.current) {
        loadedRange.current = { project: project.project, initialRange: range, range: nextRange };
        setSessionDays(data);
        setAnalytics(nextAnalytics);
        setAnalyticsError(null);
      }
    } catch (error) {
      if (generation === requestGeneration.current) setMoreError(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  }

  const sessionRange = sessionDays ? `custom:${sessionDays.startDate}_${sessionDays.endDate}` : range;
  const trendData = useMemo(() => analytics?.daily.map((day) => ({ ...day, shortDate: formatTrendDateLabel(day.date), nonCachedInputTokens: Math.max(day.inputTokens - day.cachedInputTokens, 0) })) ?? [], [analytics]);
  const summary = analytics?.summary;
  const summaryParts = summary ? projectTokenBreakdown(summary) : null;
  const cacheHitRate = summary && summary.inputTokens > 0 ? summary.cachedInputTokens / summary.inputTokens : 0;
  const maxDailyTokens = Math.max(...trendData.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...trendData.map((day) => day.costUSD), 0);
  const tokenAxisWidth = getYAxisWidth(maxDailyTokens, formatCompactNumber, 64);
  const costAxisWidth = getYAxisWidth(maxDailyCost, formatCurrencyShort, 72);

  return <div ref={dialogRef} className="fixed inset-0 z-50 flex flex-col overflow-hidden overscroll-contain bg-background text-foreground" role="dialog" aria-modal={isActive ? "true" : undefined} aria-labelledby="modal-project-title" aria-hidden={!isActive} inert={!isActive}>
    <header className="shrink-0 border-b border-border/70 bg-surface px-4 py-1.5 shadow-sm" data-testid="project-modal-header">
      <div className="flex min-h-8 items-center gap-2">
        <Folder className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id="modal-project-title" className="truncate text-base font-bold tracking-tight">{projectLabel(analytics ?? project)}</h2>
            {(analytics?.codexProjectName ?? project.codexProjectName) ? <span className="shrink-0 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-500">{t("projects.codex_project")}</span> : null}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={project.project}>{project.project}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void reloadProjectData(true)} disabled={refreshing || loadingMore || sessionsLoading || analyticsLoading} aria-busy={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />{t("project_modal.refresh")}</Button>
        <Button variant="secondary" size="sm" className="shrink-0 text-xs" onClick={() => onGoToSessions(project.project)}>{t("project_modal.view_in_sessions_tab")}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
        <Button ref={closeButtonRef} variant="secondary" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label={t("project_modal.close_aria")}><X className="h-4 w-4" /></Button>
      </div>
      {analytics && summary && summaryParts ? <>
        <p className="mt-1 text-[10px] text-muted-foreground">{t("project_modal.analytics_range", { start: analytics.startDate, end: analytics.endDate, timezone: analytics.timezone })}</p>
        <div className="flex flex-wrap gap-1.5 pt-1 pb-0.5" aria-label={t("project_modal.analytics_title")}>
          <MetricBadge label={t("project_modal.total_tokens")} value={formatNumber(summary.totalTokens)} icon={<Database className="h-3.5 w-3.5" />} tone="violet" />
          <MetricBadge label={t("project_modal.input_total")} value={formatNumber(summary.inputTokens)} icon={<Database className="h-3.5 w-3.5" />} tone="blue" />
          <MetricBadge label={t("projects.values.uncached")} value={formatNumber(summaryParts.nonCachedInput)} icon={<Database className="h-3.5 w-3.5" />} tone="blue" />
          <MetricBadge label={t("project_modal.cached")} value={formatNumber(summaryParts.cachedInput)} icon={<Database className="h-3.5 w-3.5" />} tone="cyan" />
          <MetricBadge label={t("project_modal.output")} value={formatNumber(summaryParts.output)} icon={<Database className="h-3.5 w-3.5" />} tone="green" />
          <MetricBadge label={t("project_modal.estimated_cost")} value={formatCurrency(summary.costUSD)} icon={<Coins className="h-3.5 w-3.5" />} tone="emerald" />
          <MetricBadge label={t("project_modal.cache_hit")} value={formatPercent(cacheHitRate)} icon={<Database className="h-3.5 w-3.5" />} tone="cyan" />
          <MetricBadge label={t("common.sessions")} value={sessionsLoading || sessionsError ? "—" : formatNumber(sessionDays?.totalSessions ?? 0)} icon={<Terminal className="h-3.5 w-3.5" />} tone="amber" />
        </div>
      </> : null}
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [overflow-anchor:none]" data-testid="project-modal-scroll">
      {refreshError ? <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">{t("project_modal.refresh_error")}: {refreshError}</p> : null}
      {analyticsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.analytics_loading")}</div>
        : analyticsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{t("project_modal.analytics_error")}: {analyticsError}</div>
          : analytics ? (
          <Card className="overflow-hidden" data-testid="project-daily-trend">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/80">
              <div><CardTitle>{t("project_modal.daily_trend")}</CardTitle><CardDescription>{t("project_modal.daily_trend_desc")}</CardDescription></div>
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground" aria-label={t("project_modal.daily_trend")}>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-600/75" />{t("project_modal.input")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-success/80" />{t("project_modal.cached")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-600/70" />{t("project_modal.output")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />{t("common.cost")}</span>
              </div>
            </CardHeader>
            <CardContent className="p-3.5">
              {trendData.every((day) => day.totalTokens === 0 && day.costUSD === 0) ? <p className="py-16 text-center text-sm text-muted-foreground">{t("project_modal.no_trend_data")}</p> : <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={trendData} barGap={4} barCategoryGap="32%" margin={{ top: 18, right: 10, left: 4, bottom: 6 }}>
                <defs><linearGradient id="projectCostGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.1} /><stop offset="80%" stopColor="rgb(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="rgb(var(--border) / 0.45)" strokeDasharray="3 8" vertical={false} />
                <XAxis dataKey="shortDate" dy={10} interval="preserveStartEnd" minTickGap={12} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted-foreground) / 0.72)", fontSize: 11 }} />
                <YAxis yAxisId="tokens" width={tokenAxisWidth} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted-foreground) / 0.7)", fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value))} />
                <YAxis yAxisId="cost" orientation="right" width={costAxisWidth} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--primary) / 0.78)", fontSize: 11 }} tickFormatter={(value) => formatCurrencyShort(Number(value))} />
                <Tooltip content={<TrendTooltip t={t} />} cursor={{ stroke: "rgb(var(--primary) / 0.22)", strokeDasharray: "4 4", strokeWidth: 1 }} />
                <Area yAxisId="cost" type="monotone" dataKey="costUSD" fill="url(#projectCostGradient)" stroke="none" activeDot={false} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="nonCachedInputTokens" stackId="tokens" fill="rgb(37 99 235 / 0.72)" maxBarSize={24} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="cachedInputTokens" stackId="tokens" fill="rgb(var(--success) / 0.78)" maxBarSize={24} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="outputTokens" stackId="tokens" fill="rgb(124 58 237 / 0.72)" maxBarSize={24} radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="cost" type="monotone" dataKey="costUSD" stroke="rgb(var(--primary))" strokeWidth={2.75} dot={{ r: 2.8, strokeWidth: 1.5, fill: "rgb(var(--surface))" }} activeDot={{ r: 5.5, strokeWidth: 2.25, fill: "rgb(var(--surface))" }} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>}
            </CardContent>
          </Card>
          ) : <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.no_analytics")}</div>}
      <section aria-labelledby="project-sessions-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="project-sessions-title" className="text-sm font-bold">{t("project_modal.sessions_list")}</h3>
            <p className="text-xs text-muted-foreground">{t("project_modal.subtitle_desc")}</p>
            {searchQuery ? <p className="text-xs text-muted-foreground">{t("project_modal.showing_filtered", { filtered: sessionDays?.matchingSessions ?? 0 })}</p> : null}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input aria-label={t("project_modal.search_aria")} value={searchQuery} onChange={(event) => { requestGeneration.current += 1; setSearchQuery(event.target.value); }} placeholder={t("project_modal.search_placeholder")} className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        {sessionsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("loading.loading_sessions")}</div>
          : sessionsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{sessionsError}</div>
            : !sessionDays?.days.length ? <div className="rounded-xl border border-dashed border-border p-8 text-center"><Terminal className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{searchQuery ? t("project_modal.no_matching_sessions") : t("project_modal.no_sessions")}</p></div>
              : <div key={JSON.stringify([project.project, range, query])} className="space-y-3">
                {sessionDays.days.map((day, index) => <ProjectSessionDayView key={day.date} day={day} project={project.project} range={sessionRange} query={query} initiallyExpanded={index === 0} revision={dayRevision} onSessionClick={onSessionClick} />)}
              </div>}
        {moreError ? <p role="alert" className="text-sm text-error">{moreError}</p> : null}
        {sessionDays ? <div className="flex justify-center py-3"><Button variant="secondary" onClick={() => void loadMoreDays()} disabled={loadingMore || analyticsLoading || refreshing}>{loadingMore ? t("common.loading") : t("project_modal.load_more_days")}</Button></div> : null}
      </section>
    </div>
  </div>;
}
