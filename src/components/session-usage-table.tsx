import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionDetailRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Bot, Terminal, FileText, Folder, ChevronDown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { modelTone } from "@/lib/model-tone";
import { SessionQuotaUsageView } from "./session-quota-usage";

type SessionDisplayRow = SessionDetailRow & {
  usageDate: string;
  originalSession: SessionDetailRow;
};

type SessionFamily = {
  parent: SessionDisplayRow;
  children: SessionDisplayRow[];
};

type SessionUsageTableProps = {
  sessions: SessionDetailRow[];
  initialExpandedDate?: string | null;
  selectedProject?: string | null;
  onClearProjectFilter?: () => void;
  onSessionClick?: (session: SessionDetailRow) => void;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function cleanSessionId(sessionId: string) {
  return sessionId.replace(/\.jsonl$/, "");
}

function humanizeAgentValue(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function agentSessionTitle(session: SessionDisplayRow) {
  const pathName = session.agentPath?.split("/").filter(Boolean).at(-1);
  return pathName ? humanizeAgentValue(pathName) : session.threadName || cleanSessionId(session.sessionId);
}

function groupSessionFamilies(
  rows: SessionDisplayRow[],
  sessionsByThreadId: Map<string, SessionDetailRow>,
): SessionFamily[] {
  const rowsByThreadId = new Map(
    rows.flatMap((session) => session.threadId ? [[session.threadId, session] as const] : []),
  );
  const childrenByParentPath = new Map<string, SessionDisplayRow[]>();
  const childPaths = new Set<string>();

  for (const session of rows) {
    let parentThreadId = session.parentThreadId;
    let visibleParent: SessionDisplayRow | undefined;
    const visited = new Set<string>();

    while (parentThreadId && !visited.has(parentThreadId)) {
      visited.add(parentThreadId);
      visibleParent = rowsByThreadId.get(parentThreadId) ?? visibleParent;
      parentThreadId = sessionsByThreadId.get(parentThreadId)?.parentThreadId;
    }

    if (!visibleParent || visibleParent.path === session.path) continue;
    const children = childrenByParentPath.get(visibleParent.path) ?? [];
    children.push(session);
    childrenByParentPath.set(visibleParent.path, children);
    childPaths.add(session.path);
  }

  return rows
    .filter((session) => !childPaths.has(session.path))
    .map((parent) => ({ parent, children: childrenByParentPath.get(parent.path) ?? [] }));
}

function formatDateHeader(dateStr: string) {
  try {
    return dayjs(dateStr).format("YYYY-MM-DD (dddd)");
  } catch (e) {
    return dateStr;
  }
}

function costTone(cost: number, maxCost: number, isInactive: boolean) {
  if (isInactive || cost <= 0 || maxCost <= 0) {
    return {
      name: "zero",
      className: "border-border/60 bg-muted/60 text-muted-foreground",
      fillClassName: "bg-muted-foreground/15",
    };
  }

  const relativeCost = cost / maxCost;
  if (relativeCost <= 1 / 3) {
    return {
      name: "low",
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      fillClassName: "bg-emerald-500/20",
    };
  }
  if (relativeCost <= 2 / 3) {
    return {
      name: "medium",
      className: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      fillClassName: "bg-amber-500/20",
    };
  }
  return {
    name: "high",
    className: "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    fillClassName: "bg-rose-500/20",
  };
}

export function SessionUsageTable({
  sessions,
  initialExpandedDate,
  selectedProject = null,
  onClearProjectFilter,
  onSessionClick,
}: SessionUsageTableProps) {
  const { t } = useTranslation();
  // Track which date groups are collapsed
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [expandedAgentGroups, setExpandedAgentGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (initialExpandedDate) {
      setCollapsedDates((prev) => ({
        ...prev,
        [initialExpandedDate]: false,
      }));
      // Smoothly scroll to the element after a small timeout to let the view render
      const timer = setTimeout(() => {
        const element = document.getElementById(`date-group-${initialExpandedDate}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [initialExpandedDate]);

  const displaySessions = useMemo<SessionDisplayRow[]>(() => sessions.flatMap((session) => {
    if (session.totalTokens === 0 || session.dailyUsage.length === 0) {
      return [{
        ...session,
        usageDate: dayjs(session.modifiedAtMs).format("YYYY-MM-DD"),
        originalSession: session,
      }];
    }

    return session.dailyUsage.map((usage) => ({
      ...session,
      ...usage,
      usageDate: usage.date,
      originalSession: session,
    }));
  }), [sessions]);

  const sessionsByThreadId = useMemo(
    () => new Map(sessions.flatMap((session) => session.threadId ? [[session.threadId, session] as const] : [])),
    [sessions],
  );

  // Group and sort session-day rows using the scanner's application-timezone dates.
  const groups = useMemo(() => {
    const map: Record<string, SessionDisplayRow[]> = {};
    for (const session of displaySessions) {
      if (selectedProject && !session.projects.includes(selectedProject)) {
        continue;
      }
      const dateStr = session.usageDate;
      if (!map[dateStr]) {
        map[dateStr] = [];
      }
      map[dateStr].push(session);
    }

    return Object.entries(map)
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, items]) => {
        const sortedItems = items.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
        const totalTokens = sortedItems.reduce((sum, item) => sum + item.totalTokens, 0);
        const inputTokens = sortedItems.reduce((sum, item) => sum + item.inputTokens, 0);
        const cachedInputTokens = sortedItems.reduce((sum, item) => sum + item.cachedInputTokens, 0);
        const outputTokens = sortedItems.reduce((sum, item) => sum + item.outputTokens, 0);
        const costUSD = sortedItems.reduce((sum, item) => sum + item.costUSD, 0);
        
        // Find all unique models and projects used on this date
        const models = Array.from(new Set(sortedItems.flatMap(item => item.models || [])));
        const projects = Array.from(new Set(sortedItems.flatMap(item => item.projects || [])));

        return {
          date,
          sessions: sortedItems,
          sessionFamilies: groupSessionFamilies(sortedItems, sessionsByThreadId),
          totalTokens,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          costUSD,
          models,
          projects,
        };
      });
  }, [displaySessions, selectedProject, sessionsByThreadId]);

  const filteredCount = useMemo(() => {
    if (!selectedProject) return displaySessions.length;
    return displaySessions.filter((session) => session.projects.includes(selectedProject)).length;
  }, [displaySessions, selectedProject]);

  const maxGroupTokens = useMemo(() => Math.max(...groups.map(g => g.totalTokens), 1), [groups]);
  const maxGroupCost = useMemo(() => Math.max(...groups.map(g => g.costUSD), 0), [groups]);
  const sessionScale = useMemo(
    () => groups.reduce(
      (maxima, group) => group.sessions.reduce(
        (groupMaxima, session) => ({
          tokens: Math.max(groupMaxima.tokens, session.totalTokens),
          cost: Math.max(groupMaxima.cost, session.costUSD),
        }),
        maxima,
      ),
      { tokens: 0, cost: 0 },
    ),
    [groups],
  );

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => ({
      ...prev,
      [date]: !isCollapsed(date),
    }));
  };

  const isCollapsed = (date: string) => {
    if (collapsedDates[date] !== undefined) {
      return collapsedDates[date];
    }
    // If filtering by project, expand all groups by default
    if (selectedProject) {
      return false;
    }
    const firstDate = groups[0]?.date;
    return date !== firstDate;
  };

  if (sessions.length === 0) {
    return (
      <Card className="border-border/60 bg-card/30 backdrop-blur-md">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4 rounded-full bg-muted/60 p-4 text-muted-foreground">
            <Terminal className="h-8 w-8 animate-pulse text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{t("sessions.no_data")}</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {t("sessions.no_sessions_desc", { defaultValue: "Codex CLI session logs could not be found or contain no usage events. Click \"Rescan local logs\" to check again." })}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-1">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            {t("sessions.title")}
            <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/20">
              {selectedProject ? t("sessions.showing_info_filtered", { filtered: filteredCount, total: displaySessions.length }) : t("sessions.showing_info", { count: displaySessions.length })}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("sessions.subtitle")}
          </p>
        </div>
      </div>

      {selectedProject && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 backdrop-blur-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">
              <Folder className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-400">{t("sessions.filtering_by_project", { defaultValue: "Filtering by Project" })}</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                <span className="font-bold text-foreground text-sm">{selectedProject.split("/").pop() || selectedProject}</span>
                <span className="text-[11px] font-mono text-muted-foreground truncate max-w-xs md:max-w-md">({selectedProject})</span>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClearProjectFilter}
            className="h-8 font-medium text-xs border-indigo-500/20 hover:bg-indigo-500/10 hover:text-indigo-400 transition"
          >
            {t("sessions.btn_clear_filters")}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {groups.length === 0 && selectedProject ? (
          <Card className="border-border/60 bg-card/30 backdrop-blur-md">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-muted/60 p-4 text-muted-foreground">
                <Folder className="h-8 w-8 text-indigo-400" />
              </div>
              <h3 className="text-base font-semibold text-foreground">{t("project_modal.no_sessions")}</h3>
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                {t("projects.no_projects")}
              </p>
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => {
          const collapsed = isCollapsed(group.date);
          const formattedDate = formatDateHeader(group.date);
          
          const groupTokenBarWidth = `${Math.max((group.totalTokens / maxGroupTokens) * 100, 6)}%`;
          const groupCostHeat = maxGroupCost > 0 ? group.costUSD / maxGroupCost : 0;
          const groupCostHeatAlpha = 0.08 + groupCostHeat * 0.22;

          return (
            <div
              key={group.date}
              id={`date-group-${group.date}`}
              className="overflow-hidden rounded-xl border border-border/50 bg-card/20 backdrop-blur-sm shadow-sm transition-all duration-300 hover:border-border/80 scroll-mt-6"
            >
              {/* Collapsible Accordion Header */}
              <button
                type="button"
                onClick={() => toggleDate(group.date)}
                className="flex w-full flex-col gap-3 px-5 py-4 text-left sm:flex-row sm:items-center sm:justify-between hover:bg-white/[0.02] dark:hover:bg-white/[0.01] transition-all duration-200"
                aria-expanded={!collapsed}
              >
                {/* Left Section: Date, Weekday, count of sessions */}
                <div className="flex items-center gap-3">
                  <div
                    className={`transform transition-transform duration-300 ${
                      collapsed ? "-rotate-90" : "rotate-0"
                    } text-muted-foreground`}
                  >
                    <ChevronDown className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-indigo-400" />
                      <span className="font-bold text-foreground text-base tracking-tight">{formattedDate}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex rounded bg-muted/80 px-2 py-0.5 font-semibold text-muted-foreground border border-border/20">
                        {t("sessions.count_sessions", { count: group.sessions.length, defaultValue: group.sessions.length === 1 ? "1 session" : `${group.sessions.length} sessions` })}
                      </span>
                      {group.models.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {group.models.map((model) => (
                            <span
                              key={model}
                              className="inline-flex rounded-full bg-indigo-500/10 px-2 py-0.2 text-[9px] font-bold text-indigo-400"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Section: Day summary totals */}
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  {/* Day total tokens indicator */}
                  {group.totalTokens > 0 ? (
                    <div className="space-y-1.5 min-w-[120px] text-right">
                      <div className="text-xs text-muted-foreground">{t("sessions.day_total_tokens", { defaultValue: "Day Total Tokens" })}</div>
                      <div className="font-bold text-foreground tabular-nums text-sm">
                        {formatNumber(group.totalTokens)}
                      </div>
                      <div className="ml-auto h-1 w-20 overflow-hidden rounded-full bg-muted/60">
                        <div
                          aria-hidden="true"
                          className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80"
                          style={{ width: groupTokenBarWidth }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">{t("daily.no_activity")}</div>
                  )}

                  {/* Day total cost */}
                  {group.totalTokens > 0 && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground mb-1">{t("sessions.day_cost", { defaultValue: "Day Cost" })}</div>
                      <span
                        className="inline-flex rounded-full px-3 py-0.5 font-bold text-foreground text-xs border border-white/5 shadow-sm"
                        style={{
                          backgroundColor: `rgb(var(--secondary) / ${groupCostHeatAlpha})`,
                        }}
                      >
                        {formatCurrency(group.costUSD)}
                      </span>
                    </div>
                  )}
                </div>
              </button>

              {/* Accordion Content: compact session cards for this date */}
              {!collapsed && (
                <div className="space-y-2 border-t border-border/40 bg-black/[0.04] px-3 py-3 dark:bg-black/[0.08] sm:px-4">
                  {group.sessionFamilies.flatMap(({ parent, children }) => {
                    const groupKey = `${group.date}:${parent.path}`;
                    const expanded = expandedAgentGroups[groupKey] ?? false;
                    return [
                      {
                        session: parent,
                        isSubagent: Boolean(parent.parentThreadId),
                        childCount: children.length,
                        groupKey,
                        expanded,
                      },
                      ...(expanded ? children.map((session) => ({
                        session,
                        isSubagent: true,
                        childCount: 0,
                        groupKey,
                        expanded: false,
                      })) : []),
                    ];
                  }).map(({ session, isSubagent, childCount, groupKey, expanded }) => {
                    const isInactive = session.totalTokens === 0;
                    const nonCachedInputTokens = Math.max(session.inputTokens - session.cachedInputTokens, 0);
                    const cacheHitRate = session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0;
                    const fullTime = new Date(session.modifiedAtMs).toLocaleString();
                    const formattedTime = new Date(session.modifiedAtMs).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const title = isSubagent
                      ? agentSessionTitle(session)
                      : session.threadName || cleanSessionId(session.sessionId);
                    const subagentSummary = isSubagent && session.threadName !== title
                      ? session.threadName
                      : null;
                    const agentRole = session.agentRole ? humanizeAgentValue(session.agentRole) : null;
                    const shownProjects = session.projects.slice(0, 2);
                    const shownModels = session.models.slice(0, 3);
                    const projectOverflow = session.projects.length - shownProjects.length;
                    const modelOverflow = session.models.length - shownModels.length;
                    const tokenRatio = sessionScale.tokens > 0 ? session.totalTokens / sessionScale.tokens : 0;
                    const costRatio = sessionScale.cost > 0 ? session.costUSD / sessionScale.cost : 0;
                    const cost = costTone(session.costUSD, sessionScale.cost, isInactive);
                    const tokenLabel = isInactive
                      ? t("sessions.token_bar_empty")
                      : t("sessions.token_bar_label", {
                          input: formatNumber(nonCachedInputTokens),
                          cached: formatNumber(session.cachedInputTokens),
                          output: formatNumber(session.outputTokens),
                          total: formatNumber(session.totalTokens),
                        });
                    const tokenTotalLabel = t("sessions.token_total_label", {
                      total: formatNumber(session.totalTokens),
                      percent: formatPercent(tokenRatio),
                    });
                    const costLabel = t("sessions.cost_pill_label", {
                      cost: formatCurrency(session.costUSD),
                      percent: formatPercent(costRatio),
                    });

                    return (
                      <div
                        key={session.path}
                        className={isSubagent ? "relative ml-5 border-l border-primary/25 pl-4 sm:ml-7" : "space-y-1.5"}
                        data-testid={isSubagent ? "subagent-session-row" : undefined}
                      >
                      <article
                        tabIndex={onSessionClick ? 0 : undefined}
                        role={onSessionClick ? "button" : undefined}
                        aria-label={onSessionClick ? t("sessions.open_session", { title }) : undefined}
                        data-testid="session-card"
                        onClick={() => onSessionClick?.(session.originalSession)}
                        onKeyDown={(event) => {
                          if (!onSessionClick) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSessionClick(session.originalSession);
                          }
                        }}
                        className={`session-usage-card rounded-lg border px-3 py-2.5 shadow-sm transition-colors duration-150 hover:border-primary/35 hover:bg-card ${isSubagent ? "border-primary/20 bg-primary/[0.035]" : "border-border/50 bg-card/70"} ${onSessionClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70" : ""}`}
                      >
                        <div className="session-card-time border-r border-border/40 pr-3" title={fullTime}>
                          <div className="text-base font-bold tabular-nums tracking-tight text-foreground">{formattedTime}</div>
                          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {t("sessions.recorded_time")}
                          </div>
                        </div>

                        <div className="session-card-summary min-w-0 space-y-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            {isSubagent
                              ? <Bot className="h-3.5 w-3.5 flex-none text-primary" />
                              : <FileText className="h-3.5 w-3.5 flex-none text-muted-foreground" />}
                            <h3 className="truncate text-sm font-semibold leading-tight text-foreground" title={title}>{title}</h3>
                            {isSubagent ? (
                              <span className="flex-none rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-primary">
                                {t("sessions.subagent")}
                              </span>
                            ) : null}
                          </div>
                          {subagentSummary ? (
                            <p className="truncate text-[10px] leading-tight text-muted-foreground" title={subagentSummary}>
                              {subagentSummary}
                            </p>
                          ) : null}
                          {isSubagent && (session.agentNickname || agentRole) ? (
                            <div className="flex min-w-0 items-center gap-1 text-[9px] text-muted-foreground">
                              {session.agentNickname ? <span className="truncate font-semibold text-foreground/80">{session.agentNickname}</span> : null}
                              {session.agentNickname && agentRole ? <span aria-hidden="true">·</span> : null}
                              {agentRole ? <span className="truncate">{agentRole}</span> : null}
                            </div>
                          ) : null}
                          <div className="flex min-w-0 flex-wrap items-center gap-1" title={session.projects.join("\n")}>
                            {shownProjects.length > 0 ? shownProjects.map((project) => (
                              <span key={project} className="inline-flex max-w-[120px] items-center gap-0.5 rounded border border-border/40 bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground" title={project}>
                                <Folder className="h-2.5 w-2.5 flex-none opacity-60" />
                                <span className="truncate">{project.split("/").pop() || project}</span>
                              </span>
                            )) : (
                              <span className="text-[9px] italic text-muted-foreground/70">{t("sessions.no_workspace")}</span>
                            )}
                            {projectOverflow > 0 ? <span className="text-[9px] font-semibold text-muted-foreground" title={session.projects.join("\n")}>+{projectOverflow}</span> : null}
                          </div>
                          <div className="flex min-w-0 items-center gap-1 text-[9px] text-muted-foreground/70" title={session.path}>
                            {session.threadName ? <span className="max-w-[160px] truncate font-mono">{cleanSessionId(session.sessionId)}</span> : null}
                            {session.threadName ? <span aria-hidden="true">·</span> : null}
                            <span className="whitespace-nowrap" title={session.path}>{formatBytes(session.sizeBytes)}</span>
                          </div>
                        </div>

                        <div className="session-card-tokens min-w-0 space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t("sessions.total_tokens")}</span>
                            <span
                              className="relative isolate inline-flex w-24 flex-none overflow-hidden rounded-full border border-primary/15 bg-primary/5 px-2.5 py-0.5 text-right text-sm font-bold tabular-nums text-foreground"
                              role="img"
                              aria-label={tokenTotalLabel}
                              data-testid="token-total-pill"
                            >
                              {session.totalTokens > 0 && sessionScale.tokens > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 -z-10 bg-primary/15"
                                  style={{ width: `${tokenRatio * 100}%`, minWidth: 2 }}
                                />
                              ) : null}
                              <span className="relative ml-auto">{formatNumber(session.totalTokens)}</span>
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[9px] tabular-nums text-muted-foreground">
                            <span>{t("sessions.input_including_cache")} <strong className="font-semibold text-foreground">{formatNumber(session.inputTokens)}</strong></span>
                            <span>
                              {t("sessions.cached")} <strong className="font-semibold text-foreground">{formatNumber(session.cachedInputTokens)}</strong>{" "}
                              <span className="whitespace-nowrap text-muted-foreground">({formatPercent(cacheHitRate)})</span>
                            </span>
                            <span>{t("sessions.output")} <strong className="font-semibold text-foreground">{formatNumber(session.outputTokens)}</strong></span>
                          </div>
                          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={tokenLabel} data-testid="token-bar">
                            {isInactive ? null : (
                              <>
                                <span data-token-segment="input" className="h-full flex-none bg-sky-500" style={{ width: `${(nonCachedInputTokens / session.totalTokens) * 100}%`, minWidth: nonCachedInputTokens > 0 ? 2 : undefined }} />
                                <span data-token-segment="cached" className="h-full flex-none bg-emerald-500" style={{ width: `${(session.cachedInputTokens / session.totalTokens) * 100}%`, minWidth: session.cachedInputTokens > 0 ? 2 : undefined }} />
                                <span data-token-segment="output" className="h-full flex-none bg-violet-500" style={{ width: `${(session.outputTokens / session.totalTokens) * 100}%`, minWidth: session.outputTokens > 0 ? 2 : undefined }} />
                              </>
                            )}
                          </div>
                          <SessionQuotaUsageView usage={session.quotaUsage} />
                          {isInactive ? <div className="text-[9px] italic text-muted-foreground">{t("daily.no_activity")}</div> : null}
                        </div>

                        <div className="session-card-cost flex min-w-0 flex-col items-end justify-center gap-2">
                          <span
                            data-cost-tone={cost.name}
                            className={`relative isolate inline-flex w-full max-w-full overflow-hidden rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${cost.className}`}
                            role="img"
                            aria-label={costLabel}
                            data-testid="cost-pill"
                          >
                            {!isInactive && session.costUSD > 0 && sessionScale.cost > 0 ? (
                              <span
                                aria-hidden="true"
                                className={`absolute inset-y-0 left-0 -z-10 ${cost.fillClassName}`}
                                style={{ width: `${costRatio * 100}%`, minWidth: 2 }}
                              />
                            ) : null}
                            <span className="relative ml-auto">{formatCurrency(session.costUSD)}</span>
                          </span>
                          <div className="flex w-full min-w-0 flex-wrap justify-end gap-0.5" title={session.models.join(", ")}>
                            {shownModels.length > 0 ? shownModels.map((model) => {
                              const tone = modelTone(model);
                              return (
                                <span key={model} data-model={model} data-model-tone={tone.index} className={`inline-flex whitespace-nowrap rounded-full border px-1 py-0.5 text-[8px] font-semibold ${tone.className}`} title={model}>
                                  {model}
                                </span>
                              );
                            }) : <span className="text-[9px] italic text-muted-foreground/70">{t("project_modal.no_models")}</span>}
                            {modelOverflow > 0 ? <span className="text-[9px] font-semibold text-muted-foreground" title={session.models.join(", ")}>+{modelOverflow}</span> : null}
                          </div>
                        </div>
                      </article>
                      {childCount > 0 ? (
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center gap-2 rounded-md border border-transparent px-3 text-left text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70"
                          aria-expanded={expanded}
                          aria-label={t(expanded ? "sessions.collapse_subagents" : "sessions.expand_subagents", { count: childCount, title })}
                          onClick={() => setExpandedAgentGroups((current) => ({
                            ...current,
                            [groupKey]: !expanded,
                          }))}
                        >
                          <ChevronDown className={`h-4 w-4 flex-none transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-0" : "-rotate-90"}`} />
                          <Bot className="h-4 w-4 flex-none text-primary" />
                          <span>{t("sessions.subagent_sessions", { count: childCount })}</span>
                        </button>
                      ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}
