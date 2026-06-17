import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clipboard, FileJson, Loader2, MessageSquare, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchSessionDetail, type SessionDetailRow, type SessionReplayDetail } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";

type SessionDetailModalProps = {
  session: SessionDetailRow;
  onClose: () => void;
};

type TabKey = "timeline" | "raw";

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

function TextBlock({ title, text }: { title: string; text: string }) {
  const collapsed = text.length > 360;
  if (!collapsed) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{text}</pre>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-border/50 bg-muted/35 p-3">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{text}</pre>
    </details>
  );
}

export function SessionDetailModal({ session, onClose }: SessionDetailModalProps) {
  const [detail, setDetail] = useState<SessionReplayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setActiveTab("timeline");

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
      if (event.key === "Escape") onClose();
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

  return (
    <div
      className="fixed inset-0 z-50 flex bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-detail-title"
    >
      <div className="flex h-screen w-full flex-col overflow-hidden">
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
            <Button variant="secondary" size="sm" onClick={onClose} aria-label="Close session detail">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <section className="border-b border-border/60 bg-background px-5 py-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
            {metric("Duration", formatDuration(detail?.summary.durationMs))}
            {metric("Total tokens", formatNumber(detail?.summary.totalTokens ?? session.totalTokens))}
            {metric("Cost", formatCurrency(detail?.summary.costUSD ?? session.costUSD))}
            {metric("Cache", formatPercent(cacheRate))}
            {metric("Tool calls", formatNumber(detail?.summary.toolCallCount ?? 0))}
            {metric("Patches", formatNumber(detail?.summary.patchCount ?? 0))}
            {metric("Errors", formatNumber(detail?.summary.errorCount ?? 0), (detail?.summary.errorCount ?? 0) > 0 ? "danger" : "default")}
          </div>
        </section>

        <nav className="flex items-center gap-2 border-b border-border/60 bg-background px-5 py-2">
          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${activeTab === "timeline" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("raw")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${activeTab === "raw" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            Raw JSONL
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-5 py-4">
          {error ? (
            <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : !detail ? (
            <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session replay
            </div>
          ) : activeTab === "timeline" ? (
            <div className="mx-auto max-w-6xl space-y-4">
              <section className="rounded-lg border border-border/60 bg-surface p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Session summary
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>Started: {formatTimestamp(detail.summary.startTime)}</div>
                  <div>Ended: {formatTimestamp(detail.summary.endTime)}</div>
                  <div>First token: {formatDuration(detail.summary.timeToFirstTokenMs)}</div>
                  <div>CLI: {detail.summary.cliVersion ?? "--"}</div>
                </div>
              </section>

              {detail.turns.map((turn, index) => (
                <section key={`${turn.turnId}-${index}`} className="rounded-lg border border-border/60 bg-surface p-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 font-bold">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      Turn {turn.turnId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(turn.startedAt)} · {formatDuration(turn.durationMs)}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {turn.userMessages.map((message, i) => <TextBlock key={`u-${i}`} title="User" text={message.text} />)}
                    {turn.assistantMessages.map((message, i) => <TextBlock key={`a-${i}`} title="Assistant" text={message.text} />)}
                    {turn.reasoningSummaries.map((message, i) => <TextBlock key={`r-${i}`} title="Reasoning summary" text={message.text} />)}
                    {turn.toolCalls.map((tool, i) => (
                      <details key={`t-${i}`} className="rounded-lg border border-border/50 bg-muted/35 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          <Terminal className="mr-1 inline h-3.5 w-3.5" />
                          {tool.name} {tool.status ? `· ${tool.status}` : ""}
                        </summary>
                        {tool.arguments ? <TextBlock title="Arguments" text={tool.arguments} /> : null}
                        {tool.output ? <TextBlock title="Output" text={tool.output} /> : null}
                        {tool.stderr ? <TextBlock title="Stderr" text={tool.stderr} /> : null}
                      </details>
                    ))}
                    {turn.patchResults.map((patch, i) => (
                      <details key={`p-${i}`} className="rounded-lg border border-border/50 bg-muted/35 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          Patch {patch.success === false ? "failed" : "result"}
                        </summary>
                        {patch.output ? <TextBlock title="Patch output" text={patch.output} /> : null}
                      </details>
                    ))}
                    {turn.tokenEvents.length > 0 ? (
                      <div className="rounded-lg border border-border/50 bg-muted/35 p-3 text-xs">
                        <div className="mb-2 font-semibold">Token events</div>
                        <div className="space-y-1 font-mono">
                          {turn.tokenEvents.map((event, i) => (
                            <div key={`tok-${i}`}>
                              {formatTimestamp(event.timestamp)} · {event.model} · {formatNumber(event.totalTokens)} tokens
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {turn.errors.map((turnError, i) => <TextBlock key={`e-${i}`} title="Error" text={turnError} />)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="mx-auto flex h-full max-w-6xl flex-col gap-3">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => void copyRawJsonl()}>
                  <Clipboard className="mr-2 h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <pre className="min-h-[60vh] overflow-auto rounded-lg border border-border/60 bg-surface p-4 font-mono text-xs leading-relaxed text-foreground">
                {detail.rawJsonl}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
