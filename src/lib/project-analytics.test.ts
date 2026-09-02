import { describe, expect, it } from "vitest";
import {
  defaultProjectSortDirection,
  isPositivePeak,
  positivePeaks,
  projectCostTone,
  projectTokenBreakdown,
  sortProjects,
  type ProjectRow,
  type ProjectSort,
} from "@/lib/project-analytics";

function row(name: string, values: Partial<ProjectRow> = {}): ProjectRow {
  return { project: `/repo/${name}`, displayName: name, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, totalTokens: 130, costUSD: 1, ...values };
}

describe("project analytics derivations", () => {
  it("sorts every field in both directions and applies field defaults", () => {
    const projects = [row("bravo", { lastActiveDate: "2026-09-02", inputTokens: 2, cachedInputTokens: 6, outputTokens: 4, totalTokens: 8, costUSD: 10 }), row("alpha", { lastActiveDate: "2026-09-01", inputTokens: 1, cachedInputTokens: 5, outputTokens: 3, totalTokens: 7, costUSD: 9 })];
    const fields: ProjectSort[] = ["name", "recent", "total", "input", "cached", "output", "cost"];
    for (const field of fields) {
      expect(sortProjects(projects, field, "asc")[0].displayName).toBe("alpha");
      expect(sortProjects(projects, field, "desc")[0].displayName).toBe("bravo");
    }
    expect(defaultProjectSortDirection("name")).toBe("asc");
    expect(defaultProjectSortDirection("recent")).toBe("desc");
    expect(defaultProjectSortDirection("cost")).toBe("desc");
  });

  it("uses path as a stable tie breaker", () => {
    const projects = [row("same", { project: "/repo/z" }), row("same", { project: "/repo/a" })];
    expect(sortProjects(projects, "total", "desc").map((project) => project.project)).toEqual(["/repo/a", "/repo/z"]);
    expect(sortProjects(projects, "total", "asc").map((project) => project.project)).toEqual(["/repo/a", "/repo/z"]);
  });

  it("sorts names by the displayed Codex project label", () => {
    const projects = [
      row("alpha", { codexProjectName: "Zulu" }),
      row("bravo", { codexProjectName: "Able" }),
    ];

    expect(sortProjects(projects, "name", "asc").map((project) => project.codexProjectName))
      .toEqual(["Able", "Zulu"]);
  });

  it("marks tied positive peaks and never marks zero", () => {
    const peaks = positivePeaks([row("a", { totalTokens: 10, costUSD: 0 }), row("b", { totalTokens: 10, costUSD: 0 })]);
    expect(isPositivePeak(10, peaks.totalTokens)).toBe(true);
    expect(isPositivePeak(0, peaks.costUSD)).toBe(false);
  });

  it("keeps cached input inside input instead of double counting it", () => {
    const parts = projectTokenBreakdown(row("a", { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120 }));
    expect(parts).toEqual({ nonCachedInput: 60, cachedInput: 40, output: 20 });
    expect(parts.nonCachedInput + parts.cachedInput + parts.output).toBe(120);
  });

  it("applies exact relative cost boundaries", () => {
    expect(projectCostTone(0, 9)).toBe("zero");
    expect(projectCostTone(3, 9)).toBe("low");
    expect(projectCostTone(6, 9)).toBe("medium");
    expect(projectCostTone(6.01, 9)).toBe("high");
  });
});
