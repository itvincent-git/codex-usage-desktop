// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
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

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("loads the last 30 day overview and switches to last 1 day", async () => {
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
              date: "2026-04-25",
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
    expect(screen.getByText("Total Token Trend")).toBeInTheDocument();
    expect(screen.getByText("Cost Trend")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Total Tokens" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Model Usage")).toBeInTheDocument();
    expect(screen.getByText("Project Usage")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total Token" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "gpt-5" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /codex-usage-desktop/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-04-26" })).toBeInTheDocument();
    expect(screen.getByText("No activity")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Select time range" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Last 1 Day" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith("fetch_overview", { range: "1d" });
    });
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

      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getAllByText("3,400").length).toBeGreaterThan(0));

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "scan_usage");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "fetch_overview", { range: "30d" });
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
});
