// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ModelUsageCard } from "@/components/model-usage-card";
import type { OverviewResponse } from "@/lib/api";
import { buildDonutData, modelPageColors, OTHER_MODEL_COLOR, priceTones, sortModels, tokenBreakdown } from "@/lib/model-analytics";
import i18n from "@/i18n";

type Model = OverviewResponse["models"][number];
const model = (name: string, totalTokens: number, overrides: Partial<Model> = {}): Model => ({
  model: name,
  inputTokens: totalTokens * 0.75,
  cachedInputTokens: totalTokens * 0.25,
  outputTokens: totalTokens * 0.25,
  totalTokens,
  costUSD: totalTokens / 1_000_000,
  pricingStatus: "priced",
  inputCostPerMillionTokens: 1,
  cachedInputCostPerMillionTokens: 0.1,
  outputCostPerMillionTokens: 4,
  effectiveCostPerMillionTokens: 1,
  ...overrides,
});

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("model analytics", () => {
  it("does not double count cached input in token composition", () => {
    const parts = tokenBreakdown(model("one", 1_200, { inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 200 }));
    expect(parts).toEqual({ nonCachedInput: 600, cachedInput: 400, output: 200 });
    expect(parts.nonCachedInput + parts.cachedInput + parts.output).toBe(1_200);
  });

  it("groups models after the top six into Other", () => {
    const data = buildDonutData(Array.from({ length: 8 }, (_, index) => model(`m${index + 1}`, 800 - index * 100)), "Other");
    expect(data).toHaveLength(7);
    expect(data.slice(0, 6).map((item) => item.value)).toEqual([800, 700, 600, 500, 400, 300]);
    expect(data[6]).toMatchObject({ name: "Other", value: 300, color: OTHER_MODEL_COLOR });
  });

  it("assigns the first six models unique colors in deterministic token order", () => {
    const rows = [
      model("zeta", 100),
      model("beta", 300),
      model("alpha", 300),
      model("gamma", 200),
      model("delta", 150),
      model("epsilon", 125),
    ];
    const colors = modelPageColors(rows);
    const rankedNames = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

    expect([...colors.keys()]).toEqual(rankedNames);
    expect(new Set(rankedNames.map((name) => colors.get(name))).size).toBe(6);
    expect(buildDonutData(rows, "Other", colors).map((entry) => entry.color)).toEqual(
      rankedNames.map((name) => colors.get(name)),
    );
  });

  it("sorts descending by tokens, cost, and effective price with unknown prices last", () => {
    const rows = [
      model("alpha", 100, { costUSD: 9, effectiveCostPerMillionTokens: null, pricingStatus: "unavailable" }),
      model("beta", 300, { costUSD: 1, effectiveCostPerMillionTokens: 2 }),
      model("gamma", 200, { costUSD: 5, effectiveCostPerMillionTokens: 8 }),
    ];
    expect(sortModels(rows, "tokens").map((row) => row.model)).toEqual(["beta", "gamma", "alpha"]);
    expect(sortModels(rows, "cost").map((row) => row.model)).toEqual(["alpha", "gamma", "beta"]);
    expect(sortModels(rows, "effective").map((row) => row.model)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("assigns relative low, medium, high, equal, and unavailable price tones", () => {
    const rows = [model("low", 1, { inputCostPerMillionTokens: 1 }), model("mid", 1, { inputCostPerMillionTokens: 5 }), model("high", 1, { inputCostPerMillionTokens: 10 }), model("unknown", 1, { inputCostPerMillionTokens: null })];
    expect(Object.fromEntries(priceTones(rows, "inputCostPerMillionTokens"))).toEqual({ low: "low", mid: "medium", high: "high", unknown: "unavailable" });
    expect([...priceTones([model("a", 1), model("b", 1)], "inputCostPerMillionTokens").values()]).toEqual(["equal", "equal"]);
  });

  it("renders empty and single-model states with unavailable pricing", async () => {
    const { rerender } = render(<ModelUsageCard models={[]} />);
    expect(screen.getByText("No model activity in this window.")).toBeInTheDocument();

    rerender(<ModelUsageCard models={[model("solo", 1_200, { pricingStatus: "unavailable", inputCostPerMillionTokens: null, cachedInputCostPerMillionTokens: null, outputCostPerMillionTokens: null, effectiveCostPerMillionTokens: null, costUSD: 0 })]} />);
    const row = document.querySelector("[data-model-row='solo']") as HTMLElement;
    expect(within(row).getAllByText("Pricing unavailable")).toHaveLength(4);
    expect(screen.getByText("Token composition")).toBeInTheDocument();

    const user = userEvent.setup();
    screen.getByRole("combobox", { name: "Sort descending" }).focus();
    await user.keyboard("[Enter][End][Enter]");
    expect(screen.getByRole("combobox", { name: "Sort descending" })).toHaveTextContent("Effective price");
  });

  it("uses one model color mapping across the chart and table while sorting", async () => {
    const rows = [model("alpha", 100, { costUSD: 9 }), model("beta", 300, { costUSD: 1 })];
    const colors = modelPageColors(rows);
    render(<ModelUsageCard models={rows} />);

    for (const row of rows) {
      const tableRow = document.querySelector(`[data-model-row='${row.model}']`) as HTMLElement;
      expect(tableRow).toHaveAttribute("data-model-color", colors.get(row.model));
      expect(document.querySelector(`[data-model-legend='${row.model}']`)).toHaveAttribute("data-model-color", colors.get(row.model));
      expect(tableRow.querySelector("[data-model-badge]")).toHaveClass("text-foreground");
    }

    const user = userEvent.setup();
    screen.getByRole("combobox", { name: "Sort descending" }).focus();
    await user.keyboard("[Enter][ArrowDown][Enter]");
    expect(document.querySelector("tbody tr")?.getAttribute("data-model-row")).toBe("alpha");
    expect(document.querySelector("[data-model-row='beta']")).toHaveAttribute("data-model-color", colors.get("beta"));
  });

  it("renders the model page labels in Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<ModelUsageCard models={[model("单模型", 100)]} />);
    expect(screen.getByRole("heading", { name: "Token 构成" })).toBeInTheDocument();
    expect(screen.getByText("模型比较")).toBeInTheDocument();
    await i18n.changeLanguage("en");
  });
});
