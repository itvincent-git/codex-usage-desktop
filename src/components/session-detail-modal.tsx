import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Clipboard, FileJson, Loader2, MessageSquare, Terminal, X } from "lucide-react";
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
const RAW_PREVIEW_LINES = 12;
const RAW_PREVIEW_LINE_LENGTH = 240;
const COLLAPSED_PREVIEW_LINE_LENGTH = 240;
const DISCLOSURE_BUTTON_CLASS = "rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const EXEC_TOOL_NAMES = new Set(["exec", "exec_command"]);

const ITEM_TONES = {
  system: "border-zinc-300/70 bg-zinc-100/60 dark:border-zinc-700/70 dark:bg-zinc-900/40",
  developer: "border-violet-300/70 bg-violet-50/70 dark:border-violet-800/70 dark:bg-violet-950/30",
  user: "border-blue-300/70 bg-blue-50/70 dark:border-blue-800/70 dark:bg-blue-950/30",
  assistant: "border-emerald-300/70 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/30",
  reasoning: "border-amber-300/70 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/30",
  tool: "border-cyan-300/70 bg-cyan-50/70 dark:border-cyan-800/70 dark:bg-cyan-950/30",
  patch: "border-green-300/70 bg-green-50/70 dark:border-green-800/70 dark:bg-green-950/30",
  token: "border-fuchsia-300/70 bg-fuchsia-50/70 dark:border-fuchsia-800/70 dark:bg-fuchsia-950/30",
  error: "border-error/40 bg-error/5",
  notice: "border-sky-300/70 bg-sky-50/70 dark:border-sky-800/70 dark:bg-sky-950/30",
} as const;

const ITEM_TITLE_TONES = {
  system: "text-zinc-600 dark:text-zinc-300",
  developer: "text-violet-700 dark:text-violet-300",
  user: "text-blue-700 dark:text-blue-300",
  assistant: "text-emerald-700 dark:text-emerald-300",
  reasoning: "text-amber-700 dark:text-amber-300",
  tool: "text-cyan-700 dark:text-cyan-300",
  patch: "text-green-700 dark:text-green-300",
  token: "text-fuchsia-700 dark:text-fuchsia-300",
  error: "text-error",
  notice: "text-sky-700 dark:text-sky-300",
} as const;

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

function buildRawPreview(rawJsonl: string) {
  return rawJsonl
    .split("\n")
    .slice(0, RAW_PREVIEW_LINES)
    .map((line) => (line.length > RAW_PREVIEW_LINE_LENGTH ? `${line.slice(0, RAW_PREVIEW_LINE_LENGTH)}...` : line))
    .join("\n");
}

