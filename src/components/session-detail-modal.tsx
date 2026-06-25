import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clipboard, FileJson, Loader2, MessageSquare, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchSessionDetail, type SessionDetailRow, type SessionReplayDetail } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";

type SessionDetailModalProps = {
  session: SessionDetailRow;
  onClose: () => void;
};

type TabKey = "timeline" | "raw";

const LONG_TEXT_THRESHOLD = 2000;
const TEXT_PREVIEW_LENGTH = 1200;
const RAW_PREVIEW_LENGTH = 4000;

function cleanSessionId(sessionId: string) {
  return sessionId.replace(/\.jsonl$/, "");
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function countMessages(turn: SessionReplayDetail["turns"][number]) {
  return turn.systemMessages.length + turn.userMessages.length + turn.assistantMessages.length + turn.reasoningSummaries.length;
}

function firstUserPreview(turn: SessionReplayDetail["turns"][number]) {
  const text = turn.userMessages.find((message) => message.text.trim().length > 0)?.text.trim();
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ");
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function metric(label: string, value: string, tone: "default" | "danger" = "default") {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-surface/70 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={tone === "danger" ? "mt-1 text-sm font-bold text-error" : "mt-1 text-sm font-bold text-foreground"}>
        {value}
      </div>
    </div>
  );
}

function TextBlock({
  title,
  text,
  defaultCollapsed = false,
}: {
  title: string;
  text: string;
  defaultCollapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [isFullVisible, setIsFullVisible] = useState(!defaultCollapsed && text.length <= LONG_TEXT_THRESHOLD);
  const isLong = text.length > LONG_TEXT_THRESHOLD;
  const preview = isLong ? `${text.slice(0, TEXT_PREVIEW_LENGTH)}...` : text;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
        {isFullVisible ? text : preview}
      </pre>
      {isLong ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-xs"
          onClick={() => setIsFullVisible((value) => !value)}
        >
          {isFullVisible ? t("sessions.detail.hide_full_text") : t("sessions.detail.show_full_text")}
        </Button>
      ) : null}
    </div>
  );
}

