// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { buildConversation } from "@/lib/session-conversation";
import { buildSearchDocuments, SessionSearchIndex } from "@/lib/session-search";
import type { SessionReplayDetail } from "@/lib/api";
import { ConversationItem } from "./session-detail-modal";
import mixedOrchestration from "../../e2e/fixtures/mixed-orchestration.json";
import structuredCommands from "../../e2e/fixtures/structured-command-responses.json";
import clockSleep from "../../e2e/fixtures/clock-sleep.json";
import backgroundPolls from "../../e2e/fixtures/background-polls.json";
import searchTerminal from "../../e2e/fixtures/search-terminal.json";
import openTerminal from "../../e2e/fixtures/open-terminal.json";

it("finds hidden output inside the original exploration group and restores its disclosure state", async () => {
  await i18n.changeLanguage("en");
  const tool = (callId: string, command: string, output: string) => ({
    kind: "toolCall" as const, callId, name: "exec_command", status: "completed", arguments: JSON.stringify({ cmd: command }),
    output: JSON.stringify({ output, exit_code: 0 }), stderr: null, startedAt: null, completedAt: null, durationMs: null, isError: false,
  });
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "find", startedAt: null, completedAt: null, durationMs: null, systemMessages: [], userMessages: [], assistantMessages: [],
    reasoningSummaries: [], toolCalls: [], patchResults: [], tokenEvents: [], errors: [],
    items: [tool("first", "cat first.txt", "before Needle after"), tool("second", "cat second.txt", "unrelated sibling output")],
  };
  const block = buildConversation(turn)[0];
  expect(block.kind).toBe("exploration");
  const index = new SessionSearchIndex(buildSearchDocuments([turn]), "");
  const hit = (await index.search("needle", "timeline", async () => {}))!.hit;
  const { rerender } = render(<ConversationItem block={block} rawJsonlLines={[]} />);
  const group = screen.getByRole("region", { name: "Explored" });
  const disclosure = within(group).getByRole("button", { name: /Explored/ });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  rerender(<ConversationItem block={block} rawJsonlLines={[]} searchHits={hit ? [hit] : []} />);
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("session-search-current")).toHaveTextContent("Needle");
  const command = within(group).getByRole("button", { name: /Ran cat first.txt/ });
  expect(command.parentElement?.querySelector("pre")?.textContent).toBe("└ before Needle after");
  expect(group).toHaveTextContent("cat second.txt");
  expect(group).toHaveTextContent("unrelated sibling output");
  rerender(<ConversationItem block={block} rawJsonlLines={[]} searchHits={[]} />);
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("session-search-current")).not.toBeInTheDocument();
});

it("highlights all identical nested outputs while moving only the current match", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "nested-find", startedAt: null, completedAt: null, durationMs: null, systemMessages: [], userMessages: [], assistantMessages: [],
    reasoningSummaries: [], toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "nested", name: "exec", status: "completed", isError: false,
      arguments: 'text(await tools.exec_command({cmd:"echo first"})); text(await tools.exec_command({cmd:"echo second"}));',
      output: JSON.stringify([
        { type: "input_text", text: JSON.stringify({ output: "same Needle output", exit_code: 0 }) },
        { type: "input_text", text: JSON.stringify({ output: "same Needle output", exit_code: 0 }) },
      ]), stderr: null, startedAt: null, completedAt: null, durationMs: null,
    }],
  };
  const index = new SessionSearchIndex(buildSearchDocuments([turn]), "");
  expect(await index.search("Needle", "timeline", async () => {})).toMatchObject({ count: 2 });
  const block = buildConversation(turn)[0];
  const { rerender } = render(<ConversationItem block={block} rawJsonlLines={[]} searchHits={index.select(0).matches} />);
  const first = screen.getByRole("button", { name: /Ran echo first/ });
  const second = screen.getByRole("button", { name: /Ran echo second/ });
  expect(within(first.parentElement!).getByTestId("session-search-current")).toHaveTextContent("Needle");
  expect(second).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByTestId("session-search-match")).toHaveLength(1);
  rerender(<ConversationItem block={block} rawJsonlLines={[]} searchHits={index.select(1).matches} />);
  expect(first).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByTestId("session-search-match")).toHaveLength(1);
  expect(second).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByTestId("session-search-current")).toHaveLength(1);
  expect(within(second.parentElement!).getByTestId("session-search-current")).toHaveTextContent("Needle");
});

