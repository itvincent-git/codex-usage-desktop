// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatResetTime, CodexLimitsCard } from "./codex-limits-card";
import dayjs from "dayjs";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";

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
    render(<CodexLimitsCard onOpenResetCredits={() => {}} limits={null} error={errorMsg} />);

    expect(screen.getByText("Not Logged In / 尚未登录")).toBeInTheDocument();
    expect(screen.getByText("codex auth login")).toBeInTheDocument();
    expect(screen.queryByText("Codex limits unavailable:")).not.toBeInTheDocument();
  });

  it("renders default error message for other errors", () => {
    const errorMsg = "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.";
    render(<CodexLimitsCard onOpenResetCredits={() => {}} limits={null} error={errorMsg} />);

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

    render(<CodexLimitsCard onOpenResetCredits={() => {}} limits={freeLimits} error={null} />);

    expect(screen.getByText("Monthly usage limit")).toBeInTheDocument();
    expect(screen.getByTestId("reset-area")).toBeInTheDocument();
    expect(screen.getByTestId("reset-area").parentElement).toHaveClass("grid-cols-1", "md:grid-cols-2");
    expect(screen.queryByText("5-Hour Limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly Limit")).not.toBeInTheDocument();
  });

  it("renders all limit sections without the outer title, description, or update time", () => {
    render(
      <CodexLimitsCard
        onOpenResetCredits={() => {}}
        limits={{
          session: { usedPercent: 10, remainingPercent: 90, windowMinutes: 300, resetsAt: null },
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: null },
          resetCreditsAvailableCount: 1,
          resetCredits: [],
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
        quotaForecast={{
          score: 73,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
      />,
    );

    const resetArea = screen.getByTestId("reset-area");
    const weeklyLimit = screen.getByTestId("limit-row-weekly");
    const forecastButton = screen.getByRole("button", { name: "Open Codex quota reset forecast" });
    const creditCount = screen.getByTestId("reset-credit-count");

    expect(screen.getByText("5-Hour Limit")).toBeInTheDocument();
    expect(screen.getByText("Weekly Limit")).toBeInTheDocument();
    expect(resetArea).toContainElement(forecastButton);
    expect(resetArea).toContainElement(creditCount);
    expect(resetArea.parentElement).toHaveClass("grid-cols-1", "md:grid-cols-3");
    expect(weeklyLimit).not.toContainElement(creditCount);
    expect(screen.queryByText("Codex Limits")).not.toBeInTheDocument();
    expect(screen.queryByText("Live limits from your Codex account")).not.toBeInTheDocument();
    expect(screen.queryByText("Updated 08:00:00")).not.toBeInTheDocument();
  });

  it("renders whichever reset data is available", () => {
    const { rerender } = render(
      <CodexLimitsCard
        onOpenResetCredits={() => {}}
        limits={{
          session: null,
          weekly: null,
          resetCreditsAvailableCount: 2,
          resetCredits: null,
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
        quotaForecast={null}
      />,
    );

    expect(screen.getByTestId("reset-credit-count")).toHaveTextContent("2 available");
    expect(screen.queryByRole("button", { name: "Open Codex quota reset forecast" })).not.toBeInTheDocument();

    rerender(
      <CodexLimitsCard
        onOpenResetCredits={() => {}}
        limits={{
          session: null,
          weekly: null,
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
        quotaForecast={{
          score: 55,
          fetchedAt: "2026-06-25T09:00:19.499Z",
          nextRefreshAt: "2026-06-25T09:30:19.499Z",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Codex quota reset forecast" })).toBeInTheDocument();
    expect(screen.queryByTestId("reset-credit-count")).not.toBeInTheDocument();
  });

  it("collapses reset credits to the earliest expiry and expands the sorted detail list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00+08:00"));
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
      resetCreditsAvailableCount: 3,
      resetCredits: [
        { id: "later", expiresAt: "2026-08-03T18:00:00+08:00" },
        { id: "never", expiresAt: null },
        { id: "earlier", expiresAt: "2026-08-01T18:00:00+08:00" },
      ],
      updatedAt: "2026-05-22T12:00:00.000Z",
      source: "oauth",
      account: "plus@example.com",
      membershipLevel: "plus",
    };

    const onOpenResetCredits = vi.fn();
    render(<CodexLimitsCard onOpenResetCredits={onOpenResetCredits} limits={limits} error={null} />);

    expect(screen.getByText("Weekly Limit")).toBeInTheDocument();
    expect(screen.getByText("Reset credits")).toBeInTheDocument();
    expect(screen.getByTestId("reset-credit-count")).toHaveTextContent("3 available");
    expect(screen.getByTestId("reset-credit-count")).toHaveClass("bg-muted", "text-muted-foreground", "tabular-nums");
    expect(screen.getByText("Credit 1")).toBeInTheDocument();
    expect(screen.getByText(`Expires ${dayjs("2026-08-01T18:00:00+08:00").format("YYYY-MM-DD HH:mm")}`)).toBeInTheDocument();
    expect(screen.getByText("18 days left")).toBeInTheDocument();
    expect(screen.queryByText("Credit 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Does not expire")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Show or hide reset credit expiration details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(onOpenResetCredits).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Credit 2")).toBeInTheDocument();
    expect(screen.getByText(`Expires ${dayjs("2026-08-03T18:00:00+08:00").format("YYYY-MM-DD HH:mm")}`)).toBeInTheDocument();
    expect(screen.getByText("20 days left")).toBeInTheDocument();
    expect(screen.getByText("Credit 3")).toBeInTheDocument();
    expect(screen.getByText("Does not expire")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Credit 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Does not expire")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("opens ChatGPT Usage from the reset-credit label and available-count badge", () => {
    const onOpenResetCredits = vi.fn();
    render(
      <CodexLimitsCard
        onOpenResetCredits={onOpenResetCredits}
        limits={{
          session: null,
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: null },
          resetCreditsAvailableCount: 1,
          resetCredits: [],
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
      />,
    );

    fireEvent.click(screen.getByText("Reset credits"));
    fireEvent.click(screen.getByTestId("reset-credit-count"));

    expect(onOpenResetCredits).toHaveBeenCalledTimes(2);
  });

  it("renders structured reset-credit fields in Chinese", async () => {
    await i18n.changeLanguage("zh");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00+08:00"));

    render(
      <CodexLimitsCard onOpenResetCredits={() => {}}
        limits={{
          session: null,
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-08-04T05:00:00.000Z" },
          resetCreditsAvailableCount: 1,
          resetCredits: [{ id: "known", expiresAt: "2026-08-01T18:00:00+08:00" }],
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
      />,
    );

    expect(screen.getByText("重置次数")).toBeInTheDocument();
    expect(screen.getByTestId("reset-credit-count")).toHaveTextContent("1 次可用");
    expect(screen.getByText("第 1 次")).toBeInTheDocument();
    expect(screen.getByText(`${dayjs("2026-08-01T18:00:00+08:00").format("YYYY-MM-DD HH:mm")} 到期`)).toBeInTheDocument();
    expect(screen.getByText("剩 18 天")).toBeInTheDocument();

    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("reports partial expiration details only when expanded", () => {
    render(
      <CodexLimitsCard onOpenResetCredits={() => {}}
        limits={{
          session: null,
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-08-04T05:00:00.000Z" },
          resetCreditsAvailableCount: 3,
          resetCredits: [{ id: "known", expiresAt: "2026-08-01T18:00:00.000Z" }],
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
      />,
    );

    expect(screen.queryByText("Expiration details were not returned for 2 more credits")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show or hide reset credit expiration details" }));

    expect(screen.getByText("Expiration details were not returned for 2 more credits")).toBeInTheDocument();
  });

  it("keeps the reset count when all expiration details are unavailable", () => {
    render(
      <CodexLimitsCard onOpenResetCredits={() => {}}
        limits={{
          session: null,
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-08-04T05:00:00.000Z" },
          resetCreditsAvailableCount: 3,
          resetCredits: null,
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
      />,
    );

    expect(screen.getByTestId("reset-credit-count")).toHaveTextContent("3 available");
    expect(screen.getByText("Expiration details are temporarily unavailable")).toBeInTheDocument();
  });

  it("shows the empty reset-credit state when no credits are available", () => {
    const onOpenResetCredits = vi.fn();
    render(
      <CodexLimitsCard onOpenResetCredits={onOpenResetCredits}
        limits={{
          session: null,
          weekly: { usedPercent: 45, remainingPercent: 55, windowMinutes: 10080, resetsAt: "2026-08-04T05:00:00.000Z" },
          resetCreditsAvailableCount: 0,
          resetCredits: [],
          updatedAt: "2026-07-15T00:00:00.000Z",
          source: "oauth",
          membershipLevel: "plus",
        }}
        error={null}
      />,
    );

    expect(screen.getByTestId("reset-credit-count")).toHaveTextContent("0 available");
    expect(screen.getByText("No reset credits available")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reset-credit-count"));
    expect(onOpenResetCredits).toHaveBeenCalledTimes(1);
  });

  it("renders the forecast explanation below the percentage", () => {
    render(
      <CodexLimitsCard onOpenResetCredits={() => {}}
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
    expect(forecastButton).toHaveClass("flex-col");
    expect(forecastButton).toHaveClass("border-error/30");
  });

  it("renders the latest token reset to the left of the forecast and opens its history", () => {
    const onOpenResetHistory = vi.fn();

    render(
      <CodexLimitsCard
        onOpenResetCredits={() => {}}
        onOpenResetHistory={onOpenResetHistory}
        limits={null}
        error={null}
        latestReset={{
          id: "2091688655828246890",
          resetType: "regular",
          announcedAt: "2026-08-24T00:46:51.000Z",
          text: "Reset has been propagated.",
          source: {
            author: "thsottiaux",
            url: "https://x.com/thsottiaux/status/2091688655828246890",
          },
        }}
        quotaForecast={{
          score: 73,
          fetchedAt: "2026-08-25T09:00:19.499Z",
          nextRefreshAt: "2026-08-25T09:30:19.499Z",
        }}
      />,
    );

    const latestResetButton = screen.getByRole("button", { name: "View token resets from the last 30 days" });
    const forecastButton = screen.getByRole("button", { name: "Open Codex quota reset forecast" });

    expect(latestResetButton).toHaveTextContent("Latest token reset");
    expect(latestResetButton.parentElement).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");
    expect(latestResetButton.compareDocumentPosition(forecastButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(latestResetButton);
    expect(onOpenResetHistory).toHaveBeenCalledTimes(1);
  });

  it("highlights a token reset announced within the last 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));

    render(
      <CodexLimitsCard
        onOpenResetCredits={() => {}}
        limits={null}
        error={null}
        latestReset={{
          id: "recent-reset",
          resetType: "regular",
          announcedAt: "2026-08-25T10:00:00.000Z",
          text: "Reset has been propagated.",
          source: { author: "thsottiaux", url: "https://example.com/reset" },
        }}
      />,
    );

    const latestResetButton = screen.getByRole("button", { name: "View token resets from the last 30 days" });
    expect(latestResetButton).toHaveTextContent("Token reset within 24h");
    expect(latestResetButton).toHaveTextContent("2 hours ago");
    expect(latestResetButton).toHaveClass("border-warning/60", "bg-warning/15");
    expect(screen.getByText("Token reset within 24h")).toHaveClass("text-xs", "font-bold", "text-warning");
    expect(screen.getByText(/2 hours ago/)).toHaveClass("text-[9px]", "font-normal", "text-muted-foreground");

    vi.useRealTimers();
  });

  it("changes quota forecast color by probability", () => {
    const { rerender } = render(
      <CodexLimitsCard onOpenResetCredits={() => {}}
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
      <CodexLimitsCard onOpenResetCredits={() => {}}
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
      <CodexLimitsCard onOpenResetCredits={() => {}}
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
    render(<CodexLimitsCard onOpenResetCredits={() => {}} limits={null} error={null} quotaForecast={null} />);

    expect(screen.queryByRole("button", { name: "Open Codex quota reset forecast" })).not.toBeInTheDocument();
  });
});
