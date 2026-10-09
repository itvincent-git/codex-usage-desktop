// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAnalyticsResponse, ProjectSessionDaysResponse, SessionDetailRow } from "@/lib/api";
import { ProjectSessionsModal } from "./project-sessions-modal";
import { ProjectSessionDayView } from "./project-session-day";
import i18n from "@/i18n";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const project = { project: "/repo/app", displayName: "app", totalTokens: 140, costUSD: 0.001 };
const day = (date: string) => ({ date, sessionCount: 1, totalTokens: 140, costUSD: 0.001 });
const dates = (count: number) => Array.from({ length: count }, (_, index) => new Date(Date.UTC(2026, 6, 10 - index)).toISOString().slice(0, 10));
const response = (dates: string[], startDate = "2026-07-01"): ProjectSessionDaysResponse => ({
  startDate, endDate: "2026-07-10", timezone: "UTC", totalSessions: dates.length, matchingSessions: dates.length,
  days: dates.map(day), nextBefore: null,
});
const analytics = (range: string, startDate = "2026-07-01"): ProjectAnalyticsResponse => ({
  ...project, range, startDate, endDate: "2026-07-10", timezone: "UTC",
  summary: { ...project, inputTokens: 100, cachedInputTokens: 20, outputTokens: 40 }, models: [], daily: [],
});
const session = (date: string, index = 0): SessionDetailRow => ({
  path: `/tmp/task-${index}.jsonl`, sessionId: `task-${index}`, threadName: `Task ${index}`,
  modifiedAtMs: Date.parse(`${date}T08:00:00Z`) - index, sizeBytes: 100,
  inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 0, totalTokens: 140, costUSD: 0.001,
  models: ["gpt-5"], projects: [project.project],
  dailyUsage: [{ ...day(date), inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 0, models: ["gpt-5"], projects: [project.project] }],
});

function renderModal(range = "custom:2026-07-01_2026-07-10") {
  return render(<ProjectSessionsModal project={project} range={range} onClose={vi.fn()} onGoToSessions={vi.fn()} />);
}

