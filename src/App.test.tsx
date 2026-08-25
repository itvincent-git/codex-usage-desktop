// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import i18n from "./i18n";
import tauriConfig from "../src-tauri/tauri.conf.json";

const invokeMock = vi.hoisted(() => vi.fn());
const forecastInvokeMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const autostartEnableMock = vi.hoisted(() => vi.fn());
const autostartDisableMock = vi.hoisted(() => vi.fn());
const autostartIsEnabledMock = vi.hoisted(() => vi.fn());
const updateTrayMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn());
const eventListeners = vi.hoisted(() => new Map<string, Array<(event: { payload: any }) => void>>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: any[]) => {
    if (command === "update_tray") {
      updateTrayMock(...args);
      return Promise.resolve();
    }
    if (command === "fetch_codex_quota_forecast") {
      return forecastInvokeMock();
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

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: autostartEnableMock,
  disable: autostartDisableMock,
  isEnabled: autostartIsEnabledMock,
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

function mockLoadedDashboard() {
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
}

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    forecastInvokeMock.mockReset();
    forecastInvokeMock.mockRejectedValue(new Error("Forecast unavailable"));
    saveMock.mockReset();
    autostartEnableMock.mockReset();
    autostartEnableMock.mockResolvedValue(undefined);
    autostartDisableMock.mockReset();
    autostartDisableMock.mockResolvedValue(undefined);
    autostartIsEnabledMock.mockReset();
    autostartIsEnabledMock.mockResolvedValue(false);
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

  it("checks for updates again after the app stays open for 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
    localStorage.setItem("last_update_check_time", Date.now().toString());
    localStorage.setItem("last_update_check_result", JSON.stringify({
      hasUpdate: false,
      currentVersion: tauriConfig.version,
      latestVersion: tauriConfig.version,
      latestTag: `v${tauriConfig.version}`,
      releaseName: null,
      releaseNotes: null,
      releaseUrl: "",
    }));
    mockLoadedDashboard();

    render(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("check_for_updates");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000 - 1);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("check_for_updates");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeMock).toHaveBeenCalledWith("check_for_updates");
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

  it("retranslates the completed scan message when the language changes", async () => {
    mockLoadedDashboard();

    render(<App />);
    await screen.findByText("Synced 1 days (1 cached, 0 parsed)");

    await act(async () => {
      await i18n.changeLanguage("zh");
    });

    expect(screen.getByText("已同步 1 天数据 (1 个缓存，0 个解析)")).toBeInTheDocument();
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

  it("shows string errors returned by a background rescan", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string }) => {
      if (command === "fetch_codex_limits") {
        return limits(80);
      }
      if (command === "scan_usage") {
        return Promise.reject("cached quota schema mismatch");
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

    expect(await screen.findByText("cached quota schema mismatch")).toBeInTheDocument();
  });

  it("opens the external quota forecast when the forecast badge is clicked", async () => {
    forecastInvokeMock.mockResolvedValue({
      score: 73,
      fetchedAt: "2026-06-25T09:00:19.499Z",
      nextRefreshAt: "2026-06-25T09:30:19.499Z",
    });

    invokeMock.mockImplementation(async (command: string, args?: { range?: string; url?: string }) => {
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
      if (command === "open_url") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open Codex quota reset forecast" }));

    expect(invokeMock).toHaveBeenCalledWith("open_url", { url: "https://www.willcodexquotareset.com/" });
  });

  it("opens ChatGPT Usage when reset credits are clicked", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { range?: string; url?: string }) => {
      if (command === "fetch_codex_limits") {
        return {
          ...limits(80),
          weekly: {
            usedPercent: 45,
            remainingPercent: 55,
            windowMinutes: 10080,
            resetsAt: "2026-06-18T00:00:00.000Z",
          },
          resetCreditsAvailableCount: 0,
          resetCredits: [],
          membershipLevel: "plus",
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
      if (command === "open_url") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open reset credits in ChatGPT Usage" }));

    expect(invokeMock).toHaveBeenCalledWith("open_url", { url: "https://chatgpt.com/#settings/Usage" });
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
              pricingStatus: "priced",
              inputCostPerMillionTokens: 1.25,
              cachedInputCostPerMillionTokens: 0.125,
              outputCostPerMillionTokens: 10,
              effectiveCostPerMillionTokens: 2.6083,
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
    expect(screen.queryByText("Codex Limits")).not.toBeInTheDocument();
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
    expect(screen.getByText("Model comparison")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5").length).toBeGreaterThan(0);
    expect(screen.queryByRole("cell", { name: /codex-usage-desktop/ })).not.toBeInTheDocument();

    const projectUsageTab = screen.getByRole("tab", { name: "Project" });
    await userEvent.click(projectUsageTab);

    expect(screen.getByRole("heading", { name: "Project Usage Details" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Token composition" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /codex-usage-desktop/ })).toBeInTheDocument();

    // Click the Daily tab to show the DailyUsageTable
    const dailyTab = screen.getByRole("tab", { name: "Daily" });
    await userEvent.click(dailyTab);

    expect(screen.getAllByRole("heading", { name: "Daily Usage" })).toHaveLength(1);
    expect(screen.getAllByText("Compare daily token composition, scale, and cost, with sorting by field.")).toHaveLength(1);
    const latestDailyCell = screen.getByRole("cell", { name: /2026-04-26/ });
    const inactiveDailyCell = screen.getByRole("cell", { name: "2026-04-24 to 2026-04-25" });
    expect(latestDailyCell.compareDocumentPosition(inactiveDailyCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("No activity (2 days)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("row", { name: "View sessions for 2026-04-26" }));
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(dailyTab);

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
    expect(screen.queryByText("Monthly Usage Details")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("fetch_monthly_usage");

    const tabLabels = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabLabels.indexOf("Monthly")).toBe(tabLabels.indexOf("Daily") + 1);
    expect(tabLabels.indexOf("Project")).toBe(tabLabels.indexOf("Monthly") + 1);

    await userEvent.click(screen.getByRole("tab", { name: "Monthly" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fetch_monthly_usage"));
    const monthlyTitle = screen.getByRole("heading", { name: "Monthly Usage Details" });
    expect(monthlyTitle.tagName).toBe("H2");
    expect(monthlyTitle.closest(".rounded-lg")).toBeNull();
    expect(screen.getByText("Natural-month totals from 2025-06 to 2026-05, using the UTC timezone.")).toBeInTheDocument();
    const latestMonthlyCell = screen.getByRole("cell", { name: "2026-05" });
    const inactiveMonthlyCell = screen.getByRole("cell", { name: "2026-02 to 2026-04" });
    expect(latestMonthlyCell.compareDocumentPosition(inactiveMonthlyCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("No usage (3 months)")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "2026-04" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Token Composition" })).toBeInTheDocument();
    expect(screen.getAllByText("1,600").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("usage-trends-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("opens a session replay modal from a session row", async () => {
    const longToolOutput = `${"tool output preview ".repeat(160)}LONG_TOOL_OUTPUT_TAIL`;
    const longArguments = `first command\nsecond command\n${"argument preview ".repeat(30)}LONG_ARGUMENT_TAIL`;
    const execArguments = `const r = await tools.exec_command({cmd:${JSON.stringify(longArguments)},workdir:"/repo/app",yield_time_ms:10000,max_output_tokens:4000}); text(r.output);`;
    const webSearchArguments = 'const res = await tools.web__run({search_query:[{q:"first search query"},{q:"second search query"}],response_length:"short"}); text(res);';
    const webSearchOutput = JSON.stringify([
      { text: "Script completed\nWall time 1.25 seconds\nOutput:\n", type: "input_text" },
      { text: "First result\n--------------------------------------------------------------------------------\nSecond result\n--------------------------------------------------------------------------------\n{\"nested\":{\"visible\":true}}", type: "input_text" },
    ]);
    const directWebSearchOutput = JSON.stringify([{
      type: "text_result",
      title: "Codex Usage Desktop",
      url: "https://github.com/itvincent-git/codex-usage-desktop",
      domain: "github.com",
      snippet: "A local dashboard for Codex CLI token usage.",
      ref_id: "turn0search0",
    }]);
    const applyPatchArguments = 'const patch = "*** Begin Patch\\n*** Update File: /repo/app/src/example.ts\\n@@\\n-old\\n+new\\n*** End Patch";\ntext(await tools.apply_patch(patch));';
    const execOutput = JSON.stringify([
      { text: "Script completed\nWait time 1.25 seconds\nOutput:\n", type: "input_text" },
      { text: longToolOutput, type: "input_text" },
    ]);
    const rawJsonl = [
      JSON.stringify({ timestamp: "2026-06-11T00:00:00.000Z", type: "event_msg", payload: { type: "user_message", turn_id: "turn-1", text: "Replay this session" } }),
      `${"x".repeat(4100)}raw-only-marker`,
      JSON.stringify({ timestamp: "2026-06-11T00:00:01.000Z", type: "event_msg", payload: { type: "assistant_message", turn_id: "turn-1", text: "third-preview-line" } }),
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
            threadName: "Replay summary",
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
            dailyUsage: [
              {
                date: "2026-06-11",
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
          },
        ];
      }
      if (command === "fetch_session_detail" && args?.path === "/tmp/session-replay.jsonl") {
        return {
          path: "/tmp/session-replay.jsonl",
          sessionId: "session-replay.jsonl",
          threadName: "Updated replay summary",
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
            toolCallCount: 4,
            patchCount: 2,
            errorCount: 1,
          },
          turns: [
            {
              turnId: "turn-1",
              startedAt: "2026-06-11T00:00:00.000Z",
              completedAt: "2026-06-11T00:00:02.000Z",
              durationMs: 2000,
              systemMessages: [
                { timestamp: "2026-06-11T00:00:00.000Z", kind: "base_instructions", text: "system-1\nsystem-2\nsystem-3\nSYSTEM_TAIL" },
              ],
              userMessages: [{ timestamp: "2026-06-11T00:00:00.000Z", kind: "user_message", text: "Replay this session\nuser-2\nuser-3\nuser-4\nuser-5\nuser-6\nuser-7\nuser-8\nuser-9\nuser-10\nUSER_TAIL" }],
              assistantMessages: [{ timestamp: "2026-06-11T00:00:00.000Z", kind: "assistant_message", text: "assistant-1\nassistant-2\nassistant-3\nassistant-4\nassistant-5\nassistant-6\nassistant-7\nassistant-8\nassistant-9\nassistant-10\nASSISTANT_TAIL" }],
              reasoningSummaries: [{ timestamp: "2026-06-11T00:00:00.250Z", kind: "reasoning", text: "Reasoning fixture" }],
              toolCalls: [
                {
                  callId: "call-1",
                  name: "exec",
                  status: "completed",
                  arguments: execArguments,
                  output: execOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:00.500Z",
                  completedAt: "2026-06-11T00:00:01.500Z",
                  durationMs: 1000,
                  isError: false,
                },
                {
                  callId: "call-direct-web-search",
                  name: "web_search",
                  status: "completed",
                  arguments: JSON.stringify({ q: "codex usage desktop" }),
                  output: directWebSearchOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  callId: "call-web-search",
                  name: "exec",
                  status: "completed",
                  arguments: webSearchArguments,
                  output: webSearchOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  callId: "call-wait",
                  name: "wait",
                  status: "completed",
                  arguments: JSON.stringify({ cell_id: "8", yield_time_ms: 1000, max_tokens: 30000 }),
                  output: JSON.stringify([
                    { text: "Wait completed\n", type: "input_text" },
                    { text: "Background task output", type: "input_text" },
                    { detail: "high", image_url: "data:image/png;base64,dGVzdA==", type: "input_image" },
                  ]),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  callId: "call-apply-patch",
                  name: "functions.exec",
                  status: "completed",
                  arguments: applyPatchArguments,
                  output: JSON.stringify({}),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.505Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 5,
                  isError: false,
                },
                {
                  callId: "call-input",
                  name: "request_user_input",
                  status: "completed",
                  arguments: JSON.stringify({
                    questions: [{
                      header: "Display mode",
                      id: "display_mode",
                      question: "How should the session item be displayed?",
                      options: [
                        { label: "Option cards (Recommended)", description: "Show each choice as a readable option card." },
                        { label: "Raw JSON", description: "Keep showing the tool arguments as JSON." },
                      ],
                    }],
                  }),
                  output: JSON.stringify({ answers: { display_mode: { answers: ["Option cards (Recommended)"] } } }),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.510Z",
                  completedAt: "2026-06-11T00:00:01.550Z",
                  durationMs: 40,
                  isError: false,
                },
              ],
              patchResults: [
                { callId: "patch-1", success: true, output: "PATCH_SUCCESS_OUTPUT", timestamp: "2026-06-11T00:00:01.600Z", isError: false },
                { callId: "patch-2", success: false, output: "PATCH_FAILURE_OUTPUT", timestamp: "2026-06-11T00:00:01.700Z", isError: true },
              ],
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
              errors: ["Replay error fixture"],
              items: [
                { kind: "message", timestamp: "2026-06-11T00:00:00.000Z", role: "system", source: "base_instructions", text: "system-1\nsystem-2\nsystem-3\nSYSTEM_TAIL" },
                { kind: "message", timestamp: "2026-06-11T00:00:00.000Z", role: "developer", source: "developer_message", text: "developer-1\ndeveloper-2\ndeveloper-3\nDEVELOPER_TAIL" },
                { kind: "message", timestamp: "2026-06-11T00:00:00.000Z", role: "user", source: "user_message", text: "Replay this session\nuser-2\nuser-3\nuser-4\nuser-5\nuser-6\nuser-7\nuser-8\nuser-9\nuser-10\nUSER_TAIL" },
                { kind: "message", timestamp: "2026-06-11T00:00:01.000Z", role: "assistant", source: "assistant_message", text: "assistant-1\nassistant-2\nassistant-3\nassistant-4\nassistant-5\nassistant-6\nassistant-7\nassistant-8\nassistant-9\nassistant-10\nASSISTANT_TAIL" },
                { kind: "reasoning", timestamp: "2026-06-11T00:00:00.250Z", text: "Reasoning fixture" },
                {
                  kind: "toolCall",
                  callId: "call-direct-web-search",
                  name: "web_search",
                  status: "completed",
                  arguments: JSON.stringify({ q: "codex usage desktop" }),
                  output: directWebSearchOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-web-search",
                  name: "exec",
                  status: "completed",
                  arguments: webSearchArguments,
                  output: webSearchOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-1",
                  name: "exec",
                  status: "completed",
                  arguments: execArguments,
                  output: execOutput,
                  stderr: null,
                  startedAt: "2026-06-11T00:00:00.500Z",
                  completedAt: "2026-06-11T00:00:01.500Z",
                  durationMs: 1000,
                  isError: false,
                },
                {
                  kind: "tokenUsage",
                  timestamp: "2026-06-11T00:00:02.000Z",
                  model: "gpt-5",
                  inputTokens: 50_000,
                  cachedInputTokens: 400,
                  outputTokens: 384,
                  reasoningOutputTokens: 0,
                  totalTokens: 50_784,
                },
                {
                  kind: "tokenUsage",
                  timestamp: "2026-06-11T00:00:02.100Z",
                  model: "gpt-5",
                  inputTokens: 55_000,
                  cachedInputTokens: 500,
                  outputTokens: 1_500,
                  reasoningOutputTokens: 0,
                  totalTokens: 56_500,
                },
                {
                  kind: "toolCall",
                  callId: "call-running-tests",
                  name: "exec",
                  status: "running",
                  arguments: JSON.stringify({ cmd: "pnpm test src/App.test.tsx && pnpm typecheck" }),
                  output: "running test output\n› Sent: y\ncontinued test output",
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: null,
                  durationMs: 11000,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-failed-tests",
                  name: "exec",
                  status: "failed",
                  arguments: JSON.stringify({ cmd: "pnpm test src/App.test.tsx" }),
                  output: "Script completed\nWall time 14.2 seconds\nOutput:\n2 tests failed",
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:15.700Z",
                  durationMs: 14200,
                  isError: true,
                },
                {
                  kind: "toolCall",
                  callId: "call-stopped-dev-server",
                  name: "exec",
                  status: "stopped",
                  arguments: JSON.stringify({ cmd: "pnpm tauri dev" }),
                  output: "shutting down\nProcess stopped with signal SIGTERM",
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:13.500Z",
                  durationMs: 12000,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-wait",
                  name: "wait",
                  status: "completed",
                  arguments: JSON.stringify({ cell_id: "8", yield_time_ms: 1000, max_tokens: 30000 }),
                  output: JSON.stringify([
                    { text: "Wait completed\n", type: "input_text" },
                    { text: "Background task output", type: "input_text" },
                    { detail: "high", image_url: "data:image/png;base64,dGVzdA==", type: "input_image" },
                  ]),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.500Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 10,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-apply-patch",
                  name: "functions.exec",
                  status: "completed",
                  arguments: applyPatchArguments,
                  output: JSON.stringify({}),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.505Z",
                  completedAt: "2026-06-11T00:00:01.510Z",
                  durationMs: 5,
                  isError: false,
                },
                {
                  kind: "toolCall",
                  callId: "call-input",
                  name: "request_user_input",
                  status: "completed",
                  arguments: JSON.stringify({
                    questions: [{
                      header: "Display mode",
                      id: "display_mode",
                      question: "How should the session item be displayed?",
                      options: [
                        { label: "Option cards (Recommended)", description: "Show each choice as a readable option card." },
                        { label: "Raw JSON", description: "Keep showing the tool arguments as JSON." },
                      ],
                    }],
                  }),
                  output: JSON.stringify({ answers: { display_mode: { answers: ["Option cards (Recommended)"] } } }),
                  stderr: null,
                  startedAt: "2026-06-11T00:00:01.510Z",
                  completedAt: "2026-06-11T00:00:01.550Z",
                  durationMs: 40,
                  isError: false,
                },
                { kind: "patch", callId: "patch-1", success: true, output: "PATCH_SUCCESS_OUTPUT", timestamp: "2026-06-11T00:00:01.600Z", isError: false },
                { kind: "patch", callId: "patch-2", success: false, output: "PATCH_FAILURE_OUTPUT", timestamp: "2026-06-11T00:00:01.700Z", isError: true },
                { kind: "error", timestamp: "2026-06-11T00:00:01.800Z", text: "Replay error fixture" },
                { kind: "notice", timestamp: "2026-06-11T00:00:01.900Z", label: "Replay notice", text: "Notice fixture" },
              ],
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
    expect(await screen.findByText("Replay summary")).toBeInTheDocument();
    expect(screen.getByText("session-replay")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Replay summary"));

    expect(await screen.findByRole("dialog", { name: "Updated replay summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close session detail" })).toHaveFocus();
    const detailHeader = screen.getByRole("dialog", { name: "Updated replay summary" }).querySelector("header")!;
    expect(detailHeader).toHaveClass("py-1.5");
    expect(screen.getByRole("button", { name: /Details/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(detailHeader).queryByText("session-replay")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByRole("button", { name: /Details/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(detailHeader).getByText("session-replay")).toHaveClass("border-zinc-300/70");
    expect(within(detailHeader).getByText("/repo/app")).toHaveClass("border-blue-300/60");
    expect(within(detailHeader).getByText("gpt-5")).toHaveClass("border-emerald-300/60");
    expect(screen.getAllByText("session-replay").length).toBeGreaterThan(0);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.scroll(screen.getByTestId("session-detail-scroll"), { target: { scrollTop: 20 } });
    expect(detailHeader).toHaveClass("py-1");
    const turnButton = screen.getByRole("button", { name: /Turn turn-1/ });
    expect(turnButton).toHaveAttribute("aria-expanded", "true");
    expect(turnButton).toHaveTextContent("4 messages");
    expect(turnButton).toHaveTextContent("6 tools");
    expect(turnButton).toHaveTextContent("2 patches");
    expect(turnButton).toHaveTextContent("1 error");
    expect(turnButton).toHaveTextContent("1 token event");
    expect(turnButton).toHaveTextContent("Collapse");
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    const systemButton = screen.getByRole("button", { name: /System prompt/ });
    const developerButton = screen.getByRole("button", { name: /Developer/ });
    const userButton = screen.getByRole("button", { name: /User/ });
    const assistantButton = screen.getByRole("button", { name: /Assistant/ });
    expect(systemButton).toHaveAttribute("aria-expanded", "false");
    expect(developerButton).toHaveAttribute("aria-expanded", "false");
    expect(userButton).toHaveAttribute("aria-expanded", "false");
    expect(assistantButton).toHaveAttribute("aria-expanded", "false");
    expect(systemButton).toHaveTextContent("Expand");
    expect(developerButton).toHaveTextContent("Expand");
    expect(userButton).toHaveTextContent("Expand");
    expect(assistantButton).toHaveTextContent("Expand");
    expect(systemButton.parentElement).toHaveClass("border-zinc-300/70");
    expect(developerButton.parentElement).toHaveClass("border-violet-300/70");
    expect(userButton.parentElement).toHaveClass("border-blue-300/70");
    expect(assistantButton.parentElement).toHaveClass("border-emerald-300/70");
    expect(systemButton.nextElementSibling).toHaveClass("line-clamp-3");
    expect(developerButton.nextElementSibling).toHaveClass("line-clamp-3");
    expect(userButton.nextElementSibling).toHaveClass("line-clamp-[10]");
    expect(assistantButton.nextElementSibling).toHaveClass("line-clamp-[10]");
    expect(systemButton.nextElementSibling).not.toHaveTextContent("SYSTEM_TAIL");
    expect(developerButton.nextElementSibling).not.toHaveTextContent("DEVELOPER_TAIL");
    expect(userButton.nextElementSibling).not.toHaveTextContent("USER_TAIL");
    expect(assistantButton.nextElementSibling).not.toHaveTextContent("ASSISTANT_TAIL");
    expect(screen.getAllByText(/Replay this session/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/LONG_TOOL_OUTPUT_TAIL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LONG_ARGUMENT_TAIL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-only-marker/)).not.toBeInTheDocument();

    const toolCallButton = screen.getByRole("button", { name: /Ran \(1s, exit 0\) first command/ });
    const toolCall = toolCallButton.parentElement!;
    expect(toolCallButton).toHaveAttribute("aria-expanded", "false");
    expect(toolCallButton.querySelector('[title="Process exited successfully"]')).toHaveClass("text-emerald-700");
    expect(toolCall).toHaveClass("border-cyan-300/70");
    expect(toolCall).toHaveTextContent("first command");
    expect(toolCall).toHaveTextContent("└ tool output preview");
    expect(toolCall).not.toHaveTextContent("Working directory: /repo/app");
    expect(toolCall).not.toHaveTextContent("Script completed");
    expect(toolCall).not.toHaveTextContent("Wall time");
    expect(toolCall).not.toHaveTextContent("Wait time");
    expect(toolCall).not.toHaveTextContent("yield time");
    expect(toolCall).not.toHaveTextContent("input_text");
    expect(toolCall).not.toHaveTextContent('"text"');
    const tokenMetadata = within(toolCallButton).getByText("56.5k tokens");
    expect(tokenMetadata).toHaveClass("text-violet-500/80");
    expect(tokenMetadata).toHaveAttribute("title", expect.stringContaining("Model: gpt-5\nTokens: 56,500\nTime:"));
    expect(toolCall).not.toHaveTextContent("50.8k tokens");
    expect(toolCall).not.toHaveClass("border-fuchsia-300/70");
    await userEvent.click(toolCallButton);
    expect(toolCallButton).toHaveAttribute("aria-expanded", "true");
    expect(toolCallButton).toHaveTextContent("Collapse");
    expect(toolCall).toHaveTextContent("LONG_ARGUMENT_TAIL");
    expect(toolCall).toHaveTextContent("LONG_TOOL_OUTPUT_TAIL");
    await userEvent.click(toolCallButton);
    expect(toolCallButton).toHaveAttribute("aria-expanded", "false");
    expect(toolCall).not.toHaveTextContent("LONG_ARGUMENT_TAIL");
    expect(toolCall).not.toHaveTextContent("LONG_TOOL_OUTPUT_TAIL");
    const runningActivity = screen.getByRole("button", { name: /Running \(11s\) pnpm test src\/App.test.tsx && pnpm typecheck/ });
    expect(runningActivity).toHaveAttribute("aria-expanded", "false");
    expect(runningActivity.parentElement).toHaveTextContent("running test output");
    await userEvent.click(runningActivity);
    expect(runningActivity.parentElement).toHaveTextContent("› Sent: y");
    const failedActivity = screen.getByRole("button", { name: /Ran \(14.2s, exit 1\) pnpm test src\/App.test.tsx/ });
    expect(failedActivity).toHaveAttribute("aria-expanded", "false");
    expect(failedActivity.querySelector('[title="Process exited with an error"]')).toHaveClass("text-error");
    expect(failedActivity.parentElement).toHaveTextContent("└ 2 tests failed");
    const stoppedActivity = screen.getByRole("button", { name: /Stopped \(12s, SIGTERM\) pnpm tauri dev/ });
    expect(stoppedActivity.parentElement).toHaveTextContent("└ shutting down");
    expect(stoppedActivity.parentElement).not.toHaveTextContent("Process stopped with signal");
    const webSearchButton = screen.getAllByRole("button", { name: /Web search · completed/ })
      .find((button) => button.parentElement?.textContent?.includes("first search query"))!;
    const webSearchCall = webSearchButton.parentElement!;
    expect(webSearchCall).toHaveTextContent("first search query");
    expect(webSearchCall).toHaveTextContent("second search query");
    expect(webSearchCall).not.toHaveTextContent("tools.web__run");
    expect(webSearchCall).not.toHaveTextContent("search_query");
    expect(webSearchCall).not.toHaveTextContent("--------------------------------------------------------------------------------");
    await userEvent.click(webSearchButton);
    expect(webSearchCall).toHaveTextContent("Search result 1");
    expect(webSearchCall).toHaveTextContent("First result");
    expect(webSearchCall).toHaveTextContent("Search result 2");
    expect(webSearchCall).toHaveTextContent("Second result");
    expect(webSearchCall).toHaveTextContent("Search result 3");
    expect(screen.getByText("Search result 3").nextElementSibling?.textContent).toBe('{\n  "nested": {\n    "visible": true\n  }\n}');
    const directWebSearchLink = screen.getByRole("link", { name: "Codex Usage Desktop" });
    const directWebSearchCall = directWebSearchLink.closest("article")!.parentElement!.parentElement!;
    expect(directWebSearchLink).toHaveAttribute("href", "https://github.com/itvincent-git/codex-usage-desktop");
    expect(directWebSearchCall).toHaveTextContent("github.com");
    expect(directWebSearchCall).toHaveTextContent("A local dashboard for Codex CLI token usage.");
    expect(directWebSearchCall).not.toHaveTextContent('"ref_id"');
    expect(directWebSearchCall).not.toHaveTextContent('"type"');
    const waitCallButton = screen.getByRole("button", { name: /wait · completed/ });
    const waitCall = waitCallButton.parentElement!;
    expect(waitCall).toHaveTextContent("Process session8");
    expect(waitCall).toHaveTextContent("Wait interval (ms)1000");
    expect(waitCall).toHaveTextContent("Output token limit30000");
    expect(waitCall).not.toHaveTextContent("cell_id");
    expect(waitCall).not.toHaveTextContent("yield_time_ms");
    expect(waitCall).not.toHaveTextContent("max_tokens");
    expect(waitCall).toHaveTextContent("Wait completed");
    expect(waitCall).toHaveTextContent("Background task output");
    expect(waitCall).toHaveTextContent("1 output image");
    expect(waitCall).not.toHaveTextContent("input_text");
    expect(waitCall).not.toHaveTextContent('"text"');
    expect(within(waitCall).queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(waitCallButton);
    expect(within(waitCall).getByRole("img", { name: "Output image 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /write_stdin/ })).not.toBeInTheDocument();
    const applyPatchButton = screen.getByRole("button", { name: /functions.exec · completed/ });
    const applyPatchCall = applyPatchButton.parentElement!;
    expect(applyPatchCall).toHaveTextContent("Edited 1 file");
    expect(applyPatchCall).toHaveTextContent("+1");
    expect(applyPatchCall).toHaveTextContent("-1");
    expect(applyPatchCall).not.toHaveTextContent("*** Begin Patch");
    expect(applyPatchCall).not.toHaveTextContent("const patch =");
    expect(applyPatchCall).not.toHaveTextContent("\\n*** Update File");
    expect(applyPatchCall).not.toHaveTextContent("Output");
    expect(applyPatchCall).not.toHaveTextContent("{}");
    await userEvent.click(applyPatchButton);
    expect(applyPatchCall).toHaveTextContent("src/example.ts");
    expect(screen.getByText("+new").parentElement).toHaveClass("bg-green-500/15");
    expect(screen.getByText("-old").parentElement).toHaveClass("bg-red-500/15");
    expect(screen.getByText("User input request")).toBeInTheDocument();
    expect(screen.getByText("Display mode")).toBeInTheDocument();
    expect(screen.getByText("How should the session item be displayed?")).toBeInTheDocument();
    expect(screen.getByText("Option cards (Recommended)").closest("li")).toHaveClass("border-primary/50");
    expect(screen.getByText("Raw JSON").closest("li")).not.toHaveClass("border-primary/50");
    expect(screen.getByText("Show each choice as a readable option card.")).toBeInTheDocument();

    const reasoningTitle = screen.getByText("Reasoning summary");
    expect(reasoningTitle.parentElement?.parentElement).toHaveClass("border-amber-300/70");
    const failedPatchButton = screen.getByRole("button", { name: /Patch failed/ });
    expect(screen.queryByRole("button", { name: /Patch result/ })).not.toBeInTheDocument();
    expect(failedPatchButton.parentElement).toHaveClass("border-error/40");
    expect(screen.queryByText("PATCH_SUCCESS_OUTPUT")).not.toBeInTheDocument();
    expect(screen.queryByText(/50,784 tokens/)).not.toBeInTheDocument();
    expect(screen.getByText("Replay error fixture").parentElement).toHaveClass("border-error/40");
    expect(screen.getByText(/Replay notice/).parentElement).toHaveClass("border-sky-300/70");

    await userEvent.click(systemButton);
    expect(systemButton).toHaveAttribute("aria-expanded", "true");
    expect(systemButton).toHaveTextContent("Collapse");
    expect(screen.getByText(/SYSTEM_TAIL/)).toBeInTheDocument();

    await userEvent.click(turnButton);
    expect(turnButton).toHaveAttribute("aria-expanded", "false");
    expect(turnButton).toHaveTextContent("Expand");
    expect(screen.queryByText(/LONG_TOOL_OUTPUT_TAIL/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Raw JSONL" }));
    expect(screen.getByText("Raw JSONL preview")).toBeInTheDocument();
    expect(screen.queryByText(/raw-only-marker/)).not.toBeInTheDocument();
    expect(screen.getByText(/third-preview-line/)).toBeInTheDocument();

    const showFullButton = screen.getByRole("button", { name: "Show full JSONL" });
    const copyButton = screen.getByRole("button", { name: "Copy" });
    expect(showFullButton.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(copyButton);
    expect(writeTextMock).toHaveBeenCalledWith(rawJsonl);

    await userEvent.click(showFullButton);
    expect(screen.getByText(/raw-only-marker/)).toBeInTheDocument();

    screen.getByRole("button", { name: /Details/ }).focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: /Copy|Copied/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Updated replay summary" })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("auto");
    expect(screen.getByText("Replay summary")).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain("Replay summary");
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

  it("defaults the tray title to 5-hour and weekly limits", async () => {
    const now = new Date().getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const sessionReset = new Date(now + 3 * 60 * 60_000).toISOString();
    const weeklyReset = new Date(now + 4 * 24 * 60 * 60_000).toISOString();

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
    expect(screen.getByRole("tabpanel", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Display Settings")).toBeInTheDocument();
    expect(screen.getByText("Menu Bar / System Tray Settings")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Maintenance" }));
    expect(screen.getByRole("tab", { name: "Maintenance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Menu Bar / System Tray Settings")).toBeInTheDocument();
    expect(screen.getByText("Local cache")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("tab", { name: "Maintenance" }));
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

    expect(screen.getByText("Menu Bar / System Tray Settings")).toBeInTheDocument();
    expect(screen.getByText("Display Settings")).toBeInTheDocument();

    // Verify Display Settings card is rendered with "Show Logs Tab" toggle switch
    expect(screen.getByText("Language Settings")).toBeInTheDocument();
    expect(screen.getByText("Display Settings")).toBeInTheDocument();
    expect(screen.getByText("Launch at Login")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    await userEvent.click(screen.getByRole("button", { name: "Toggle Logs Tab" }));

    // Logs tab should be hidden and settings should remain selected
    expect(screen.queryByRole("tab", { name: "Logs" })).not.toBeInTheDocument();
    expect(localStorage.getItem("show_logs_tab")).toBe("false");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows launch at login as disabled when autostart is not enabled", async () => {
    mockLoadedDashboard();
    autostartIsEnabledMock.mockResolvedValue(false);

    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("tab", { name: "General" }));

    const toggle = await screen.findByRole("button", { name: "Toggle Launch at Login" });
    await waitFor(() => expect(autostartIsEnabledMock).toHaveBeenCalled());
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("enables launch at login from Settings", async () => {
    mockLoadedDashboard();
    autostartIsEnabledMock.mockResolvedValue(false);

    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    const toggle = await screen.findByRole("button", { name: "Toggle Launch at Login" });

    await userEvent.click(toggle);

    await waitFor(() => expect(autostartEnableMock).toHaveBeenCalledTimes(1));
    expect(autostartDisableMock).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("disables launch at login from Settings", async () => {
    mockLoadedDashboard();
    autostartIsEnabledMock.mockResolvedValue(true);

    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    const toggle = await screen.findByRole("button", { name: "Toggle Launch at Login" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));

    await userEvent.click(toggle);

    await waitFor(() => expect(autostartDisableMock).toHaveBeenCalledTimes(1));
    expect(autostartEnableMock).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("rolls back launch at login when enabling fails", async () => {
    mockLoadedDashboard();
    autostartIsEnabledMock.mockResolvedValue(false);
    autostartEnableMock.mockRejectedValue(new Error("Autostart unavailable"));

    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    const toggle = await screen.findByRole("button", { name: "Toggle Launch at Login" });
    await userEvent.click(toggle);

    expect(await screen.findByText("Autostart unavailable")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("rolls back launch at login when disabling fails", async () => {
    mockLoadedDashboard();
    autostartIsEnabledMock.mockResolvedValue(true);
    autostartDisableMock.mockRejectedValue(new Error("Cannot disable autostart"));

    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    const toggle = await screen.findByRole("button", { name: "Toggle Launch at Login" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(toggle);

    expect(await screen.findByText("Cannot disable autostart")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
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