it.each([
  ["command", "exec_command", JSON.stringify({ cmd: "echo command-text", workdir: "/find-workdir" }), JSON.stringify({ output: "find-stdout", stderr: "find-stderr", exit_code: 0 })],
  ["terminal", "write_stdin", JSON.stringify({ session_id: 42, chars: "find-input" }), JSON.stringify({ output: "find-terminal-output", exit_code: 0 })],
  ["tool", "mcp__test", JSON.stringify({ value: "find-argument" }), "find-tool-output"],
  ["page", "exec", 'text(await tools.web__run({open:[{ref_id:"https://example.com/find-page"}]}));', "find-page-content"],
])("locates every indexed field of a %s in its original item", async (_label, name, args, output) => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "fields", startedAt: null, completedAt: null, durationMs: null, systemMessages: [], userMessages: [], assistantMessages: [],
    reasoningSummaries: [], toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "fields", name, arguments: args, output, status: "completed", isError: false,
      stderr: null, startedAt: null, completedAt: null, durationMs: null,
    }],
  };
  const documents = buildSearchDocuments([turn]);
  const index = new SessionSearchIndex(documents, "");
  const blocks = buildConversation(turn);
  const { rerender } = render(<ConversationItem block={blocks[0]} rawJsonlLines={[]} />);
  for (const document of documents) {
    const result = (await index.search(document.text, "timeline", async () => {}))!;
    for (let selected = 0; selected < result.count; selected += 1) {
      const hit = index.select(selected).hit!;
      rerender(<ConversationItem block={blocks[hit.blockIndex]} rawJsonlLines={[]} searchHits={index.select(selected).matches.filter((match) => match.blockIndex === hit.blockIndex)} />);
      const marks = screen.queryAllByTestId("session-search-current");
      expect(marks, `${name}: ${hit.field} ${document.text}`).toHaveLength(1);
      expect(marks[0].textContent).toBe(document.text);
    }
  }
});

it.each([
  ["en", "completed", "Opened"], ["en", null, "Opening"], ["zh", "completed", "已打开网页："],
])("renders a standalone page open in %s with status %s", async (language, status, label) => {
  await i18n.changeLanguage(language!);
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "open", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "open", name: "exec", status,
      arguments: 'text(await tools.web__run({open:[{ref_id:"https://example.com"}]}));',
      output: status ? "page content" : null,
      stderr: null, startedAt: null, completedAt: null, durationMs: null, isError: false,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);
  const button = screen.getByRole("button", { name: new RegExp(`${label} https://example.com`) });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(document.body).not.toHaveTextContent("tools.web__run");
  await userEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  if (status) expect(button.parentElement?.querySelector("pre")?.textContent).toBe("page content");
});

