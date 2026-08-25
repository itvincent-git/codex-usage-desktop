import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Clipboard, Clock3, Coins, Database, FileDiff, FileJson, GitBranch, Info, Loader2, MessageSquare, Terminal, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchSessionDetail, type SessionDetailRow, type SessionReplayDetail } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { SessionQuotaUsageView } from "./session-quota-usage";

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
type TokenUsageItem = Extract<ReplayItem, { kind: "tokenUsage" }>;

type TimelineEntry = {
  item: ReplayItem;
  tokenUsage?: TokenUsageItem;
};

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

function isVisibleTimelineItem(item: ReplayItem) {
  return item.kind !== "patch" || item.isError || item.success === false;
}

function timelineEntries(items: ReplayItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const item of items) {
    if (item.kind === "tokenUsage") {
      const previousEntry = entries.findLast((entry) => isVisibleTimelineItem(entry.item));
      if (previousEntry) {
        previousEntry.tokenUsage = item;
        continue;
      }
    }
    entries.push({ item });
  }

  return entries;
}

function formatCompactTokenCount(value: number) {
  if (Math.abs(value) < 1_000) return formatNumber(value);
  if (Math.abs(value) < 1_000_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return `${Number((value / 1_000_000).toFixed(1))}m`;
}

function TokenMetadata({ usage }: { usage: TokenUsageItem }) {
  const { t } = useTranslation();
  const tooltip = [
    `${t("common.model")}: ${usage.model}`,
    `${t("common.tokens")}: ${formatNumber(usage.totalTokens)}`,
    `${t("common.time")}: ${formatTimestamp(usage.timestamp)}`,
  ].join("\n");

  return (
    <span
      className="shrink-0 font-sans text-[11px] font-medium tabular-nums text-violet-500/80 dark:text-violet-300/75"
      title={tooltip}
    >
      {formatCompactTokenCount(usage.totalTokens)} tokens
    </span>
  );
}

const METRIC_TONES = {
  blue: "border-blue-300/60 bg-blue-50/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  violet: "border-violet-300/60 bg-violet-50/80 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  emerald: "border-emerald-300/60 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  cyan: "border-cyan-300/60 bg-cyan-50/80 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  amber: "border-amber-300/60 bg-amber-50/80 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  green: "border-green-300/60 bg-green-50/80 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  red: "border-red-300/60 bg-red-50/80 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
} as const;

function metric(label: string, value: string, icon: ReactNode, tone: keyof typeof METRIC_TONES) {
  return (
    <div className={`flex min-w-max items-center justify-center gap-1.5 rounded-md border px-2 py-1 ${METRIC_TONES[tone]}`}>
      <span className="shrink-0">{icon}</span>
      <span className="text-[10px] font-medium opacity-75">{label}</span>
      <span className="font-mono text-xs font-bold tabular-nums">{value}</span>
    </div>
  );
}

function AgentHierarchy({
  agents,
  activePath,
  onSelect,
}: {
  agents: SessionReplayDetail["agents"];
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  if (agents.length <= 1) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-surface p-3" aria-label={t("sessions.detail.agent_hierarchy")}>
      <div className="mb-2 flex items-center gap-2 text-sm font-bold">
        <GitBranch className="h-4 w-4 text-primary" />
        {t("sessions.detail.agent_hierarchy")}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {t("sessions.detail.agent_count", { count: agents.length })}
        </span>
      </div>
      <div className="space-y-1">
        {agents.map((agent) => {
          const isActive = agent.path === activePath;
          const name = agent.agentPath.split("/").filter(Boolean).at(-1) || "root";
          return (
            <button
              key={agent.path}
              type="button"
              className={`relative flex w-full items-center gap-2 rounded-md border py-1.5 pr-2 text-left transition ${isActive ? "border-primary/50 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground"}`}
              style={{ paddingLeft: `${8 + agent.depth * 24}px` }}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(agent.path)}
            >
              {agent.depth > 0 ? <span className="absolute top-0 bottom-1/2 w-px bg-border" style={{ left: `${agent.depth * 24 - 5}px` }} /> : null}
              <Bot className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : ""}`} />
              <span className="font-mono text-xs font-semibold text-foreground">{name}</span>
              {agent.nickname ? <span className="text-[10px]">· {agent.nickname}</span> : null}
              {agent.threadName ? <span className="min-w-0 flex-1 truncate text-xs" title={agent.threadName}>{agent.threadName}</span> : <span className="flex-1" />}
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {agent.parentSessionId ? t("sessions.detail.subagent") : t("sessions.detail.root_agent")}
              </span>
              {isActive ? <span className="shrink-0 text-[10px] font-bold text-primary">{t("sessions.detail.current_agent")}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
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

function MessageItem({ item, tokenUsage }: { item: Extract<ReplayItem, { kind: "message" }>; tokenUsage?: TokenUsageItem }) {
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
          {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
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
  const displayText = formatJsonForDisplay(text);
  return (
    <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{displayText}</pre>
    </div>
  );
}

function ToolPreview({ title, text, lines }: { title: string; text: string; lines: 1 | 5 }) {
  const displayText = formatJsonForDisplay(text);
  return (
    <div className="min-w-0 rounded-lg border border-border/50 bg-muted/35 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <pre className={`${lines === 1 ? "line-clamp-1" : "line-clamp-5"} whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground`}>
        {buildCollapsedPreview(displayText, lines)}
      </pre>
    </div>
  );
}

type PatchDiffFile = {
  path: string;
  lines: string[];
  additions: number;
  deletions: number;
};

function parsePatchDiff(patch: string): PatchDiffFile[] {
  const files: PatchDiffFile[] = [];
  let current: PatchDiffFile | null = null;

  for (const line of patch.split("\n")) {
    const fileMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      current = { path: fileMatch[1], lines: [], additions: 0, deletions: 0 };
      files.push(current);
      continue;
    }
    if (!current || line === "*** Begin Patch" || line === "*** End Patch") continue;
    current.lines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }

  return files;
}

function numberPatchLines(lines: string[]) {
  let oldLine: number | null = null;
  let newLine: number | null = null;

  return lines.map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text, lineNumber: null };
    }
    if (text.startsWith("@@")) {
      oldLine = null;
      newLine = null;
      return { text, lineNumber: null };
    }

    const lineNumber = text.startsWith("-") ? oldLine : newLine;
    if (!text.startsWith("+") && oldLine !== null) oldLine += 1;
    if (!text.startsWith("-") && newLine !== null) newLine += 1;
    return { text, lineNumber };
  });
}

function PatchDiffBlock({ patch, expanded }: { patch: string; expanded: boolean }) {
  const { t } = useTranslation();
  const files = parsePatchDiff(patch);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  if (files.length === 0) {
    return expanded
      ? <ToolTextBlock title={t("sessions.detail.patch_input")} text={patch} />
      : <ToolPreview title={t("sessions.detail.patch_input")} text={patch} lines={1} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/70 font-mono text-xs">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 font-semibold">
        <FileDiff className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{t("sessions.detail.edited_files", { count: files.length })}</span>
        <span className="text-green-600 dark:text-green-400">+{additions}</span>
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      </div>
      {expanded ? files.map((file) => (
        <section key={file.path}>
          <div className="flex items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-2 font-semibold">
            <span className="text-muted-foreground">└</span>
            <span className="min-w-0 flex-1 break-all">{file.path}</span>
            <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
            <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
          </div>
          <div className="overflow-x-auto py-1">
            {numberPatchLines(file.lines).map(({ text: line, lineNumber }, index) => {
              const isAddition = line.startsWith("+") && !line.startsWith("+++");
              const isDeletion = line.startsWith("-") && !line.startsWith("---");
              const isHunk = line.startsWith("@@");
              const tone = isAddition
                ? "bg-green-500/15 text-green-950 dark:text-green-100"
                : isDeletion
                  ? "bg-red-500/15 text-red-950 dark:text-red-100"
                  : isHunk
                    ? "text-muted-foreground"
                    : "text-foreground";
              return (
                <div key={`${index}-${line}`} className={`flex min-w-max w-full ${tone}`}>
                  <span className="w-10 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted-foreground/60">{lineNumber ?? ""}</span>
                  <span className="whitespace-pre px-3">{line || " "}</span>
                </div>
              );
            })}
          </div>
        </section>
      )) : null}
    </div>
  );
}

type ExecArguments = {
  command: string;
  workdir: string | null;
  kind: "command" | "patch";
};

type ExecOutput = {
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  wallTimeSeconds: number | null;
  sessionId: string | number | null;
};

type ToolContentBlocks = {
  text: string | null;
  images: string[];
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

function baseToolName(name: string) {
  return name.split(".").at(-1) ?? name;
}

function formatToolArgumentValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function formatJsonForDisplay(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : text;
  } catch {
    return text;
  }
}

function parseNestedToolCall(value: string, toolName: string) {
  const marker = `tools.${toolName}(`;
  const start = value.indexOf(marker);
  if (start < 0) return null;

  const objectStart = value.indexOf("{", start + marker.length);
  if (objectStart < 0) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let index = objectStart; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') inString = true;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const objectLiteral = value.slice(objectStart, index + 1);
        const parsed = parseJsonObject(objectLiteral);
        if (parsed) return parsed;

        let normalized = "";
        let normalizedInString = false;
        let normalizedIsEscaped = false;
        for (let literalIndex = 0; literalIndex < objectLiteral.length; literalIndex += 1) {
          const literalCharacter = objectLiteral[literalIndex];
          normalized += literalCharacter;

          if (normalizedInString) {
            if (normalizedIsEscaped) {
              normalizedIsEscaped = false;
            } else if (literalCharacter === "\\") {
              normalizedIsEscaped = true;
            } else if (literalCharacter === '"') {
              normalizedInString = false;
            }
            continue;
          }

          if (literalCharacter === '"') {
            normalizedInString = true;
            continue;
          }
          if (literalCharacter !== "{" && literalCharacter !== ",") continue;

          const property = objectLiteral.slice(literalIndex + 1).match(/^(\s*)([A-Za-z_$][\w$]*)(\s*:)/);
          if (!property) continue;
          normalized += `${property[1]}"${property[2]}"${property[3]}`;
          literalIndex += property[0].length;
        }

        return parseJsonObject(normalized);
      }
    }
  }

  return null;
}

function parseExecArguments(value: string | null): ExecArguments | null {
  const parsed = parseJsonObject(value) ?? (value ? parseNestedToolCall(value, "exec_command") : null);
  if (parsed) {
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
    return { command, workdir, kind: "command" };
  }

  if (!value) return null;
  const assignment = value.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*")\s*;/s);
  if (!assignment || !value.includes(`tools.apply_patch(${assignment[1]})`)) return null;

  try {
    const patch = JSON.parse(assignment[2]);
    return typeof patch === "string" ? { command: patch, workdir: null, kind: "patch" } : null;
  } catch {
    return null;
  }
}

function parseWebSearchQueries(value: string | null) {
  if (!value) return null;
  const parsed = parseNestedToolCall(value, "web__run");
  if (!parsed || !Array.isArray(parsed.search_query)) return null;

  const queries = parsed.search_query.flatMap((entry) => (
    entry && typeof entry === "object" && typeof (entry as { q?: unknown }).q === "string"
      ? [(entry as { q: string }).q]
      : []
  ));
  return queries.length > 0 ? queries : null;
}

function splitWebSearchResults(text: string) {
  return cleanExecOutput(text)
    .split(/-{10,}/)
    .map((result) => result.trim())
    .filter(Boolean);
}

type WebSearchResult = {
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string | null;
};

function parseWebSearchResultCards(value: string | null): WebSearchResult[] | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const results = parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const result = entry as Record<string, unknown>;
      if (result.type !== "text_result" || typeof result.title !== "string") return [];
      return [{
        title: result.title,
        url: typeof result.url === "string" ? result.url : null,
        domain: typeof result.domain === "string" ? result.domain : null,
        snippet: typeof result.snippet === "string" ? result.snippet : null,
      }];
    });
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function parseToolContentBlocks(value: string | null): ToolContentBlocks | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    let text = "";
    const images: string[] = [];

    for (const block of parsed) {
      if (block === null || typeof block !== "object") return null;
      const content = block as Record<string, unknown>;
      if (typeof content.text === "string") {
        text += content.text;
      } else if (typeof content.image_url === "string") {
        images.push(content.image_url);
      } else {
        return null;
      }
    }

    return text || images.length > 0 ? { text: text || null, images } : null;
  } catch {
    return null;
  }
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

function cleanExecOutput(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^Script (?:running with cell ID .+|completed)$/.test(line)
      && !/^(?:Wall|Wait) time [^\r\n]+$/.test(line)
      && !/^Process (?:exited with code -?\d+|stopped with signal SIG[A-Z]+)$/.test(line)
      && line !== "Output:")
    .join("\n")
    .trim();
}

function isEmptyExecOutput(text: string | null) {
  if (!text) return true;
  const cleaned = cleanExecOutput(text).trim();
  return cleaned === "" || cleaned === "{}";
}

type UserInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: Array<{ label: string; description: string }>;
};

function formatActivityDuration(ms: number | null) {
  if (ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function processExitCode(output: string | null, isError: boolean) {
  if (output) {
    const match = output.match(/(?:"exit_code"\s*:\s*|exit code:\s*|process exited with code\s+)(-?\d+)/i);
    if (match) return Number(match[1]);
  }
  return isError ? 1 : 0;
}

function processSignal(output: string | null) {
  return output?.match(/Process stopped with signal (SIG[A-Z]+)/)?.[1] ?? null;
}

function ActivityOutput({ text, expanded, tone }: { text: string; expanded: boolean; tone: string }) {
  const lines = (expanded ? text : buildCollapsedPreview(text, 5)).split("\n");
  return (
    <pre className={`mt-1 whitespace-pre-wrap break-words pl-2 ${tone}`}>
      {lines.map((line, index) => (
        <span key={`${index}-${line}`} className="block">
          {index === lines.length - 1 ? "└" : "│"} {line}
        </span>
      ))}
    </pre>
  );
}

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

function UserInputItem({ item, questions, tokenUsage }: { item: Extract<ReplayItem, { kind: "toolCall" }>; questions: UserInputQuestion[]; tokenUsage?: TokenUsageItem }) {
  const { t } = useTranslation();
  const answers = parseUserInputAnswers(item.output);

  return (
    <div className={`rounded-lg border p-3 ${ITEM_TONES.tool}`}>
      <div className={`flex items-center justify-between gap-3 text-xs font-semibold ${ITEM_TITLE_TONES.tool}`}>
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span>{t("sessions.detail.user_input_request")}</span>
        </span>
        {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
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

function WebSearchItem({
  item,
  queries,
  structuredResults,
  tokenUsage,
}: {
  item: Extract<ReplayItem, { kind: "toolCall" }>;
  queries: string[];
  structuredResults: WebSearchResult[] | null;
  tokenUsage?: TokenUsageItem;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const contentBlocks = parseToolContentBlocks(item.output);
  const output = contentBlocks?.text ?? item.output;
  const results = output ? splitWebSearchResults(output) : [];

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
          <span className="truncate">{t("sessions.detail.web_search")} {item.status ? `· ${item.status}` : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
          <span className="flex items-center gap-1">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
          </span>
        </span>
      </button>
      <div className="mt-3 space-y-2">
        {queries.length > 0 ? (
          <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("sessions.detail.search_queries")}</div>
            <ul className="space-y-1 font-mono text-xs leading-relaxed text-foreground">
              {queries.map((query, index) => <li key={`${index}-${query}`} className="break-words">• {query}</li>)}
            </ul>
          </div>
        ) : null}
        {structuredResults ? (
          <div className="space-y-2">
            {structuredResults.map((result, index) => (
              <article key={`${index}-${result.url ?? result.title}`} className="rounded-lg border border-border/50 bg-muted/35 p-3">
                {result.url ? (
                  <a href={result.url} target="_blank" rel="noreferrer" className="block break-words text-sm font-semibold text-primary hover:underline">{result.title}</a>
                ) : <div className="break-words text-sm font-semibold text-foreground">{result.title}</div>}
                {result.domain ? <div className="mt-1 text-xs text-muted-foreground">{result.domain}</div> : null}
                {result.snippet ? <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground ${isExpanded ? "" : "line-clamp-3"}`}>{result.snippet}</p> : null}
              </article>
            ))}
          </div>
        ) : results.length > 0 ? isExpanded ? (
          <div className="space-y-2">
            {results.map((result, index) => (
              <ToolTextBlock key={`${index}-${result.slice(0, 80)}`} title={t("sessions.detail.search_result", { index: index + 1 })} text={result} />
            ))}
          </div>
        ) : (
          <ToolPreview title={t("sessions.detail.output")} text={results.join("\n\n")} lines={5} />
        ) : null}
      </div>
    </div>
  );
}

