import { describe, expect, it } from "vitest";
import { formatCompactResetCountdown, formatTrayLimitTitle } from "./tray-format";

const now = new Date("2026-09-04T00:00:00.000Z").getTime();

describe("tray title formatting", () => {
  it("keeps the default compact English format", () => {
    expect(formatTrayLimitTitle("5h: {remaining}/{reset}", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 4 * 60 * 60_000).toISOString(),
    }, "en", now)).toBe("5h: 90%/4h");
  });

  it("supports a Chinese custom template and localized countdown", () => {
    expect(formatTrayLimitTitle("5小时:{remaining} {reset}后重置", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 4 * 60 * 60_000).toISOString(),
    }, "zh", now)).toBe("5小时:90% 4小时后重置");

    expect(formatCompactResetCountdown(
      new Date(now + 3 * 24 * 60 * 60_000).toISOString(),
      "zh",
      now,
    )).toBe("3天");
  });

  it("omits reset-specific text when a reset time is unavailable", () => {
    expect(formatTrayLimitTitle("W: {remaining}/{reset}", {
      usedPercent: 50,
      remainingPercent: 50,
      windowMinutes: 10080,
      resetsAt: null,
    }, "en")).toBe("W: 50%");
  });
});