it("renders the reported opened pages independently from the native command and running poll", async () => {
  await i18n.changeLanguage("en");
  const native = openTerminal[1].payload.item!;
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "open-terminal", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: openTerminal[0].payload.call_id!, name: "exec", status: "completed",
      arguments: openTerminal[0].payload.input!, output: JSON.stringify(openTerminal[2].payload.output),
      stderr: null, startedAt: null, completedAt: null, durationMs: 7200, isError: false, rawJsonlLineNumbers: [1, 2, 3],
      commandExecutions: [{
        callId: native.id, name: "exec_command", arguments: JSON.stringify({ cmd: native.command[2] }),
        output: JSON.stringify({ output: native.aggregated_output, exit_code: native.exit_code }),
        stderr: null, startedAt: null, completedAt: null, durationMs: 61, status: "completed", isError: false,
      }],
    }, {
      kind: "tokenUsage", timestamp: null, model: "gpt-6", inputTokens: 81022, cachedInputTokens: 76544,
      outputTokens: 403, reasoningOutputTokens: 264, totalTokens: 81425, rawJsonlLineNumbers: [4],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={openTerminal.map((record) => JSON.stringify(record))} />);
  const opened = screen.getByRole("button", { name: /Opened.*github.com/ });
  expect(opened).toHaveTextContent("Opened https://developer.apple.com/");
  expect(opened).toHaveAttribute("aria-expanded", "false");
  const wait = screen.getByRole("button", { name: /Waited for background terminal.*Running/ });
  expect(wait).toBeDisabled();
  const command = screen.getByRole("button", { name: /Ran rtk proxy ps/ });
  expect(command.parentElement?.textContent).toContain("lines omitted");
  expect(screen.getAllByTestId("token-metadata")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Output #/ })).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("Script completed");
  expect(document.body).not.toHaveTextContent("Warning: truncated output");
  await userEvent.click(opened);
  const pages = opened.parentElement?.querySelectorAll("pre");
  expect(pages).toHaveLength(2);
  expect(pages?.[0].textContent).toContain("Issue #11945");
  expect(pages?.[1].textContent).toContain("performDrag(with:)");
  expect(opened.parentElement?.textContent).not.toContain("session_id");
  expect(opened.parentElement?.textContent).not.toContain("PID  PPID");
  await userEvent.click(command);
  expect(command.parentElement?.querySelector("pre")?.textContent).toBe(`└ ${native.aggregated_output.trim()}`);
  expect(command.parentElement?.textContent).not.toContain("Apple Developer Documentation");
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  const raw = screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.querySelector("pre")?.textContent;
  expect(raw).toContain('"type":"CommandExecution"');
  expect(raw).toContain("Warning: truncated output");
  expect(raw).toContain('"type":"token_count"');
});

