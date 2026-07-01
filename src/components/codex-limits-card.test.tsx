// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatResetTime, CodexLimitsCard } from "./codex-limits-card";
import dayjs from "dayjs";
import { fireEvent, render, screen } from "@testing-library/react";

describe("formatResetTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Reset unavailable when resetsAtStr is null", () => {
    expect(formatResetTime(null, 300)).toBe("Reset unavailable");
  });

  it("returns Resetting soon when resetsAt is in the past", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    expect(formatResetTime("2026-05-22T11:59:00.000Z", 300)).toBe("Resetting soon");
  });

  it("returns formatted Reset at HH:MM for session limits in future", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    
    const resetsAtStr = "2026-05-22T16:30:00.000Z";
    const expectedResetDate = new Date(resetsAtStr);
    const expectedHours = String(expectedResetDate.getHours()).padStart(2, "0");
    const expectedMins = String(expectedResetDate.getMinutes()).padStart(2, "0");
    
    expect(formatResetTime(resetsAtStr, 300)).toBe(`Reset at ${expectedHours}:${expectedMins} (5 hours left)`);
  });

  it("returns formatted Reset at HH:MM with minutes left for session limits", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    
    const resetsAtStr = "2026-05-22T12:10:00.000Z";
    const expectedResetDate = new Date(resetsAtStr);
    const expectedHours = String(expectedResetDate.getHours()).padStart(2, "0");
    const expectedMins = String(expectedResetDate.getMinutes()).padStart(2, "0");
    
    expect(formatResetTime(resetsAtStr, 300)).toBe(`Reset at ${expectedHours}:${expectedMins} (10 mins left)`);
  });

  it("returns formatted weekly limit style for windowMinutes > 300", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    
    const resetsAtStr = "2026-05-24T05:00:00.000Z";
    const resetsAt = new Date(resetsAtStr);
    const resetDate = dayjs(resetsAtStr).format("YYYY-MM-DD h:mm A");
    
    const diffMs = resetsAt.getTime() - new Date("2026-05-22T12:00:00.000Z").getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    let daysLeftText = "";
    if (diffHours < 1) {
      const mins = Math.ceil(diffMs / (1000 * 60));
      daysLeftText = mins === 1 ? "1 min left" : `${mins} mins left`;
    } else if (diffHours < 24) {
      const hours = Math.ceil(diffHours);
      daysLeftText = hours === 1 ? "1 hour left" : `${hours} hours left`;
    } else {
      const days = Math.ceil(diffHours / 24);
      daysLeftText = days === 1 ? "1 day left" : `${days} days left`;
    }
    
    expect(formatResetTime(resetsAtStr, 10080)).toBe(`Resets ${resetDate} (${daysLeftText})`);
  });

  it("returns formatted weekly limit style with 1 day left", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    const resetsAtStr = "2026-05-23T11:59:00.000Z";
    const resetDate = dayjs(resetsAtStr).format("YYYY-MM-DD h:mm A");
    expect(formatResetTime(resetsAtStr, 10080)).toBe(`Resets ${resetDate} (24 hours left)`);

    const resetsAtStr2 = "2026-05-23T12:01:00.000Z";
    const resetDate2 = dayjs(resetsAtStr2).format("YYYY-MM-DD h:mm A");
    expect(formatResetTime(resetsAtStr2, 10080)).toBe(`Resets ${resetDate2} (1 day left)`);
  });

  it("returns formatted weekly limit style with hours left", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    const resetsAtStr = "2026-05-22T17:00:00.000Z"; // 5 hours in future
    const resetDate = dayjs(resetsAtStr).format("YYYY-MM-DD h:mm A");
    expect(formatResetTime(resetsAtStr, 10080)).toBe(`Resets ${resetDate} (5 hours left)`);
  });

  it("returns formatted weekly limit style with minutes left", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    const resetsAtStr = "2026-05-22T12:35:00.000Z"; // 35 minutes in future
    const resetDate = dayjs(resetsAtStr).format("YYYY-MM-DD h:mm A");
    expect(formatResetTime(resetsAtStr, 10080)).toBe(`Resets ${resetDate} (35 mins left)`);
  });
});

