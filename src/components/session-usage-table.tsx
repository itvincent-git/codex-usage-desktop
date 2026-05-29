import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionDetailRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Sparkles, Terminal, FileText, Folder, ChevronDown, Calendar } from "lucide-react";
import dayjs from "dayjs";

type SessionUsageTableProps = {
  sessions: SessionDetailRow[];
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

function formatDateHeader(dateStr: string) {
  try {
    return dayjs(dateStr).format("YYYY-MM-DD");
  } catch (e) {
    return dateStr;
  }
}

export function SessionUsageTable({ sessions }: SessionUsageTableProps) {
  // Track which date groups are collapsed
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});

  // Group and sort sessions
  const groups = useMemo(() => {
    const map: Record<string, SessionDetailRow[]> = {};
    for (const session of sessions) {
      // Extract date part (local time based on timestamp) using dayjs with YYYY-MM-DD format
      const dateStr = dayjs(session.modifiedAtMs).format("YYYY-MM-DD");
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
  }, [sessions]);

  const maxGroupTokens = useMemo(() => Math.max(...groups.map(g => g.totalTokens), 1), [groups]);
  const maxGroupCost = useMemo(() => Math.max(...groups.map(g => g.costUSD), 0), [groups]);

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => ({
      ...prev,
      [date]: !isCollapsed(date),
    }));
  };

  const isCollapsed = (date: string) => {
    // If not explicitly set, the first date group (index 0) is expanded by default, others collapsed
    if (collapsedDates[date] !== undefined) {
      return collapsedDates[date];
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
          <h3 className="text-lg font-semibold text-foreground">No active sessions found</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Codex CLI session logs could not be found or contain no usage events. Click "Rescan local logs" to check again.
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
            Session Details
            <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/20">
              {sessions.length} sessions
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Parse individual Codex sessions, grouped by date from newest to oldest. Click on a group header to expand/collapse.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((group, index) => {
          const collapsed = isCollapsed(group.date);
          const formattedDate = formatDateHeader(group.date);
          
          const groupTokenBarWidth = `${Math.max((group.totalTokens / maxGroupTokens) * 100, 6)}%`;
          const groupCostHeat = maxGroupCost > 0 ? group.costUSD / maxGroupCost : 0;
          const groupCostHeatAlpha = 0.08 + groupCostHeat * 0.22;

          return (
            <div
              key={group.date}
              className="overflow-hidden rounded-xl border border-border/50 bg-card/20 backdrop-blur-sm shadow-sm transition-all duration-300 hover:border-border/80"
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
                        {group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"}
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
                      <div className="text-xs text-muted-foreground">Day Total Tokens</div>
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
                    <div className="text-xs text-muted-foreground italic">No activity</div>
                  )}

                  {/* Day total cost */}
                  {group.totalTokens > 0 && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground mb-1">Day Cost</div>
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

              {/* Accordion Content: Session Table for this Date */}
              {!collapsed && (
                <div className="border-t border-border/40 bg-black/[0.04] dark:bg-black/[0.08] px-5 pb-5 pt-3">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="border-b border-border/60 pb-3 font-medium">Session ID / File</th>
                          <th className="border-b border-border/60 px-4 pb-3 font-medium">Projects & Models</th>
                          <th className="border-b border-border/60 px-4 pb-3 font-medium">Total Tokens</th>
                          <th className="border-b border-border/60 px-4 pb-3 text-right font-medium">Input</th>
                          <th className="border-b border-border/60 px-4 pb-3 text-right font-medium">Cache</th>
                          <th className="border-b border-border/60 px-4 pb-3 text-right font-medium">Output</th>
                          <th className="border-b border-border/60 pb-3 text-right font-medium">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.sessions.map((session) => {
                          const isInactive = session.totalTokens === 0;
                          const tokenBarWidth = `${Math.max((session.totalTokens / group.totalTokens) * 100, 6)}%`;
                          const cacheHitRate = session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0;
                          
                          const formattedTime = new Date(session.modifiedAtMs).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });

                          return (
                            <tr
                              key={session.path}
                              className="align-top hover:bg-white/[0.01] transition-colors duration-150"
                            >
                              {/* Session Name & Time */}
                              <td className="border-b border-border/30 py-4">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 font-semibold text-foreground leading-none">
                                    <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate max-w-[180px] text-xs" title={session.path}>
                                      {cleanSessionId(session.sessionId)}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground tabular-nums flex flex-col gap-0.5">
                                    <span>Time: {formattedTime}</span>
                                    <span className="opacity-80">Size: {formatBytes(session.sizeBytes)}</span>
                                  </div>
                                </div>
                              </td>

                              {/* Projects & Models */}
                              <td className="border-b border-border/30 px-4 py-4">
                                <div className="space-y-2 max-w-[280px]">
                                  {/* Projects */}
                                  {session.projects && session.projects.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {session.projects.map((proj) => {
                                        const name = proj.split("/").pop() || proj;
                                        return (
                                          <span
                                            key={proj}
                                            className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground border border-border/10 transition-all"
                                            title={proj}
                                          >
                                            <Folder className="h-2.5 w-2.5 opacity-60" />
                                            {name}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/60 italic">No workspace</span>
                                  )}

                                  {/* Models */}
                                  {session.models && session.models.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {session.models.map((model) => (
                                        <span
                                          key={model}
                                          className="inline-flex items-center rounded-full bg-indigo-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-indigo-400 border border-indigo-500/10"
                                        >
                                          {model}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/60 italic">No models</span>
                                  )}
                                </div>
                              </td>

                              {/* Total Tokens (relative to group total) */}
                              <td className="border-b border-border/30 px-4 py-4">
                                {isInactive ? (
                                  <span className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    No activity
                                  </span>
                                ) : (
                                  <div className="space-y-1.5 min-w-[90px]">
                                    <div className="font-semibold text-foreground text-xs">
                                      {formatNumber(session.totalTokens)}
                                    </div>
                                    <div className="h-1 overflow-hidden rounded-full bg-muted/65 w-full">
                                      <div
                                        aria-hidden="true"
                                        className="h-full rounded-full bg-primary/70"
                                        style={{ width: tokenBarWidth }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Input Tokens */}
                              <td className="border-b border-border/30 px-4 py-4 text-right tabular-nums text-foreground text-xs">
                                {isInactive ? <span className="text-muted-foreground/60">--</span> : formatNumber(session.inputTokens)}
                              </td>

                              {/* Cached Input Tokens */}
                              <td className="border-b border-border/30 px-4 py-4 text-right">
                                {isInactive ? (
                                  <span className="text-muted-foreground/60">--</span>
                                ) : (
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className="tabular-nums font-medium text-foreground text-xs">{formatNumber(session.cachedInputTokens)}</span>
                                    <span className="rounded-full bg-secondary/10 px-1 py-0.2 text-[8px] font-bold text-secondary">
                                      {formatPercent(cacheHitRate)}
                                    </span>
                                  </div>
                                )}
                              </td>

                              {/* Output Tokens */}
                              <td className="border-b border-border/30 px-4 py-4 text-right tabular-nums text-foreground text-xs">
                                {isInactive ? <span className="text-muted-foreground/60">--</span> : formatNumber(session.outputTokens)}
                              </td>

                              {/* Cost */}
                              <td className="border-b border-border/30 py-4 text-right tabular-nums">
                                {isInactive ? (
                                  <span className="text-muted-foreground/60">--</span>
                                ) : (
                                  <span className="font-semibold text-foreground text-xs">
                                    {formatCurrency(session.costUSD)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
