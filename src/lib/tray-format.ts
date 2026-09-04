import type { CodexLimitWindow } from "@/lib/api";

export type TrayTitleFormats = {
  limit5h: string;
  limitWeekly: string;
  limitMonthly: string;
  separator: string;
};

export const DEFAULT_TRAY_TITLE_FORMATS: TrayTitleFormats = {
  limit5h: "5h: {remaining}/{reset}",
  limitWeekly: "W: {remaining}/{reset}",
  limitMonthly: "M: {remaining}/{reset}",
  separator: " | ",
};

function compactUnit(language: string, value: number, unit: "minute" | "hour" | "day"): string {
  if (language.startsWith("zh")) {
    return `${value}${unit === "minute" ? "分钟" : unit === "hour" ? "小时" : "天"}`;
  }
  if (language.startsWith("ja")) {
    return `${value}${unit === "minute" ? "分" : unit === "hour" ? "時間" : "日"}`;
  }
  return `${value}${unit === "minute" ? "m" : unit === "hour" ? "h" : "d"}`;
}

export function formatCompactResetCountdown(
  resetsAt: string | null,
  language: string,
  now = Date.now(),
): string | null {
  if (!resetsAt) return null;

  const resetTime = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return null;

  const diffMs = resetTime - now;
  if (diffMs <= 0) {
    if (language.startsWith("zh")) return "即将";
    if (language.startsWith("ja")) return "まもなく";
    return "soon";
  }

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return compactUnit(language, minutes, "minute");

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return compactUnit(language, hours, "hour");

  return compactUnit(language, Math.ceil(hours / 24), "day");
}

export function formatTrayLimitTitle(
  template: string,
  window: CodexLimitWindow | null | undefined,
  language: string,
  now = Date.now(),
): string {
  const remainingTokenIndex = template.indexOf("{remaining}");
  if (!window) {
    return remainingTokenIndex >= 0
      ? `${template.slice(0, remainingTokenIndex)}-`.trim()
      : `${template} -`.trim();
  }

  const remaining = `${Math.round(window.remainingPercent)}%`;
  const resetCountdown = formatCompactResetCountdown(window.resetsAt, language, now);
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
