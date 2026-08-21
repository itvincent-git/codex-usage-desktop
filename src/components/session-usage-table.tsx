import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionDetailRow } from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatNumber } from "@/lib/formatters";
import { Terminal, Folder, ChevronDown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { SessionQuotaUsageView } from "./session-quota-usage";

type SessionDisplayRow = SessionDetailRow & {
  usageDate: string;
  originalSession: SessionDetailRow;
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

function formatSessionTokenCount(value: number) {
  if (Math.abs(value) < 1_000) return formatNumber(value);
  if (Math.abs(value) < 1_000_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return formatCompactNumber(value);
}

function cleanSessionId(sessionId: string) {
  return sessionId.replace(/\.jsonl$/, "");
}

function formatDateHeader(dateStr: string) {
  try {
    return dayjs(dateStr).format("YYYY-MM-DD (dddd)");
  } catch (e) {
    return dateStr;
  }
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
          totalTokens,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          costUSD,
          models,
          projects,
        };
      });
  }, [displaySessions, selectedProject]);

  const filteredCount = useMemo(() => {
    if (!selectedProject) return displaySessions.length;
    return displaySessions.filter((session) => session.projects.includes(selectedProject)).length;
  }, [displaySessions, selectedProject]);

  const maxGroupTokens = useMemo(() => Math.max(...groups.map(g => g.totalTokens), 1), [groups]);
  const maxGroupCost = useMemo(() => Math.max(...groups.map(g => g.costUSD), 0), [groups]);
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
                  {group.sessions.map((session) => {
                    const isInactive = session.totalTokens === 0;
                    const nonCachedInputTokens = Math.max(session.inputTokens - session.cachedInputTokens, 0);
                    const fullTime = new Date(session.modifiedAtMs).toLocaleString();
                    const formattedTime = new Date(session.modifiedAtMs).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const title = session.threadName || cleanSessionId(session.sessionId);
                    const shownProjects = session.projects.slice(0, 2);
                    const shownModels = session.models.slice(0, 3);
                    const projectOverflow = session.projects.length - shownProjects.length;
                    const modelOverflow = session.models.length - shownModels.length;
                    const tokenLabel = isInactive
                      ? t("sessions.token_bar_empty")
                      : t("sessions.token_bar_label", {
                          input: formatNumber(nonCachedInputTokens),
                          cached: formatNumber(session.cachedInputTokens),
                          output: formatNumber(session.outputTokens),
                          total: formatNumber(session.totalTokens),
                        });

                    return (
                      <article
                        key={session.path}
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
                        className={`session-usage-card rounded-lg border border-border/50 bg-card/70 px-3 py-2.5 shadow-sm transition-colors duration-150 hover:border-primary/35 hover:bg-card ${onSessionClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70" : ""}`}
                      >
                        <div className="session-card-summary min-w-0 space-y-1.5">
                          <h3 className="truncate text-sm font-semibold leading-tight text-foreground" title={title}>{title}</h3>
                          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground" title={session.projects.join("\n")}>
                            <Folder className="h-3 w-3 flex-none opacity-70" />
                            {shownProjects.length > 0 ? (
                              <span className="flex min-w-0 items-center gap-1 truncate font-medium">
                                {shownProjects.map((project) => (
                                  <span key={project} title={project}>
                                    {project.split("/").pop() || project}
                                  </span>
                                ))}
                                {projectOverflow > 0 ? <span title={session.projects.join("\n")}>+{projectOverflow}</span> : null}
                              </span>
                            ) : <span className="italic">{t("sessions.no_workspace")}</span>}
                            {session.threadName ? <span aria-hidden="true">·</span> : null}
                            {session.threadName ? <span className="min-w-0 truncate font-mono" title={session.path}>{cleanSessionId(session.sessionId)}</span> : null}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/80">
                            <span className="font-semibold tabular-nums text-foreground" title={fullTime}>{formattedTime}</span>
                            {shownModels.length > 0 ? <span aria-hidden="true">·</span> : null}
                            {shownModels.length > 0 ? (
                              <span className="flex min-w-0 items-center gap-1 overflow-hidden" title={session.models.join(", ")}>
                                {shownModels.map((model) => (
                                  <span key={model} className="whitespace-nowrap">
                                    {model}
                                  </span>
                                ))}
                                {modelOverflow > 0 ? <span className="whitespace-nowrap">+{modelOverflow}</span> : null}
                              </span>
                            ) : null}
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0" title={session.path}>{formatBytes(session.sizeBytes)}</span>
                          </div>
                        </div>

                        <div className="session-card-tokens min-w-0 space-y-1.5">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-base font-bold tabular-nums tracking-tight text-foreground" data-testid="token-total">
                              {formatSessionTokenCount(session.totalTokens)}
                            </span>
                            <span className="text-[10px] font-medium text-muted-foreground">{t("common.tokens")}</span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                            <span>{t("sessions.input_including_cache")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.inputTokens)}</strong></span>
                            <span aria-hidden="true">·</span>
                            <span>{t("sessions.cached")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.cachedInputTokens)}</strong></span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                            <span>{t("sessions.output")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.outputTokens)}</strong></span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-foreground" data-testid="session-cost">{formatCurrency(session.costUSD)}</span>
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
                          {isInactive ? <div className="text-[9px] italic text-muted-foreground">{t("daily.no_activity")}</div> : null}
                        </div>

                        <div className="session-card-quota min-w-0">
                          <SessionQuotaUsageView usage={session.quotaUsage} />
                        </div>
                      </article>
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
