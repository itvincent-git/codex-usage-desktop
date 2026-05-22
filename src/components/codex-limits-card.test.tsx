import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatResetTime } from "./codex-limits-card";

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
    
    expect(formatResetTime(resetsAtStr, 300)).toBe(`Reset at ${expectedHours}:${expectedMins}`);
  });

  it("returns formatted weekly limit style for windowMinutes > 300", () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    
    const resetsAtStr = "2026-05-24T05:00:00.000Z"; // a Sunday in UTC
    const resetsAt = new Date(resetsAtStr);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = weekdays[resetsAt.getDay()];
    const hoursStr = String(resetsAt.getHours()).padStart(2, "0");
    const minsStr = String(resetsAt.getMinutes()).padStart(2, "0");
    
    expect(formatResetTime(resetsAtStr, 10080)).toBe(`Reset ${dayName} ${hoursStr}:${minsStr}`);
  });
});
