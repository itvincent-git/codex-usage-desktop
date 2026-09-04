import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAY_COUNTDOWN_UNITS,
  DEFAULT_TRAY_TITLE_FORMATS,
  formatCompactResetCountdown,
  formatTrayLimitTitle,
} from "./tray-format";

const now = new Date("2026-09-04T00:00:00.000Z").getTime();

describe("tray title formatting", () => {
  it("uses the default emoji templates and separator", () => {
    expect(DEFAULT_TRAY_TITLE_FORMATS).toEqual({
      limit5h: "⏱️ {remaining}/{reset}",
      limitWeekly: "🗓️ {remaining}/{reset}",
      limitMonthly: "M: {remaining}/{reset}",
      separator: "┃",
    });
  });

  it("formats a compact title template", () => {
    expect(formatTrayLimitTitle("5h: {remaining}/{reset}", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 4 * 60 * 60_000).toISOString(),
    }, DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBe("5h: 90%/4h");
  });

  it("supports custom countdown units independently of the title template", () => {
    const units = { minute: "分钟", hour: "小时", day: "天" };

    expect(formatTrayLimitTitle("5小时:{remaining} {reset}后重置", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 4 * 60 * 60_000).toISOString(),
    }, units, now)).toBe("5小时:90% 4小时后重置");

    expect(formatCompactResetCountdown(
      new Date(now + 3 * 24 * 60 * 60_000).toISOString(),
      units,
      now,
    )).toBe("3天");
  });

  it("omits reset-specific text when a reset time is unavailable", () => {
    expect(formatTrayLimitTitle("W: {remaining}/{reset}", {
      usedPercent: 50,
      remainingPercent: 50,
      windowMinutes: 10080,
      resetsAt: null,
    }, DEFAULT_TRAY_COUNTDOWN_UNITS)).toBe("W: 50%");
  });
});
