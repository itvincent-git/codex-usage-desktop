import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionDetailRow, SessionQuotaWindowUsage } from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Terminal, Folder, ChevronDown, Calendar, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { modelTone } from "@/lib/model-tone";
import { SessionQuotaUsageView } from "./session-quota-usage";
import { projectLabel, sessionProjectReferences } from "@/lib/project-reference";

type SessionDisplayRow = SessionDetailRow & {
  usageDate: string;
  originalSession: SessionDetailRow;
};

const COLLAPSED_SUBAGENT_LIMIT = 1;

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

function orderSessionsByAgentHierarchy(sessions: SessionDisplayRow[]) {
  const chronological = [...sessions].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  const byAgentId = new Map(
    chronological.flatMap((session) => session.agentSessionId ? [[session.agentSessionId, session] as const] : []),
  );
  const children = new Map<string, SessionDisplayRow[]>();

  for (const session of chronological) {
    if (!session.parentSessionId || !byAgentId.has(session.parentSessionId)) continue;
    const siblings = children.get(session.parentSessionId) ?? [];
    siblings.push(session);
    children.set(session.parentSessionId, siblings);
  }

  const ordered: SessionDisplayRow[] = [];
  const visited = new Set<SessionDisplayRow>();
  const visit = (session: SessionDisplayRow) => {
    if (visited.has(session)) return;
    visited.add(session);
    ordered.push(session);
    if (!session.agentSessionId) return;
    for (const child of children.get(session.agentSessionId) ?? []) visit(child);
  };

  for (const session of chronological) {
    if (!session.parentSessionId || !byAgentId.has(session.parentSessionId)) visit(session);
  }
  for (const session of chronological) visit(session);
  return ordered;
}

function groupSessionsByAgentHierarchy(sessions: SessionDisplayRow[]) {
  const byAgentId = new Map(
    sessions.flatMap((session) => session.agentSessionId ? [[session.agentSessionId, session] as const] : []),
  );
  const groups = new Map<SessionDisplayRow, SessionDisplayRow[]>();

  for (const session of sessions) {
    let root = session;
    const visited = new Set<string>();
    while (root.parentSessionId && byAgentId.has(root.parentSessionId) && !visited.has(root.parentSessionId)) {
      visited.add(root.parentSessionId);
      root = byAgentId.get(root.parentSessionId)!;
    }
    const members = groups.get(root) ?? [];
    members.push(session);
    groups.set(root, members);
  }

  return Array.from(groups, ([root, members]) => ({
    key: root.path,
    sessions: members,
    inputTokens: members.reduce((sum, session) => sum + session.inputTokens, 0),
    cachedInputTokens: members.reduce((sum, session) => sum + session.cachedInputTokens, 0),
    outputTokens: members.reduce((sum, session) => sum + session.outputTokens, 0),
    costUSD: members.reduce((sum, session) => sum + session.costUSD, 0),
  }));
}

function buildAgentConnectorMetadata(sessions: SessionDisplayRow[]) {
  const byAgentId = new Map(
    sessions.flatMap((session) => session.agentSessionId ? [[session.agentSessionId, session] as const] : []),
  );
  const children = new Map<string, SessionDisplayRow[]>();

  for (const session of sessions) {
    if (!session.parentSessionId || !byAgentId.has(session.parentSessionId)) continue;
    const siblings = children.get(session.parentSessionId) ?? [];
    siblings.push(session);
    children.set(session.parentSessionId, siblings);
  }

  const hasFollowingSiblingByPath = new Map<string, boolean>();
  const followingSiblingDepths = new Set<number>();
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    const depth = Math.min(session.agentDepth ?? (session.parentSessionId ? 1 : 0), 6);
    hasFollowingSiblingByPath.set(session.path, followingSiblingDepths.has(depth));
    for (const trackedDepth of followingSiblingDepths) {
      if (trackedDepth > depth) followingSiblingDepths.delete(trackedDepth);
    }
    followingSiblingDepths.add(depth);
  }

  const hasFollowingSibling = (session: SessionDisplayRow) => (
    hasFollowingSiblingByPath.get(session.path) ?? false
  );

  return new Map(sessions.map((session) => {
    const continuingAncestorDepths: number[] = [];
    let ancestor = session.parentSessionId ? byAgentId.get(session.parentSessionId) : undefined;

    while (ancestor) {
      if ((ancestor.agentDepth ?? 0) > 0 && hasFollowingSibling(ancestor)) {
        continuingAncestorDepths.push(Math.min(ancestor.agentDepth ?? 0, 6));
      }
      ancestor = ancestor.parentSessionId ? byAgentId.get(ancestor.parentSessionId) : undefined;
    }

    return [session.path, {
      hasVisibleChildren: Boolean(session.agentSessionId && children.get(session.agentSessionId)?.length),
      hasFollowingVisibleSibling: hasFollowingSibling(session),
      continuingAncestorDepths,
    }] as const;
  }));
}