it("renders the reported search and running terminal wait independently with one token badge", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "search-terminal", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: searchTerminal[0].payload.call_id!, name: "exec", status: "completed",
      arguments: searchTerminal[0].payload.input!, output: JSON.stringify(searchTerminal[1].payload.output),
      stderr: null, startedAt: null, completedAt: null, durationMs: 8400, isError: false, rawJsonlLineNumbers: [1, 2],
    }, {
      kind: "tokenUsage", timestamp: null, model: "gpt-6", inputTokens: 76758, cachedInputTokens: 75392,
      outputTokens: 317, reasoningOutputTokens: 224, totalTokens: 77075, rawJsonlLineNumbers: [3],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={searchTerminal.map((record) => JSON.stringify(record))} />);
  const search = screen.getByRole("button", { name: /Searched the web for.*tauri macos/ });
  const wait = screen.getByRole("button", { name: /Waited for background terminal.*Running/ });
  expect(search).toHaveTextContent("WKWebView performWindowDragWithEvent selection mouseDown mouseUp");
  expect(search).toHaveAttribute("aria-expanded", "false");
  expect(wait).toHaveAttribute("aria-expanded", "false");
  expect(screen.getAllByTestId("token-metadata")).toHaveLength(1);
  expect(document.body).not.toHaveTextContent("81206");
  expect(document.body).not.toHaveTextContent("Script completed");
  expect(screen.queryByRole("button", { name: /Output #/ })).not.toBeInTheDocument();
  await userEvent.click(search);
  expect(search.parentElement?.querySelectorAll("pre")).toHaveLength(23);
  expect(search.parentElement?.textContent).toContain("performWindowDragWithEvent: | Apple Developer Documentation");
  expect(search.parentElement?.textContent).not.toContain("session_id");
  expect(wait).toHaveAttribute("aria-expanded", "false");
  expect(wait).toBeDisabled();
  expect(wait.parentElement?.querySelector("pre")).toBeNull();
  expect(wait.parentElement?.textContent).not.toContain("Apple Developer Documentation");
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  const raw = screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.querySelector("pre")?.textContent;
  expect(raw).toContain('"type":"custom_tool_call_output"');
  expect(raw).toContain('"session_id\\":81206');
  expect(raw).toContain('"type":"token_count"');
});

it("renders the reported poll batch as separate failed and running waits with complete output", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "polls", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: backgroundPolls[0].payload.call_id!, name: "exec", status: "completed",
      arguments: backgroundPolls[0].payload.input!, output: JSON.stringify(backgroundPolls[1].payload.output),
      stderr: null, startedAt: null, completedAt: null, durationMs: 7804, isError: false, rawJsonlLineNumbers: [1, 2],
    }, {
      kind: "tokenUsage", timestamp: null, model: "gpt-6", inputTokens: 95689, cachedInputTokens: 94336,
      outputTokens: 175, reasoningOutputTokens: 36, totalTokens: 95864, rawJsonlLineNumbers: [3],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={backgroundPolls.map((record) => JSON.stringify(record))} />);
  const waits = screen.getAllByRole("button", { name: /Waited for background terminal/ });
  expect(waits).toHaveLength(2);
  expect(waits[0]).toHaveTextContent("Failed");
  expect(waits[0].parentElement).toHaveClass("border-error/40");
  expect(waits[1]).toHaveTextContent("Running");
  expect(waits[1].parentElement).not.toHaveClass("border-error/40");
  expect(screen.getAllByTestId("token-metadata")).toHaveLength(1);
  expect(document.body).not.toHaveTextContent("write_stdin");
  expect(document.body).not.toHaveTextContent("81206");
  expect(screen.queryByRole("button", { name: /Output #/ })).not.toBeInTheDocument();
  for (const [index, wait] of waits.entries()) {
    expect(wait).toHaveAttribute("aria-expanded", "false");
    expect(wait.parentElement?.querySelector("pre")).toBeNull();
    await userEvent.click(wait);
    const output = JSON.parse(backgroundPolls[1].payload.output![index + 1].text).output;
    expect(wait.parentElement?.querySelector("pre")?.textContent).toBe(`└ ${output.trim()}`);
  }
  expect(waits[0].parentElement?.textContent).not.toContain("editor-window-drag.spec.ts");
  expect(waits[1].parentElement?.textContent).not.toContain("MarkdownEditor.test.tsx");
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  const raw = screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.querySelector("pre")?.textContent;
  expect(raw).toContain('"type":"custom_tool_call_output"');
  expect(raw).toContain('"type":"token_count"');
});

it("collapses the reported clock.sleep activity while keeping tokens, complete output and raw provenance", async () => {
  await i18n.changeLanguage("en");
  const call = clockSleep.find((record) => record.payload.type === "function_call")!.payload;
  const output = clockSleep.find((record) => record.payload.type === "function_call_output")!.payload.output!;
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "sleep", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: call.call_id!, name: "clock.sleep", status: "completed", arguments: call.arguments!,
      output, stderr: null, startedAt: null, completedAt: null, durationMs: 20067, isError: false, rawJsonlLineNumbers: [2, 4, 5],
    }, {
      kind: "tokenUsage", timestamp: null, model: "gpt-6", inputTokens: 81764, cachedInputTokens: 80768,
      outputTokens: 537, reasoningOutputTokens: 516, totalTokens: 82301, rawJsonlLineNumbers: [6],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={clockSleep.map((record) => JSON.stringify(record))} />);
  const button = screen.getByRole("button", { name: /Waited 20 seconds/ });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.getAllByTestId("token-metadata")).toHaveLength(1);
  expect(screen.getByTestId("token-metadata")).toHaveTextContent("82.3k tokens");
  expect(screen.queryByText(/Wall time:/)).not.toBeInTheDocument();
  expect(screen.queryByText("clock.sleep")).not.toBeInTheDocument();
  await userEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("clock.sleep")).toBeInTheDocument();
  expect(button.parentElement?.querySelector("pre")?.textContent).toBe(output);
  await userEvent.click(button);
  expect(button.parentElement?.querySelector("pre")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  const raw = screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.querySelector("pre")?.textContent;
  expect(raw).toContain('"namespace":"clock"');
  expect(raw).toContain('"kind":"clock.sleep"');
  expect(raw).toContain('"type":"function_call_output"');
  expect(raw).toContain('"type":"token_count"');
  expect(raw).not.toContain("background-test-command");
});

