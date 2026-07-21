import type { OverviewResponse } from "@/lib/api";

export type ModelRow = OverviewResponse["models"][number];
export type ModelSort = "tokens" | "cost" | "effective";
export type PriceTone = "low" | "medium" | "high" | "equal" | "unavailable";

const MODEL_COLORS = ["#0ea5e9", "#8b5cf6", "#06b6d4", "#d946ef", "#f97316", "#14b8a6"] as const;
const MODEL_TONE_CLASSES = [
  "border-sky-500/20 bg-sky-500/10 text-sky-500",
  "border-violet-500/20 bg-violet-500/10 text-violet-500",
  "border-cyan-500/20 bg-cyan-500/10 text-cyan-500",
  "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-500",
  "border-orange-500/20 bg-orange-500/10 text-orange-500",
  "border-teal-500/20 bg-teal-500/10 text-teal-500",
] as const;

export function modelTone(model: string) {
  let hash = 0;
  for (const character of model) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const index = hash % MODEL_COLORS.length;
  return { index, color: MODEL_COLORS[index], className: MODEL_TONE_CLASSES[index] };
}

export function tokenBreakdown(row: Pick<ModelRow, "inputTokens" | "cachedInputTokens" | "outputTokens">) {
  const cached = Math.max(Math.min(row.cachedInputTokens, row.inputTokens), 0);
  return {
    nonCachedInput: Math.max(row.inputTokens - cached, 0),
    cachedInput: cached,
    output: Math.max(row.outputTokens, 0),
  };
}

export function sortModels(models: ModelRow[], sort: ModelSort) {
  return [...models].sort((a, b) => {
    if (sort === "effective") {
      const aValue = a.effectiveCostPerMillionTokens;
      const bValue = b.effectiveCostPerMillionTokens;
      if (aValue == null && bValue != null) return 1;
      if (aValue != null && bValue == null) return -1;
      if (aValue != null && bValue != null && aValue !== bValue) return bValue - aValue;
    } else {
      const difference = sort === "cost" ? b.costUSD - a.costUSD : b.totalTokens - a.totalTokens;
      if (difference !== 0) return difference;
    }
    return a.model.localeCompare(b.model);
  });
}

export function buildDonutData(models: ModelRow[], otherLabel: string) {
  const sorted = sortModels(models, "tokens");
  const visible: Array<{ name: string; value: number; color: string }> = sorted.slice(0, 6).map((model) => ({
    name: model.model,
    value: model.totalTokens,
    color: modelTone(model.model).color,
  }));
  const other = sorted.slice(6).reduce((sum, model) => sum + model.totalTokens, 0);
  if (other > 0) visible.push({ name: otherLabel, value: other, color: "#94a3b8" });
  return visible;
}

export function priceTones(models: ModelRow[], key: keyof Pick<ModelRow,
  "inputCostPerMillionTokens" | "cachedInputCostPerMillionTokens" | "outputCostPerMillionTokens" | "effectiveCostPerMillionTokens"
>) {
  const values = models.map((model) => model[key]).filter((value): value is number => value != null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return new Map(models.map((model) => {
    const value = model[key];
    let tone: PriceTone;
    if (value == null) tone = "unavailable";
    else if (min === max) tone = "equal";
    else {
      const position = (value - min) / (max - min);
      tone = position <= 1 / 3 ? "low" : position <= 2 / 3 ? "medium" : "high";
    }
    return [model.model, tone];
  }));
}