function ToolCallItem({ item, tokenUsage }: { item: Extract<ReplayItem, { kind: "toolCall" }>; tokenUsage?: TokenUsageItem }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const outerToolName = baseToolName(item.name);
  const nestedWriteStdinArguments = EXEC_TOOL_NAMES.has(outerToolName) && item.arguments
    ? parseNestedToolCall(item.arguments, "write_stdin")
    : null;
  const toolName = nestedWriteStdinArguments ? "write_stdin" : outerToolName;
  const userInputQuestions = toolName === "request_user_input" ? parseUserInputQuestions(item.arguments) : null;
  const isExec = EXEC_TOOL_NAMES.has(outerToolName);
  const webSearchQueries = isExec ? parseWebSearchQueries(item.arguments) : null;
  const webSearchResults = parseWebSearchResultCards(item.output);
  const execArguments = isExec ? parseExecArguments(item.arguments) : null;
  const parsedArguments = nestedWriteStdinArguments ?? parseJsonObject(item.arguments);
  const argumentEntries = parsedArguments
    ? Object.entries(parsedArguments).filter(([key]) => !execArguments || !["cmd", "command", "workdir", "cwd"].includes(key))
    : [];
  const execOutput = isExec ? parseExecOutput(item.output) ?? parseExecOutput(item.output ? cleanExecOutput(item.output) : null) : null;
  const contentBlocks = parseToolContentBlocks(item.output);
  const argumentsText = execArguments?.command ?? (parsedArguments ? null : item.arguments);
  const argumentsTitle = execArguments?.kind === "patch"
    ? t("sessions.detail.patch_input")
    : t(execArguments ? "sessions.detail.command" : "sessions.detail.arguments");
  const rawOutputText = contentBlocks ? contentBlocks.text : execOutput?.stdout ?? (execOutput ? null : item.output);
  const outputText = isExec && isEmptyExecOutput(rawOutputText) ? null : rawOutputText;
  const stderrText = execOutput?.stderr ?? item.stderr;

  if (userInputQuestions) {
    return <UserInputItem item={item} questions={userInputQuestions} tokenUsage={tokenUsage} />;
  }

  if (webSearchQueries || (outerToolName === "web_search" && webSearchResults)) {
    return <WebSearchItem item={item} queries={webSearchQueries ?? []} structuredResults={webSearchResults} tokenUsage={tokenUsage} />;
  }

  if (execArguments?.kind === "command") {
    const commandOutput = outputText ? cleanExecOutput(outputText) : null;
    const activityStatus = item.status === "stopped"
      ? "stopped"
      : item.isError
        ? "failed"
        : item.status === "running"
          ? "running"
          : "success";
    const duration = formatActivityDuration(item.durationMs);
    const exitCode = processExitCode(item.output, item.isError);
    const signal = processSignal(item.output);
    const statusTone = activityStatus === "failed"
      ? "text-error"
      : activityStatus === "success"
        ? "text-emerald-700 dark:text-emerald-300"
        : activityStatus === "stopped"
          ? "text-amber-700 dark:text-amber-300"
          : "text-foreground";
    const outputTone = activityStatus === "failed" ? "text-error" : "text-muted-foreground";
    return (
      <div className={`rounded-lg border p-3 font-mono text-xs leading-relaxed ${item.isError ? ITEM_TONES.error : ITEM_TONES.tool}`}>
        <button
          type="button"
          className={`flex w-full min-w-0 items-start justify-between gap-3 text-left text-foreground ${DISCLOSURE_BUTTON_CLASS}`}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <span className="flex min-w-0 gap-1.5">
            <span className={`shrink-0 ${statusTone}`}>•</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {activityStatus === "running"
                ? t("sessions.detail.activity_running")
                : activityStatus === "stopped"
                  ? t("sessions.detail.activity_stopped")
                  : t("sessions.detail.activity_ran")}
              {duration || activityStatus !== "running" ? " (" : " "}
              {duration}
              {duration && activityStatus !== "running" && (activityStatus !== "stopped" || signal) ? ", " : null}
              {activityStatus === "stopped" ? signal : activityStatus !== "running" ? (
                <span className={statusTone} title={t(exitCode === 0 ? "sessions.detail.exit_success_tooltip" : "sessions.detail.exit_failure_tooltip")}>exit {exitCode}</span>
              ) : null}
              {duration || activityStatus !== "running" ? ") " : null}
              {isExpanded ? execArguments.command : buildCollapsedPreview(execArguments.command, 1)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3 font-sans text-muted-foreground">
            {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
            <span className="flex items-center gap-1">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
            </span>
          </span>
        </button>
        {commandOutput ? <ActivityOutput text={commandOutput} expanded={isExpanded} tone={outputTone} /> : null}
        {stderrText ? (
          <ActivityOutput text={stderrText} expanded={isExpanded} tone="text-error" />
        ) : null}
      </div>
    );
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
          <span className="truncate">{nestedWriteStdinArguments ? toolName : item.name} {item.status ? `· ${item.status}` : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
          <span className="flex items-center gap-1">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
          </span>
        </span>
      </button>
      <div className="mt-3 space-y-2">
        {argumentsText ? (
          execArguments?.kind === "patch"
            ? <PatchDiffBlock patch={argumentsText} expanded={isExpanded} />
            : isExpanded
              ? <ToolTextBlock title={argumentsTitle} text={argumentsText} />
              : <ToolPreview title={argumentsTitle} text={argumentsText} lines={1} />
        ) : null}
        {argumentEntries.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {argumentEntries.map(([key, value]) => (
              <div key={key} className="min-w-0 rounded-md border border-cyan-300/50 bg-cyan-50/60 px-3 py-2 dark:border-cyan-800/50 dark:bg-cyan-950/25">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-700 dark:text-cyan-300">
                  {t(`sessions.detail.tool_argument_labels.${key}`, { defaultValue: key.replaceAll("_", " ") })}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                  {formatToolArgumentValue(value)}
                </pre>
              </div>
            ))}
          </div>
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
        {contentBlocks?.images.length ? (
          <div className="rounded-lg border border-border/50 bg-muted/35 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("sessions.detail.image_count", { count: contentBlocks.images.length })}
            </div>
            {isExpanded ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {contentBlocks.images.map((imageUrl, index) => (
                  <img
                    key={`${item.callId ?? item.name}-${index}`}
                    src={imageUrl}
                    alt={t("sessions.detail.output_image", { index: index + 1 })}
                    loading="lazy"
                    className="max-h-80 w-full rounded-md border border-border/60 bg-background object-contain"
                  />
                ))}
              </div>
            ) : null}
          </div>
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

function PatchItem({ item, tokenUsage }: { item: Extract<ReplayItem, { kind: "patch" }>; tokenUsage?: TokenUsageItem }) {
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
        <span className="flex shrink-0 items-center gap-3">
          {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
          <span className="flex items-center gap-1">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {isExpanded ? t("sessions.detail.collapse") : t("sessions.detail.expand")}
          </span>
        </span>
      </button>
      {isExpanded && item.output ? <div className="mt-3"><TextBlock title={t("sessions.detail.patch_output")} text={item.output} /></div> : null}
    </div>
  );
}

function TimelineItem({ item, tokenUsage }: TimelineEntry) {
  const { t } = useTranslation();

  if (item.kind === "message") {
    return <MessageItem item={item} tokenUsage={tokenUsage} />;
  }

  if (item.kind === "reasoning") {
    return (
      <div className={`rounded-lg border p-3 ${ITEM_TONES.reasoning}`}>
        {tokenUsage ? <div className="mb-1 flex justify-end"><TokenMetadata usage={tokenUsage} /></div> : null}
        <TextBlock title={t("sessions.detail.reasoning_summary")} text={item.text} titleClassName={ITEM_TITLE_TONES.reasoning} />
      </div>
    );
  }

  if (item.kind === "toolCall") {
    return <ToolCallItem item={item} tokenUsage={tokenUsage} />;
  }

  if (item.kind === "patch") {
    return item.isError || item.success === false ? <PatchItem item={item} tokenUsage={tokenUsage} /> : null;
  }

  if (item.kind === "tokenUsage") {
    return (
      <div className="flex justify-end px-3 py-0.5">
        <TokenMetadata usage={item} />
      </div>
    );
  }

  if (item.kind === "error") {
    return <div className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${ITEM_TONES.error} ${ITEM_TITLE_TONES.error}`}><span>{item.text}</span>{tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}</div>;
  }

  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${ITEM_TONES.notice} ${ITEM_TITLE_TONES.notice}`}>
      <span>{item.label}{item.text ? ` · ${item.text}` : ""}</span>
      {tokenUsage ? <TokenMetadata usage={tokenUsage} /> : null}
    </div>
  );
}

export function SessionDetailModal({ session, onClose }: SessionDetailModalProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<SessionReplayDetail | null>(null);
  const [activePath, setActivePath] = useState(session.path);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [copied, setCopied] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => new Set());
  const [showFullRaw, setShowFullRaw] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setActivePath(session.path);
  }, [session.path]);

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
    setShowDetails(false);
    setIsScrolled(false);

    void fetchSessionDetail(activePath)
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
  }, [activePath]);

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
        <header className={`z-10 border-b border-border/70 bg-surface px-4 shadow-sm transition-[padding] ${isScrolled ? "py-1" : "py-1.5"}`}>
          <div className="flex min-h-8 items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <FileJson className="h-4 w-4 text-primary" />
                <h2 id="session-detail-title" className={`mr-1 min-w-0 truncate font-bold tracking-tight transition-[font-size] ${isScrolled ? "text-sm" : "text-base"}`}>
                  {threadName || cleanSessionId(session.sessionId)}
                </h2>
              </div>
            </div>
            <button
              type="button"
              className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground ${DISCLOSURE_BUTTON_CLASS}`}
              aria-expanded={showDetails}
              onClick={() => setShowDetails((value) => !value)}
            >
              <Info className="h-3.5 w-3.5" />
              {t("sessions.detail.details")}
              {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <nav className="flex shrink-0 items-center rounded-md bg-muted/70 p-0.5">
              <button type="button" onClick={() => setActiveTab("timeline")} className={`rounded px-2 py-1 text-xs font-semibold transition ${activeTab === "timeline" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t("sessions.detail.timeline")}
              </button>
              <button type="button" onClick={() => setActiveTab("raw")} className={`rounded px-2 py-1 text-xs font-semibold transition ${activeTab === "raw" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t("sessions.detail.raw_jsonl")}
              </button>
            </nav>
            <Button ref={closeButtonRef} variant="secondary" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label={t("sessions.detail.close_aria")}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-1 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {metric(t("sessions.detail.duration"), formatDuration(detail?.summary.durationMs), <Clock3 className="h-3.5 w-3.5" />, "blue")}
            {metric(t("sessions.detail.total_tokens"), formatNumber(detail?.summary.totalTokens ?? session.totalTokens), <Database className="h-3.5 w-3.5" />, "violet")}
            {metric(t("sessions.detail.cost"), formatCurrency(detail?.summary.costUSD ?? session.costUSD), <Coins className="h-3.5 w-3.5" />, "emerald")}
            {metric(t("sessions.detail.cache"), formatPercent(cacheRate), <Database className="h-3.5 w-3.5" />, "cyan")}
            {metric(t("sessions.detail.tool_calls"), formatNumber(detail?.summary.toolCallCount ?? 0), <Wrench className="h-3.5 w-3.5" />, "amber")}
            {metric(t("sessions.detail.patches"), formatNumber(detail?.summary.patchCount ?? 0), <FileDiff className="h-3.5 w-3.5" />, "green")}
            {metric(t("sessions.detail.errors"), formatNumber(detail?.summary.errorCount ?? 0), <AlertTriangle className="h-3.5 w-3.5" />, "red")}
          </div>
          {showDetails ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
              {threadName ? <span className="max-w-[260px] truncate rounded border border-zinc-300/70 bg-zinc-100/80 px-2 py-0.5 font-mono text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" title={session.sessionId}>{cleanSessionId(session.sessionId)}</span> : null}
              {projects.map((project) => <span key={project} className="max-w-[360px] truncate rounded border border-blue-300/60 bg-blue-50/80 px-2 py-0.5 font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300" title={project}>{project}</span>)}
              {models.map((model) => <span key={model} className="rounded-full border border-emerald-300/60 bg-emerald-50/80 px-2 py-0.5 font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{model}</span>)}
              <span>{t("sessions.detail.started", { value: formatTimestamp(detail?.summary.startTime ?? null) })}</span>
              <span>·</span>
              <span>{t("sessions.detail.ended", { value: formatTimestamp(detail?.summary.endTime ?? null) })}</span>
              <span>·</span>
              <span>{t("sessions.detail.first_token", { value: formatDuration(detail?.summary.timeToFirstTokenMs) })}</span>
              <span>·</span>
              <span>{t("sessions.detail.cli", { value: detail?.summary.cliVersion ?? "--" })}</span>
            </div>
          ) : null}
        </header>

        <div
          data-testid="session-detail-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-3"
          onScroll={(event) => {
            const nextIsScrolled = event.currentTarget.scrollTop > 12;
            setIsScrolled((current) => current === nextIsScrolled ? current : nextIsScrolled);
          }}
        >
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
            <div className="mx-auto max-w-6xl space-y-2.5">
              <AgentHierarchy agents={detail.agents ?? []} activePath={detail.path} onSelect={setActivePath} />
              {activePath === session.path ? <SessionQuotaUsageView usage={session.quotaUsage} detailed /> : null}
              {detail.turns.map((turn, index) => {
                const turnKey = `${turn.turnId}-${index}`;
                const isExpanded = expandedTurns.has(turnKey);
                const userPreview = firstUserPreview(turn);
                return (
                <section key={turnKey} className="rounded-lg border border-border/60 bg-surface px-3 py-2.5">
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1.5 rounded-md text-left sm:flex-row sm:items-center sm:justify-between ${DISCLOSURE_BUTTON_CLASS}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleTurn(turnKey)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        {t("sessions.detail.turn", { id: turn.turnId })}
                      </div>
                      {userPreview ? (
                        <div className="mt-1 truncate text-xs text-muted-foreground">{userPreview}</div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
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
                  <div className="relative mt-2 ml-1 space-y-2 border-l-2 border-border/70 pl-4 before:absolute before:-left-[5px] before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-primary">
                    {timelineEntries(orderedItems(turn)).map((entry, itemIndex) => (
                      <TimelineItem key={`${entry.item.kind}-${itemIndex}`} {...entry} />
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