it.each([
  ["Wall time: 3.1 seconds\nSleep interrupted by new input.", "completed", false, "Wait interrupted by new input"],
  [null, null, false, "Requested wait 20 seconds · Incomplete"],
  [null, "completed", false, "Wait ended · Requested wait 20 seconds"],
  ["Clock unavailable", "failed", true, "Wait failed"],
])("renders clock.sleep state %s without assuming successful completion", async (output, status, isError, label) => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "sleep", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "sleep", name: "clock.sleep", status, arguments: '{"duration_ms":20000}',
      output, stderr: null, startedAt: null, completedAt: null, durationMs: null, isError,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);
  const button = screen.getByRole("button", { name: label });
  expect(button.parentElement).toHaveClass(isError ? "border-error/40" : "border-cyan-300/70");
  expect(screen.queryByRole("button", { name: /Waited 20 seconds/ })).not.toBeInTheDocument();
  await userEvent.click(button);
  if (output) expect(button.parentElement?.querySelector("pre")?.textContent).toBe(output);
});

it("renders structured parallel responses under their commands with stable identities", async () => {
  await i18n.changeLanguage("en");
  const executions = structuredCommands.flatMap((record) => {
    const item = record.payload.item;
    if (!item) return [];
    return [{
      callId: item.id, name: "exec_command", status: item.status,
      arguments: JSON.stringify({ cmd: item.command[2], workdir: "/native-response-test" }),
      output: JSON.stringify({ output: item.stdout ?? item.aggregated_output, stderr: item.stderr ?? null, exit_code: item.exit_code, session_id: item.process_id }),
      stderr: null, startedAt: null, completedAt: record.timestamp, durationMs: null, isError: item.exit_code !== 0,
    }];
  });
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "native-turn", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "native-batch", name: "exec", status: "completed",
      arguments: structuredCommands[0].payload.input!, output: JSON.stringify(structuredCommands[3].payload.output),
      commandExecutions: executions, stderr: null, startedAt: null, completedAt: null, durationMs: null, isError: false,
      rawJsonlLineNumbers: [1, 2, 3, 4, 7],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={structuredCommands.map((record) => JSON.stringify(record))} />);
  const first = screen.getByRole("button", { name: /Ran first-command/ });
  const second = screen.getByRole("button", { name: /Ran second-command/ });
  const third = screen.getByRole("button", { name: /Ran third-command/ });
  expect(first.parentElement?.querySelector("pre")?.textContent).toContain("first response line 1");
  expect(first.parentElement?.textContent).not.toContain("second response");
  expect(second.parentElement?.textContent).toContain("second response");
  expect(second.parentElement?.textContent).toContain("second error");
  expect(second.querySelector(".text-error-foreground")).toBeInTheDocument();
  expect(third.parentElement?.textContent).toContain("third command finished");
  expect(screen.queryByRole("button", { name: /^Output #/ })).not.toBeInTheDocument();
  await userEvent.click(first);
  expect(first).toHaveAttribute("aria-expanded", "true");
  expect(first.parentElement?.querySelector("pre")?.textContent).toContain("first response line 8");
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  expect(screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.textContent).toContain("exec-third");
});

it("renders the reported mapped orchestration as individual activities without its allSettled wrapper or process timing", async () => {
  await i18n.changeLanguage("en");
  const [call, response] = mixedOrchestration;
  const output = response.payload.output!;
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "mixed", name: "exec", status: "completed",
      arguments: call.payload.input!, output: JSON.stringify(output),
      stderr: null, startedAt: null, completedAt: null, durationMs: 6300, isError: false, rawJsonlLineNumbers: [1, 2],
    }, {
      kind: "tokenUsage", timestamp: null, model: "gpt-6", inputTokens: 102416, cachedInputTokens: 99840,
      outputTokens: 243, reasoningOutputTokens: 67, totalTokens: 102659,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={mixedOrchestration.map((record) => JSON.stringify(record))} />);
  expect(screen.queryByRole("button", { name: /exec · completed/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Ran/ })).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: /Waited for background terminal/ })).toHaveLength(2);
  expect(screen.queryByText(/Promise.allSettled/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Exit code:|Wall time:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/write_stdin · completed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Script completed/)).not.toBeInTheDocument();
  expect(screen.getAllByTestId("token-metadata")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /^Output #/ })).toHaveLength(5);
  expect(screen.queryByText(/Process session:/)).not.toBeInTheDocument();
  const failed = screen.getByRole("button", { name: "Output #4" });
  expect(failed.parentElement).toHaveClass("border-error/40");
  const first = screen.getByRole("button", { name: "Output #1" });
  await userEvent.click(first);
  expect(first.parentElement?.querySelector("pre")?.textContent).toContain(JSON.parse(output[1].text).output.trim());
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  expect(screen.getByRole("button", { name: "Hide raw JSONL" }).parentElement?.parentElement?.querySelector("pre")?.textContent).toContain(JSON.stringify(response));
});

