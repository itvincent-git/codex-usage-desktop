// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import i18n from "./i18n";
import tauriConfig from "../src-tauri/tauri.conf.json";

const invokeMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const updateTrayMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn());
const eventListeners = vi.hoisted(() => new Map<string, Array<(event: { payload: any }) => void>>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: any[]) => {
    if (command === "update_tray") {
      updateTrayMock(...args);
      return Promise.resolve();
    }
    if (command === "refresh_usage_data") {
      return invokeMock("scan_usage").then(async (scan: any) => {
        const filesParsed = scan.metrics?.filesParsed ?? 0;
        const forceLimits = args[0]?.forceLimits === true;
        if (!forceLimits && filesParsed === 0) {
          return {
            scan,
            limits: null,
            limitsError: null,
            limitsSkipped: true,
            refreshedAt: scan.scannedAt,
          };
        }

        try {
          const limits = await invokeMock("fetch_codex_limits");
          return {
            scan,
            limits,
            limitsError: null,
            limitsSkipped: false,
            refreshedAt: scan.scannedAt,
          };
        } catch (error) {
          return {
            scan,
            limits: null,
            limitsError: error instanceof Error ? error.message : String(error),
            limitsSkipped: false,
            refreshedAt: scan.scannedAt,
          };
        }
      });
    }
    return invokeMock(command, ...args);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, callback: (event: { payload: any }) => void) => {
    const listeners = eventListeners.get(event) ?? [];
    listeners.push(callback);
    eventListeners.set(event, listeners);
    return Promise.resolve(() => {
      eventListeners.set(event, (eventListeners.get(event) ?? []).filter((listener) => listener !== callback));
    });
  }),
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

function overview(totalTokens = 1600) {
  return {
    range: "30d",
    days: 30,
    timezone: "UTC",
    startDate: "2026-05-13",
    endDate: "2026-06-11",
    updatedAt: "2026-06-11T00:00:00.000Z",
    daily: [],
    totals: {
      inputTokens: totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens,
      costUSD: 0,
      avgTokensPerDay: totalTokens / 30,
      avgCostPerDay: 0,
      cacheHitRate: 0,
      costPerMillionTokens: 0,
    },
    models: [],
    projects: [],
  };
}

function scan(filesParsed: number) {
  return {
    importedDays: 1,
    scannedAt: "2026-06-11T00:00:00.000Z",
    timezone: "UTC",
    metrics: {
      totalMs: 1,
      pricingMs: 0,
      parseMs: 1,
      dbMs: 0,
      filesScanned: 1,
      filesParsed,
      filesReused: filesParsed > 0 ? 0 : 1,
      bytesRead: filesParsed > 0 ? 100 : 0,
    },
  };
}

function limits(remainingPercent = 80, resetsAt = "2026-06-11T05:00:00.000Z") {
  return {
    session: {
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      windowMinutes: 300,
      resetsAt,
    },
    weekly: null,
    updatedAt: "2026-06-11T00:00:00.000Z",
    source: "cli-rpc",
  };
}

