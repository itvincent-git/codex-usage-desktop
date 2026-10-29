// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionUsageTable } from "./session-usage-table";
import { SessionCredits } from "./session-credits";
import { useSessionCredits } from "@/hooks/use-session-credits";
import type { SessionDetailRow, SessionCreditsRow } from "@/lib/api";
import i18n from "@/i18n";

vi.mock("@/hooks/use-session-credits", () => ({ useSessionCredits: vi.fn() }));
const credit: SessionCreditsRow = { threadId: "a", dataStatus: "partial", balanceUsageCredits: "-0.000004", usageSource: "credits", dataAsOf: null, fetchedAt: "now", stale: true, isMock: true };
function session(threadId: string, dates = ["2026-10-28"]): SessionDetailRow {
  return {
    threadId, path: `/tmp/${threadId}.jsonl`, sessionId: threadId, threadName: `Session ${threadId}`,
    modifiedAtMs: Date.parse("2026-10-28T04:00:00Z"), sizeBytes: 100, turnCount: 1,
    inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0,
    totalTokens: 110, costUSD: 0.52, models: ["gpt-5"], projects: ["/fixture"],
    dailyUsage: dates.map((date) => ({ date, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens: 110, costUSD: 0.52, models: ["gpt-5"], projects: ["/fixture"] })),
  };
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.mocked(useSessionCredits).mockReturnValue({ rows: { a: credit }, loading: false, error: null, refresh: vi.fn() });
});
afterEach(cleanup);

it("collects only expanded loaded cards, with the lifetime ID on both dates", () => {
  render(<SessionUsageTable showSessionCredits sessions={[session("a", ["2026-10-28", "2026-10-27"]), session("b", ["2026-10-27"])]} />);
  expect(vi.mocked(useSessionCredits).mock.lastCall?.[1].map((thread) => thread.threadId)).toEqual(["a"]);
  fireEvent.click(document.querySelector('#date-group-2026-10-27 > button')!);
  expect(vi.mocked(useSessionCredits).mock.lastCall?.[1].map((thread) => thread.threadId)).toEqual(["a", "a", "b"]);
  expect(screen.getAllByText("Balance debits · session total")).toHaveLength(3);
  expect(screen.getAllByText("Partial data")).toHaveLength(2);
  expect(screen.getAllByTestId("session-cost")).toHaveLength(3);
  expect(document.querySelector('#date-group-2026-10-28 > button')).not.toHaveTextContent("credits");
});

it("excludes unloaded groups and inactive outer containers", () => {
  const sessions = [session("a"), session("b")];
  const { rerender } = render(<SessionUsageTable embedded projectDay agentGroupPageSize={1} showSessionCredits sessions={sessions} />);
  expect(vi.mocked(useSessionCredits).mock.lastCall?.[1]).toHaveLength(1);
  fireEvent.click(screen.getByText("Load more sessions"));
  expect(vi.mocked(useSessionCredits).mock.lastCall?.[1]).toHaveLength(2);
  rerender(<SessionUsageTable embedded projectDay showSessionCredits creditsActive={false} sessions={sessions} />);
  expect(vi.mocked(useSessionCredits).mock.lastCall).toEqual([false, []]);
  expect(screen.queryByTestId("session-credits")).not.toBeInTheDocument();
});

it("shows partial, cached and mock annotations and preserves the raw amount", () => {
  render(<SessionCredits row={credit} loading={false} error={null} hasThreadId />);
  expect(screen.getByTestId("session-credits")).toHaveTextContent("-0.0000040 credits");
  expect(screen.getByText("Cached data")).toBeInTheDocument();
  expect(screen.getByText("Simulated data")).toBeInTheDocument();
  expect(screen.getByTestId("session-credits").title).toContain("-0.000004");
  expect(screen.getByTestId("session-credits").title).toContain("refunds");
});

it("keeps unavailable amounts distinct from zero and contains errors to the card", () => {
  const { rerender } = render(<SessionCredits row={{ ...credit, dataStatus: "unavailable", balanceUsageCredits: null }} loading={false} error="networkError" hasThreadId />);
  expect(screen.getByTestId("session-credits")).toHaveTextContent("—");
  rerender(<SessionCredits row={{ ...credit, dataStatus: "available", balanceUsageCredits: "0E-10" }} loading={false} error={null} hasThreadId />);
  expect(screen.getByTestId("session-credits")).toHaveTextContent("0.00 credits");
  rerender(<SessionUsageTable showSessionCredits sessions={[session("a")]} />);
  expect(screen.getByText("Session a")).toBeInTheDocument();
  expect(screen.getByTestId("session-cost")).toHaveTextContent("$0.52");
});