describe("project session pagination", () => {
  beforeEach(async () => {
    invoke.mockReset();
    await i18n.changeLanguage("en");
  });

  it("shows all selected-range days immediately while loading session details on expansion", async () => {
    const dates = Array.from({ length: 10 }, (_, index) => `2026-07-${String(10 - index).padStart(2, "0")}`);
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_project_session_days") return response(dates);
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    expect([...document.querySelectorAll('[id^="date-group-"]')].map((group) => group.id))
      .toEqual(dates.map((date) => `date-group-${date}`));
    expect(screen.getByRole("button", { name: "Load more days" })).toBeInTheDocument();
    expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_day_sessions")).toHaveLength(1);
    await userEvent.click(within(document.getElementById("date-group-2026-07-01")!).getByRole("button"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_project_day_sessions", {
      project: project.project, range: "custom:2026-07-01_2026-07-10", date: "2026-07-01", query: "",
    }));
  });

  it("doubles the date range on every click while preserving existing days and their expansion state", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      const start = args.range.slice("custom:".length).split("_")[0];
      if (command === "fetch_project_analytics") return analytics(args.range, start);
      if (command === "fetch_project_session_days") return response(dates(start === "2026-06-01" ? 40 : start === "2026-06-21" ? 20 : 10), start);
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    const first = document.getElementById("date-group-2026-07-10")!;
    await userEvent.click(within(first).getAllByRole("button")[0]);
    for (const [start, count] of [["2026-06-21", 20], ["2026-06-01", 40]] as const) {
      await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
      await waitFor(() => expect(document.querySelectorAll('[id^="date-group-"]')).toHaveLength(count));
      expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: `custom:${start}_2026-07-10`, query: "", before: null });
      expect(invoke).toHaveBeenCalledWith("fetch_project_analytics", { project: project.project, range: `custom:${start}_2026-07-10` });
      expect(screen.getByTestId("project-modal-header")).toHaveTextContent(`${start} – 2026-07-10`);
      expect(document.getElementById("date-group-2026-07-10")).toBe(first);
      expect(within(first).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
    }
    expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_day_sessions")).toHaveLength(1);
    await userEvent.click(within(document.getElementById("date-group-2026-06-01")!).getByRole("button"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_project_day_sessions", { project: project.project, range: "custom:2026-06-01_2026-07-10", date: "2026-06-01", query: "" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search project sessions" }), "older");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: "custom:2026-06-01_2026-07-10", query: "older", before: null }));
  });

  it("ignores an old range expansion response after the search changes", async () => {
    let completeMore!: (value: ProjectSessionDaysResponse) => void;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") {
        if (args.query) return { ...response(["2026-07-01"]), matchingSessions: 1 };
        if (args.range !== "custom:2026-07-01_2026-07-10") return new Promise<ProjectSessionDaysResponse>((resolve) => { completeMore = resolve; });
        return response(["2026-07-10"]);
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search project sessions" }), "old task");
    await waitFor(() => expect(document.getElementById("date-group-2026-07-01")).toBeInTheDocument());
    expect(screen.getByText("Showing 1 matching sessions")).toBeInTheDocument();
    await act(async () => completeMore(response(["2026-07-09"])));
    expect(document.getElementById("date-group-2026-07-09")).toBeNull();
    expect(document.getElementById("date-group-2026-07-10")).toBeNull();
  });

  it("retries a failed expansion while preserving existing days", async () => {
    let attempts = 0;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") {
        if (args.range === "custom:2026-07-01_2026-07-10") return response(["2026-07-10"]);
        if (++attempts === 1) throw new Error("page unavailable");
        return response(["2026-07-10", "2026-06-21"], "2026-06-21");
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("page unavailable");
    expect(screen.getByText("Task 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(document.getElementById("date-group-2026-06-21")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets loaded days when the selected range changes", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") {
        if (args.range === "1d") return response(["2026-07-10"], "2026-07-10");
        if (args.range === "custom:2026-06-21_2026-07-10") return response(["2026-07-01", "2026-06-21"], "2026-06-21");
        return response(["2026-07-01"]);
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    const { rerender } = renderModal();
    await waitFor(() => expect(document.getElementById("date-group-2026-07-01")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(document.getElementById("date-group-2026-06-21")).toBeInTheDocument());
    rerender(<ProjectSessionsModal project={project} range="1d" onClose={vi.fn()} onGoToSessions={vi.fn()} />);
    await waitFor(() => expect(document.getElementById("date-group-2026-07-10")).toBeInTheDocument());
    expect(document.getElementById("date-group-2026-07-01")).toBeNull();
    expect(document.getElementById("date-group-2026-06-21")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", expect.objectContaining({ range: "1d" }));
  });

  it("keeps the bottom button for an empty search so older matching dates can be loaded", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") {
        if (args.range === "custom:2026-06-21_2026-07-10") return response(["2026-06-21"], "2026-06-21");
        return response(args.query ? [] : ["2026-07-10"]);
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    await userEvent.type(screen.getByRole("textbox", { name: "Search project sessions" }), "older");
    await screen.findByText("No sessions match your search query");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(document.getElementById("date-group-2026-06-21")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: "custom:2026-06-21_2026-07-10", query: "older", before: null });
  });

  it.each([
    ["1d", "2026-07-10", "2026-07-09"],
    ["7d", "2026-07-04", "2026-06-27"],
  ])("doubles the calendar span for %s", async (range, start, nextStart) => {
    invoke.mockImplementation(async (command: string, args: any) => {
      const requestedStart = args.range === range ? start : nextStart;
      if (command === "fetch_project_analytics") return analytics(args.range, requestedStart);
      if (command === "fetch_project_session_days") return response(["2026-07-10"], requestedStart);
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal(range);
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: `custom:${nextStart}_2026-07-10`, query: "", before: null }));
  });

  it("loads a day on expansion, retries failures and limits initially rendered sessions", async () => {
    let attempts = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command !== "fetch_project_day_sessions") throw new Error(command);
      if (++attempts === 1) throw new Error("day unavailable");
      return Array.from({ length: 65 }, (_, index) => session("2026-07-10", index));
    });
    render(<ProjectSessionDayView day={{ ...day("2026-07-10"), sessionCount: 65 }} project={project.project} range="7d" query="" initiallyExpanded={false} />);
    expect(invoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("day unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByTestId("session-card")).toHaveLength(30));
    fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
    expect(screen.getAllByTestId("session-card")).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
    expect(screen.getAllByTestId("session-card")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "Load more sessions" })).not.toBeInTheDocument();
    const toggle = screen.getAllByRole("button")[0];
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(attempts).toBe(2);
  });
});