function formatDateHeader(dateStr: string) {
  try {
    return dayjs(dateStr).format("YYYY-MM-DD (dddd)");
  } catch (e) {
    return dateStr;
  }
}

function rebaseQuotaUsage(sessions: SessionDisplayRow[]) {
  const windows = sessions.flatMap((session) =>
    (["fiveHour", "weekly"] as const).flatMap((key) =>
      (session.quotaUsage?.[key] ?? []).map((window) => ({ key, window })),
    ),
  );

  const rebaseWindow = (key: "fiveHour" | "weekly", window: SessionQuotaWindowUsage) => {
    const startAt = Date.parse(window.observedStartAt);
    const endAt = Date.parse(window.observedEndAt);
    const resetAt = window.resetsAt ? Date.parse(window.resetsAt) : null;
    let baseline: SessionQuotaWindowUsage | null = null;
    let baselineEndAt = Number.NEGATIVE_INFINITY;

    for (const candidate of windows) {
      if (candidate.key !== key || candidate.window === window) continue;
      const candidateEndAt = Date.parse(candidate.window.observedEndAt);
      const candidateResetAt = candidate.window.resetsAt ? Date.parse(candidate.window.resetsAt) : null;
      const sameReset = resetAt === null && candidateResetAt === null
        || resetAt !== null && candidateResetAt !== null && Math.abs(resetAt - candidateResetAt) <= 60_000;
      if (
        sameReset
        && candidateEndAt > startAt
        && candidateEndAt < endAt
        && candidate.window.observedEndPercent <= window.observedEndPercent
        && candidateEndAt > baselineEndAt
      ) {
        baseline = candidate.window;
        baselineEndAt = candidateEndAt;
      }
    }

    if (!baseline) return window;
    const observedDeltaPercent = window.observedEndPercent - baseline.observedEndPercent;
    return {
      ...window,
      observedStartAt: baseline.observedEndAt,
      observedStartPercent: baseline.observedEndPercent,
      observedDeltaPercent,
      belowResolution: Math.round(observedDeltaPercent) === 0,
    };
  };

  return sessions.map((session) => session.quotaUsage ? {
    ...session,
    quotaUsage: {
      fiveHour: session.quotaUsage.fiveHour.map((window) => rebaseWindow("fiveHour", window)),
      weekly: session.quotaUsage.weekly.map((window) => rebaseWindow("weekly", window)),
    },
  } : session);
}

function summarizeQuotaUsage(sessions: SessionDisplayRow[], key: "fiveHour" | "weekly") {
  let observedDeltaPercent = 0;
  let hasBelowResolutionUsage = false;
  let hasUsage = false;
  let firstObservedAt: string | null = null;
  let lastObservedAt: string | null = null;
  let observedStartPercent: number | null = null;
  let observedEndPercent: number | null = null;

  for (const session of sessions) {
    for (const window of session.quotaUsage?.[key] ?? []) {
      hasUsage = true;
      observedDeltaPercent += window.observedDeltaPercent;
      hasBelowResolutionUsage ||= window.belowResolution;
      if (firstObservedAt === null || window.observedStartAt < firstObservedAt) {
        firstObservedAt = window.observedStartAt;
        observedStartPercent = window.observedStartPercent;
      }
      if (lastObservedAt === null || window.observedEndAt > lastObservedAt) {
        lastObservedAt = window.observedEndAt;
        observedEndPercent = window.observedEndPercent;
      }
    }
  }

  return {
    observedDeltaPercent,
    observedStartPercent,
    observedEndPercent,
    hasBelowResolutionUsage,
    hasUsage,
  };
}

