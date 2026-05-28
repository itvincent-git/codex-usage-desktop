import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionDetailRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Sparkles, Terminal, FileText, Folder } from "lucide-react";

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

export function SessionUsageTable({ sessions }: SessionUsageTableProps) {
  const maxSessionTokens = Math.max(...sessions.map((s) => s.totalTokens), 1);
  const maxSessionCost = Math.max(...sessions.map((s) => s.costUSD), 0);

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
    <Card className="border-border/60 bg-card/30 backdrop-blur-sm shadow-md transition-all duration-300">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Session Details
            <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
              {sessions.length} sessions
            </span>
          </CardTitle>
          <CardDescription>
            Individual Codex session runs parsed from your local JSONL log cache, sorted from newest to oldest.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="border-b border-border/80 px-0 pb-3 font-medium">Session / Time</th>
                <th className="border-b border-border/80 px-4 pb-3 font-medium">Projects & Models</th>
                <th className="border-b border-border/80 px-4 pb-3 font-medium">Total Tokens</th>
                <th className="border-b border-border/80 px-4 pb-3 text-right font-medium">Input</th>
                <th className="border-b border-border/80 px-4 pb-3 text-right font-medium">Cache</th>
                <th className="border-b border-border/80 px-4 pb-3 text-right font-medium">Output</th>
                <th className="border-b border-border/80 px-0 pb-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const isInactive = session.totalTokens === 0;
                const tokenBarWidth = `${Math.max((session.totalTokens / maxSessionTokens) * 100, 6)}%`;
                const cacheHitRate = session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0;
                const costHeat = maxSessionCost > 0 ? session.costUSD / maxSessionCost : 0;
                const costHeatAlpha = 0.08 + costHeat * 0.22;

                const formattedTime = new Date(session.modifiedAtMs).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                return (
                  <tr
                    key={session.path}
                    className="align-top hover:bg-white/[0.02] dark:hover:bg-white/[0.01] transition-colors duration-150"
                  >
                    {/* Session ID & Time */}
                    <td className="border-b border-border/50 px-0 py-4.5">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 font-semibold text-foreground leading-none">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate max-w-[200px]" title={session.path}>
                            {cleanSessionId(session.sessionId)}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums flex flex-col gap-0.5">
                          <span>{formattedTime}</span>
                          <span className="opacity-80">Size: {formatBytes(session.sizeBytes)}</span>
                        </div>
                      </div>
                    </td>

                    {/* Projects & Models */}
                    <td className="border-b border-border/50 px-4 py-4.5">
                      <div className="space-y-2 max-w-[320px]">
                        {/* Projects */}
                        {session.projects && session.projects.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {session.projects.map((proj) => {
                              const name = proj.split("/").pop() || proj;
                              return (
                                <span
                                  key={proj}
                                  className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/20 transition-all hover:bg-muted/80"
                                  title={proj}
                                >
                                  <Folder className="h-2.5 w-2.5 opacity-60" />
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">No workspace</span>
                        )}

                        {/* Models */}
                        {session.models && session.models.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {session.models.map((model) => (
                              <span
                                key={model}
                                className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/20"
                              >
                                {model}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">No models</span>
                        )}
                      </div>
                    </td>

                    {/* Total Tokens (with visual bar) */}
                    <td className="border-b border-border/50 px-4 py-4.5">
                      {isInactive ? (
                        <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                          No activity
                        </span>
                      ) : (
                        <div className="space-y-2 min-w-[100px]">
                          <div className="font-semibold text-foreground">{formatNumber(session.totalTokens)}</div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted/65 w-full">
                            <div
                              aria-hidden="true"
                              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80"
                              style={{ width: tokenBarWidth }}
                            />
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Input Tokens */}
                    <td className="border-b border-border/50 px-4 py-4.5 text-right tabular-nums text-foreground">
                      {isInactive ? <span className="text-muted-foreground/60">--</span> : formatNumber(session.inputTokens)}
                    </td>

                    {/* Cached Input Tokens */}
                    <td className="border-b border-border/50 px-4 py-4.5 text-right">
                      {isInactive ? (
                        <span className="text-muted-foreground/60">--</span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <span className="tabular-nums font-medium text-foreground">{formatNumber(session.cachedInputTokens)}</span>
                          <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[9px] font-bold text-secondary">
                            {formatPercent(cacheHitRate)}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Output Tokens */}
                    <td className="border-b border-border/50 px-4 py-4.5 text-right tabular-nums text-foreground">
                      {isInactive ? <span className="text-muted-foreground/60">--</span> : formatNumber(session.outputTokens)}
                    </td>

                    {/* Cost */}
                    <td className="border-b border-border/50 px-0 py-4.5 text-right tabular-nums">
                      {isInactive ? (
                        <span className="text-muted-foreground/60">--</span>
                      ) : (
                        <span
                          className="inline-flex rounded-full px-2.5 py-0.5 font-bold text-foreground border border-white/5 shadow-sm transition-all hover:scale-105"
                          style={{
                            backgroundColor: `rgb(var(--secondary) / ${costHeatAlpha})`,
                            color: "rgb(var(--foreground))",
                          }}
                        >
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
      </CardContent>
    </Card>
  );
}