it("renders async user input titles and optional string choices as readable questions", async () => {
  await i18n.changeLanguage("en");
  const title = "当前代码的足球首页路径是 `/`（`/football` 已不再是首页路由）。这次我会测足球首页以及英超、曼城、一个有完整数据的球员详情页；如果你说的 `/football` 是比赛详情页，或有出现 250ms 的具体 URL、日志和机器配置，请补充。";
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "call_c1b878e6c86d4fcea9d32aeab086ca8a", name: "request_user_input_async", status: "completed",
      arguments: JSON.stringify({ questions: [{ title }, { title: "Which **page**?", options: ["Home", "Team"] }] }),
      output: '{"accepted":true}', stderr: null, startedAt: null, completedAt: null, durationMs: 17, isError: false,
      rawJsonlLineNumbers: [1],
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={['{"type":"function_call"}']} />);

  expect(screen.getByText("User input request")).toBeInTheDocument();
  expect((await screen.findAllByText("/football", {}, { timeout: 10_000 }))[0].tagName).toBe("CODE");
  expect(screen.getByText("page").tagName).toBe("STRONG");
  expect(screen.getByText("Home")).toBeInTheDocument();
  expect(screen.getByText("Team")).toBeInTheDocument();
  expect(screen.getAllByRole("list")).toHaveLength(1);
  expect(screen.queryByText(/accepted/)).not.toBeInTheDocument();
  expect(screen.queryByText(/request_user_input_async/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "View raw JSONL" }));
  expect(screen.getByText('{"type":"function_call"}')).toBeInTheDocument();
});

it("preserves synchronous user input options and selected or custom answers", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "sync", name: "request_user_input", status: "completed",
      arguments: JSON.stringify({ questions: [{ header: "Scope", id: "scope", question: "Which page?", options: [{ label: "Home", description: "Test the homepage" }] }] }),
      output: JSON.stringify({ answers: { scope: { answers: ["Home", "Also test the team page"] } } }),
      stderr: null, startedAt: null, completedAt: null, durationMs: 100, isError: false,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);
  expect(screen.getByText("Scope")).toBeInTheDocument();
  expect(await screen.findByText("Which page?")).toBeInTheDocument();
  expect(screen.getByText("Test the homepage")).toBeInTheDocument();
  expect(screen.getByText("Home").closest("li")).toHaveClass("border-primary/50");
  expect(screen.getByText("Also test the team page")).toBeInTheDocument();
});

it("uses distinct card backgrounds and borders for conversation item types", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [
      { kind: "message", role: "system", text: "System fixture", source: "base_instructions", timestamp: null },
      { kind: "message", role: "developer", text: "Developer fixture", source: "developer_message", timestamp: null },
      { kind: "message", role: "user", text: "User fixture", source: "user_message", timestamp: null },
      { kind: "message", role: "assistant", text: "Assistant fixture", source: "assistant_message", timestamp: null },
      { kind: "reasoning", text: "Reasoning fixture", timestamp: null },
    ],
  };
  render(<>{buildConversation(turn).map((block, index) => <ConversationItem key={index} block={block} rawJsonlLines={[]} />)}</>);
  expect(screen.getByRole("button", { name: /^System/ }).closest("article")).toHaveClass("border-zinc-300/70", "bg-zinc-100/60");
  expect(screen.getByRole("button", { name: /^Developer/ }).closest("article")).toHaveClass("border-violet-300/70", "bg-violet-50/70");
  expect(screen.getByRole("button", { name: /^User/ }).closest("article")).toHaveClass("border-blue-300/70", "bg-blue-50/70");
  expect(screen.getByRole("button", { name: /^Assistant/ }).closest("article")).toHaveClass("border-emerald-300/70", "bg-emerald-50/70");
  expect(screen.getByText("Reasoning fixture").closest(".rounded-lg")).toHaveClass("border-amber-300/70", "bg-amber-50/70");
});