function formatQuotaTotal(
  total: ReturnType<typeof summarizeQuotaUsage>,
  approximate: string,
) {
  if (!total.hasUsage) return "--";
  if (total.observedDeltaPercent === 0 && total.hasBelowResolutionUsage) return "<1%";
  return `${approximate} ${Math.round(total.observedDeltaPercent)}%`;
}

function formatQuotaRemainingRange(total: ReturnType<typeof summarizeQuotaUsage>) {
  if (total.observedStartPercent === null || total.observedEndPercent === null) return "--";
  const start = Math.min(Math.max(100 - total.observedStartPercent, 0), 100);
  const end = Math.min(Math.max(100 - total.observedEndPercent, 0), 100);
  return `${Math.round(start)}% → ${Math.round(end)}%`;
}

function costTone(cost: number, maxCost: number) {
  if (cost <= 0 || maxCost <= 0) {
    return {
      name: "zero",
      className: "border-border/60 bg-muted/50 text-muted-foreground",
      fillClassName: "bg-muted-foreground/10",
    };
  }

  const relativeCost = cost / maxCost;
  if (relativeCost <= 1 / 3) {
    return {
      name: "low",
      className: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
      fillClassName: "bg-emerald-500/20",
    };
  }
  if (relativeCost <= 2 / 3) {
    return {
      name: "medium",
      className: "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      fillClassName: "bg-amber-500/20",
    };
  }
  return {
    name: "high",
    className: "border-rose-500/25 bg-rose-500/5 text-rose-700 dark:text-rose-300",
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
  const { t, i18n } = useTranslation();
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

  const displaySessions = useMemo<SessionDisplayRow[]>(() => rebaseQuotaUsage(sessions.flatMap((session) => {
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
  })), [sessions]);

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
        const sortedItems = orderSessionsByAgentHierarchy(items);
        const totalTokens = sortedItems.reduce((sum, item) => sum + item.totalTokens, 0);
        const inputTokens = sortedItems.reduce((sum, item) => sum + item.inputTokens, 0);
        const cachedInputTokens = sortedItems.reduce((sum, item) => sum + item.cachedInputTokens, 0);
        const outputTokens = sortedItems.reduce((sum, item) => sum + item.outputTokens, 0);
        const costUSD = sortedItems.reduce((sum, item) => sum + item.costUSD, 0);
        const fiveHourQuota = summarizeQuotaUsage(sortedItems, "fiveHour");
        const weeklyQuota = summarizeQuotaUsage(sortedItems, "weekly");
        
        // Find all unique models and projects used on this date
        const models = Array.from(new Set(sortedItems.flatMap(item => item.models || [])));
        const projects = Array.from(new Set(sortedItems.flatMap(item => item.projects || [])));

        return {
          date,
          sessions: sortedItems,
          agentGroups: groupSessionsByAgentHierarchy(sortedItems),
          totalTokens,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          costUSD,
          fiveHourQuota,
          weeklyQuota,
          models,
          projects,
        };
      });
  }, [displaySessions, selectedProject]);

  const filteredCount = useMemo(() => {
    if (!selectedProject) return displaySessions.length;
    return displaySessions.filter((session) => session.projects.includes(selectedProject)).length;
  }, [displaySessions, selectedProject]);
  const selectedProjectReference = useMemo(() => {
    if (!selectedProject) return null;
    return sessions
      .flatMap(sessionProjectReferences)
      .find((project) => project.path === selectedProject) ?? null;
  }, [selectedProject, sessions]);

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

  const toggleAgentGroup = (key: string) => {
    setExpandedAgentGroups((previous) => ({ ...previous, [key]: !previous[key] }));
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
                <span className="inline-flex items-center gap-1.5 font-bold text-foreground text-sm">{selectedProjectReference ? projectLabel(selectedProjectReference) : selectedProject.split(/[\\/]/).pop() || selectedProject}{selectedProjectReference?.codexProjectName ? <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-indigo-500">{t("projects.codex_project")}</span> : null}</span>
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
          const fiveHourQuota = group.fiveHourQuota.hasUsage
            ? t("sessions.quota.used_and_remaining_change", {
                usage: formatQuotaTotal(group.fiveHourQuota, t("sessions.quota.approx")),
                remaining: formatQuotaRemainingRange(group.fiveHourQuota),
              })
            : "--";
          const weeklyQuota = group.weeklyQuota.hasUsage
            ? t("sessions.quota.used_and_remaining_change", {
                usage: formatQuotaTotal(group.weeklyQuota, t("sessions.quota.approx")),
                remaining: formatQuotaRemainingRange(group.weeklyQuota),
              })
            : "--";
          const hasQuotaUsage = group.fiveHourQuota.hasUsage || group.weeklyQuota.hasUsage;

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
                  {hasQuotaUsage ? (
                    <div
                      data-testid="day-quota-summary"
                      className="space-y-1 text-right text-xs tabular-nums"
                      aria-label={t("sessions.quota.day_usage_label", {
                        fiveHour: fiveHourQuota,
                        weekly: weeklyQuota,
                      })}
                      title={t("sessions.quota.day_caveat")}
                    >
                      <div className="text-muted-foreground">{t("sessions.quota.day_consumed")}</div>
                      <div className="flex items-center justify-end gap-3 font-semibold text-foreground">
                        <span><span className="text-muted-foreground">{t("sessions.quota.five_hour")}</span> {fiveHourQuota}</span>
                        <span><span className="text-muted-foreground">{t("sessions.quota.weekly")}</span> {weeklyQuota}</span>
                      </div>
                    </div>
                  ) : null}

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
                  {group.agentGroups.map((agentGroup) => {
                    const groupKey = `${group.date}:${agentGroup.key}`;
                    const hasSubagents = agentGroup.sessions.length > 1;
                    const isExpanded = Boolean(expandedAgentGroups[groupKey]);
                    const visibleSessions = hasSubagents && !isExpanded
                      ? [agentGroup.sessions[0], ...agentGroup.sessions.slice(1, COLLAPSED_SUBAGENT_LIMIT + 1)]
                      : agentGroup.sessions;
                    const connectorMetadata = buildAgentConnectorMetadata(visibleSessions);

                    return (
                      <div key={agentGroup.key} className="space-y-2" data-testid={hasSubagents ? "subagent-group" : undefined}>
                        <div className="space-y-2">
                          {visibleSessions.map((session) => {
                    const isInactive = session.totalTokens === 0;
                    const nonCachedInputTokens = Math.max(session.inputTokens - session.cachedInputTokens, 0);
                    const fullTime = new Date(session.modifiedAtMs).toLocaleString();
                    const formattedTime = new Date(session.modifiedAtMs).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const title = session.threadName || cleanSessionId(session.sessionId);
                    const projectReferences = sessionProjectReferences(session);
                    const shownProjects = projectReferences.slice(0, 2);
                    const shownModels = session.models.slice(0, 3);
                    const projectOverflow = projectReferences.length - shownProjects.length;
                    const modelOverflow = session.models.length - shownModels.length;
                    const tokenRatio = sessionScale.tokens > 0 ? session.totalTokens / sessionScale.tokens : 0;
                    const costRatio = sessionScale.cost > 0 ? session.costUSD / sessionScale.cost : 0;
                    const cost = costTone(session.costUSD, sessionScale.cost);
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
                    const isSubagent = Boolean(session.parentSessionId) || (session.agentDepth ?? 0) > 0;
                    const hierarchyDepth = Math.min(session.agentDepth ?? (isSubagent ? 1 : 0), 6);
                    const subagentLabel = [t("sessions.subagent"), session.agentNickname, session.agentRole]
                      .filter(Boolean)
                      .join(" · ");
                    const isParentAgent = hasSubagents && session.path === agentGroup.key;
                    const connector = connectorMetadata.get(session.path);

                    return (
                      <div
                        key={session.path}
                        className="relative"
                        data-agent-depth={session.agentDepth ?? 0}
                        style={{ paddingInlineStart: hierarchyDepth ? `${hierarchyDepth * 20}px` : undefined }}
                      >
                      {connector?.continuingAncestorDepths.map((ancestorDepth) => (
                        <span
                          key={ancestorDepth}
                          aria-hidden="true"
                          className="session-agent-rail"
                          style={{ insetInlineStart: `${(ancestorDepth - 1) * 20 + 8}px` }}
                        />
                      ))}
                      {isSubagent ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="session-agent-branch"
                            data-testid="agent-branch"
                            style={{ insetInlineStart: `${Math.max(hierarchyDepth - 1, 0) * 20 + 8}px` }}
                          />
                          {connector?.hasFollowingVisibleSibling ? (
                            <span
                              aria-hidden="true"
                              className="session-agent-sibling-stem"
                              data-testid="agent-sibling-stem"
                              style={{ insetInlineStart: `${Math.max(hierarchyDepth - 1, 0) * 20 + 8}px` }}
                            />
                          ) : null}
                        </>
                      ) : null}
                      {connector?.hasVisibleChildren ? (
                        <span
                          aria-hidden="true"
                          className="session-agent-child-stem"
                          data-testid="agent-child-stem"
                          style={{ insetInlineStart: `${hierarchyDepth * 20 + 8}px` }}
                        />
                      ) : null}
                      <article
                        tabIndex={onSessionClick ? 0 : undefined}
                        role={onSessionClick ? "button" : undefined}
                        aria-label={onSessionClick ? t("sessions.open_session", { title }) : undefined}
                        data-testid="session-card"
                        data-language={i18n.language.startsWith("zh") ? "zh" : "en"}
                        onClick={() => onSessionClick?.(session.originalSession)}
                        onKeyDown={(event) => {
                          if (!onSessionClick) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSessionClick(session.originalSession);
                          }
                        }}
                        className={`session-usage-card rounded-lg border border-border/50 bg-card/70 px-3 py-2.5 shadow-sm transition-colors duration-150 hover:border-primary/35 hover:bg-card ${isParentAgent ? "has-subagents" : ""} ${onSessionClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70" : ""}`}
                      >
                        {isParentAgent ? (
                          <button
                            type="button"
                            className="session-card-subagents flex w-full min-w-0 items-center gap-2 border-b border-indigo-500/15 pb-2 text-left text-xs transition hover:bg-indigo-500/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/50"
                            data-testid="subagent-summary"
                            aria-expanded={isExpanded}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleAgentGroup(groupKey);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <GitBranch className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
                            <span className="font-semibold text-foreground">
                              {t("sessions.subagent_count", { count: agentGroup.sessions.length - 1 })}
                            </span>
                            <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-muted-foreground">
                              <span>{t("sessions.input_including_cache")} <strong className="tabular-nums text-foreground" data-testid="subagent-group-input">{formatSessionTokenCount(agentGroup.inputTokens)}</strong></span>
                              <span>{t("sessions.cached")} <strong className="tabular-nums text-foreground" data-testid="subagent-group-cache">{formatSessionTokenCount(agentGroup.cachedInputTokens)}</strong></span>
                              <span>{t("sessions.output")} <strong className="tabular-nums text-foreground" data-testid="subagent-group-output">{formatSessionTokenCount(agentGroup.outputTokens)}</strong></span>
                              <span>{t("sessions.total_cost")} <strong className="tabular-nums text-foreground" data-testid="subagent-group-cost">{formatCurrency(agentGroup.costUSD)}</strong></span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-semibold text-indigo-400">
                              {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} aria-hidden="true" />
                            </span>
                          </button>
                        ) : null}
                        <div className="session-card-summary min-w-0 space-y-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate text-sm font-semibold leading-tight text-foreground" title={title}>{title}</h3>
                            {isSubagent ? (
                              <span
                                className="shrink-0 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-px text-[9px] font-semibold text-indigo-400"
                                title={session.agentPath || subagentLabel}
                              >
                                {subagentLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground" title={projectReferences.map((project) => project.path).join("\n")}>
                            <Folder className="h-3 w-3 flex-none opacity-70" />
                            {shownProjects.length > 0 ? (
                              <span className="flex min-w-0 items-center gap-1 truncate font-medium">
                                {shownProjects.map((project) => (
                                  <span key={project.path} className="inline-flex min-w-0 flex-col items-start" title={project.path}>
                                    <span className="inline-flex min-w-0 items-center gap-1">
                                      <span className="truncate">{projectLabel(project)}</span>
                                      {project.codexProjectName ? <span className="shrink-0 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1 py-px text-[8px] font-semibold text-indigo-500">{t("projects.codex_project")}</span> : null}
                                    </span>
                                    {project.codexProjectName && project.codexProjectName !== project.displayName ? <span className="truncate font-mono text-[9px] opacity-80">{project.displayName}</span> : null}
                                  </span>
                                ))}
                                {projectOverflow > 0 ? <span title={projectReferences.map((project) => project.path).join("\n")}>+{projectOverflow}</span> : null}
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
                                {shownModels.map((model) => {
                                  const tone = modelTone(model);
                                  return (
                                    <span
                                      key={model}
                                      data-model={model}
                                      data-model-tone={tone.index}
                                      className={`whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-semibold ${tone.className}`}
                                    >
                                      {model}
                                    </span>
                                  );
                                })}
                                {modelOverflow > 0 ? <span className="whitespace-nowrap">+{modelOverflow}</span> : null}
                              </span>
                            ) : null}
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0" title={session.path}>{formatBytes(session.sizeBytes)}</span>
                          </div>
                        </div>

                        <div className="session-card-tokens min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-medium text-muted-foreground">{t("sessions.total_tokens")}</span>
                            <span
                              className="relative isolate inline-flex min-w-[6.5rem] overflow-hidden rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-sm font-bold tabular-nums tracking-tight text-foreground"
                              role="img"
                              aria-label={tokenTotalLabel}
                              data-testid="token-total"
                            >
                              {tokenRatio > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 -z-10 bg-primary/20"
                                  style={{ width: `${tokenRatio * 100}%`, minWidth: 2 }}
                                />
                              ) : null}
                              <span className="relative">{formatSessionTokenCount(session.totalTokens)}</span>
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                            <span>{t("sessions.input_including_cache")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.inputTokens)}</strong></span>
                            <span aria-hidden="true">·</span>
                            <span>{t("sessions.cached")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.cachedInputTokens)}</strong></span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                            <span>{t("sessions.output")} <strong className="font-semibold text-foreground">{formatSessionTokenCount(session.outputTokens)}</strong></span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">{t("sessions.cols.cost")}</span>
                            <span
                              role="img"
                              aria-label={costLabel}
                              data-cost-tone={cost.name}
                              data-testid="session-cost"
                              className={`relative isolate inline-flex min-w-[4.5rem] overflow-hidden rounded-full border px-1.5 py-px font-semibold ${cost.className}`}
                            >
                              {costRatio > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className={`absolute inset-y-0 left-0 -z-10 ${cost.fillClassName}`}
                                  style={{ width: `${costRatio * 100}%`, minWidth: 2 }}
                                />
                              ) : null}
                              <span className="relative ml-auto">{formatCurrency(session.costUSD)}</span>
                            </span>
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
                      </div>
                    );
                          })}
                        </div>
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
