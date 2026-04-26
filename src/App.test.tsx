// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

describe("App", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("loads the recent 7 day overview and switches to recent 1 day", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/api/scan")) {
        return new Response(JSON.stringify({ importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" }), {
          status: 200,
        });
      }

      if (url.endsWith("/api/overview?range=7d")) {
        return new Response(
          JSON.stringify({
            range: "7d",
            days: 7,
            timezone: "UTC",
            startDate: "2026-04-20",
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
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/api/overview?range=1d")) {
        return new Response(
          JSON.stringify({
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
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("3,400")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Recent 1 Day" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:43110/api/overview?range=1d");
    });
  });

  it("bootstraps only once in strict mode", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/api/scan")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(JSON.stringify({ importedDays: 3, scannedAt: "2026-04-26T00:00:00.000Z", timezone: "UTC" }), {
          status: 200,
        });
      }

      if (url.endsWith("/api/overview?range=7d")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(
          JSON.stringify({
            range: "7d",
            days: 7,
            timezone: "UTC",
            startDate: "2026-04-20",
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
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText("3,400")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:43110/api/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:43110/api/overview?range=7d");
  });
});
