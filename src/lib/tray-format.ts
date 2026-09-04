import type { CodexLimitWindow } from "@/lib/api";

export type TrayTitleFormats = {
  limit5h: string;
  limitWeekly: string;
  limitMonthly: string;
  separator: string;
};

export type TrayCountdownUnits = {
  minute: string;
  hour: string;
  day: string;
};

export const DEFAULT_TRAY_TITLE_FORMATS: TrayTitleFormats = {
  limit5h: "⏱️ {remaining}/{reset}",
  limitWeekly: "🗓️ {remaining}/{reset}",
  limitMonthly: "M: {remaining}/{reset}",
  separator: "┃",
};

export const DEFAULT_TRAY_COUNTDOWN_UNITS: TrayCountdownUnits = {
  minute: "m",
  hour: "h",
  day: "d",
};

function compactUnit(units: TrayCountdownUnits, value: number, unit: keyof TrayCountdownUnits): string {
  return `${value}${units[unit]}`;
}

export function formatCompactResetCountdown(
  resetsAt: string | null,
  units: TrayCountdownUnits,
  now = Date.now(),
): string | null {
  if (!resetsAt) return null;

  const resetTime = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return null;

  const diffMs = resetTime - now;
  if (diffMs <= 0) return "soon";

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return compactUnit(units, minutes, "minute");

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return compactUnit(units, hours, "hour");

  return compactUnit(units, Math.ceil(hours / 24), "day");
}

export function formatTrayLimitTitle(
  template: string,
  window: CodexLimitWindow | null | undefined,
  units: TrayCountdownUnits,
  now = Date.now(),
): string {
  const remainingTokenIndex = template.indexOf("{remaining}");
  if (!window) {
    return remainingTokenIndex >= 0
      ? `${template.slice(0, remainingTokenIndex)}-`.trim()
      : `${template} -`.trim();
  }

  const remaining = `${Math.round(window.remainingPercent)}%`;
  const resetCountdown = formatCompactResetCountdown(window.resetsAt, units, now);
  if (!resetCountdown) {
    const resetTokenIndex = template.indexOf("{reset}");
    const withoutReset = resetTokenIndex >= 0 ? template.slice(0, resetTokenIndex) : template;
    return withoutReset
      .replaceAll("{remaining}", remaining)
      .replace(/[\s/|;,，；:]+$/u, "")
      .trim();
  }

  return template
    .replaceAll("{remaining}", remaining)
    .replaceAll("{reset}", resetCountdown)
    .trim();
}