it("copies the full text content from message and reasoning cards without raw JSONL", async () => {
  await i18n.changeLanguage("en");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const message = "Full **message** content";
  const reasoning = "Full reasoning content";
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [
      { kind: "message", role: "assistant", text: message, source: "assistant_message", timestamp: null, rawJsonlLineNumbers: [1] },
      { kind: "reasoning", text: reasoning, timestamp: null, rawJsonlLineNumbers: [2] },
    ],
  };

  render(<>{buildConversation(turn).map((block, index) => <ConversationItem key={index} block={block} rawJsonlLines={['{"message":true}', '{"reasoning":true}']} />)}</>);

  const copyButtons = screen.getAllByRole("button", { name: "Copy content" });
  await userEvent.click(copyButtons[0]);
  expect(writeText).toHaveBeenLastCalledWith(message);
  expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("message\":true"));
  expect(copyButtons[0]).toHaveAccessibleName("Content copied");

  await userEvent.click(copyButtons[1]);
  expect(writeText).toHaveBeenLastCalledWith(reasoning);
});

it("keeps each call's tokens visible after deduplicating reads and exposes original output on expansion", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [],
  };
  for (const [index, totalTokens] of [42000, 45000, 75000, 135000].entries()) {
    turn.items.push({
      kind: "toolCall", callId: String(index), name: "exec_command", status: "completed",
      arguments: JSON.stringify({ cmd: "cat src/shimmer.rs" }),
      output: JSON.stringify({ exit_code: 0, output: `original output ${index}` }),
      stderr: null, startedAt: null, completedAt: null, durationMs: 100, isError: false,
      rawJsonlLineNumbers: [index + 1],
    }, {
      kind: "tokenUsage", model: "gpt-5", timestamp: null, inputTokens: totalTokens - 500,
      cachedInputTokens: 40000, outputTokens: 500, reasoningOutputTokens: 100, totalTokens,
    });
  }
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={['{"call":0}', '{"call":1}']} />);
  expect(screen.getAllByText("src/shimmer.rs")).toHaveLength(1);
  const collapsedTokenMetadata = screen.getAllByTestId("token-metadata");
  expect(collapsedTokenMetadata[0]).toHaveTextContent("42k tokens");
  expect(collapsedTokenMetadata[1]).toHaveTextContent("45k (+3k) tokens");
  expect(collapsedTokenMetadata[2]).toHaveTextContent("75k (+30k) tokens");
  expect(collapsedTokenMetadata[3]).toHaveTextContent("135k (+60k) tokens");
  expect(screen.getByText("(+3k)")).toHaveClass("text-sky-600");
  expect(screen.getByText("(+30k)")).toHaveClass("text-amber-600");
  expect(screen.getByText("(+60k)")).toHaveClass("text-red-600");
  expect(screen.getByText("In 41.5k · Cache 40k · Out 500")).toBeInTheDocument();
  expect(screen.queryByText(/original output/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Explored/ }));
  const calls = screen.getAllByRole("button", { name: /Ran/ });
  expect(calls).toHaveLength(4);
  expect(within(calls[0]).getByTestId("token-metadata")).toHaveTextContent("42k tokens");
  expect(within(calls[1]).getByTestId("token-metadata")).toHaveTextContent("45k (+3k) tokens");
  expect(screen.getByText(/original output 0/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "View raw JSONL" })[1]);
  expect(screen.getByText('{"call":1}')).toBeInTheDocument();
});

