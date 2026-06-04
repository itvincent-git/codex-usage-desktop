// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatResetTime, CodexLimitsCard } from "./codex-limits-card";
import dayjs from "dayjs";
import { render, screen } from "@testing-library/react";

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
    expect(screen.getByText("Codex limits unavailable: Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.")).toBeInTheDocument();
  });
});