describe("CodexLimitsCard component", () => {
  it("renders friendly tip for OAuth login / no credentials error", () => {
    const errorMsg = "OAuth unavailable: Failed to read Codex auth at /Users/vincent/.codex/auth.json: No such file or directory (os error 2); CLI RPC unavailable: Codex CLI not found.";
    render(<CodexLimitsCard limits={null} error={errorMsg} />);

    expect(screen.getByText("Not Logged In / 尚未登录")).toBeInTheDocument();
    expect(screen.getByText("codex auth login")).toBeInTheDocument();
    expect(screen.queryByText("Codex limits unavailable:")).not.toBeInTheDocument();
  });

  it("renders default error message for other errors", () => {
    const errorMsg = "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.";
    render(<CodexLimitsCard limits={null} error={errorMsg} />);

    expect(screen.queryByText("Not Logged In / 尚未登录")).not.toBeInTheDocument();
    expect(screen.getByText("Unable to get Codex limits right now. Please check your network and Codex login status, then try again.")).toBeInTheDocument();
    expect(screen.queryByText(errorMsg)).not.toBeInTheDocument();
  });

  it("renders a single monthly limit row when the user is not subscribed to any membership", () => {
    const freeLimits = {
      session: {
        usedPercent: 10,
        remainingPercent: 90,
        windowMinutes: 300,
        resetsAt: "2026-05-22T16:30:00.000Z",
      },
      weekly: {
        usedPercent: 45,
        remainingPercent: 55,
        windowMinutes: 10080,
        resetsAt: "2026-05-24T05:00:00.000Z",
      },
      updatedAt: "2026-05-22T12:00:00.000Z",
      source: "cli-rpc",
      account: "free@example.com",
      membershipLevel: "free",
    };

    render(<CodexLimitsCard limits={freeLimits} error={null} />);

    expect(screen.getByText("Monthly usage limit")).toBeInTheDocument();
    expect(screen.queryByText("5-Hour Limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly Limit")).not.toBeInTheDocument();
  });

  it("renders reset credits on the weekly limit row", () => {
    const limits = {
      session: {
        usedPercent: 10,
        remainingPercent: 90,
        windowMinutes: 300,
        resetsAt: "2026-05-22T16:30:00.000Z",
      },
      weekly: {
        usedPercent: 45,
        remainingPercent: 55,
        windowMinutes: 10080,
        resetsAt: "2026-05-24T05:00:00.000Z",
      },
      resetCreditsAvailableCount: 2,
      updatedAt: "2026-05-22T12:00:00.000Z",
      source: "oauth",
      account: "plus@example.com",
      membershipLevel: "plus",
    };

    render(<CodexLimitsCard limits={limits} error={null} />);

    expect(screen.getByText("Weekly Limit")).toBeInTheDocument();
    expect(screen.getByText("Reset credits")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("times")).toBeInTheDocument();
  });

  it("renders a prominent quota forecast badge", () => {
    render(
      <CodexLimitsCard
        limits={null}
        error={null}
        quotaForecast={{
          score: 73,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
      />,
    );

    const forecastButton = screen.getByRole("button", { name: "Open Codex quota reset forecast" });

    expect(screen.getByRole("img", { name: "73% reset probability" })).toBeInTheDocument();
    expect(forecastButton).toHaveTextContent("73");
    expect(forecastButton).toHaveTextContent("Reset likely in 48h");
    expect(forecastButton).toHaveClass("border-error/30");
  });

  it("changes quota forecast color by probability", () => {
    const { rerender } = render(
      <CodexLimitsCard
        limits={null}
        error={null}
        quotaForecast={{
          score: 18,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Codex quota reset forecast" })).toHaveClass("border-success/30");

    rerender(
      <CodexLimitsCard
        limits={null}
        error={null}
        quotaForecast={{
          score: 55,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Codex quota reset forecast" })).toHaveClass("border-warning/35");
  });

  it("opens the quota forecast URL from the forecast badge", () => {
    const onOpenQuotaForecast = vi.fn();

    render(
      <CodexLimitsCard
        limits={null}
        error={null}
        quotaForecast={{
          score: 55,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
        onOpenQuotaForecast={onOpenQuotaForecast}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Codex quota reset forecast" }));

    expect(onOpenQuotaForecast).toHaveBeenCalledTimes(1);
  });

  it("does not render the quota forecast pill without forecast data", () => {
    render(<CodexLimitsCard limits={null} error={null} quotaForecast={null} />);

    expect(screen.queryByRole("button", { name: "Open Codex quota reset forecast" })).not.toBeInTheDocument();
  });
});
