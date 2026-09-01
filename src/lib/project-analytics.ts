import type { OverviewResponse } from "@/lib/api";
import { projectLabel } from "@/lib/project-reference";

export type ProjectRow = OverviewResponse["projects"][number];
export type ProjectSort = "name" | "total" | "input" | "cached" | "output" | "cost";
export type SortDirection = "asc" | "desc";
export type CostTone = "zero" | "low" | "medium" | "high";

export function projectTokenBreakdown(row: Pick<ProjectRow, "inputTokens" | "cachedInputTokens" | "outputTokens">) {
  const cachedInput = Math.max(Math.min(row.cachedInputTokens, row.inputTokens), 0);
  return {
    nonCachedInput: Math.max(row.inputTokens - cachedInput, 0),
    cachedInput,
    output: Math.max(row.outputTokens, 0),
  };
}

export function defaultProjectSortDirection(sort: ProjectSort): SortDirection {
  return sort === "name" ? "asc" : "desc";
}

export function sortProjects(projects: ProjectRow[], sort: ProjectSort, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  const key = sort === "total" ? "totalTokens"
    : sort === "input" ? "inputTokens"
      : sort === "cached" ? "cachedInputTokens"
        : sort === "output" ? "outputTokens"
          : sort === "cost" ? "costUSD"
            : null;
  return projects.map((project, index) => ({ project, index })).sort((a, b) => {
    const difference = key
      ? (a.project[key] - b.project[key]) * multiplier
      : projectLabel(a.project).localeCompare(projectLabel(b.project)) * multiplier;
    if (difference !== 0) return difference;
    const nameDifference = projectLabel(a.project).localeCompare(projectLabel(b.project));
    if (nameDifference !== 0) return nameDifference;
    const pathDifference = a.project.project.localeCompare(b.project.project);
    return pathDifference !== 0 ? pathDifference : a.index - b.index;
  }).map(({ project }) => project);
}

export function positivePeaks(projects: ProjectRow[]) {
  const values = (key: keyof Pick<ProjectRow, "totalTokens" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "costUSD">) =>
    Math.max(0, ...projects.map((project) => project[key]));
  return {
    totalTokens: values("totalTokens"),
    inputTokens: values("inputTokens"),
    cachedInputTokens: values("cachedInputTokens"),
    outputTokens: values("outputTokens"),
    costUSD: values("costUSD"),
  };
}

export function isPositivePeak(value: number, peak: number) {
  return value > 0 && value === peak;
}

export function projectCostTone(costUSD: number, maxCostUSD: number): CostTone {
  if (costUSD <= 0 || maxCostUSD <= 0) return "zero";
  const ratio = costUSD / maxCostUSD;
  if (ratio <= 1 / 3) return "low";
  if (ratio <= 2 / 3) return "medium";
  return "high";
}
