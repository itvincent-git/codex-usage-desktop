import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Cpu, FileText, Folder, Search, Terminal, X } from "lucide-react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import {
  fetchProjectAnalytics,
  fetchSessionDetails,
  type OverviewResponse,
  type ProjectAnalyticsResponse,
  type RangeKey,
  type SessionDetailRow,
} from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { MODEL_PAGE_COLORS, OTHER_MODEL_COLOR } from "@/lib/model-analytics";
import { projectTokenBreakdown } from "@/lib/project-analytics";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type ProjectSessionsModalProps = {
  project: Pick<OverviewResponse["projects"][number], "project" | "displayName" | "totalTokens" | "costUSD">;
  range: RangeKey;
  onClose: () => void;
  onGoToSessions: (projectPath: string) => void;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(1).replace(/\.0$/, "")} ${units[index]}`;
}

function cleanSessionId(sessionId: string) {
  return sessionId.replace(/\.jsonl$/, "");
}

function TrendTooltip({ active, payload, label, t }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ProjectAnalyticsResponse["daily"][number] & { nonCachedInputTokens: number };
  const cacheHit = row.inputTokens > 0 ? row.cachedInputTokens / row.inputTokens : 0;
  return <div className="min-w-56 rounded-lg border border-border bg-surface/95 p-3 text-xs shadow-xl">
    <p className="mb-2 font-bold text-foreground">{label}</p>
    <div className="space-y-1 text-muted-foreground">
      <p className="flex justify-between gap-5"><span>{t("project_modal.total_tokens")}</span><b className="text-foreground">{formatNumber(row.totalTokens)}</b></p>
      <p className="flex justify-between gap-5"><span>{t("project_modal.input_total")}</span><span>{formatNumber(row.inputTokens)}</span></p>
      <p className="flex justify-between gap-5"><span>{t("project_modal.cached")}</span><span>{formatNumber(row.cachedInputTokens)}</span></p>
      <p className="flex justify-between gap-5"><span>{t("project_modal.output")}</span><span>{formatNumber(row.outputTokens)}</span></p>
      <p className="flex justify-between gap-5"><span>{t("project_modal.cache_hit")}</span><span>{formatPercent(cacheHit)}</span></p>
      <p className="flex justify-between gap-5"><span>{t("common.cost")}</span><span>{formatCurrency(row.costUSD)}</span></p>
    </div>
  </div>;
}

export function ProjectSessionsModal({ project, range, onClose, onGoToSessions }: ProjectSessionsModalProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionDetailRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
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
    let active = true;
    setSessionsLoading(true);
    setSessionsError(null);
    void fetchSessionDetails().then((data) => {
      if (active) setSessions(data.filter((session) => session.projects?.includes(project.project)));
    }).catch((error) => {
      if (active) setSessionsError(error instanceof Error ? error.message : t("project_modal.no_sessions"));
    }).finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; };
  }, [project.project, t]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.threadName?.toLowerCase().includes(query)
      || cleanSessionId(session.sessionId).toLowerCase().includes(query)
      || session.models?.some((model) => model.toLowerCase().includes(query)));
  }, [searchQuery, sessions]);

  const modelData = useMemo(() => {
    if (!analytics) return [];
    const visible = analytics.models.slice(0, 6).map((model, index) => ({ ...model, color: MODEL_PAGE_COLORS[index % MODEL_PAGE_COLORS.length] }));
    const other = analytics.models.slice(6).reduce((sum, model) => sum + model.totalTokens, 0);
    return other > 0 ? [...visible, { model: t("models.other"), totalTokens: other, color: OTHER_MODEL_COLOR }] : visible;
  }, [analytics, t]);
  const trendData = useMemo(() => analytics?.daily.map((day) => ({ ...day, ...projectTokenBreakdown(day), nonCachedInputTokens: Math.max(day.inputTokens - day.cachedInputTokens, 0) })) ?? [], [analytics]);
  const summary = analytics?.summary;
  const cacheHitRate = summary && summary.inputTokens > 0 ? summary.cachedInputTokens / summary.inputTokens : 0;

  return <div onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="modal-project-title">
    <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface/95 shadow-2xl">
      <div className="flex items-start justify-between border-b border-border/60 bg-muted/20 px-6 py-5">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/10 bg-indigo-500/10 text-indigo-500"><Folder className="h-5 w-5" /></span><div className="min-w-0"><h3 id="modal-project-title" className="truncate text-lg font-bold text-foreground">{project.displayName}</h3><p className="truncate font-mono text-xs text-muted-foreground" title={project.project}>{project.project}</p>{analytics ? <p className="mt-1 text-[10px] text-muted-foreground">{analytics.startDate} – {analytics.endDate} · {analytics.timezone}</p> : null}</div></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" aria-label={t("range_switcher.modal_close_aria")}><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <section aria-labelledby="project-analytics-title" className="space-y-4">
          <h4 id="project-analytics-title" className="text-sm font-bold text-foreground">{t("project_modal.analytics_title")}</h4>
          {analyticsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.analytics_loading")}</div>
            : analyticsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{t("project_modal.analytics_error")}: {analyticsError}</div>
              : analytics && summary ? <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[[t("project_modal.total_tokens"), formatNumber(summary.totalTokens)], [t("project_modal.cache_hit"), formatPercent(cacheHitRate)], [t("project_modal.estimated_cost"), formatCurrency(summary.costUSD)], [t("common.sessions"), sessionsLoading ? "—" : formatNumber(sessions.length)]].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-surface p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p></div>)}
                </div>
                <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                  <div className="rounded-xl border border-border p-4"><h5 className="text-sm font-bold">{t("project_modal.model_share")}</h5><p className="text-xs text-muted-foreground">{t("project_modal.model_share_desc")}</p>{modelData.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">{t("project_modal.no_model_data")}</p> : <div className="mt-3 flex min-h-56 items-center gap-3"><div className="h-52 min-w-0 flex-1"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={modelData} dataKey="totalTokens" nameKey="model" innerRadius={55} outerRadius={82} paddingAngle={2}>{modelData.map((entry) => <Cell key={entry.model} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => formatNumber(Number(value))} /></PieChart></ResponsiveContainer></div><div className="w-1/2 space-y-2 text-xs">{modelData.map((entry) => <div key={entry.model} className="flex items-center justify-between gap-2" data-model-legend={entry.model} data-model-color={entry.color}><span className="min-w-0 truncate"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />{entry.model}</span><span className="shrink-0 text-right tabular-nums text-muted-foreground">{formatCompactNumber(entry.totalTokens)} · {formatPercent(entry.totalTokens / Math.max(summary.totalTokens, 1))}</span></div>)}</div></div>}</div>
                  <div className="rounded-xl border border-border p-4"><h5 className="text-sm font-bold">{t("project_modal.daily_trend")}</h5><p className="text-xs text-muted-foreground">{t("project_modal.daily_trend_desc")}</p>{trendData.every((day) => day.totalTokens === 0 && day.costUSD === 0) ? <p className="py-16 text-center text-sm text-muted-foreground">{t("project_modal.no_trend_data")}</p> : <div className="mt-3 h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={trendData} margin={{ top: 10, right: 5, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} /><YAxis yAxisId="tokens" tickFormatter={(value) => formatCompactNumber(Number(value))} width={45} /><YAxis yAxisId="cost" orientation="right" tickFormatter={(value) => `$${Number(value).toFixed(3)}`} width={52} /><Tooltip content={<TrendTooltip t={t} />} /><Bar yAxisId="tokens" dataKey="nonCachedInputTokens" stackId="tokens" fill="#0ea5e9" /><Bar yAxisId="tokens" dataKey="cachedInputTokens" stackId="tokens" fill="#10b981" /><Bar yAxisId="tokens" dataKey="outputTokens" stackId="tokens" fill="#8b5cf6" /><Line yAxisId="cost" dataKey="costUSD" stroke="#ef4444" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div>}</div>
                </div>
              </> : <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.no_analytics")}</div>}
        </section>

        <section aria-labelledby="project-sessions-title" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h4 id="project-sessions-title" className="text-sm font-bold text-foreground">{t("project_modal.sessions_list")}</h4><p className="text-xs text-muted-foreground">{searchQuery ? t("project_modal.showing_filtered", { filtered: filteredSessions.length }) : t("project_modal.subtitle_desc")}</p></div><div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input aria-label={t("project_modal.search_aria")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("project_modal.search_placeholder")} className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/30" /></div></div>
          {sessionsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("loading.loading_sessions")}</div>
            : sessionsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{sessionsError}</div>
              : filteredSessions.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center"><Terminal className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{searchQuery ? t("project_modal.no_matching_sessions") : t("project_modal.no_sessions")}</p></div>
                : <div className="max-h-[36vh] overflow-auto rounded-xl border border-border"><table className="min-w-[850px] w-full text-sm"><thead className="sticky top-0 bg-surface"><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="border-b border-border px-4 py-3">{t("project_modal.session_id_file")}</th><th className="border-b border-border px-4 py-3">{t("common.model")}</th><th className="border-b border-border px-4 py-3 text-right">{t("project_modal.total_tokens")}</th><th className="border-b border-border px-4 py-3 text-right">{t("project_modal.input")}</th><th className="border-b border-border px-4 py-3 text-right">{t("project_modal.cached")}</th><th className="border-b border-border px-4 py-3 text-right">{t("project_modal.output")}</th><th className="border-b border-border px-4 py-3 text-right">{t("common.cost")}</th></tr></thead><tbody>{filteredSessions.map((session) => <tr key={session.path} className="border-b border-border/60"><td className="px-4 py-3"><div className="flex items-center gap-1.5 font-semibold"><FileText className="h-3.5 w-3.5" />{session.threadName || cleanSessionId(session.sessionId)}</div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{session.threadName ? `${cleanSessionId(session.sessionId)} · ` : ""}{dayjs(session.modifiedAtMs).format("YYYY-MM-DD HH:mm:ss")} · {formatBytes(session.sizeBytes)}</p></td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{session.models?.length ? session.models.map((model) => <span key={model} className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] text-indigo-500"><Cpu className="mr-1 inline h-2.5 w-2.5" />{model}</span>) : <span className="text-xs text-muted-foreground">{t("project_modal.no_models")}</span>}</div></td>{[session.totalTokens, session.inputTokens, session.cachedInputTokens, session.outputTokens].map((value, index) => <td key={index} className="px-4 py-3 text-right tabular-nums">{formatNumber(value)}</td>)}<td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCurrency(session.costUSD)}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-6 py-4"><Button variant="secondary" size="sm" onClick={onClose}>{t("common.close")}</Button><Button variant="primary" size="sm" onClick={() => onGoToSessions(project.project)}>{t("project_modal.view_in_sessions_tab")}<ArrowRight className="ml-1.5 h-4 w-4" /></Button></div>
    </div>
  </div>;
}
