import { useState, useEffect, useMemo, useRef } from "react";
import { X, Folder, Terminal, FileText, Calendar, Sparkles, Cpu, Search, ArrowRight } from "lucide-react";
import { fetchSessionDetails, type SessionDetailRow } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

type ProjectSessionsModalProps = {
  project: {
    project: string; // The project path
    displayName: string;
    totalTokens: number;
    costUSD: number;
  };
  onClose: () => void;
  onGoToSessions: (projectPath: string) => void;
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

export function ProjectSessionsModal({ project, onClose, onGoToSessions }: ProjectSessionsModalProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionDetailRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  // Close modal when pressing Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Click outside to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  // Fetch session details on mount
  useEffect(() => {
    async function loadSessions() {
      setIsLoading(true);
      try {
        const data = await fetchSessionDetails();
        // Filter sessions that belong to this project
        const projectSessions = data.filter((s) => s.projects && s.projects.includes(project.project));
        setSessions(projectSessions);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("project_modal.no_sessions"));
      } finally {
        setIsLoading(false);
      }
    }
    void loadSessions();
  }, [project.project]);

  // Sum up tokens and cost for this project's sessions
  const totals = useMemo(() => {
    return sessions.reduce(
      (acc, s) => {
        acc.totalTokens += s.totalTokens;
        acc.inputTokens += s.inputTokens;
        acc.cachedInputTokens += s.cachedInputTokens;
        acc.outputTokens += s.outputTokens;
        acc.costUSD += s.costUSD;
        return acc;
      },
      { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUSD: 0 }
    );
  }, [sessions]);

  // Filter sessions inside the modal by search query
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((s) => {
      const cleanId = cleanSessionId(s.sessionId).toLowerCase();
      const matchesSession = cleanId.includes(query);
      const matchesModel = s.models && s.models.some((m) => m.toLowerCase().includes(query));
      return matchesSession || matchesModel;
    });
  }, [sessions, searchQuery]);

  const cacheHitRate = totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0;

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-all duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-project-title"
    >
      <div
        ref={modalRef}
        className="bg-surface/95 border border-border/80 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden backdrop-blur-lg transition-transform duration-300 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-border/60 bg-muted/20 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/10">
              <Folder className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <h3 id="modal-project-title" className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                {project.displayName}
                <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/20">
                  {t("project_modal.project_details", { defaultValue: "Project Details" })}
                </span>
              </h3>
              <p className="font-mono text-xs text-muted-foreground truncate max-w-lg md:max-w-xl" title={project.project}>
                {project.project}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground transition cursor-pointer"
            aria-label={t("range_switcher.modal_close_aria")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500/20 border-t-indigo-500" />
              <p className="text-sm text-muted-foreground font-medium">{t("loading.loading_sessions")}</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error/95">
              {error}
            </div>
          ) : (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Total Sessions Card */}
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("common.sessions")}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-foreground">{sessions.length}</span>
                    <span className="text-xs text-muted-foreground">{t("project_modal.active_files", { defaultValue: "active files" })}</span>
                  </div>
                </div>

                {/* Total Tokens Card */}
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("project_modal.tokens_breakdown")}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-foreground">{formatNumber(totals.totalTokens)}</span>
                  </div>
                  {totals.totalTokens > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{t("common.cache")}: {formatPercent(cacheHitRate)}</span>
                    </div>
                  )}
                </div>

                {/* Total Cost Card */}
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("project_modal.estimated_cost")}</span>
                  <div>
                    <span className="inline-flex rounded-full bg-secondary/10 px-2.5 py-0.5 font-bold text-secondary text-base border border-secondary/10">
                      {formatCurrency(totals.costUSD)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sessions Table Header + Search */}
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-foreground">{t("project_modal.sessions_list")}</h4>
                    <p className="text-xs text-muted-foreground">
                      {searchQuery ? t("project_modal.showing_filtered", { filtered: filteredSessions.length, defaultValue: `Showing ${filteredSessions.length} matching sessions` }) : t("project_modal.subtitle_desc", { defaultValue: "Individual sessions writing to this directory" })}
                    </p>
                  </div>
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder={t("project_modal.search_placeholder", { defaultValue: "Search session ID or model..." })}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-indigo-500/80 focus:ring-4 focus:ring-indigo-500/10 transition"
                    />
                  </div>
                </div>

                {filteredSessions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/80 p-8 text-center space-y-2">
                    <Terminal className="h-6 w-6 text-muted-foreground/60 mx-auto" />
                    <p className="text-sm font-medium text-foreground">{t("project_modal.no_matching_sessions", { defaultValue: "No sessions match your search query" })}</p>
                    <p className="text-xs text-muted-foreground">{t("project_modal.clear_search_hint", { defaultValue: "Try clearing your search query or searching for another term." })}</p>
                  </div>
                ) : (
                  <div className="border border-border/60 rounded-xl overflow-hidden bg-surface shadow-sm">
                    <div className="overflow-x-auto max-h-[30vh]">
                      <table className="min-w-full border-separate border-spacing-0 text-sm">
                        <thead className="sticky top-0 bg-surface z-10">
                          <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground border-b border-border bg-muted/20">
                            <th className="border-b border-border/60 px-4 py-3 font-semibold">{t("project_modal.session_id_file", { defaultValue: "Session ID / File" })}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold">{t("common.model")}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold text-right">{t("common.tokens")}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold text-right">{t("project_modal.input")}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold text-right">{t("common.cache")}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold text-right">{t("project_modal.output")}</th>
                            <th className="border-b border-border/60 px-4 py-3 font-semibold text-right">{t("common.cost")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {filteredSessions.map((session) => {
                            const isInactive = session.totalTokens === 0;
                            const sessionCacheHit = session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0;
                            const formattedTime = dayjs(session.modifiedAtMs).format("YYYY-MM-DD HH:mm:ss");

                            return (
                              <tr key={session.path} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                                {/* Session ID & Time */}
                                <td className="px-4 py-3 border-b border-border/30">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs leading-none">
                                      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                      <span className="truncate max-w-[140px]" title={session.path}>
                                        {cleanSessionId(session.sessionId)}
                                      </span>
                                    </div>
                                    <div className="text-[9px] text-muted-foreground flex flex-col gap-0.5 font-mono">
                                      <span>{formattedTime}</span>
                                      <span>Size: {formatBytes(session.sizeBytes)}</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Models Used */}
                                <td className="px-4 py-3 border-b border-border/30">
                                  {session.models && session.models.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                                      {session.models.map((model) => (
                                        <span
                                          key={model}
                                          className="inline-flex items-center gap-0.5 rounded-full bg-indigo-500/10 px-2 py-0.2 text-[8px] font-bold text-indigo-400 border border-indigo-500/10"
                                        >
                                          <Cpu className="h-2 w-2 opacity-65" />
                                          {model}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground italic">{t("project_modal.no_models", { defaultValue: "No models" })}</span>
                                  )}
                                </td>

                                {/* Total Tokens */}
                                <td className="px-4 py-3 text-right tabular-nums text-foreground text-xs font-semibold border-b border-border/30">
                                  {isInactive ? "--" : formatNumber(session.totalTokens)}
                                </td>

                                {/* Input Tokens */}
                                <td className="px-4 py-3 text-right tabular-nums text-foreground text-xs border-b border-border/30">
                                  {isInactive ? "--" : formatNumber(session.inputTokens)}
                                </td>

                                {/* Cached Input */}
                                <td className="px-4 py-3 text-right border-b border-border/30">
                                  {isInactive ? (
                                    <span className="text-muted-foreground/60">--</span>
                                  ) : (
                                    <div className="flex flex-col items-end">
                                      <span className="tabular-nums font-medium text-foreground text-xs">{formatNumber(session.cachedInputTokens)}</span>
                                      <span className="text-[8px] font-bold text-secondary">
                                        {formatPercent(sessionCacheHit)}
                                      </span>
                                    </div>
                                  )}
                                </td>

                                {/* Output Tokens */}
                                <td className="px-4 py-3 text-right tabular-nums text-foreground text-xs border-b border-border/30">
                                  {isInactive ? "--" : formatNumber(session.outputTokens)}
                                </td>

                                {/* Cost */}
                                <td className="px-4 py-3 text-right border-b border-border/30">
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
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>

          {!isLoading && !error && sessions.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onGoToSessions(project.project)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 font-medium shadow-sm transition"
            >
              {t("project_modal.view_in_sessions_tab", { defaultValue: "View in Sessions Tab" })}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
