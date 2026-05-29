// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  attachLogger: vi.fn(() => Promise.resolve(() => {})),
  LogLevel: {
    Trace: 0,
    Debug: 1,
    Info: 2,
    Warn: 3,
    Error: 4,
  },
}));

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    saveMock.mockReset();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("shows the initial loading state while loading the cached overview", () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_overview" && args?.range === "30d") {
        return new Promise(() => {});
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    expect(screen.getByRole("status", { name: "Preparing local cache" })).toBeInTheDocument();
    expect(screen.getByText("Preparing local cache")).toBeInTheDocument();
    expect(screen.getByText("Loading the cached dashboard snapshot.")).toBeInTheDocument();
    expect(screen.getByText("Reading sessions")).toBeInTheDocument();
    expect(screen.getByText("Aggregating tokens")).toBeInTheDocument();
    expect(screen.getByText("Estimating cost")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset cache" })).not.toBeInTheDocument();
  });

  it("loads the last 30 day overview and switches to last 1 day", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_codex_limits") {
        return {
          session: {
            usedPercent: 20,
            remainingPercent: 80,
            windowMinutes: 300,
            resetsAt: "2026-04-26T05:00:00.000Z",
          },
          weekly: {
            usedPercent: 45,
            remainingPercent: 55,
            windowMinutes: 10080,
            resetsAt: "2026-04-30T00:00:00.000Z",
          },
          updatedAt: "2026-04-26T00:00:00.000Z",
          source: "cli-rpc",
          account: "user@example.com",
          membershipLevel: "plus",
          subscriptionExpiresAt: "2026-06-12T08:22:29+00:00",
          subscriptionWillRenew: false,
        };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [
            {
              date: "2026-04-25",
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUSD: 0,
            },
            {
              date: "2026-04-24",
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUSD: 0,
            },
            {
              date: "2026-04-26",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [
            {
              model: "gpt-5",
              inputTokens: 2600,
              cachedInputTokens: 400,
              outputTokens: 800,
              totalTokens: 3400,
              costUSD: 0.0088685,
            },
          ],
          projects: [
            {
              project: "/Users/vincent/Documents/Develop/github/codex-usage-desktop",
              displayName: "codex-usage-desktop",
              inputTokens: 2600,
              cachedInputTokens: 400,
              outputTokens: 800,
              totalTokens: 3400,
              costUSD: 0.0088685,
            },
          ],
        };
      }

      if (command === "fetch_overview" && args?.range === "1d") {
        return {
            range: "1d",
            days: 1,
            timezone: "UTC",
            startDate: "2026-04-26",
            endDate: "2026-04-26",
            updatedAt: "2026-04-26T00:00:00.000Z",
            daily: [
              {
                date: "2026-04-26",
                inputTokens: 1200,
                cachedInputTokens: 200,
                outputTokens: 400,
                totalTokens: 1600,
                costUSD: 0.005275,
              },
            ],
            totals: {
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
              avgTokensPerDay: 1600,
              avgCostPerDay: 0.005275,
              cacheHitRate: 0.1666,
              costPerMillionTokens: 3.296875,
            },
            models: [
              {
                model: "gpt-5",
                inputTokens: 1200,
                cachedInputTokens: 200,
                outputTokens: 400,
                totalTokens: 1600,
                costUSD: 0.005275,
              },
            ],
            projects: [
              {
                project: "/Users/vincent/Documents/Develop/github/codex-usage-desktop",
                displayName: "codex-usage-desktop",
                inputTokens: 1200,
                cachedInputTokens: 200,
                outputTokens: 400,
                totalTokens: 1600,
                costUSD: 0.005275,
              },
            ],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));
    expect(screen.getByText("Codex Limits")).toBeInTheDocument();
    expect(screen.getByText("5-Hour Limit")).toBeInTheDocument();
    expect(screen.getByText("Weekly Limit")).toBeInTheDocument();
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("55%").length).toBeGreaterThan(0);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Expires 2026-06-12 \(\d+ days left\)/)).toBeInTheDocument();
    expect(screen.getByText("· Auto-renew off")).toBeInTheDocument();
    expect(screen.getByText("Total Token Trend")).toBeInTheDocument();
    expect(screen.getByText("Cost Trend")).toBeInTheDocument();
    const trendsCard = screen.getByRole("heading", { name: "Usage Trends" }).closest(".rounded-lg");
    expect(trendsCard).not.toBeNull();
    expect(within(trendsCard as HTMLElement).getByText("Token Breakdown")).toBeInTheDocument();
    expect(within(trendsCard as HTMLElement).getByText("Avg / Day")).toBeInTheDocument();
    expect(within(trendsCard as HTMLElement).getByText("Cache Hit")).toBeInTheDocument();
    expect(within(trendsCard as HTMLElement).getByText("Cost / 1M")).toBeInTheDocument();
    expect(screen.queryByText("Cached Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Avg Daily Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Peak Token")).not.toBeInTheDocument();
    expect(screen.queryByText("Peak Cost")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Total Token" })).not.toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "gpt-5" })).not.toBeInTheDocument();

    const modelUsageTab = screen.getByRole("tab", { name: "Model" });
    await userEvent.click(modelUsageTab);

    expect(screen.getByRole("heading", { name: "Model Usage Details" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total Token" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "gpt-5" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: /codex-usage-desktop/ })).not.toBeInTheDocument();

    const projectUsageTab = screen.getByRole("tab", { name: "Project" });
    await userEvent.click(projectUsageTab);

    expect(screen.getByRole("heading", { name: "Project Usage Details" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Total Tokens" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("cell", { name: /codex-usage-desktop/ })).toBeInTheDocument();

    // Click the Daily tab to show the DailyUsageTable
    const dailyTab = screen.getByRole("tab", { name: "Daily" });
    await userEvent.click(dailyTab);

    const latestDailyCell = screen.getByRole("cell", { name: "2026-04-26" });
    const inactiveDailyCell = screen.getByRole("cell", { name: "2026-04-24 to 2026-04-25" });
    expect(latestDailyCell.compareDocumentPosition(inactiveDailyCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("No activity (2 days)")).toBeInTheDocument();

    // Switch back to Dashboard tab to perform range selection
    const dashboardTab = screen.getByRole("tab", { name: "Dashboard" });
    await userEvent.click(dashboardTab);

    await userEvent.click(screen.getByRole("button", { name: "Select time range" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Last 1 Day" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith("fetch_overview", { range: "1d" });
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(1);
  });

  it("shows a loading state while switching to last 90 days", async () => {
    let resolve90DayOverview: (value: unknown) => void = () => {};

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [
            {
              date: "2026-04-26",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "fetch_overview" && args?.range === "90d") {
        return new Promise((resolve) => {
          resolve90DayOverview = resolve;
        });
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Select time range" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Last 90 Days" }));

    expect(screen.getByRole("status", { name: "Loading Last 90 Days" })).toBeInTheDocument();
    expect(screen.getByText("Loading usage and cost data for the selected window.")).toBeInTheDocument();

    resolve90DayOverview({
      range: "90d",
      days: 90,
      timezone: "UTC",
      startDate: "2026-01-27",
      endDate: "2026-04-26",
      updatedAt: "2026-04-26T00:00:00.000Z",
      daily: [],
      totals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUSD: 0,
        avgTokensPerDay: 0,
        avgCostPerDay: 0,
        cacheHitRate: 0,
        costPerMillionTokens: 0,
      },
      models: [],
      projects: [],
    });

    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading Last 90 Days" })).not.toBeInTheDocument());
  });

  it("loads monthly usage from the Monthly tab", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-05-11T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [
            {
              date: "2026-05-11",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 400,
            totalTokens: 1600,
            costUSD: 0.005275,
            avgTokensPerDay: 53.3333333,
            avgCostPerDay: 0.0001758,
            cacheHitRate: 0.1666,
            costPerMillionTokens: 3.296875,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "fetch_monthly_usage") {
        return {
          timezone: "UTC",
          startMonth: "2025-06",
          endMonth: "2026-05",
          updatedAt: "2026-05-11T00:00:00.000Z",
          monthly: [
            {
              month: "2026-02",
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUSD: 0,
            },
            {
              month: "2026-03",
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUSD: 0,
            },
            {
              month: "2026-04",
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUSD: 0,
            },
            {
              month: "2026-05",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));
    expect(screen.queryByText("Monthly Usage")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Monthly" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fetch_monthly_usage"));
    expect(screen.getByText("Monthly Usage")).toBeInTheDocument();
    expect(screen.getByText("Natural-month totals from 2025-06 to 2026-05 in UTC.")).toBeInTheDocument();
    const latestMonthlyCell = screen.getByRole("cell", { name: "2026-05" });
    const inactiveMonthlyCell = screen.getByRole("cell", { name: "2026-02 to 2026-04" });
    expect(latestMonthlyCell.compareDocumentPosition(inactiveMonthlyCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("No usage (3 months)")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "2026-04" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Total Tokens" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,600").length).toBeGreaterThan(0);
    expect(screen.queryByText("Usage Trends")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("loads session details from the Sessions tab", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-05-11T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [
            {
              date: "2026-05-11",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 400,
            totalTokens: 1600,
            costUSD: 0.005275,
            avgTokensPerDay: 53.3333333,
            avgCostPerDay: 0.0001758,
            cacheHitRate: 0.1666,
            costPerMillionTokens: 3.296875,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "fetch_session_details") {
        return [
          {
            path: "/path/to/session/first.jsonl",
            sessionId: "first.jsonl",
            modifiedAtMs: 1779926400000,
            sizeBytes: 2048,
            inputTokens: 800,
            cachedInputTokens: 100,
            outputTokens: 200,
            totalTokens: 1000,
            costUSD: 0.0035,
            models: ["gpt-4o"],
            projects: ["/path/to/project"],
          },
        ];
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));
    expect(screen.queryByText("Session Details")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Sessions" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fetch_session_details"));
    expect(screen.getByText("Session Details")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,000").length).toBeGreaterThan(0);
  });

  it("navigates to sessions view when a daily usage row is clicked", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-05-11T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [
            {
              date: "2026-05-11",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 400,
            totalTokens: 1600,
            costUSD: 0.005275,
            avgTokensPerDay: 53.3333333,
            avgCostPerDay: 0.0001758,
            cacheHitRate: 0.1666,
            costPerMillionTokens: 3.296875,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "fetch_session_details") {
        return [
          {
            path: "/path/to/session/first.jsonl",
            sessionId: "first.jsonl",
            modifiedAtMs: 1778544000000,
            sizeBytes: 2048,
            inputTokens: 800,
            cachedInputTokens: 100,
            outputTokens: 200,
            totalTokens: 1000,
            costUSD: 0.0035,
            models: ["gpt-4o"],
            projects: ["/path/to/project"],
          },
        ];
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));
    
    // Switch to Daily tab
    await userEvent.click(screen.getByRole("tab", { name: "Daily" }));
    expect(screen.getByRole("heading", { name: "Daily Usage Details" })).toBeInTheDocument();

    // Click the active daily row for 2026-05-11
    const dailyRowCell = screen.getByRole("cell", { name: "2026-05-11" });
    await userEvent.click(dailyRowCell);

    // Verify it automatically navigated to Session Details
    await waitFor(() => expect(screen.getByText("Session Details")).toBeInTheDocument());
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("opens project sessions modal when a project row is clicked, filters sessions, and can view in sessions tab", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-05-11T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 400,
            totalTokens: 1600,
            costUSD: 0.005275,
            avgTokensPerDay: 53.3333333,
            avgCostPerDay: 0.0001758,
            cacheHitRate: 0.1666,
            costPerMillionTokens: 3.296875,
          },
          models: [],
          projects: [
            {
              project: "/path/to/my-awesome-project",
              displayName: "my-awesome-project",
              inputTokens: 1000,
              cachedInputTokens: 200,
              outputTokens: 200,
              totalTokens: 1200,
              costUSD: 0.004,
            },
          ],
        };
      }

      if (command === "fetch_session_details") {
        return [
          {
            path: "/path/to/session/first.jsonl",
            sessionId: "first.jsonl",
            modifiedAtMs: 1778544000000,
            sizeBytes: 2048,
            inputTokens: 800,
            cachedInputTokens: 100,
            outputTokens: 200,
            totalTokens: 1000,
            costUSD: 0.0035,
            models: ["gpt-4o"],
            projects: ["/path/to/my-awesome-project"],
          },
          {
            path: "/path/to/session/second.jsonl",
            sessionId: "second.jsonl",
            modifiedAtMs: 1778544000000,
            sizeBytes: 1024,
            inputTokens: 400,
            cachedInputTokens: 100,
            outputTokens: 100,
            totalTokens: 500,
            costUSD: 0.0017,
            models: ["claude-3.5-sonnet"],
            projects: ["/path/to/another-project"],
          },
        ];
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));

    // Switch to Project tab
    await userEvent.click(screen.getByRole("tab", { name: "Project" }));
    expect(screen.getByRole("heading", { name: "Project Usage Details" })).toBeInTheDocument();

    // Verify project is visible
    expect(screen.getByText("my-awesome-project")).toBeInTheDocument();

    // Click the project row
    const projectCell = screen.getByText("my-awesome-project");
    await userEvent.click(projectCell);

    // Verify modal has opened
    await waitFor(() => expect(screen.getByText("Project Details")).toBeInTheDocument());
    expect(screen.getAllByText("/path/to/my-awesome-project").length).toBeGreaterThan(0);

    // Modal should show only the matching session ('first') and not the non-matching one ('second')
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();

    // Type a query in search that doesn't match
    const searchInput = screen.getByPlaceholderText("Search session ID or model...");
    await userEvent.type(searchInput, "non-existent-query");
    await waitFor(() => expect(screen.queryByText("first")).not.toBeInTheDocument());

    // Clear search query
    await userEvent.clear(searchInput);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());

    // Click the "View in Sessions Tab" button in footer
    const viewInSessionsBtn = screen.getByRole("button", { name: "View in Sessions Tab" });
    await userEvent.click(viewInSessionsBtn);

    // Modal should be closed and tab should have changed to Sessions with filter active
    expect(screen.queryByText("Project Details")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Session Details/ })).toBeInTheDocument();

    // Should show pre-filtered sessions message and badge
    expect(screen.getByText("Filtering by Project")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();

    // Click "Clear Filter" button in Sessions tab
    const clearFilterBtn = screen.getByRole("button", { name: "Clear Filter" });
    await userEvent.click(clearFilterBtn);

    // Both sessions should now be visible
    expect(screen.queryByText("Filtering by Project")).not.toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("bootstraps only once in strict mode", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
            range: "30d",
            days: 30,
            timezone: "UTC",
            startDate: "2026-03-28",
            endDate: "2026-04-26",
            updatedAt: "2026-04-26T00:00:00.000Z",
            daily: [
              {
                date: "2026-04-26",
                inputTokens: 1200,
                cachedInputTokens: 200,
                outputTokens: 400,
                totalTokens: 1600,
                costUSD: 0.005275,
              },
            ],
            totals: {
              inputTokens: 2600,
              cachedInputTokens: 400,
              outputTokens: 800,
              totalTokens: 3400,
              costUSD: 0.0088685,
              avgTokensPerDay: 485.7142857,
              avgCostPerDay: 0.0012669,
              cacheHitRate: 0.1538,
              costPerMillionTokens: 2.6083,
            },
            models: [
              {
                model: "gpt-5",
                inputTokens: 2600,
                cachedInputTokens: 400,
                outputTokens: 800,
                totalTokens: 3400,
                costUSD: 0.0088685,
              },
            ],
          };
      }

      if (command === "check_for_updates") {
        return {
          hasUpdate: false,
          currentVersion: "0.4.0",
          latestVersion: "0.4.0",
          latestTag: "v0.4.0",
          releaseName: null,
          releaseNotes: null,
          releaseUrl: "",
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(5));
    expect(invokeMock).toHaveBeenNthCalledWith(1, "fetch_codex_limits");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "fetch_overview", { range: "30d" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "scan_usage");
    expect(invokeMock).toHaveBeenNthCalledWith(4, "check_for_updates");
    expect(invokeMock).toHaveBeenNthCalledWith(5, "fetch_overview", { range: "30d" });
  });

  it("keeps the cached overview visible when the background scan fails", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "scan_usage") {
        throw new Error("scan failed");
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("scan failed")).toBeInTheDocument());
    expect(screen.getAllByText("3,400").length).toBeGreaterThan(0);
  });

  it("keeps the dashboard visible when Codex limits are unavailable", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        throw "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.";
      }

      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [],
          projects: [],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));
    expect(
      screen.getByText("Codex limits unavailable: Codex CLI not found. Set CODEX_CLI_PATH or install the codex command."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Data sync failed")).not.toBeInTheDocument();
  });

  it("resets the local cache and rebuilds usage data", async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "reset_usage_state") {
        return undefined;
      }

      if (command === "scan_usage") {
        return {
          importedDays: 1,
          scannedAt: "2026-05-11T00:00:00.000Z",
          timezone: "UTC",
          metrics: {
            totalMs: 20,
            pricingMs: 1,
            parseMs: 10,
            dbMs: 3,
            filesScanned: 1,
            filesParsed: 1,
            filesReused: 0,
            bytesRead: 1024,
          },
        };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [
            {
              date: "2026-05-11",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 400,
            totalTokens: 1600,
            costUSD: 0.005275,
            avgTokensPerDay: 53.3333333,
            avgCostPerDay: 0.0001758,
            cacheHitRate: 0.1666,
            costPerMillionTokens: 3.296875,
          },
          models: [],
          projects: [],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByText("Manage local app state and recovery actions.")).toBeInTheDocument();
    expect(screen.getByText("Local cache")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset cache" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Reset cache" }));

    await userEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    await waitFor(() => expect(screen.getByText("Reset local cache and rebuilt usage data from local Codex logs.")).toBeInTheDocument());
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("Source logs will not be deleted"));

    const calls = invokeMock.mock.calls.map(([command, args]) => [command, args]);
    const resetCallIndex = calls.findIndex(([command]) => command === "reset_usage_state");
    expect(resetCallIndex).toBeGreaterThan(-1);
    expect(calls[resetCallIndex + 1]).toEqual(["scan_usage", undefined]);
    expect(calls[resetCallIndex + 2]).toEqual(["fetch_overview", { range: "30d" }]);
    expect(calls[resetCallIndex + 3]).toEqual(["fetch_codex_limits", undefined]);
  });

  it("does not reset when confirmation is canceled", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 1, scannedAt: "2026-05-11T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-04-12",
          endDate: "2026-05-11",
          updatedAt: "2026-05-11T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUSD: 0,
            avgTokensPerDay: 0,
            avgCostPerDay: 0,
            cacheHitRate: 0,
            costPerMillionTokens: 0,
          },
          models: [],
          projects: [],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset cache" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Reset cache" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("reset_usage_state");
  });

  it("exports the selected range to Excel", async () => {
    saveMock.mockResolvedValue("/tmp/codex-usage-30d.xlsx");
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [
            {
              date: "2026-04-26",
              inputTokens: 1200,
              cachedInputTokens: 200,
              outputTokens: 400,
              totalTokens: 1600,
              costUSD: 0.005275,
            },
          ],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [
            {
              model: "gpt-5",
              inputTokens: 2600,
              cachedInputTokens: 400,
              outputTokens: 800,
              totalTokens: 3400,
              costUSD: 0.0088685,
            },
          ],
        };
      }

      if (command === "export_usage") {
        return {
          path: "/tmp/codex-usage-30d.xlsx",
          format: "xlsx",
          range: "30d",
          exportedAt: "2026-04-26T00:00:00.000Z",
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        title: "Export Codex usage to Excel",
        defaultPath: "codex-usage-30d-2026-03-28_to_2026-04-26.xlsx",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      expect(invokeMock).toHaveBeenLastCalledWith("export_usage", {
        range: "30d",
        format: "xlsx",
        path: "/tmp/codex-usage-30d.xlsx",
      });
    });
  });

  it("does not export when the save dialog is canceled", async () => {
    saveMock.mockResolvedValue(null);
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUSD: 0,
            avgTokensPerDay: 0,
            avgCostPerDay: 0,
            cacheHitRate: 0,
            costPerMillionTokens: 0,
          },
          models: [],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Markdown (.md)" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith("export_usage", expect.anything());
  });

  it("dismisses the main update banner and shows the eye-catching upgrade button in the header", async () => {
    localStorage.clear();
    invokeMock.mockImplementation(async (command: string, args?: { range?: string; url?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_codex_limits") {
        return {
          session: { usedPercent: 20, remainingPercent: 80, windowMinutes: 300, resetsAt: "2026-04-26T05:00:00.000Z" },
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-04-30T00:00:00.000Z" },
          updatedAt: "2026-04-26T00:00:00.000Z",
          source: "cli-rpc",
        };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 2600,
            cachedInputTokens: 400,
            outputTokens: 800,
            totalTokens: 3400,
            costUSD: 0.0088685,
            avgTokensPerDay: 113.3333333,
            avgCostPerDay: 0.0002956,
            cacheHitRate: 0.1538,
            costPerMillionTokens: 2.6083,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "check_for_updates") {
        return {
          hasUpdate: true,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          latestTag: "v0.5.0",
          releaseName: "Big Release",
          releaseNotes: "Feature details",
          releaseUrl: "https://github.com/test/release",
        };
      }

      if (command === "open_url" && args?.url === "https://github.com/test/release") {
        return null;
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    // Wait for the main update banner to be displayed
    await waitFor(() => expect(screen.getByText("New update available: v0.5.0")).toBeInTheDocument());

    // Click the X button to dismiss the banner
    const dismissButton = screen.getByRole("button", { name: "Dismiss update notification" });
    await userEvent.click(dismissButton);

    // Main update banner should disappear
    expect(screen.queryByText("New update available: v0.5.0")).not.toBeInTheDocument();

    // Check that the persistent dismiss tag was stored in localStorage
    expect(localStorage.getItem("dismissed_update_tag")).toBe("v0.5.0");

    // The small upgrade button in the header next to CODEX USAGE DESKTOP should appear
    const headerUpgradeButton = screen.getByRole("button", { name: "Upgrade v0.5.0" });
    expect(headerUpgradeButton).toBeInTheDocument();

    // Click the header upgrade button to open the release URL
    await userEvent.click(headerUpgradeButton);
    expect(invokeMock).toHaveBeenCalledWith("open_url", { url: "https://github.com/test/release" });
  });

  it("defaults to hiding the Logs tab, and shows it when toggled in Settings", async () => {
    localStorage.removeItem("show_logs_tab");

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_codex_limits") {
        return {
          session: { usedPercent: 20, remainingPercent: 80, windowMinutes: 300, resetsAt: "2026-04-26T05:00:00.000Z" },
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-04-30T00:00:00.000Z" },
          updatedAt: "2026-04-26T00:00:00.000Z",
          source: "cli-rpc",
        };
      }

      if (command === "fetch_overview" && args?.range === "30d") {
        return {
          range: "30d",
          days: 30,
          timezone: "UTC",
          startDate: "2026-03-28",
          endDate: "2026-04-26",
          updatedAt: "2026-04-26T00:00:00.000Z",
          daily: [],
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUSD: 0,
            avgTokensPerDay: 0,
            avgCostPerDay: 0,
            cacheHitRate: 0,
            costPerMillionTokens: 0,
          },
          models: [],
          projects: [],
        };
      }

      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "0.4.0", latestVersion: "0.4.0", latestTag: "v0.4.0" };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    // Wait for the overview to render (proves app loaded)
    await waitFor(() => expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument());

    // By default, the Logs tab should NOT be visible
    expect(screen.queryByRole("tab", { name: "Logs" })).not.toBeInTheDocument();

    // Click Settings
    const settingsTab = screen.getByRole("tab", { name: "Settings" });
    await userEvent.click(settingsTab);

    // Verify Display Settings card is rendered with "Show Logs Tab" toggle switch
    expect(screen.getByText("Display Settings")).toBeInTheDocument();
    const toggleSwitch = screen.getByRole("button", { name: "Toggle Logs Tab" });
    expect(toggleSwitch).toBeInTheDocument();

    // Click toggle to enable Logs tab
    await userEvent.click(toggleSwitch);

    // Logs tab should now be visible in navigation
    const logsTab = screen.getByRole("tab", { name: "Logs" });
    expect(logsTab).toBeInTheDocument();
    expect(localStorage.getItem("show_logs_tab")).toBe("true");

    // Click Logs tab to view it
    await userEvent.click(logsTab);
    expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();

    // Go back to Settings and toggle it off
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Toggle Logs Tab" }));

    // Logs tab should be hidden and settings should remain selected
    expect(screen.queryByRole("tab", { name: "Logs" })).not.toBeInTheDocument();
    expect(localStorage.getItem("show_logs_tab")).toBe("false");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  });
});