it("renders nested orchestration calls as ordered CLI-style activities", async () => {
  await i18n.changeLanguage("en");
  const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@ -1 +1 @@\n-old\n+new\n*** End Patch";
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "outer", name: "exec", status: "completed",
      arguments: `text(await tools.exec_command({cmd:"pnpm test"}));\nconst patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));\nconst result = await tools.view_image({path:"/tmp/result.png"}); image(result.image_url);`,
      output: JSON.stringify([
        { type: "input_text", text: JSON.stringify({ exit_code: 0, output: "tests passed", wall_time_seconds: 1 }) },
        { type: "input_text", text: "Done!" },
        { type: "input_image", image_url: "data:image/png;base64,AA==" },
      ]),
      stderr: null, startedAt: null, completedAt: null, durationMs: 100, isError: false,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);
  expect(screen.getByRole("button", { name: /Ran/ }).closest(".rounded-lg")).toHaveClass("border-cyan-300/70", "bg-cyan-50/70");
  const activities = screen.getAllByRole("button");
  expect(activities[0]).toHaveTextContent("Ran pnpm test");
  expect(document.body).not.toHaveTextContent("Exit code:");
  expect(document.body).not.toHaveTextContent("Wall time:");
  expect(activities[1]).toHaveTextContent("Edited src/a.ts+1-1");
  expect(activities[2]).toHaveTextContent("Viewed Image");
  expect(activities[2]).toHaveTextContent("/tmp/result.png");
  await userEvent.click(activities[0]);
  expect(screen.getByText(/tests passed/)).toBeInTheDocument();
  await userEvent.click(activities[2]);
  expect(screen.getByRole("img", { name: "/tmp/result.png" })).toBeInTheDocument();
});

it("preserves dynamic terminal polling as an outer script with readable output", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "wait", name: "exec", status: "completed",
      arguments: 'const ids=[88600,42227];\nconst rs=await Promise.all(ids.map(session_id=>tools.write_stdin({session_id,chars:"",yield_time_ms:30000,max_output_tokens:20000})));',
      output: JSON.stringify([
        { type: "input_text", text: "JOB1\nBackground task output" },
        { type: "input_text", text: "SESSION1=88600" },
      ]),
      stderr: null, startedAt: null, completedAt: null, durationMs: 30000, isError: false,
    }],
  };

  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);

  expect(screen.getByRole("button", { name: /exec · completed/ })).toBeInTheDocument();
  expect(screen.getByText(/Background task output/)).toBeInTheDocument();
  expect(screen.queryByText(/session_id/)).not.toBeInTheDocument();
  const poll = screen.getByRole("button", { name: /exec · completed/ });
  expect(poll).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(poll);
  expect(poll).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/Background task output/)).toBeInTheDocument();
});

it("expands unpaired command responses without assigning them to another command", async () => {
  await i18n.changeLanguage("en");
  const fragment = Array.from({ length: 8 }, (_, index) => `retained fragment ${index + 1}`).join("\n");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [{
      kind: "toolCall", callId: "partial", name: "exec", status: "completed",
      arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));',
      output: JSON.stringify([
        { type: "input_text", text: JSON.stringify({ i: 0, status: "fulfilled", value: { output: "first response", exit_code: 0 } }) },
        { type: "input_text", text: fragment },
      ]),
      stderr: null, startedAt: null, completedAt: null, durationMs: 100, isError: false,
    }],
  };
  render(<ConversationItem block={buildConversation(turn)[0]} rawJsonlLines={[]} />);
  expect(screen.getByText(/first response/)).toBeInTheDocument();
  const second = screen.getByRole("button", { name: /Ran second/ });
  await userEvent.click(second);
  expect(second.parentElement).not.toHaveTextContent("first response");
  const output = screen.getByRole("button", { name: "Output" });
  expect(output).toHaveAttribute("aria-expanded", "false");
  expect(output.parentElement).toHaveTextContent("retained fragment 1");
  expect(output.parentElement).not.toHaveTextContent("retained fragment 4");
  await userEvent.click(output);
  expect(output).toHaveAttribute("aria-expanded", "true");
  expect(output.parentElement?.querySelector("pre")?.textContent).toContain(fragment);
});