function setPageActive(active: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (active ? "visible" : "hidden"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(active);
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    saveMock.mockReset();
    updateTrayMock.mockReset();
    eventListeners.clear();
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    writeTextMock.mockReset();
    vi.stubGlobal("navigator", { language: "en-US", clipboard: { writeText: writeTextMock } });
    void i18n.changeLanguage("en");
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

  it("prevents the default page context menu", () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_overview" && args?.range === "30d") {
        return new Promise(() => {});
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("rescans after returning from the background but skips limits when files are unchanged", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setPageActive(true);

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        return limits(80);
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));

    setPageActive(false);
    window.dispatchEvent(new Event("blur"));
    now += 5 * 60_000 + 1;
    setPageActive(true);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([command]) => command === "scan_usage")).toHaveLength(2);
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(1);
  });

  it("refreshes expired limits after returning from the background even when files are unchanged", async () => {
    const initialNow = new Date("2026-06-11T00:00:00.000Z").getTime();
    let now = initialNow;
    let limitsFetchCount = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setPageActive(true);

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        limitsFetchCount += 1;
        return limits(limitsFetchCount >= 2 ? 100 : 80, new Date(initialNow + 60_000).toISOString());
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByText("80%").length).toBeGreaterThan(0));

    setPageActive(false);
    window.dispatchEvent(new Event("blur"));
    now += 5 * 60_000 + 1;
    setPageActive(true);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getAllByText("100%").length).toBeGreaterThan(0));
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_usage")).toHaveLength(2);
    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(2);
  });

  it("updates overview and limits after a background resume scan finds changed files", async () => {
    let now = 10_000;
    let scanCount = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setPageActive(true);

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        return limits(scanCount >= 2 ? 65 : 80);
      }
      if (command === "scan_usage") {
        scanCount += 1;
        return scan(scanCount >= 2 ? 1 : 0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview(scanCount >= 2 ? 2400 : 1600);
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));

    setPageActive(false);
    window.dispatchEvent(new Event("blur"));
    now += 5 * 60_000 + 1;
    setPageActive(true);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getAllByText("2,400").length).toBeGreaterThan(0));
    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(2);
  });

  it("forces limits refresh on manual rescan even when files are unchanged", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        return limits(80);
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rescan local logs" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "Rescan local logs" }));

    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(2);
    });
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
    expect(screen.getByText(/Expires 2026-06-11 \(\d+ days? left\)/)).toBeInTheDocument();
    expect(screen.getByText("· Auto-renew off")).toBeInTheDocument();
    expect(screen.getByText("Total Token Trend")).toBeInTheDocument();
    expect(screen.getByText("Cost Trend")).toBeInTheDocument();
    const trendsCard = screen.getByTestId("usage-trends-card");
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
    expect(screen.queryByTestId("usage-trends-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("opens a session replay modal from a session row", async () => {
    const longToolOutput = `${"tool output preview ".repeat(160)}LONG_TOOL_OUTPUT_TAIL`;
    const rawJsonl = [
      JSON.stringify({ timestamp: "2026-06-11T00:00:00.000Z", type: "event_msg", payload: { type: "user_message", turn_id: "turn-1", text: "Replay this session" } }),
      `${"x".repeat(4100)}raw-only-marker`,
    ].join("\n");

    invokeMock.mockImplementation(async (command: string, args?: { range?: string; path?: string }) => {
      if (command === "fetch_codex_limits") {
        return limits(80);
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      if (command === "fetch_session_details") {
        return [
          {
            path: "/tmp/session-replay.jsonl",
            sessionId: "session-replay.jsonl",
            modifiedAtMs: new Date("2026-06-11T00:00:02.000Z").getTime(),
            sizeBytes: rawJsonl.length,
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 140,
            costUSD: 0.001,
            models: ["gpt-5"],
            projects: ["/repo/app"],
          },
        ];
      }
      if (command === "fetch_session_detail" && args?.path === "/tmp/session-replay.jsonl") {
        return {
          path: "/tmp/session-replay.jsonl",
          sessionId: "session-replay.jsonl",
          modifiedAtMs: new Date("2026-06-11T00:00:02.000Z").getTime(),
          sizeBytes: rawJsonl.length,
          rawJsonl,
          summary: {
            startTime: "2026-06-11T00:00:00.000Z",
            endTime: "2026-06-11T00:00:02.000Z",
            durationMs: 2000,
            timeToFirstTokenMs: 1000,
            cwd: "/repo/app",
            projects: ["/repo/app"],
            models: ["gpt-5"],
            cliVersion: "1.0.0",
            git: {},
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 140,
            costUSD: 0.001,
            turnCount: 1,
            messageCount: 1,
            toolCallCount: 0,
            patchCount: 0,
            errorCount: 0,
          },
          turns: [
            {
              turnId: "turn-1",
              startedAt: "2026-06-11T00:00:00.000Z",
              completedAt: "2026-06-11T00:00:02.000Z",
              durationMs: 2000,
              systemMessages: [
                { timestamp: "2026-06-11T00:00:00.000Z", kind: "base_instructions", text: "Use the repo instructions." },
              ],
              userMessages: [{ timestamp: "2026-06-11T00:00:00.000Z", kind: "user_message", text: "Replay this session" }],
              assistantMessages: [],
              reasoningSummaries: [],
              toolCalls: [
                {
                  callId: "call-1",
                  name: "shell",
                  status: "completed",
                  arguments: null,
                  output: longToolOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:00.500Z",
                  completedAt: "2026-06-11T00:00:01.500Z",
                  durationMs: 1000,
                  isError: false,
                },
              ],
              patchResults: [],
              tokenEvents: [
                {
                  timestamp: "2026-06-11T00:00:02.000Z",
                  model: "gpt-5",
                  inputTokens: 100,
                  cachedInputTokens: 20,
                  outputTokens: 40,
                  reasoningOutputTokens: 0,
                  totalTokens: 140,
                },
              ],
              errors: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByText("1,600").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fetch_session_details"));

    document.body.style.overflow = "auto";
    await userEvent.click(await screen.findByText("session-replay"));

    expect(await screen.findByRole("dialog", { name: "session-replay" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Close session detail" })).toHaveFocus();
    expect(screen.getByText("Session summary")).toBeInTheDocument();
    const turnButton = screen.getByRole("button", { name: /Turn turn-1/ });
    expect(turnButton).toHaveAttribute("aria-expanded", "false");
    expect(turnButton).toHaveTextContent("2 messages");
    expect(turnButton).toHaveTextContent("1 tool");
    expect(turnButton).toHaveTextContent("0 patches");
    expect(turnButton).toHaveTextContent("0 errors");
    expect(turnButton).toHaveTextContent("1 token event");
    expect(screen.queryByText("System prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Use the repo instructions.")).not.toBeInTheDocument();
    expect(screen.getByText("Replay this session")).toBeInTheDocument();
    expect(screen.queryByText(/LONG_TOOL_OUTPUT_TAIL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-only-marker/)).not.toBeInTheDocument();

    await userEvent.click(turnButton);
    expect(turnButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("Use the repo instructions.")).toBeInTheDocument();
    expect(screen.queryByText(/LONG_TOOL_OUTPUT_TAIL/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("shell · completed"));
    await userEvent.click(screen.getByRole("button", { name: "Show full text" }));
    expect(screen.getByText(/LONG_TOOL_OUTPUT_TAIL/)).toBeInTheDocument();

    await userEvent.click(turnButton);
    expect(screen.queryByText(/LONG_TOOL_OUTPUT_TAIL/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Raw JSONL" }));
    expect(screen.getByText("Raw JSONL preview")).toBeInTheDocument();
    expect(screen.queryByText(/raw-only-marker/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeTextMock).toHaveBeenCalledWith(rawJsonl);

    await userEvent.click(screen.getByRole("button", { name: "Show full JSONL" }));
    expect(screen.getByText(/raw-only-marker/)).toBeInTheDocument();

    screen.getByRole("button", { name: "Close session detail" }).focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: /Copy|Copied/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "session-replay" })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("auto");
    expect(screen.getByText("session-replay")).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain("session-replay");
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
      screen.getByText("Unable to get Codex limits right now. Please check your network and Codex login status, then try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Data sync failed")).not.toBeInTheDocument();
  });

  it("shows reset countdowns for 5-hour and weekly limits in the tray", async () => {
    const now = new Date().getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const sessionReset = new Date(now + 3 * 60 * 60_000).toISOString();
    const weeklyReset = new Date(now + 4 * 24 * 60 * 60_000).toISOString();
    localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: true, limitWeekly: true, tokens: false, cost: false }));
    localStorage.setItem("tray_menu_show", JSON.stringify({ limit5h: true, limitWeekly: true, tokens: false, cost: false }));

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        return {
          session: { usedPercent: 20, remainingPercent: 80, windowMinutes: 300, resetsAt: sessionReset },
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: weeklyReset },
          updatedAt: new Date().toISOString(),
          source: "cli-rpc",
          membershipLevel: "pro",
        };
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(updateTrayMock).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
          title: "5h: 80%/3h | W: 55%/4d",
          items: expect.arrayContaining([
            expect.objectContaining({ id: "status_5h", text: expect.stringContaining("3 hours left") }),
            expect.objectContaining({ id: "status_weekly", text: expect.stringContaining("4 days left") }),
          ]),
        }),
      }));
    });
  });

  it("refreshes expired limits for skipped native background refreshes and updates the tray", async () => {
    const initialNow = new Date("2026-06-11T06:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(initialNow);
    localStorage.setItem("tray_title_show", JSON.stringify({ limit5h: true, limitWeekly: false, tokens: false, cost: false }));
    localStorage.setItem("tray_menu_show", JSON.stringify({ limit5h: true, limitWeekly: false, tokens: false, cost: false }));

    let limitsFetchCount = 0;
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        limitsFetchCount += 1;
        return { ...limits(limitsFetchCount >= 2 ? 100 : 80, "2026-06-11T05:00:00.000Z"), membershipLevel: "pro" };
      }
      if (command === "scan_usage") {
        return scan(0);
      }
      if (command === "fetch_overview" && args?.range === "30d") {
        return overview();
      }
      if (command === "check_for_updates") {
        return { hasUpdate: false, currentVersion: "1.0.0", latestVersion: "1.0.0", latestTag: "v1.0.0", releaseName: null, releaseNotes: null, releaseUrl: "" };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(eventListeners.get("background-refresh-completed")?.length).toBeGreaterThan(0));
    const listener = eventListeners.get("background-refresh-completed")?.[0];
    expect(listener).toBeDefined();

    await act(async () => {
      listener?.({
        payload: {
          scan: scan(0),
          limits: null,
          limitsError: null,
          limitsSkipped: true,
          refreshedAt: "2026-06-11T06:00:00.000Z",
        },
      });
    });

    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_limits")).toHaveLength(2);
      expect(updateTrayMock).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
          title: "5h: 100%/soon",
          items: expect.arrayContaining([
            expect.objectContaining({ id: "status_5h", text: expect.stringContaining("100%") }),
          ]),
        }),
      }));
    });
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
    expect(calls[resetCallIndex + 2]).toEqual(["fetch_codex_limits", undefined]);
    expect(calls[resetCallIndex + 3]).toEqual(["fetch_overview", { range: "30d" }]);
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

      if (command === "download_and_install_update") {
        return { version: "0.5.0" };
      }

      if (command === "restart_app") {
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

    // Click the header upgrade button to download and install the update
    await userEvent.click(headerUpgradeButton);
    expect(invokeMock).toHaveBeenCalledWith("download_and_install_update");

    const restartButton = await screen.findByRole("button", { name: "Restart to update" });
    await userEvent.click(restartButton);
    expect(invokeMock).toHaveBeenCalledWith("restart_app");
  });

  it("shows download progress while installing an update", async () => {
    let finishDownload = (_value: { version: string }) => {};

    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "scan_usage") {
        return { importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" };
      }

      if (command === "fetch_codex_limits") {
        throw new Error("limits unavailable");
      }

      if (command === "fetch_overview") {
        return overview();
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

      if (command === "download_and_install_update") {
        return new Promise((resolve) => {
          finishDownload = resolve;
        });
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("New update available: v0.5.0")).toBeInTheDocument());
    await waitFor(() => expect(eventListeners.get("update-download-progress")?.length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "Upgrade Now" }));

    eventListeners.get("update-download-progress")?.forEach((listener) => {
      listener({ payload: { downloaded: 50, total: 100, finished: false } });
    });

    expect(await screen.findByRole("button", { name: "Downloading 50%" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    finishDownload({ version: "0.5.0" });
    expect(await screen.findByRole("button", { name: "Restart to Update" })).toBeInTheDocument();
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

  it("does not show update banner when cached latest version matches or is older than the current running version", async () => {
    localStorage.clear();
    // Cache says update is available, but the app version is already newer or equal to the cached latest version
    localStorage.setItem("last_update_check_result", JSON.stringify({
      hasUpdate: true,
      currentVersion: "0.4.0",
      latestVersion: tauriConfig.version,
      latestTag: `v${tauriConfig.version}`,
      releaseName: "Big Release",
      releaseNotes: "Details",
      releaseUrl: "https://url"
    }));
    localStorage.setItem("last_update_check_time", Date.now().toString());

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
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    // Wait for the overview to load
    await waitFor(() => expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument());

    // The update banner should NOT be in the document
    expect(screen.queryByText(/New update available/i)).not.toBeInTheDocument();
    
    // Check that the cached result in localStorage was corrected to hasUpdate = false
    const parsedCache = JSON.parse(localStorage.getItem("last_update_check_result") || "{}");
    expect(parsedCache.hasUpdate).toBe(false);
    expect(parsedCache.currentVersion).toBe(tauriConfig.version);
  });
});
