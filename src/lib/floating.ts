import { invoke } from "@tauri-apps/api/core";

export type TokenTotals = { input: number; cached: number; output: number; total: number };
type UsageSeries = Pick<FloatingUsage, "today" | "week" | "month" | "total" | "models" | "projects">;
export type UsagePeriod = keyof UsageSeries["models"];
export const usagePeriods: { key: UsagePeriod; label: string }[] = [
  { key: "today", label: "今日" }, { key: "week", label: "本周" },
  { key: "month", label: "本月" }, { key: "total", label: "累计" },
];
export type FloatingPreferences = { enabled: boolean; expanded: boolean; extensionLength?: number | null; dock?: "free" | "left" | "right" | "bottomLeft" | "bottomRight" };
export type FloatingUsage = {
  today: TokenTotals;
  week: TokenTotals | null;
  month: TokenTotals;
  total: TokenTotals;
  models: Record<"today" | "week" | "month" | "total", { name: string; tokens: TokenTotals }[]>;
  projects: { path: string; name: string; tokens: TokenTotals }[];
  remainingPercent: number | null;
  quotaUpdatedAt: string | null;
  quotaWarning?: string | null;
  updatedAt: string;
  firstRecordAt: string | null;
};

export function floatingAction(action: "show" | "hide" | "expand" | "collapse" | "main" | "savePosition" | "finishDrag" | "setLength" | "detach", extensionLength?: number) {
  return invoke<FloatingPreferences>("floating_action", { action, extensionLength });
}

export function tokenNumber(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}

export function floatingBalance(data: FloatingUsage | null) {
  return { percent: data?.remainingPercent ?? null, label: "账号周额度余量", updatedAt: data?.quotaUpdatedAt ?? null };
}

/** Short labels for the narrow edge capsule; full values remain in the detail view. */
export function compactTokenNumber(value: number): string {
  const units: [number, string][] = [[100_000_000, "亿"], [10_000, "万"], [1_000, "k"]];
  for (const [divisor, suffix] of units) {
    if (value >= divisor) {
      const amount = value / divisor;
      return amount.toFixed(amount >= 100 ? 0 : 1).replace(/\.0$/, "") + suffix;
    }
  }
  return String(Math.round(value));
}