export function SessionDetailModal({ session, onClose }: SessionDetailModalProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<SessionReplayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [copied, setCopied] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => new Set());
  const [showFullRaw, setShowFullRaw] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setActiveTab("timeline");
    setExpandedTurns(new Set());
    setShowFullRaw(false);

    void fetchSessionDetail(session.path)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [session.path]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const cacheRate = useMemo(() => {
    const inputTokens = detail?.summary.inputTokens ?? session.inputTokens;
    const cachedInputTokens = detail?.summary.cachedInputTokens ?? session.cachedInputTokens;
    return inputTokens > 0 ? cachedInputTokens / inputTokens : 0;
  }, [detail, session.cachedInputTokens, session.inputTokens]);

  const models = detail?.summary.models.length ? detail.summary.models : session.models;
  const projects = detail?.summary.projects.length ? detail.summary.projects : session.projects;

  async function copyRawJsonl() {
    if (!detail) return;
    await navigator.clipboard?.writeText(detail.rawJsonl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function toggleTurn(key: string) {
    setExpandedTurns((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex overscroll-contain bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-detail-title"
    >
      <div className="flex h-screen w-full flex-col overflow-hidden overscroll-contain">
        <header className="border-b border-border/70 bg-surface px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-primary" />
                <h2 id="session-detail-title" className="truncate text-lg font-bold tracking-tight">
                  {cleanSessionId(session.sessionId)}
                </h2>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {projects.map((project) => (
                  <span key={project} className="max-w-[360px] truncate rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" title={project}>
                    {project}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {models.map((model) => (
                  <span key={model} className="rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {model}
                  </span>
                ))}
              </div>
            </div>
            <Button ref={closeButtonRef} variant="secondary" size="sm" onClick={onClose} aria-label={t("sessions.detail.close_aria")}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <section className="border-b border-border/60 bg-background px-5 py-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
            {metric(t("sessions.detail.duration"), formatDuration(detail?.summary.durationMs))}
            {metric(t("sessions.detail.total_tokens"), formatNumber(detail?.summary.totalTokens ?? session.totalTokens))}
            {metric(t("sessions.detail.cost"), formatCurrency(detail?.summary.costUSD ?? session.costUSD))}
            {metric(t("sessions.detail.cache"), formatPercent(cacheRate))}
            {metric(t("sessions.detail.tool_calls"), formatNumber(detail?.summary.toolCallCount ?? 0))}
            {metric(t("sessions.detail.patches"), formatNumber(detail?.summary.patchCount ?? 0))}
            {metric(t("sessions.detail.errors"), formatNumber(detail?.summary.errorCount ?? 0), (detail?.summary.errorCount ?? 0) > 0 ? "danger" : "default")}
          </div>
        </section>

        <nav className="flex items-center gap-2 border-b border-border/60 bg-background px-5 py-2">
          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${activeTab === "timeline" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {t("sessions.detail.timeline")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("raw")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${activeTab === "raw" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {t("sessions.detail.raw_jsonl")}
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 px-5 py-4">
          {error ? (
            <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : !detail ? (
            <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("sessions.detail.loading_replay")}
            </div>
          ) : activeTab === "timeline" ? (
            <div className="mx-auto max-w-6xl space-y-4">
              <section className="rounded-lg border border-border/60 bg-surface p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {t("sessions.detail.session_summary")}
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>{t("sessions.detail.started", { value: formatTimestamp(detail.summary.startTime) })}</div>
                  <div>{t("sessions.detail.ended", { value: formatTimestamp(detail.summary.endTime) })}</div>
                  <div>{t("sessions.detail.first_token", { value: formatDuration(detail.summary.timeToFirstTokenMs) })}</div>
                  <div>{t("sessions.detail.cli", { value: detail.summary.cliVersion ?? "--" })}</div>
                </div>
              </section>

              {detail.turns.map((turn, index) => {
                const turnKey = `${turn.turnId}-${index}`;
                const isExpanded = expandedTurns.has(turnKey);
                const userPreview = firstUserPreview(turn);
                return (
                <section key={turnKey} className="rounded-lg border border-border/60 bg-surface p-4">
                  <button
                    type="button"
                    className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between"
                    aria-expanded={isExpanded}
                    onClick={() => toggleTurn(turnKey)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-bold">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <MessageSquare className="h-4 w-4 text-primary" />
                        {t("sessions.detail.turn", { id: turn.turnId })}
                      </div>
                      {userPreview ? (
                        <div className="mt-2 truncate text-sm text-muted-foreground">{userPreview}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded border border-border/50 px-2 py-0.5">{t("sessions.detail.message_count", { count: countMessages(turn) })}</span>
                        <span className="rounded border border-border/50 px-2 py-0.5">{t("sessions.detail.tool_count", { count: turn.toolCalls.length })}</span>
                        <span className="rounded border border-border/50 px-2 py-0.5">{t("sessions.detail.patch_count", { count: turn.patchResults.length })}</span>
                        <span className="rounded border border-border/50 px-2 py-0.5">{t("sessions.detail.error_count", { count: turn.errors.length })}</span>
                        <span className="rounded border border-border/50 px-2 py-0.5">{t("sessions.detail.token_event_count", { count: turn.tokenEvents.length })}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {formatTimestamp(turn.startedAt)} · {formatDuration(turn.durationMs)}
                    </div>
                  </button>
                  {isExpanded ? (
                  <div className="mt-3 space-y-3">
                    {turn.systemMessages.map((message, i) => (
                      <TextBlock
                        key={`s-${i}`}
                        title={t("sessions.detail.system")}
                        text={message.text}
                        defaultCollapsed
                      />
                    ))}
                    {turn.userMessages.map((message, i) => <TextBlock key={`u-${i}`} title={t("sessions.detail.user")} text={message.text} />)}
                    {turn.assistantMessages.map((message, i) => <TextBlock key={`a-${i}`} title={t("sessions.detail.assistant")} text={message.text} />)}
                    {turn.reasoningSummaries.map((message, i) => <TextBlock key={`r-${i}`} title={t("sessions.detail.reasoning_summary")} text={message.text} />)}
                    {turn.toolCalls.map((tool, i) => (
                      <details key={`t-${i}`} className="rounded-lg border border-border/50 bg-muted/35 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          <Terminal className="mr-1 inline h-3.5 w-3.5" />
                          {tool.name} {tool.status ? `· ${tool.status}` : ""}
                        </summary>
                        {tool.arguments ? <TextBlock title={t("sessions.detail.arguments")} text={tool.arguments} /> : null}
                        {tool.output ? <TextBlock title={t("sessions.detail.output")} text={tool.output} /> : null}
                        {tool.stderr ? <TextBlock title={t("sessions.detail.stderr")} text={tool.stderr} /> : null}
                      </details>
                    ))}
                    {turn.patchResults.map((patch, i) => (
                      <details key={`p-${i}`} className="rounded-lg border border-border/50 bg-muted/35 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          {patch.success === false ? t("sessions.detail.patch_failed") : t("sessions.detail.patch_result")}
                        </summary>
                        {patch.output ? <TextBlock title={t("sessions.detail.patch_output")} text={patch.output} /> : null}
                      </details>
                    ))}
                    {turn.tokenEvents.length > 0 ? (
                      <div className="rounded-lg border border-border/50 bg-muted/35 p-3 text-xs">
                        <div className="mb-2 font-semibold">{t("sessions.detail.token_events")}</div>
                        <div className="space-y-1 font-mono">
                          {turn.tokenEvents.map((event, i) => (
                            <div key={`tok-${i}`}>
                              {formatTimestamp(event.timestamp)} · {event.model} · {t("sessions.detail.tokens_count", { value: formatNumber(event.totalTokens) })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {turn.errors.map((turnError, i) => <TextBlock key={`e-${i}`} title={t("sessions.detail.error")} text={turnError} />)}
                  </div>
                  ) : null}
                </section>
                );
              })}
            </div>
          ) : (
            <div className="mx-auto flex h-full max-w-6xl flex-col gap-3">
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{t("sessions.detail.raw_preview")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("sessions.detail.raw_metadata", {
                      size: formatBytes(detail.sizeBytes),
                      lines: formatNumber(detail.rawJsonl ? detail.rawJsonl.split("\n").length : 0),
                    })}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void copyRawJsonl()}>
                  <Clipboard className="mr-2 h-4 w-4" />
                  {copied ? t("sessions.detail.copied") : t("sessions.detail.copy")}
                </Button>
              </div>
              <pre className="min-h-[60vh] overflow-auto rounded-lg border border-border/60 bg-surface p-4 font-mono text-xs leading-relaxed text-foreground">
                {showFullRaw ? detail.rawJsonl : detail.rawJsonl.slice(0, RAW_PREVIEW_LENGTH)}
              </pre>
              {!showFullRaw && detail.rawJsonl.length > RAW_PREVIEW_LENGTH ? (
                <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setShowFullRaw(true)}>
                  {t("sessions.detail.show_full_raw")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
