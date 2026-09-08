import { describe, expect, it } from "vitest";
import { buildConversation, classifyExploration, summarizeOutput, type ReplayItem } from "./session-conversation";
import type { SessionReplayDetail } from "./api";

function replayTurn(items: ReplayItem[]): SessionReplayDetail["turns"][number] {
  return { turnId: "1", startedAt: null, completedAt: null, durationMs: null, systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [], toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items };
}
function command(cmd: string, overrides: Partial<Extract<ReplayItem, { kind: "toolCall" }>> = {}): ReplayItem {
  return { kind: "toolCall", callId: cmd, name: "exec_command", arguments: JSON.stringify({ cmd }), output: JSON.stringify({ exit_code: 0, output: "result" }), stderr: null, startedAt: null, completedAt: "2026-09-09", durationMs: 100, status: "completed", isError: false, ...overrides };
}
function usage(totalTokens: number): ReplayItem {
  return { kind: "tokenUsage", timestamp: null, model: "gpt-5", inputTokens: totalTokens - 10, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens };
}

describe("conversation projection", () => {
  it("groups adjacent exploration without losing calls, raw provenance or token attribution", () => {
    const blocks = buildConversation(replayTurn([
      command("rg -n shimmer src", { rawJsonlLineNumbers: [1, 2] }), usage(100),
      command("cat src/a.rs"), usage(200), command("cat src/a.rs src/b.rs"), usage(300),
      { kind: "message", role: "assistant", text: "Next", source: "message", timestamp: null },
      command("ls src"), usage(400),
    ]));
    expect(blocks.map((block) => block.kind)).toEqual(["exploration", "item", "exploration"]);
    const first = blocks[0];
    if (first.kind !== "exploration") throw new Error("Expected exploration");
    expect(first.entries.map((entry) => entry.tokenUsage?.totalTokens)).toEqual([100, 200, 300]);
    expect(first.entries[0].item.rawJsonlLineNumbers).toEqual([1, 2]);
    expect(first.actions[0]).toEqual([{ label: "Search", text: "shimmer in src" }]);
  });

  it("keeps failures, running commands, writes and ambiguous shell scripts visible", () => {
    const blocks = buildConversation(replayTurn([
      command("cat a", { isError: true }), command("cat a", { status: "running" }),
      command("cat a", { output: JSON.stringify({ exit_code: 2, output: "no file" }) }),
      command("cat a && pnpm test"), command("cat a&&pnpm test"), command("cat a > b"),
      command("cat a | sh"), command("cat $(touch x)"), command("cat a &"), command("cat 'unterminated"),
    ]));
    expect(blocks.every((block) => block.kind === "item")).toBe(true);
  });

  it("does not present the first command of an unpaired batch as exploration", () => {
    const blocks = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"cat a"})); text(await tools.exec_command({cmd:"pnpm test"}));',
    }), usage(500)]));
    expect(blocks[0].kind).toBe("item");
  });

  it("recognizes literal RTK read, search and list commands", () => {
    expect(classifyExploration("rtk proxy cat 'src/a b.rs'")).toEqual([{ label: "Read", text: "src/a b.rs" }]);
    expect(classifyExploration("rtk sed -n '1,20p' src/a.rs")).toEqual([{ label: "Read", text: "src/a.rs" }]);
    expect(classifyExploration("rg --files src")?.[0].label).toBe("List");
    expect(classifyExploration("rtk proxy sh -c 'cat src/a.rs && ls src'")).toEqual([
      { label: "Read", text: "src/a.rs" }, { label: "List", text: "src" },
    ]);
    expect(classifyExploration("rg '(shimmer|status)' src")?.[0].label).toBe("Search");
    expect(classifyExploration("sed -i 's/a/b/' src/a.rs")).toBeNull();
  });

  it("keeps the head and tail with an exact omitted line count", () => {
    expect(summarizeOutput("1\n2\n3\n4\n5\n6\n7\n8")).toEqual({ head: ["1", "2", "3"], tail: ["7", "8"], omitted: 3 });
    expect(summarizeOutput("1\n2")).toEqual({ head: ["1", "2"], tail: [], omitted: 0 });
  });
});
