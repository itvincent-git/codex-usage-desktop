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

    const sessionCard = within(secondDay!).getByText("fallback-session").closest("article");
    expect(sessionCard).not.toBeNull();
    await userEvent.click(sessionCard!);
    expect(onSessionClick).toHaveBeenCalledWith(resumed);

    sessionCard!.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onSessionClick).toHaveBeenCalledTimes(3);

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
  it("shows the summary name with weak file metadata and avoids repeating a fallback ID", () => {
    render(
      <SessionUsageTable
        sessions={[
          session({ path: "/tmp/titled.jsonl", sessionId: "titled-session.jsonl", threadName: "Fix login flow", sizeBytes: 2048 }),
          session({ path: "/tmp/fallback.jsonl", sessionId: "fallback-session.jsonl", sizeBytes: 3072 }),
        ]}
      />,
    );

    const titledCard = screen.getByText("Fix login flow").closest("article")!;
    const fallbackCard = screen.getByText("fallback-session").closest("article")!;
    expect(within(titledCard).getByText("titled-session")).toBeInTheDocument();
    expect(within(titledCard).getByText("2 KB")).toHaveAttribute("title", "/tmp/titled.jsonl");
    expect(within(fallbackCard).getAllByText("fallback-session")).toHaveLength(1);
    expect(within(fallbackCard).getByText("3 KB")).toHaveAttribute("title", "/tmp/fallback.jsonl");
  });

  it("shows the modified time to the minute and keeps the complete time in a tooltip", () => {
    const modifiedAtMs = new Date("2026-07-15T08:23:47Z").getTime();
    render(<SessionUsageTable sessions={[session({ modifiedAtMs })]} />);

    const expectedTime = new Date(modifiedAtMs).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const time = screen.getByText(expectedTime);
    expect(time.parentElement).toHaveAttribute("title", new Date(modifiedAtMs).toLocaleString());
    expect(time).not.toHaveTextContent("47");
  });

  it("limits project and model badges and exposes complete lists in tooltips", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Badge limits",
      projects: ["/repo/one", "/repo/two", "/repo/three"],
      models: ["model-one", "model-two", "model-three", "model-four"],
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Badge limits").closest("article")!;
    expect(within(card).getByText("one")).toBeInTheDocument();
    expect(within(card).getByText("two")).toBeInTheDocument();
    expect(within(card).queryByText("three")).not.toBeInTheDocument();
    expect(within(card).getByText("+1", { selector: "span[title='/repo/one\\A /repo/two\\A /repo/three']" })).toBeInTheDocument();
    expect(within(card).getByText("model-one")).toBeInTheDocument();
    expect(within(card).getByText("model-three")).toBeInTheDocument();
    expect(within(card).queryByText("model-four")).not.toBeInTheDocument();
    expect(within(card).getByText("+1", { selector: "span[title='model-one, model-two, model-three, model-four']" })).toBeInTheDocument();
  });

  it("uses non-cached input, cached input, and output as non-overlapping token segments", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Token segments",
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 40,
      totalTokens: 140,
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Token segments").closest("article")!;
    const input = card.querySelector<HTMLElement>("[data-token-segment='input']")!;
    const cached = card.querySelector<HTMLElement>("[data-token-segment='cached']")!;
    const output = card.querySelector<HTMLElement>("[data-token-segment='output']")!;
    expect(input.style.width).toBe(`${(80 / 140) * 100}%`);
    expect(cached.style.width).toBe(`${(20 / 140) * 100}%`);
    expect(output.style.width).toBe(`${(40 / 140) * 100}%`);
    expect(within(card).getByRole("img", { name: /80 non-cached input, 20 cached input, 40 output, 140 total/ })).toBeInTheDocument();
    expect(within(card).getByText("(20.0%)", { selector: "span" })).toBeInTheDocument();
  });

  it("shows the complete model name in a session card", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Long model name",
      models: ["gpt-5.6-sol"],
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Long model name").closest("article")!;
    const model = within(card).getByText("gpt-5.6-sol", { selector: "span" });
    expect(model).not.toHaveClass("truncate");
    expect(model.className).not.toContain("max-w-");
  });

  it("renders an empty neutral token bar and neutral cost for an inactive session", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Inactive session",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Inactive session").closest("article")!;
    expect(within(card).getByRole("img", { name: "No token activity" })).toBeEmptyDOMElement();
    expect(card.querySelector("[data-cost-tone='zero']")).toHaveTextContent("$0.00");
    expect(within(card).getByText("No activity")).toBeInTheDocument();
  });

  it("keeps model colors stable and applies relative zero, low, medium, and high cost tones", () => {
    const costSession = (threadName: string, path: string, costUSD: number, model: string) => session({
      threadName,
      path,
      sessionId: `${threadName}.jsonl`,
      costUSD,
      models: [model],
      dailyUsage: [],
    });
    render(<SessionUsageTable sessions={[
      costSession("Zero", "/tmp/zero.jsonl", 0, "shared-model"),
      costSession("Low", "/tmp/low.jsonl", 0.001, "shared-model"),
      costSession("Medium", "/tmp/medium.jsonl", 0.002, "other-model"),
      costSession("High", "/tmp/high.jsonl", 0.003, "third-model"),
    ]} />);

    const card = (name: string) => screen.getByText(name, { selector: "h3" }).closest("article")!;
    expect(card("Zero").querySelector("[data-cost-tone='zero']")).toBeInTheDocument();
    expect(card("Low").querySelector("[data-cost-tone='low']")).toBeInTheDocument();
    expect(card("Medium").querySelector("[data-cost-tone='medium']")).toBeInTheDocument();
    expect(card("High").querySelector("[data-cost-tone='high']")).toBeInTheDocument();
    const sharedTones = screen.getAllByText("shared-model", { selector: "article span" }).map((badge) => badge.getAttribute("data-model-tone"));
    expect(sharedTones).toEqual([sharedTones[0], sharedTones[0]]);
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
