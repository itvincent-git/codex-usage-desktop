// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSessionsModal } from "./project-sessions-modal";
import { SessionDetailModal } from "./session-detail-modal";
import { SessionUsageTable } from "./session-usage-table";
import type { SessionDetailRow } from "@/lib/api";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function session(overrides: Partial<SessionDetailRow>): SessionDetailRow {
  return {
    path: "/tmp/rollout.jsonl",
    sessionId: "fallback-session.jsonl",
    threadName: null,
    modifiedAtMs: new Date("2026-07-15T08:00:00Z").getTime(),
    sizeBytes: 1024,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 40,
    reasoningOutputTokens: 0,
    totalTokens: 140,
    costUSD: 0.001,
    models: ["gpt-5"],
    projects: ["/repo/app"],
    dailyUsage: [
      {
        date: "2026-07-15",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningOutputTokens: 0,
        totalTokens: 140,
        costUSD: 0.001,
        models: ["gpt-5"],
        projects: ["/repo/app"],
      },
    ],
    ...overrides,
  };
}

describe("session daily usage", () => {
  it("splits resumed usage by rollup date and opens the complete session", async () => {
    const onSessionClick = vi.fn();
    const resumed = session({
      inputTokens: 300,
      cachedInputTokens: 60,
      outputTokens: 120,
      totalTokens: 420,
      costUSD: 0.003,
      models: ["gpt-5", "gpt-5-mini"],
      projects: ["/repo/first", "/repo/second"],
      dailyUsage: [
        {
          date: "2026-07-01",
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 40,
          reasoningOutputTokens: 0,
          totalTokens: 140,
          costUSD: 0.001,
          models: ["gpt-5"],
          projects: ["/repo/first"],
        },
        {
          date: "2026-07-02",
          inputTokens: 200,
          cachedInputTokens: 40,
          outputTokens: 80,
          reasoningOutputTokens: 0,
          totalTokens: 280,
          costUSD: 0.002,
          models: ["gpt-5-mini"],
          projects: ["/repo/second"],
        },
      ],
    });

    const { rerender } = render(
      <SessionUsageTable sessions={[resumed]} onSessionClick={onSessionClick} />,
    );

    const firstDay = document.getElementById("date-group-2026-07-01");
    const secondDay = document.getElementById("date-group-2026-07-02");
    expect(firstDay).not.toBeNull();
    expect(secondDay).not.toBeNull();
    expect(firstDay).toHaveTextContent("140");
    expect(firstDay).toHaveTextContent("gpt-5");
    expect(firstDay).not.toHaveTextContent("420");
    expect(secondDay).toHaveTextContent("280");
    expect(secondDay).toHaveTextContent("gpt-5-mini");
    expect(secondDay).not.toHaveTextContent("420");

    const sessionRow = within(secondDay!).getByText("fallback-session").closest("tr");
    expect(sessionRow).not.toBeNull();
    await userEvent.click(sessionRow!);
    expect(onSessionClick).toHaveBeenCalledWith(resumed);

    rerender(
      <SessionUsageTable
        sessions={[resumed]}
        selectedProject="/repo/first"
        onSessionClick={onSessionClick}
      />,
    );
    expect(document.getElementById("date-group-2026-07-01")).not.toBeNull();
    expect(document.getElementById("date-group-2026-07-02")).toBeNull();
  });

  it("keeps sessions without usage on their modified date", () => {
    render(<SessionUsageTable sessions={[session({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      dailyUsage: [{
        date: "2026-07-01",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        costUSD: 0,
        models: [],
        projects: [],
      }],
    })]} />);

    expect(document.getElementById("date-group-2026-07-15")).not.toBeNull();
    expect(document.getElementById("date-group-2026-07-01")).toBeNull();
    expect(screen.getAllByText("No activity").length).toBeGreaterThan(0);
  });
});

describe("session titles", () => {
  it("shows the summary name with the session ID and falls back to the ID", () => {
    render(
      <SessionUsageTable
        sessions={[
          session({ path: "/tmp/titled.jsonl", sessionId: "titled-session.jsonl", threadName: "Fix login flow" }),
          session({ path: "/tmp/fallback.jsonl", sessionId: "fallback-session.jsonl" }),
        ]}
      />,
    );

    expect(screen.getByText("Fix login flow")).toBeInTheDocument();
    expect(screen.getByText("titled-session")).toBeInTheDocument();
    expect(screen.getByText("fallback-session")).toBeInTheDocument();
  });

  it("filters project sessions by summary name", async () => {
    invokeMock.mockResolvedValue([
      session({ path: "/tmp/alpha.jsonl", sessionId: "alpha-id.jsonl", threadName: "Alpha launch notes" }),
      session({ path: "/tmp/beta.jsonl", sessionId: "beta-id.jsonl", threadName: "Beta cleanup" }),
    ]);

    render(
      <ProjectSessionsModal
        project={{ project: "/repo/app", displayName: "app", totalTokens: 280, costUSD: 0.002 }}
        onClose={vi.fn()}
        onGoToSessions={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha launch notes")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("Search title, session ID, or model..."), "alpha launch");

    expect(screen.getByText("Alpha launch notes")).toBeInTheDocument();
    expect(screen.getByText("alpha-id")).toBeInTheDocument();
    expect(screen.queryByText("Beta cleanup")).not.toBeInTheDocument();
  });

  it("falls back to the session ID in session details", async () => {
    invokeMock.mockResolvedValue({
      path: "/tmp/fallback.jsonl",
      sessionId: "fallback-session.jsonl",
      threadName: null,
      modifiedAtMs: new Date("2026-07-15T08:00:00Z").getTime(),
      sizeBytes: 1024,
      rawJsonl: "",
      summary: {
        startTime: null,
        endTime: null,
        durationMs: null,
        timeToFirstTokenMs: null,
        cwd: null,
        projects: [],
        models: [],
        cliVersion: null,
        git: {},
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningOutputTokens: 0,
        totalTokens: 140,
        costUSD: 0.001,
        turnCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        patchCount: 0,
        errorCount: 0,
      },
      turns: [],
    });

    render(<SessionDetailModal session={session({})} onClose={vi.fn()} />);

    expect(await screen.findByRole("dialog", { name: "fallback-session" })).toBeInTheDocument();
  });
});
