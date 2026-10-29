import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAY_COUNTDOWN_UNITS,
  TRAY_TITLE_TEMPLATES,
  formatCompactResetCountdown,
  formatTrayLimitTitle,
} from "./tray-format";

const now = new Date("2026-09-04T00:00:00.000Z").getTime();

describe("tray title formatting", () => {
  it.each([
    [1, "1m"],
    [59, "59m"],
    [60, "1h"],
    [123, "2h3m"],
    [1439, "23h59m"],
    [1440, "1d"],
    [1560, "1d2h"],
    [1590, "1d2h"],
    [2880, "2d"],
  ])("formats %i remaining minutes as %s", (minutes, expected) => {
    expect(formatCompactResetCountdown(
      new Date(now + minutes * 60_000).toISOString(),
      DEFAULT_TRAY_COUNTDOWN_UNITS,
      now,
    )).toBe(expected);
  });

  it("rounds partial minutes up and preserves unavailable or expired reset times", () => {
    expect(formatCompactResetCountdown(new Date(now + 30_000).toISOString(), DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBe("1m");
    expect(formatCompactResetCountdown(null, DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBeNull();
    expect(formatCompactResetCountdown("invalid", DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBeNull();
    expect(formatCompactResetCountdown(new Date(now).toISOString(), DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBe("soon");
  });

  it("uses fixed quota title templates", () => {
    expect(TRAY_TITLE_TEMPLATES).toEqual({
      limit5h: "⏱️ {remaining}/{reset}",
      limitWeekly: "🗓️ {remaining}/{reset}",
      limitMonthly: "M: {remaining}/{reset}",
    });
  });

  it("formats a compact title template", () => {
    expect(formatTrayLimitTitle("5h: {remaining}/{reset}", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 123 * 60_000).toISOString(),
    }, DEFAULT_TRAY_COUNTDOWN_UNITS, now)).toBe("5h: 90%/2h3m");
  });

  it("supports custom countdown units independently of the title template", () => {
    const units = { minute: "分钟", hour: "小时", day: "天" };

    expect(formatTrayLimitTitle("5小时:{remaining} {reset}后重置", {
      usedPercent: 10,
      remainingPercent: 90,
      windowMinutes: 300,
      resetsAt: new Date(now + 123 * 60_000).toISOString(),
    }, units, now)).toBe("5小时:90% 2小时3分钟后重置");

    expect(formatCompactResetCountdown(
      new Date(now + (3 * 24 + 2) * 60 * 60_000).toISOString(),
      units,
      now,
    )).toBe("3天2小时");
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
