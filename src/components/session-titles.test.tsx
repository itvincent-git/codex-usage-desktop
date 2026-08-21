// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSessionsModal } from "./project-sessions-modal";
import { SessionDetailModal } from "./session-detail-modal";
import { SessionUsageTable } from "./session-usage-table";
import type { SessionDetailRow } from "@/lib/api";
import i18n from "@/i18n";

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
  it("shows quota color scales, low-resolution values, and multiple resets", () => {
    const window = (delta: number, belowResolution = false) => ({
      windowMinutes: 300,
      resetsAt: "2026-07-15T13:00:00Z",
      observedStartAt: "2026-07-15T08:00:00Z",
      observedEndAt: "2026-07-15T09:00:00Z",
      observedStartPercent: 10,
      observedEndPercent: 10 + delta,
      observedDeltaPercent: delta,
      belowResolution,
    });
    render(<SessionUsageTable sessions={[session({
      threadName: "Quota session",
      quotaUsage: { fiveHour: [window(99)], weekly: [] },
      dailyUsage: [{
        date: "2026-07-15",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningOutputTokens: 0,
        totalTokens: 140,
        costUSD: 0.001,
        models: ["gpt-5"],
        projects: ["/repo/app"],
        quotaUsage: { fiveHour: [window(2), window(0, true)], weekly: [window(75)] },
      }],
    })]} />);

    const card = screen.getByText("Quota session").closest("article")!;
    const fiveHourValues = within(card).getByText("5h").nextElementSibling;
    expect(fiveHourValues).toHaveClass("flex-col");
    expect(fiveHourValues).toHaveTextContent("Approx. 2% · 88% left<1% · 90% left");
    expect(within(card).getByText("Weekly").parentElement).toHaveTextContent("Approx. 75% · 15% left");
    expect(card).not.toHaveTextContent("99%");
    expect(within(card).getByRole("img", { name: "5h usage Approx. 2%, remaining 88%" })).toHaveAttribute("data-quota-tone", "high");
    expect(within(card).getByRole("img", { name: "5h usage <1%, remaining 90%" })).toHaveAttribute("data-quota-tone", "high");
    expect(within(card).getByRole("img", { name: "Weekly usage Approx. 75%, remaining 15%" })).toHaveAttribute("data-quota-tone", "low");
    expect(within(card).getByLabelText("Estimated 5-hour and weekly quota usage and remaining quota")).toHaveAttribute("title", expect.stringContaining("latest observed snapshot"));
  });

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
    expect(sessionCard!.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe(`${(160 / 280) * 100}%`);
    expect(within(sessionCard!).getByTestId("session-cost")).toHaveTextContent("$0.002");

    await userEvent.click(within(firstDay!).getByRole("button"));
    const firstDayCard = within(firstDay!).getByText("fallback-session").closest("article")!;
    expect(firstDayCard.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe(`${(80 / 140) * 100}%`);
    expect(within(firstDayCard).getByTestId("token-total")).toHaveTextContent("140");
    expect(within(firstDayCard).getByTestId("session-cost")).toHaveTextContent("$0.001");

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
  it("keeps nested subagent sessions collapsed under their main session and shows distinct agent identities", async () => {
    const user = userEvent.setup();
    const onSessionClick = vi.fn();
    const main = session({
      path: "/tmp/main.jsonl",
      sessionId: "main.jsonl",
      threadId: "main-thread",
      threadName: "Main session",
    });
    const explorer = session({
      path: "/tmp/explorer.jsonl",
      sessionId: "explorer.jsonl",
      threadId: "explorer-thread",
      parentThreadId: "main-thread",
      threadName: "Inspect how titles are rendered",
      agentPath: "/root/investigate_titles",
      agentNickname: "Ada",
      agentRole: "code_explorer",
    });
    const worker = session({
      path: "/tmp/worker.jsonl",
      sessionId: "worker.jsonl",
      threadId: "worker-thread",
      parentThreadId: "explorer-thread",
      threadName: "Implement the session grouping",
      agentPath: "/root/fix_sidebar",
      agentNickname: "Grace",
      agentRole: "worker",
    });

    render(
      <SessionUsageTable
        sessions={[main, explorer, worker]}
        onSessionClick={onSessionClick}
      />,
    );

    expect(screen.getByText("Main session")).toBeInTheDocument();
    expect(screen.queryByText("investigate titles")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Expand 2 subagent sessions under Main session" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("investigate titles")).toBeInTheDocument();
    expect(screen.getByText("fix sidebar")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("code explorer")).toBeInTheDocument();
    expect(screen.getAllByText("Subagent")).toHaveLength(2);
    await user.click(screen.getByText("fix sidebar").closest("article")!);
    expect(onSessionClick).toHaveBeenCalledWith(worker);

    await user.click(toggle);
    expect(screen.queryByText("investigate titles")).not.toBeInTheDocument();
  });

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
    expect(time).toHaveAttribute("title", new Date(modifiedAtMs).toLocaleString());
    expect(time).not.toHaveTextContent("47");
  });

  it("limits project and model metadata and exposes complete lists in tooltips", () => {
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
    expect(within(card).getAllByText("+1")[0]).toHaveAttribute("title", "/repo/one\n/repo/two\n/repo/three");
    expect(within(card).getByText("model-one")).toBeInTheDocument();
    expect(within(card).getByText("model-three")).toBeInTheDocument();
    expect(within(card).queryByText("model-four")).not.toBeInTheDocument();
    expect(within(card).getAllByText("+1")[1].parentElement).toHaveAttribute("title", "model-one, model-two, model-three, model-four");
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
    expect(within(card).getByText("20", { selector: "strong" })).toBeInTheDocument();
  });

  it("keeps tiny non-zero token composition segments visible", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Tiny cached segment",
      inputTokens: 999,
      cachedInputTokens: 1,
      outputTokens: 1_000,
      totalTokens: 1_999,
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Tiny cached segment").closest("article")!;
    const cached = card.querySelector<HTMLElement>("[data-token-segment='cached']")!;
    expect(parseFloat(cached.style.width)).toBeCloseTo((1 / 1_999) * 100);
    expect(cached).toHaveStyle({ minWidth: "2px" });
  });

  it("normalizes token composition and shows total tokens and cost inline", () => {
    render(<SessionUsageTable sessions={[
      session({
        path: "/tmp/smaller.jsonl",
        sessionId: "smaller.jsonl",
        threadName: "Smaller session",
        inputTokens: 60,
        cachedInputTokens: 20,
        outputTokens: 40,
        totalTokens: 100,
        costUSD: 0.001,
        dailyUsage: [],
      }),
      session({
        path: "/tmp/larger.jsonl",
        sessionId: "larger.jsonl",
        threadName: "Larger session",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 80,
        totalTokens: 200,
        costUSD: 0.004,
        dailyUsage: [],
      }),
    ]} />);

    const smaller = screen.getByText("Smaller session").closest("article")!;
    const larger = screen.getByText("Larger session").closest("article")!;
    expect(smaller.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe("40%");
    expect(smaller.querySelector<HTMLElement>("[data-token-segment='cached']")!.style.width).toBe("20%");
    expect(smaller.querySelector<HTMLElement>("[data-token-segment='output']")!.style.width).toBe("40%");
    expect(larger.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe("50%");
    expect(larger.querySelector<HTMLElement>("[data-token-segment='cached']")!.style.width).toBe("10%");
    expect(larger.querySelector<HTMLElement>("[data-token-segment='output']")!.style.width).toBe("40%");
    expect(within(smaller).getByTestId("token-total")).toHaveTextContent("100");
    expect(within(larger).getByTestId("token-total")).toHaveTextContent("200");
    expect(within(smaller).getByTestId("session-cost")).toHaveTextContent("$0.001");
    expect(within(larger).getByTestId("session-cost")).toHaveTextContent("$0.004");
    expect(within(smaller).getByTestId("token-total").querySelector<HTMLElement>("[aria-hidden='true']")).toHaveStyle({ width: "50%" });
    expect(within(larger).getByTestId("token-total").querySelector<HTMLElement>("[aria-hidden='true']")).toHaveStyle({ width: "100%" });
    expect(within(smaller).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "low");
    expect(within(larger).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "high");
    expect(within(smaller).getByRole("img", { name: /Token breakdown: 40 non-cached input, 20 cached input, 40 output, 100 total$/ })).toBeInTheDocument();
  });

  it("uses compact numbers for million-token session totals", () => {
    render(<SessionUsageTable sessions={[session({
      threadName: "Large session",
      inputTokens: 11_330_000,
      cachedInputTokens: 11_120_000,
      outputTokens: 28_100,
      totalTokens: 11_360_000,
      costUSD: 7.46,
      dailyUsage: [],
    })]} />);

    const card = screen.getByText("Large session").closest("article")!;
    expect(within(card).getByTestId("token-total")).toHaveTextContent("11.36M");
    expect(card).toHaveTextContent("Output 28.1K");
    expect(within(card).getByTestId("session-cost")).toHaveTextContent("$7.46");
  });

  it("keeps token composition independent of collapsed dates", () => {
    render(<SessionUsageTable sessions={[
      session({
        path: "/tmp/newer.jsonl",
        sessionId: "newer.jsonl",
        threadName: "Visible newer session",
        modifiedAtMs: new Date("2026-07-15T08:00:00Z").getTime(),
        inputTokens: 50,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 50,
        costUSD: 0.001,
        dailyUsage: [{
          date: "2026-07-15",
          inputTokens: 50,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 50,
          costUSD: 0.001,
          models: ["gpt-5"],
          projects: ["/repo/app"],
        }],
      }),
      session({
        path: "/tmp/older.jsonl",
        sessionId: "older.jsonl",
        threadName: "Collapsed older maximum",
        modifiedAtMs: new Date("2026-07-14T08:00:00Z").getTime(),
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 100,
        costUSD: 0.002,
        dailyUsage: [{
          date: "2026-07-14",
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 100,
          costUSD: 0.002,
          models: ["gpt-5"],
          projects: ["/repo/app"],
        }],
      }),
    ]} />);

    expect(screen.queryByText("Collapsed older maximum")).not.toBeInTheDocument();
    const visible = screen.getByText("Visible newer session").closest("article")!;
    expect(visible.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe("100%");
    expect(within(visible).getByTestId("token-total")).toHaveTextContent("50");
    expect(within(visible).getByTestId("session-cost")).toHaveTextContent("$0.001");
  });

  it("shows inline totals after applying the project filter", () => {
    render(<SessionUsageTable
      selectedProject="/repo/selected"
      sessions={[
        session({
          path: "/tmp/selected.jsonl",
          sessionId: "selected.jsonl",
          threadName: "Selected project session",
          inputTokens: 50,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 50,
          costUSD: 0.001,
          projects: ["/repo/selected"],
          dailyUsage: [],
        }),
        session({
          path: "/tmp/other.jsonl",
          sessionId: "other.jsonl",
          threadName: "Other project maximum",
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 100,
          costUSD: 0.002,
          projects: ["/repo/other"],
          dailyUsage: [],
        }),
      ]}
    />);

    const selected = screen.getByText("Selected project session").closest("article")!;
    expect(screen.queryByText("Other project maximum")).not.toBeInTheDocument();
    expect(selected.querySelector<HTMLElement>("[data-token-segment='input']")!.style.width).toBe("100%");
    expect(within(selected).getByTestId("token-total")).toHaveTextContent("50");
    expect(within(selected).getByTestId("session-cost")).toHaveTextContent("$0.001");
  });

  it("keeps zero bars empty and makes tiny non-zero values visible", () => {
    render(<SessionUsageTable sessions={[
      session({
        path: "/tmp/zero.jsonl",
        sessionId: "zero.jsonl",
        threadName: "Zero comparison session",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUSD: 0,
        dailyUsage: [],
      }),
      session({
        path: "/tmp/tiny.jsonl",
        sessionId: "tiny.jsonl",
        threadName: "Tiny comparison session",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 1,
        costUSD: 0.000001,
        dailyUsage: [],
      }),
      session({
        path: "/tmp/maximum.jsonl",
        sessionId: "maximum.jsonl",
        threadName: "Maximum comparison session",
        inputTokens: 10_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 10_000,
        costUSD: 1,
        dailyUsage: [],
      }),
    ]} />);

    const zero = screen.getByText("Zero comparison session").closest("article")!;
    const tiny = screen.getByText("Tiny comparison session").closest("article")!;
    expect(within(zero).getByTestId("token-bar")).toBeEmptyDOMElement();
    expect(within(zero).getByTestId("token-total")).toHaveTextContent("0");
    expect(within(zero).getByTestId("session-cost")).toHaveTextContent("$0.00");
    expect(zero.innerHTML).not.toContain("NaN");
    expect(tiny.querySelector<HTMLElement>("[data-token-segment='input']")).toHaveStyle({ width: "100%", minWidth: "2px" });
    expect(within(tiny).getByTestId("token-total")).toHaveTextContent("1");
    expect(within(tiny).getByTestId("session-cost")).toHaveTextContent("$0.00");
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
    expect(within(card).getByTestId("token-total")).toHaveTextContent("0");
    expect(within(card).getByTestId("session-cost")).toHaveTextContent("$0.00");
    expect(within(card).getByText("No activity")).toBeInTheDocument();
  });

  it("adds stable model colors and relative cost tones", () => {
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
    expect(within(card("Zero")).getByTestId("session-cost")).toHaveTextContent("$0.00");
    expect(within(card("Low")).getByTestId("session-cost")).toHaveTextContent("$0.001");
    expect(within(card("Medium")).getByTestId("session-cost")).toHaveTextContent("$0.002");
    expect(within(card("High")).getByTestId("session-cost")).toHaveTextContent("$0.003");
    expect(within(card("Zero")).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "zero");
    expect(within(card("Low")).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "low");
    expect(within(card("Medium")).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "medium");
    expect(within(card("High")).getByTestId("session-cost")).toHaveAttribute("data-cost-tone", "high");
    const sharedModels = screen.getAllByText("shared-model", { selector: "article span" });
    expect(sharedModels).toHaveLength(2);
    expect(sharedModels[0]).toHaveAttribute("data-model-tone", sharedModels[1].getAttribute("data-model-tone"));
    expect(sharedModels[0]).toHaveClass("rounded-full", "border");
  });

  it("filters project sessions by summary name", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "fetch_session_details") return [
        session({ path: "/tmp/alpha.jsonl", sessionId: "alpha-id.jsonl", threadName: "Alpha launch notes" }),
        session({ path: "/tmp/beta.jsonl", sessionId: "beta-id.jsonl", threadName: "Beta cleanup" }),
      ];
      if (command === "fetch_project_analytics") return {
        project: "/repo/app", displayName: "app", range: "30d", startDate: "2026-07-01", endDate: "2026-07-30", timezone: "UTC",
        summary: { project: "/repo/app", displayName: "app", inputTokens: 200, cachedInputTokens: 40, outputTokens: 80, totalTokens: 280, costUSD: 0.002 },
        models: Array.from({ length: 7 }, (_, index) => ({ model: `model-${index + 1}`, totalTokens: 70 - index * 10 })),
        daily: [{ date: "2026-07-30", inputTokens: 200, cachedInputTokens: 40, outputTokens: 80, totalTokens: 280, costUSD: 0.002 }],
      };
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(
      <ProjectSessionsModal
        project={{ project: "/repo/app", displayName: "app", totalTokens: 280, costUSD: 0.002 }}
        range="30d"
        onClose={vi.fn()}
        onGoToSessions={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha launch notes")).toBeInTheDocument());
    const sessionsTableContainer = screen.getByRole("table").parentElement!;
    expect(sessionsTableContainer).toHaveClass("overflow-x-auto");
    expect(sessionsTableContainer).not.toHaveClass("overflow-auto", "max-h-[36vh]");
    expect(invokeMock).toHaveBeenCalledWith("fetch_project_analytics", { project: "/repo/app", range: "30d" });
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Daily token and cost trend")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Search title, session ID, or model..."), "alpha launch");

    expect(screen.getByText("Alpha launch notes")).toBeInTheDocument();
    expect(screen.getByText(/alpha-id/)).toBeInTheDocument();
    expect(screen.queryByText("Beta cleanup")).not.toBeInTheDocument();
  });

  it("keeps sessions usable when project analytics fails", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_session_details") return [session({ threadName: "Available session" })];
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<ProjectSessionsModal project={{ project: "/repo/app", displayName: "app", totalTokens: 140, costUSD: 0.001 }} range="7d" onClose={vi.fn()} onGoToSessions={vi.fn()} />);

    expect(await screen.findByText("Available session")).toBeInTheDocument();
    expect(await screen.findByText(/analytics offline/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search title, session ID, or model...")).toBeEnabled();
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

  it("shows complete quota windows and localized estimation guidance in session details", async () => {
    await i18n.changeLanguage("zh");
    invokeMock.mockResolvedValue({
      path: "/tmp/fallback.jsonl",
      sessionId: "fallback-session.jsonl",
      threadName: null,
      modifiedAtMs: 0,
      sizeBytes: 0,
      rawJsonl: "",
      summary: {
        startTime: null, endTime: null, durationMs: null, timeToFirstTokenMs: null,
        cwd: null, projects: [], models: [], cliVersion: null, git: {}, inputTokens: 0,
        cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0,
        costUSD: 0, turnCount: 0, messageCount: 0, toolCallCount: 0, patchCount: 0, errorCount: 0,
      },
      turns: [],
    });
    const quotaWindow = {
      windowMinutes: 300,
      resetsAt: "2026-07-15T13:00:00Z",
      observedStartAt: "2026-07-15T08:00:00Z",
      observedEndAt: "2026-07-15T09:00:00Z",
      observedStartPercent: 10,
      observedEndPercent: 14,
      observedDeltaPercent: 4,
      belowResolution: false,
    };

    render(<SessionDetailModal session={session({ quotaUsage: { fiveHour: [quotaWindow, { ...quotaWindow, observedEndPercent: 12, observedDeltaPercent: 2 }], weekly: [] } })} onClose={vi.fn()} />);

    expect(await screen.findByText("观测到的限额消耗")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("周")).toBeInTheDocument();
    expect(screen.getByText("使用了 4% • 90% → 86%")).toBeInTheDocument();
    expect(screen.getByText("使用了 2% • 90% → 88%")).toBeInTheDocument();
    expect(screen.getByText(/列表显示最近一次观测快照时的剩余额度/)).toBeInTheDocument();
    await i18n.changeLanguage("en");
  });
});