describe("project refresh", () => {
  beforeEach(async () => { invoke.mockReset(); await i18n.changeLanguage("en"); });

  it("retains search, extended range, expanded dates and scroll while invalidating day caches", async () => {
    let complete!: (value: unknown) => void;
    let refreshed = false;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "rescan_project") return new Promise((resolve) => { complete = resolve; });
      if (command === "fetch_project_analytics") return analytics(args.range, args.range.includes("06-21") ? "2026-06-21" : "2026-07-01");
      if (command === "fetch_project_session_days") return response(["2026-07-10", "2026-07-09", "2026-07-08"], args.range.includes("06-21") ? "2026-06-21" : "2026-07-01");
      if (command === "fetch_project_day_sessions") return [session(args.date, refreshed ? 99 : 0)];
      throw new Error(command);
    });
    const { container } = renderModal();
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(screen.getByTestId("project-modal-header")).toHaveTextContent("2026-06-21"));
    const search = screen.getByRole("textbox", { name: "Search project sessions" });
    await userEvent.type(search, "task");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: "custom:2026-06-21_2026-07-10", query: "task", before: null }));
    await screen.findByText("Task 0");
    const first = container.querySelector("#date-group-2026-07-10")!;
    const second = container.querySelector("#date-group-2026-07-09")!;
    const third = container.querySelector("#date-group-2026-07-08")!;
    const toggle = (element: Element) => within(element as HTMLElement).getAllByRole("button")[0];
    await userEvent.click(toggle(second));
    await userEvent.click(toggle(third));
    await waitFor(() => expect(within(third as HTMLElement).getByText("Task 0")).toBeInTheDocument());
    await userEvent.click(toggle(third));
    const scroll = screen.getByTestId("project-modal-scroll");
    scroll.scrollTop = 234;
    invoke.mockClear();
    const refresh = screen.getByRole("button", { name: "Refresh project sessions" });
    await userEvent.click(refresh);
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("Task 0").length).toBeGreaterThan(0);
    refreshed = true;
    await act(async () => complete({ importedDays: 1, scannedAt: "now", timezone: "UTC" }));
    await screen.findAllByText("Task 99");
    expect(container.querySelector("#date-group-2026-07-10")).toBe(first);
    expect(toggle(first)).toHaveAttribute("aria-expanded", "true");
    expect(toggle(second)).toHaveAttribute("aria-expanded", "true");
    expect(toggle(third)).toHaveAttribute("aria-expanded", "false");
    expect(scroll.scrollTop).toBe(234);
    expect(search).toHaveValue("task");
    expect(invoke).toHaveBeenCalledWith("fetch_project_analytics", { project: project.project, range: "custom:2026-06-21_2026-07-10" });
    expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_day_sessions")).toHaveLength(2);
    await userEvent.click(toggle(third));
    await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_day_sessions")).toHaveLength(3));
  });

  it("retains data after failure, allows retry and discards results after the search changes", async () => {
    let complete!: (value: unknown) => void;
    let attempts = 0;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "rescan_project") {
        if (++attempts === 1) throw new Error("cannot read logs");
        return new Promise((resolve) => { complete = resolve; });
      }
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") return response([args.query ? "2026-07-09" : "2026-07-10"]);
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    const refresh = screen.getByRole("button", { name: "Refresh project sessions" });
    await userEvent.click(refresh);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot read logs");
    expect(screen.getByText("Task 0")).toBeInTheDocument();
    await userEvent.click(refresh);
    fireEvent.change(screen.getByRole("textbox", { name: "Search project sessions" }), { target: { value: "new" } });
    await waitFor(() => expect(document.getElementById("date-group-2026-07-09")).toBeInTheDocument());
    invoke.mockClear();
    await act(async () => complete({ importedDays: 1, scannedAt: "now", timezone: "UTC" }));
    expect(document.getElementById("date-group-2026-07-10")).not.toBeInTheDocument();
    expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_session_days")).toHaveLength(0);
  });

  it("reloads stale project data on return from session detail without remounting dates", async () => {
    let refreshed = false;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") return analytics(args.range);
      if (command === "fetch_project_session_days") return response(["2026-07-10"]);
      if (command === "fetch_project_day_sessions") return [session(args.date, refreshed ? 99 : 0)];
      throw new Error(command);
    });
    const props = { project, range: "custom:2026-07-01_2026-07-10", onClose: vi.fn(), onGoToSessions: vi.fn() };
    const { rerender } = render(<ProjectSessionsModal {...props} />);
    await screen.findByText("Task 0");
    const first = document.getElementById("date-group-2026-07-10");
    rerender(<ProjectSessionsModal {...props} isActive={false} dataRevision={1} />);
    refreshed = true;
    invoke.mockClear();
    expect(invoke).not.toHaveBeenCalled();
    rerender(<ProjectSessionsModal {...props} isActive dataRevision={1} />);
    await screen.findByText("Task 99");
    expect(document.getElementById("date-group-2026-07-10")).toBe(first);
  });
});
