// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import i18n from "@/i18n";
import { buildConversation } from "@/lib/session-conversation";
import type { SessionReplayDetail } from "@/lib/api";
import { ConversationItem } from "./session-detail-modal";

it("keeps each call's tokens visible after deduplicating reads and exposes original output on expansion", async () => {
  await i18n.changeLanguage("en");
  const turn: SessionReplayDetail["turns"][number] = {
    turnId: "1", startedAt: null, completedAt: null, durationMs: null,
    systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [],
    toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items: [],
  };
  for (const [index, totalTokens] of [42000, 45000].entries()) {
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
  expect(screen.getByText("42k tokens")).toBeInTheDocument();
  expect(screen.getByText("45k tokens")).toBeInTheDocument();
  expect(screen.getByText("In 41.5k · Cache 40k · Out 500")).toBeInTheDocument();
  expect(screen.queryByText(/original output/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Explored/ }));
  const calls = screen.getAllByRole("button", { name: /Ran/ });
  expect(calls).toHaveLength(2);
  expect(within(calls[0]).getByText("42k tokens")).toBeInTheDocument();
  expect(within(calls[1]).getByText("45k tokens")).toBeInTheDocument();
  expect(screen.getByText(/original output 0/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "View raw JSONL" })[1]);
  expect(screen.getByText('{"call":1}')).toBeInTheDocument();
});