function buildCollapsedPreview(text: string, lines: number) {
  const preview = text.split("\n").slice(0, lines).join("\n");
  const maxLength = lines * COLLAPSED_PREVIEW_LINE_LENGTH;
  const isTruncated = preview.length < text.length || preview.length > maxLength;
  return isTruncated ? `${preview.slice(0, maxLength)}...` : preview;
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

type ReplayItem = SessionReplayDetail["turns"][number]["items"][number];

function orderedItems(turn: SessionReplayDetail["turns"][number]): ReplayItem[] {
  if (turn.items?.length) return turn.items;
  return [
    ...turn.systemMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "system", source: message.kind, text: message.text })),
    ...turn.userMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "user", source: message.kind, text: message.text })),
    ...turn.assistantMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "assistant", source: message.kind, text: message.text })),
    ...turn.reasoningSummaries.map((message) => ({ kind: "reasoning" as const, timestamp: message.timestamp, text: message.text })),
    ...turn.toolCalls.map((tool) => ({ kind: "toolCall" as const, ...tool })),
    ...turn.patchResults.map((patch) => ({ kind: "patch" as const, ...patch })),
    ...turn.tokenEvents.map((usage) => ({ kind: "tokenUsage" as const, ...usage })),
    ...turn.errors.map((text) => ({ kind: "error" as const, timestamp: null, text })),
  ];
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
  titleClassName = "text-muted-foreground",
}: {
  title: string;
  text: string;
  defaultCollapsed?: boolean;
  titleClassName?: string;
}) {
  const { t } = useTranslation();
  const [isFullVisible, setIsFullVisible] = useState(!defaultCollapsed && text.length <= LONG_TEXT_THRESHOLD);
  const isLong = text.length > LONG_TEXT_THRESHOLD;
  const preview = isLong ? `${text.slice(0, TEXT_PREVIEW_LENGTH)}...` : text;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${titleClassName}`}>{title}</div>
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

function MessageItem({ item }: { item: Extract<ReplayItem, { kind: "message" }> }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const title = item.role === "user"
    ? t("sessions.detail.user")
    : item.role === "assistant"
      ? t("sessions.detail.assistant")
      : item.role === "developer"
        ? t("sessions.detail.developer")
        : t("sessions.detail.system");
  const previewLines = item.role === "user" || item.role === "assistant" ? 10 : 3;
  const previewClass = previewLines === 10 ? "line-clamp-[10]" : "line-clamp-3";
  const toneKey = item.role === "user" || item.role === "assistant" || item.role === "developer" ? item.role : "system";

  return (
    <div className={`rounded-lg border p-3 ${ITEM_TONES[toneKey]}`}>
      <button
        type="button"
        className={`mb-2 flex w-full items-center justify-between gap-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] ${ITEM_TITLE_TONES[toneKey]} ${DISCLOSURE_BUTTON_CLASS}`}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <span>{title}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono normal-case tracking-normal text-muted-foreground">{formatTimestamp(item.timestamp)}</span>
          <span className="flex items-center gap-1 normal-case tracking-normal">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
          </span>
        </span>
      </button>
      <pre className={`${isExpanded ? "" : previewClass} rounded-md border border-border/50 bg-muted/35 p-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground`}>
        {isExpanded ? item.text : buildCollapsedPreview(item.text, previewLines)}
      </pre>
    </div>
  );
}

function ToolTextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{text}</pre>
    </div>
  );
}

function ToolPreview({ title, text, lines }: { title: string; text: string; lines: 1 | 5 }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <pre className={`${lines === 1 ? "line-clamp-1" : "line-clamp-5"} whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground`}>
        {buildCollapsedPreview(text, lines)}
      </pre>
    </div>
  );
}

type ExecArguments = {
  command: string;
  workdir: string | null;
};

type ExecOutput = {
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  wallTimeSeconds: number | null;
  sessionId: string | number | null;
};

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseExecArguments(value: string | null): ExecArguments | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;

  const command = typeof parsed.cmd === "string"
    ? parsed.cmd
    : typeof parsed.command === "string"
      ? parsed.command
      : null;
  if (!command) return null;

  const workdir = typeof parsed.workdir === "string"
    ? parsed.workdir
    : typeof parsed.cwd === "string"
      ? parsed.cwd
      : null;
  return { command, workdir };
}

function parseExecOutput(value: string | null): ExecOutput | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;

  const stdout = typeof parsed.output === "string"
    ? parsed.output
    : typeof parsed.stdout === "string"
      ? parsed.stdout
      : null;
  const stderr = typeof parsed.stderr === "string" ? parsed.stderr : null;
  const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code : null;
  const wallTimeSeconds = typeof parsed.wall_time_seconds === "number" ? parsed.wall_time_seconds : null;
  const sessionId = typeof parsed.session_id === "string" || typeof parsed.session_id === "number"
    ? parsed.session_id
    : null;

  return stdout !== null || stderr !== null || exitCode !== null || wallTimeSeconds !== null || sessionId !== null
    ? { stdout, stderr, exitCode, wallTimeSeconds, sessionId }
    : null;
}

type UserInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: Array<{ label: string; description: string }>;
};

function parseUserInputQuestions(argumentsJson: string | null): UserInputQuestion[] | null {
  if (!argumentsJson) return null;

  try {
    const parsed = JSON.parse(argumentsJson) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return null;

    const questions = parsed.questions.filter((question): question is UserInputQuestion => {
      if (!question || typeof question !== "object") return false;
      const value = question as Partial<UserInputQuestion>;
      return typeof value.header === "string"
        && typeof value.id === "string"
        && typeof value.question === "string"
        && Array.isArray(value.options)
        && value.options.every((option) => option
          && typeof option === "object"
          && typeof option.label === "string"
          && typeof option.description === "string");
    });

    return questions.length > 0 ? questions : null;
  } catch {
    return null;
  }
}

function parseUserInputAnswers(outputJson: string | null): Record<string, string[]> {
  if (!outputJson) return {};

  try {
    const parsed = JSON.parse(outputJson) as { answers?: Record<string, { answers?: unknown }> };
    if (!parsed.answers || typeof parsed.answers !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.answers).flatMap(([id, answer]) => (
      Array.isArray(answer?.answers) && answer.answers.every((value) => typeof value === "string")
        ? [[id, answer.answers]]
        : []
    )));
  } catch {
    return {};
  }
}

function UserInputItem({ item, questions }: { item: Extract<ReplayItem, { kind: "toolCall" }>; questions: UserInputQuestion[] }) {
  const { t } = useTranslation();
  const answers = parseUserInputAnswers(item.output);

  return (
    <div className={`rounded-lg border p-3 ${ITEM_TONES.tool}`}>
      <div className={`flex items-center gap-1 text-xs font-semibold ${ITEM_TITLE_TONES.tool}`}>
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span>{t("sessions.detail.user_input_request")}</span>
      </div>
      <div className="mt-3 space-y-3">
        {questions.map((question) => {
          const selectedAnswers = answers[question.id] ?? [];
          const customAnswers = selectedAnswers.filter((answer) => !question.options.some((option) => option.label === answer));

          return (
            <section key={question.id} className="rounded-lg border border-border/50 bg-muted/35 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{question.header}</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{question.question}</div>
              <ol className="mt-3 space-y-2">
                {question.options.map((option, index) => {
                  const isSelected = selectedAnswers.includes(option.label);
                  return (
                    <li
                      key={`${question.id}-${option.label}`}
                      className={`flex gap-3 rounded-md border px-3 py-2 ${isSelected ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/60"}`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
                        {isSelected ? <Check className="h-3 w-3" /> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {customAnswers.map((answer) => (
                <div key={answer} className="mt-2 flex gap-3 rounded-md border border-primary/50 bg-primary/10 px-3 py-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("sessions.detail.custom_answer")}</span>
                    <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm text-foreground">{answer}</span>
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ToolCallItem({ item }: { item: Extract<ReplayItem, { kind: "toolCall" }> }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const userInputQuestions = item.name === "request_user_input" ? parseUserInputQuestions(item.arguments) : null;
  const isExec = EXEC_TOOL_NAMES.has(item.name);
  const execArguments = isExec ? parseExecArguments(item.arguments) : null;
  const execOutput = isExec ? parseExecOutput(item.output) : null;
  const argumentsText = execArguments?.command ?? item.arguments;
  const outputText = execOutput?.stdout ?? (execOutput ? null : item.output);
  const stderrText = execOutput?.stderr ?? item.stderr;

  if (userInputQuestions) {
    return <UserInputItem item={item} questions={userInputQuestions} />;
  }

  return (
    <div className={`rounded-lg border p-3 ${item.isError ? ITEM_TONES.error : ITEM_TONES.tool}`}>
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-3 text-left text-xs font-semibold ${item.isError ? ITEM_TITLE_TONES.error : ITEM_TITLE_TONES.tool} ${DISCLOSURE_BUTTON_CLASS}`}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-1">
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{item.name} {item.status ? `· ${item.status}` : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
        </span>
      </button>
      <div className="mt-3 space-y-2">
        {argumentsText ? (
          isExpanded
            ? <ToolTextBlock title={t(execArguments ? "sessions.detail.command" : "sessions.detail.arguments")} text={argumentsText} />
            : <ToolPreview title={t(execArguments ? "sessions.detail.command" : "sessions.detail.arguments")} text={argumentsText} lines={1} />
        ) : null}
        {execArguments?.workdir ? (
          <div className="rounded-md border border-border/50 bg-muted/35 px-3 py-2 text-xs">
            <span className="font-semibold text-muted-foreground">{t("sessions.detail.working_directory")}: </span>
            <span className="break-all font-mono text-foreground">{execArguments.workdir}</span>
          </div>
        ) : null}
        {execOutput && (execOutput.exitCode !== null || execOutput.wallTimeSeconds !== null || execOutput.sessionId !== null) ? (
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {execOutput.exitCode !== null ? <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">{t("sessions.detail.exit_code")}: {execOutput.exitCode}</span> : null}
            {execOutput.wallTimeSeconds !== null ? <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">{t("sessions.detail.wall_time")}: {execOutput.wallTimeSeconds}s</span> : null}
            {execOutput.sessionId !== null ? <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">{t("sessions.detail.process_session")}: {execOutput.sessionId}</span> : null}
          </div>
        ) : null}
        {outputText ? (
          isExpanded
            ? <ToolTextBlock title={t("sessions.detail.output")} text={outputText} />
            : <ToolPreview title={t("sessions.detail.output")} text={outputText} lines={5} />
        ) : null}
        {stderrText ? (
          isExpanded
            ? <ToolTextBlock title={t("sessions.detail.stderr")} text={stderrText} />
            : <ToolPreview title={t("sessions.detail.stderr")} text={stderrText} lines={5} />
        ) : null}
      </div>
    </div>
  );
}

function PatchItem({ item }: { item: Extract<ReplayItem, { kind: "patch" }> }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const isError = item.isError || item.success === false;

  return (
    <div className={`rounded-lg border p-3 ${isError ? ITEM_TONES.error : ITEM_TONES.patch}`}>
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-3 text-left text-xs font-semibold ${isError ? ITEM_TITLE_TONES.error : ITEM_TITLE_TONES.patch} ${DISCLOSURE_BUTTON_CLASS}`}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <span>{item.success === false ? t("sessions.detail.patch_failed") : t("sessions.detail.patch_result")}</span>
        <span className="flex shrink-0 items-center gap-1">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
        </span>
      </button>
      {isExpanded && item.output ? <div className="mt-3"><TextBlock title={t("sessions.detail.patch_output")} text={item.output} /></div> : null}
    </div>
  );
}

function TimelineItem({ item }: { item: ReplayItem }) {
  const { t } = useTranslation();

  if (item.kind === "message") {
    return <MessageItem item={item} />;
  }

  if (item.kind === "reasoning") {
    return (
      <div className={`rounded-lg border p-3 ${ITEM_TONES.reasoning}`}>
        <TextBlock title={t("sessions.detail.reasoning_summary")} text={item.text} titleClassName={ITEM_TITLE_TONES.reasoning} />
      </div>
    );
  }

  if (item.kind === "toolCall") {
    return <ToolCallItem item={item} />;
  }

  if (item.kind === "patch") {
    return <PatchItem item={item} />;
  }

  if (item.kind === "tokenUsage") {
    return (
      <div className={`rounded-lg border px-3 py-2 font-mono text-[11px] ${ITEM_TONES.token} ${ITEM_TITLE_TONES.token}`}>
        {formatTimestamp(item.timestamp)} · {item.model} · {t("sessions.detail.tokens_count", { value: formatNumber(item.totalTokens) })}
      </div>
    );
  }

  if (item.kind === "error") {
    return <div className={`rounded-lg border p-3 text-sm ${ITEM_TONES.error} ${ITEM_TITLE_TONES.error}`}>{item.text}</div>;
  }

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${ITEM_TONES.notice} ${ITEM_TITLE_TONES.notice}`}>
      {item.label}{item.text ? ` · ${item.text}` : ""}
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
        if (!cancelled) {
          setDetail(data);
          setExpandedTurns(new Set(data.turns.map((turn, index) => `${turn.turnId}-${index}`)));
        }
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
  const threadName = detail ? detail.threadName : session.threadName;
  const rawPreview = detail ? buildRawPreview(detail.rawJsonl) : "";

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
                  {threadName || cleanSessionId(session.sessionId)}
                </h2>
              </div>
              {threadName ? (
                <p className="truncate font-mono text-xs text-muted-foreground" title={session.sessionId}>
                  {cleanSessionId(session.sessionId)}
                </p>
              ) : null}
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
                    className={`flex w-full flex-col gap-3 rounded-md text-left sm:flex-row sm:items-start sm:justify-between ${DISCLOSURE_BUTTON_CLASS}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleTurn(turnKey)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-bold">
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
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatTimestamp(turn.startedAt)} · {formatDuration(turn.durationMs)}</span>
                      <span className="flex items-center gap-1 font-semibold text-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
                      </span>
                    </div>
                  </button>
                  {isExpanded ? (
                  <div className="mt-3 space-y-3">
                    {orderedItems(turn).map((item, itemIndex) => (
                      <TimelineItem key={`${item.kind}-${itemIndex}`} item={item} />
                    ))}
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
                <div className="flex flex-wrap items-center gap-2">
                  {!showFullRaw && detail.rawJsonl !== rawPreview ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowFullRaw(true)}>
                      {t("sessions.detail.show_full_raw")}
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={() => void copyRawJsonl()}>
                    <Clipboard className="mr-2 h-4 w-4" />
                    {copied ? t("sessions.detail.copied") : t("sessions.detail.copy")}
                  </Button>
                </div>
              </div>
              <pre className="min-h-[60vh] overflow-auto rounded-lg border border-border/60 bg-surface p-4 font-mono text-xs leading-relaxed text-foreground">
                {showFullRaw ? detail.rawJsonl : rawPreview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
