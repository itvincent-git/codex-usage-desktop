import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { fetchProjectDaySessions, type ProjectSessionDay, type RangeKey, type SessionDetailRow } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { SessionUsageTable } from "./session-usage-table";

type ProjectSessionDayProps = {
  day: ProjectSessionDay;
  project: string;
  range: RangeKey;
  query: string;
  initiallyExpanded: boolean;
  revision?: number;
  onSessionClick?: (session: SessionDetailRow) => void;
};

export function ProjectSessionDayView({ day, project, range, query, initiallyExpanded, revision = 0, onSessionClick }: ProjectSessionDayProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [sessions, setSessions] = useState<SessionDetailRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ key: string; promise: Promise<SessionDetailRow[]> } | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = JSON.stringify([project, day.date, query, revision]);

  useEffect(() => {
    if (!expanded || loadedKey === key) return;
    let active = true;
    setError(null);
    if (request.current?.key !== key) request.current = { key, promise: fetchProjectDaySessions(project, range, day.date, query) };
    void request.current.promise.then((data) => {
      if (active) { setSessions(data); setLoadedKey(key); }
    }).catch((error) => {
      if (active) setError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [expanded, loadedKey, key, project, range, day.date, query, retry]);

  return <div id={`date-group-${day.date}`} className="overflow-hidden rounded-xl border border-border/50 bg-card/20 shadow-sm scroll-mt-6">
    <button type="button" aria-expanded={expanded} aria-controls={`project-day-${day.date}`} onClick={() => setExpanded((value) => !value)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/30">
      <span className="flex items-center gap-3">
        <ChevronDown className={`h-5 w-5 text-muted-foreground ${expanded ? "" : "-rotate-90"}`} />
        <Calendar className="h-4 w-4 text-indigo-400" />
        <span className="font-bold">{dayjs(day.date).format("YYYY-MM-DD (dddd)")}</span>
        <span className="rounded bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground">{t("sessions.count_sessions", { count: day.sessionCount })}</span>
      </span>
      <span className="flex gap-4 text-sm tabular-nums">
        <span>{formatNumber(day.totalTokens)} <span className="text-xs text-muted-foreground">{t("project_modal.total_tokens")}</span></span>
        <span>{formatCurrency(day.costUSD)}</span>
      </span>
    </button>
    <div id={`project-day-${day.date}`} hidden={!expanded}>
      {error ? <div role="alert" className="p-4 text-sm text-error">{error}<Button variant="secondary" size="sm" className="ml-3" onClick={() => {
        request.current = null;
        setError(null);
        setRetry((value) => value + 1);
      }}>{t("project_modal.retry")}</Button></div> : null}
      {sessions ? <SessionUsageTable sessions={sessions} selectedProject={project} onSessionClick={onSessionClick} embedded projectDay agentGroupPageSize={30} />
        : expanded && !error ? <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading.loading_sessions")}</p> : null}
    </div>
  </div>;
}
