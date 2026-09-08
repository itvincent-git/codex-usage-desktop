import type { SessionReplayDetail } from "./api";

const EXEC_TOOL_NAMES = new Set(["exec", "exec_command"]);

export type ReplayItem = SessionReplayDetail["turns"][number]["items"][number];
export type TokenUsageItem = Extract<ReplayItem, { kind: "tokenUsage" }>;

export type TimelineEntry = {
  item: ReplayItem;
  tokenUsage?: TokenUsageItem;
  activity?: ToolActivity;
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
    entries.push({ item, activity: item.kind === "toolCall" ? buildToolActivity(item) : undefined });
  }

  return entries;
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
  texts: string[];
  images: string[];
};

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`, "g");

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

export function formatToolArgumentValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export function formatJsonForDisplay(text: string) {
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

function parseNestedToolCalls(value: string, toolName: string) {
  const marker = `tools.${toolName}(`;
  const calls: Record<string, unknown>[] = [];
  let start = 0;
  while ((start = value.indexOf(marker, start)) >= 0) {
    const parsed = parseNestedToolCall(value.slice(start), toolName);
    if (parsed) calls.push(parsed);
    start += marker.length;
  }
  return calls;
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

function parseExecArgumentList(value: string | null): ExecArguments[] {
  if (!value) return [];
  const calls = parseNestedToolCalls(value, "exec_command");
  return calls.flatMap((parsed) => {
    const command = typeof parsed.cmd === "string"
      ? parsed.cmd
      : typeof parsed.command === "string"
        ? parsed.command
        : null;
    if (!command) return [];
    const workdir = typeof parsed.workdir === "string"
      ? parsed.workdir
      : typeof parsed.cwd === "string"
        ? parsed.cwd
        : null;
    return [{ command, workdir, kind: "command" as const }];
  });
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

export function splitWebSearchResults(text: string) {
  return cleanExecOutput(text)
    .split(/-{10,}/)
    .map((result) => result.trim())
    .filter(Boolean);
}

export type WebSearchResult = {
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

export function parseToolContentBlocks(value: string | null): ToolContentBlocks | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    let text = "";
    const texts: string[] = [];
    const images: string[] = [];

    for (const block of parsed) {
      if (block === null || typeof block !== "object") return null;
      const content = block as Record<string, unknown>;
      if (typeof content.text === "string") {
        text += content.text;
        texts.push(content.text);
      } else if (typeof content.image_url === "string") {
        images.push(content.image_url);
      } else {
        return null;
      }
    }

    return text || images.length > 0 ? { text: text || null, texts, images } : null;
  } catch {
    return null;
  }
}

export type NestedActivity =
  | { kind: "command"; command: string; workdir: string | null; output: ExecOutput | null }
  | { kind: "patch"; patch: string }
  | { kind: "image"; path: string; imageUrl: string | null };

function parseStringArgument(value: string, callStart: number) {
  const argument = value.slice(callStart).match(/^\s*("(?:\\.|[^"\\])*")/s)?.[1];
  if (!argument) return null;
  try {
    const parsed: unknown = JSON.parse(argument);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveStringVariable(value: string, callStart: number) {
  const name = value.slice(callStart).match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (!name) return null;
  const declarations = [...value.slice(0, callStart).matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*")\s*;/gs)];
  const declaration = declarations.findLast((match) => match[1] === name);
  if (!declaration) return null;
  try {
    const parsed: unknown = JSON.parse(declaration[2]);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function execResultsFromContent(content: ToolContentBlocks | null) {
  if (!content) return [];
  return content.texts.flatMap((text) => {
    const direct = parseExecOutput(text);
    if (direct) return [direct];
    return text.split("\n").flatMap((line) => {
      const value = parseJsonObject(line.trim());
      const result = value?.status === "fulfilled" ? value.value : value;
      const parsed = result && typeof result === "object" && !Array.isArray(result)
        ? parseExecOutput(JSON.stringify(result))
        : null;
      return parsed ? [parsed] : [];
    });
  });
}

function nestedToolCalls(value: string) {
  const calls: Array<{ name: "exec_command" | "apply_patch" | "view_image"; index: number; argumentStart: number }> = [];
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    const match = value.slice(index).match(/^tools\.(exec_command|apply_patch|view_image)\s*\(/);
    if (!match) continue;
    calls.push({ name: match[1] as "exec_command" | "apply_patch" | "view_image", index, argumentStart: index + match[0].length });
    index += match[0].length - 1;
  }
  return calls;
}

function parseNestedActivities(value: string | null, output: string | null): NestedActivity[] | null {
  if (!value) return null;
  const content = parseToolContentBlocks(output);
  const execResults = execResultsFromContent(content);
  let execIndex = 0;
  let imageIndex = 0;
  const activities: NestedActivity[] = [];
  for (const call of nestedToolCalls(value)) {
    const { name, index: callIndex, argumentStart } = call;
    if (name === "exec_command") {
      const parsed = parseNestedToolCall(value.slice(callIndex), name);
      const command = typeof parsed?.cmd === "string" ? parsed.cmd : typeof parsed?.command === "string" ? parsed.command : null;
      if (!command) continue;
      const workdir = typeof parsed?.workdir === "string" ? parsed.workdir : typeof parsed?.cwd === "string" ? parsed.cwd : null;
      activities.push({ kind: "command", command, workdir, output: execResults[execIndex++] ?? null });
    } else if (name === "apply_patch") {
      const patch = parseStringArgument(value, argumentStart) ?? resolveStringVariable(value, argumentStart);
      if (patch) activities.push({ kind: "patch", patch });
    } else {
      const parsed = parseNestedToolCall(value.slice(callIndex), name);
      if (typeof parsed?.path === "string") {
        activities.push({ kind: "image", path: parsed.path, imageUrl: content?.images[imageIndex++] ?? null });
      }
    }
  }

  return activities.length > 1 || activities.some((activity) => activity.kind !== "command") ? activities : null;
}

type BatchExecResult = {
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  wallTimeSeconds: number | null;
  isRejected: boolean;
};

function parseBatchExecResults(value: string | null): BatchExecResult[] | null {
  const content = parseToolContentBlocks(value)?.text;
  if (!content) return null;

  const results = content.split("\n").flatMap((line) => {
    const parsed = parseJsonObject(line.trim());
    if (!parsed) return [];
    if (parsed.status === "rejected") {
      return [{
        stdout: null,
        stderr: typeof parsed.reason === "string" ? parsed.reason : JSON.stringify(parsed.reason ?? "Rejected"),
        exitCode: null,
        wallTimeSeconds: null,
        isRejected: true,
      }];
    }

    const result = parsed.status === "fulfilled" ? parsed.value : parsed;
    if (!result || typeof result !== "object" || Array.isArray(result)) return [];
    const output = result as Record<string, unknown>;
    if (typeof output.exit_code !== "number") return [];
    return [{
      stdout: typeof output.output === "string" ? output.output : typeof output.stdout === "string" ? output.stdout : null,
      stderr: typeof output.stderr === "string" ? output.stderr : null,
      exitCode: typeof output.exit_code === "number" ? output.exit_code : null,
      wallTimeSeconds: typeof output.wall_time_seconds === "number" ? output.wall_time_seconds : null,
      isRejected: false,
    }];
  });

  return results.length > 1 ? results : null;
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

export function cleanExecOutput(text: string) {
  return text
    .replaceAll("\r\n", "\n")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replaceAll("\r", "")
    .split("\n")
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

export type UserInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: Array<{ label: string; description: string }>;
};

export function formatActivityDuration(ms: number | null) {
  if (ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

export function processExitCode(output: string | null, isError: boolean) {
  if (output) {
    const canonicalCodes = [...output.matchAll(/^Process exited with code (-?\d+)$/gim)]
      .map((match) => Number(match[1]));
    if (canonicalCodes.length > 0) return canonicalCodes.at(-1)!;

    const structuredCode = parseExecOutput(output)?.exitCode;
    if (structuredCode != null) return structuredCode;

    const codes = [...output.matchAll(/^(?:exit code:\s*|command failed with exit code\s+)(-?\d+)\.?$/gim)]
      .map((match) => Number(match[1]));
    if (codes.length > 0) {
      const nonzeroCodes = codes.filter((code) => code !== 0);
      return Math.max(...(nonzeroCodes.length > 0 ? nonzeroCodes : codes));
    }
  }
  return isError ? 1 : 0;
}

export function processSignal(output: string | null) {
  return output?.match(/Process stopped with signal (SIG[A-Z]+)/)?.[1] ?? null;
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

export function parseUserInputAnswers(outputJson: string | null): Record<string, string[]> {
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


function buildToolActivity(item: Extract<ReplayItem, { kind: "toolCall" }>) {
  const outerToolName = baseToolName(item.name);
  const nestedWriteStdinArguments = EXEC_TOOL_NAMES.has(outerToolName) && item.arguments
    ? parseNestedToolCall(item.arguments, "write_stdin")
    : null;
  const toolName = nestedWriteStdinArguments ? "write_stdin" : outerToolName;
  const userInputQuestions = toolName === "request_user_input" ? parseUserInputQuestions(item.arguments) : null;
  const isExec = EXEC_TOOL_NAMES.has(outerToolName);
  const webSearchQueries = isExec ? parseWebSearchQueries(item.arguments) : null;
  const webSearchResults = parseWebSearchResultCards(item.output);
  const batchExecResults = isExec ? parseBatchExecResults(item.output) : null;
  const execArgumentList = isExec ? parseExecArgumentList(item.arguments) : [];
  const batchActivities = batchExecResults && execArgumentList.length > 1
    ? batchExecResults.map((result, index) => ({ result, arguments: execArgumentList[index] ?? null }))
    : null;
  const execArguments = isExec && !batchActivities && execArgumentList.length <= 1 ? parseExecArguments(item.arguments) : null;
  const parsedArguments = nestedWriteStdinArguments ?? parseJsonObject(item.arguments);
  const argumentEntries = parsedArguments
    ? Object.entries(parsedArguments).filter(([key]) => !execArguments || !["cmd", "command", "workdir", "cwd"].includes(key))
    : [];
  const execOutput = isExec ? parseExecOutput(item.output) ?? parseExecOutput(item.output ? cleanExecOutput(item.output) : null) : null;
  const contentBlocks = parseToolContentBlocks(item.output);
  const nestedActivities = isExec ? parseNestedActivities(item.arguments, item.output) : null;
  const argumentsText = execArguments?.command ?? (parsedArguments ? null : item.arguments);
  const displayToolName = execArguments?.kind === "patch"
    ? "apply_patch"
    : nestedWriteStdinArguments
      ? toolName
      : item.name;
  const rawOutputText = contentBlocks ? contentBlocks.text : execOutput?.stdout ?? (execOutput ? null : item.output);
  const outputText = isExec && isEmptyExecOutput(rawOutputText) ? null : rawOutputText;
  const stderrText = execOutput?.stderr ?? item.stderr;

  return { outerToolName, userInputQuestions, webSearchQueries, webSearchResults, batchActivities, nestedActivities, execArguments, argumentEntries, execOutput, contentBlocks, argumentsText, displayToolName, outputText, stderrText };
}

export type ToolActivity = ReturnType<typeof buildToolActivity>;

export type Exploration = { label: "Read" | "Search" | "List"; text: string };
export type ConversationBlock =
  | { kind: "item"; entry: TimelineEntry }
  | { kind: "exploration"; entries: TimelineEntry[]; actions: Exploration[][] };

// Deliberately classify only literal, known read-only commands. Unknown shell syntax
// stays a command with its output; never hide a write/test behind an Explored label.
export function classifyExploration(command: string): Exploration[] | null {
  if (/[`$\\\n]/.test(command)) return null;
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|[;&|<>]|[^\s;&|<>"']+/g) ?? [];
  if (tokens.join("").replace(/\s/g, "") !== command.replace(/\s/g, "")) return null;
  const commands: string[][] = [[]];
  for (const token of tokens) {
    if (token === ";" || token === "&&") commands.push([]);
    else if (["&", "|", "<", ">"].includes(token)) return null;
    else {
      if (!/^["']/.test(token) && /[()#]/.test(token)) return null;
      commands.at(-1)!.push(token.replace(/^("|')(.*)\1$/, "$2"));
    }
  }
  const actions: Exploration[] = [];
  for (const words of commands) {
    if (words[0] === "rtk") words.shift();
    if (words[0] === "proxy") words.shift();
    const name = words.shift();
    if (["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh"].includes(name ?? "") && words.length === 2 && ["-c", "-lc"].includes(words[0])) {
      const nested = classifyExploration(words[1]);
      if (!nested) return null;
      actions.push(...nested);
    } else if (name === "cat" && words.length && words.every((word) => !word.startsWith("-"))) {
      actions.push(...words.map((text) => ({ label: "Read" as const, text })));
    } else if (name === "sed" && words[0] === "-n" && /^\d+(,\d+)?p$/.test(words[1] ?? "") && words.length === 3) {
      actions.push({ label: "Read", text: words[2] });
    } else if (name === "ls" && words.every((word) => !word.startsWith("-") || /^-[alhAF1]+$/.test(word))) {
      actions.push({ label: "List", text: words.filter((word) => !word.startsWith("-")).join(", ") || "." });
    } else if (name === "rg" || name === "grep") {
      const args: string[] = [];
      let list = false;
      for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        if (word === "--files" && name === "rg") list = true;
        else if (["-g", "--glob", "-t", "--type"].includes(word)) { if (!words[++i]) return null; }
        else if (/^-[nilwSF]+$/.test(word) || word === "--hidden") continue;
        else if (word.startsWith("-")) return null;
        else args.push(word);
      }
      if (!list && !args.length) return null;
      actions.push({ label: list ? "List" : "Search", text: list ? command : args.join(" in ") });
    } else return null;
  }
  return actions.length ? actions : null;
}

export function buildConversation(turn: SessionReplayDetail["turns"][number]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  for (const entry of timelineEntries(orderedItems(turn))) {
    if (!isVisibleTimelineItem(entry.item)) continue;
    const activity = entry.activity;
    const tool = entry.item.kind === "toolCall" ? entry.item : null;
    // Batch results retain their individual exit status/output; don't infer success
    // from the outer orchestration call or allocate its tokens to nested commands.
    const actions = tool && !tool.isError && tool.status !== "running" && tool.status !== "stopped"
      && activity?.execArguments?.kind === "command" && !activity.batchActivities
      && !/tools\.(?!exec_command\b)\w+\s*\(/.test(tool.arguments ?? "")
      && processExitCode(tool.output, tool.isError) === 0
      ? classifyExploration(activity.execArguments.command) : null;
    if (actions) {
      const previous = blocks.at(-1);
      if (previous?.kind === "exploration") {
        previous.entries.push(entry);
        previous.actions.push(actions);
      } else blocks.push({ kind: "exploration", entries: [entry], actions: [actions] });
    } else blocks.push({ kind: "item", entry });
  }
  return blocks;
}

export function summarizeOutput(text: string) {
  const lines = text.split("\n");
  const shorten = (line: string) => line.length > 240 ? `${line.slice(0, 240)}…` : line;
  return {
    head: (lines.length > 5 ? lines.slice(0, 3) : lines).map(shorten),
    tail: lines.length > 5 ? lines.slice(-2).map(shorten) : [],
    omitted: Math.max(0, lines.length - 5),
  };
}
