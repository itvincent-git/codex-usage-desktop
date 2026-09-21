// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { buildConversation } from "@/lib/session-conversation";
import type { SessionReplayDetail } from "@/lib/api";
import { ConversationItem } from "./session-detail-modal";

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
  expect(activities[0]).toHaveTextContent("Ran (1s) pnpm test");
  expect(activities[1]).toHaveTextContent("Edited src/a.ts+1-1");
  expect(activities[2]).toHaveTextContent("Viewed Image");
  expect(activities[2]).toHaveTextContent("/tmp/result.png");
  await userEvent.click(activities[0]);
  expect(screen.getByText(/tests passed/)).toBeInTheDocument();
  await userEvent.click(activities[2]);
  expect(screen.getByRole("img", { name: "/tmp/result.png" })).toBeInTheDocument();
});

it("renders background terminal polling like Codex CLI", async () => {
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

  expect(screen.getByText("Waited for background terminal")).toBeInTheDocument();
  expect(screen.queryByText(/Background task output/)).not.toBeInTheDocument();
  expect(screen.queryByText(/session_id/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /exec · completed/ })).not.toBeInTheDocument();
});
