// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MonthlyUsageTable } from "@/components/monthly-usage-table";
import type { MonthlyUsageResponse } from "@/lib/api";
import i18n from "@/i18n";

type Month = MonthlyUsageResponse["monthly"][number];

const month = (value: string, overrides: Partial<Month> = {}): Month => ({
  month: value,
  inputTokens: 80,
  cachedInputTokens: 20,
  outputTokens: 20,
  totalTokens: 100,
  costUSD: 0.1,
  ...overrides,
});

const inactive = (value: string): Month => month(value, {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUSD: 0,
});

function response(monthly: Month[]): MonthlyUsageResponse {
  return {
    timezone: "UTC",
    startMonth: monthly.at(0)?.month ?? "2026-01",
    endMonth: monthly.at(-1)?.month ?? "2026-12",
    updatedAt: "2026-12-31T00:00:00.000Z",
    monthly,
  };
}

function activeMonths() {
  return [...document.querySelectorAll<HTMLElement>("[data-monthly-row]")].map((row) => row.dataset.monthlyRow);
}

function row(value: string) {
  return document.querySelector(`[data-monthly-row='${value}']`) as HTMLElement;
}

async function selectSort(label: string) {
  const user = userEvent.setup();
  const labels = ["Month", "Total tokens", "Input", "Cached tokens", "Output", "Cost"];
  screen.getByRole("combobox", { name: "Sort by" }).focus();
  await user.keyboard(`[Enter][Home]${"[ArrowDown]".repeat(labels.indexOf(label))}[Enter]`);
}

beforeAll(async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  await i18n.changeLanguage("en");
});

describe("MonthlyUsageTable", () => {
  it("sorts all six fields, defaults field changes to descending, and breaks metric ties by newest month", async () => {
    render(<MonthlyUsageTable data={response([
      month("2026-01"),
      month("2026-02", { inputTokens: 150, cachedInputTokens: 50, outputTokens: 50, totalTokens: 200, costUSD: 0.3 }),
      month("2026-03", { inputTokens: 140, cachedInputTokens: 60, outputTokens: 60, totalTokens: 200, costUSD: 0.2 }),
    ])} />);

    expect(activeMonths()).toEqual(["2026-03", "2026-02", "2026-01"]);
    const expected: Array<[string, string[], string[]]> = [
      ["Total tokens", ["2026-03", "2026-02", "2026-01"], ["2026-01", "2026-03", "2026-02"]],
      ["Input", ["2026-02", "2026-03", "2026-01"], ["2026-01", "2026-03", "2026-02"]],
      ["Cached tokens", ["2026-03", "2026-02", "2026-01"], ["2026-01", "2026-02", "2026-03"]],
      ["Output", ["2026-03", "2026-02", "2026-01"], ["2026-01", "2026-02", "2026-03"]],
      ["Cost", ["2026-02", "2026-03", "2026-01"], ["2026-01", "2026-03", "2026-02"]],
      ["Month", ["2026-03", "2026-02", "2026-01"], ["2026-01", "2026-02", "2026-03"]],
    ];

    for (const [label, descending, ascending] of expected) {
      await selectSort(label);
      expect(activeMonths()).toEqual(descending);
      expect(screen.getByRole("button", { name: "Descending" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Descending" }));
      expect(activeMonths()).toEqual(ascending);
      expect(screen.getByRole("button", { name: "Ascending" })).toBeInTheDocument();
    }

    await selectSort("Cost");
    expect(screen.getByRole("button", { name: "Descending" })).toBeInTheDocument();
  });

  it("merges consecutive inactive months for month sorting and puts them last for metric sorting", async () => {
    render(<MonthlyUsageTable data={response([
      month("2026-01", { totalTokens: 50 }),
      month("2026-02"),
      inactive("2026-03"),
      inactive("2026-04"),
      month("2026-05", { totalTokens: 200 }),
    ])} />);

    expect(screen.getByRole("cell", { name: "2026-03 to 2026-04" })).toBeInTheDocument();
    expect(screen.getByText("No usage (2 months)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(activeMonths()).toEqual(["2026-01", "2026-02", "2026-05"]);

    await selectSort("Total tokens");
    expect(activeMonths()).toEqual(["2026-05", "2026-02", "2026-01"]);
    const tableRows = [...document.querySelectorAll("tbody tr")];
    expect(tableRows.slice(0, 3).every((tableRow) => tableRow.hasAttribute("data-monthly-row"))).toBe(true);
    expect(tableRows.at(-1)).not.toHaveAttribute("data-monthly-row");
  });

  it("normalizes token composition without double-counting cache and applies all cost tones", () => {
    render(<MonthlyUsageTable data={response([
      month("2026-01", { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, totalTokens: 50, costUSD: 0.1 }),
      month("2026-02", { inputTokens: 80, cachedInputTokens: 20, outputTokens: 20, totalTokens: 100, costUSD: 0.2 }),
      month("2026-03", { inputTokens: 140, cachedInputTokens: 60, outputTokens: 60, totalTokens: 200, costUSD: 0.3 }),
    ])} />);

    expect(row("2026-03").querySelector<HTMLElement>("[data-token-bar]")?.style.width).toBe("100%");
    expect(row("2026-03").querySelector<HTMLElement>("[data-token-segment='uncached']")?.style.width).toBe("40%");
    expect(row("2026-03").querySelector<HTMLElement>("[data-token-segment='cached']")?.style.width).toBe("30%");
    expect(row("2026-03").querySelector<HTMLElement>("[data-token-segment='output']")?.style.width).toBe("30%");
    expect(row("2026-02").querySelector<HTMLElement>("[data-token-bar]")?.style.width).toBe("50%");
    expect(row("2026-01").querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "low");
    expect(row("2026-02").querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "medium");
    expect(row("2026-03").querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "high");
  });

  it("marks individual and tied positive peaks for every field and never marks zero", () => {
    const { rerender } = render(<MonthlyUsageTable data={response([
      month("2026-01", { inputTokens: 100, cachedInputTokens: 10, outputTokens: 10, totalTokens: 500, costUSD: 0.1 }),
      month("2026-02", { inputTokens: 200, cachedInputTokens: 20, outputTokens: 10, totalTokens: 400, costUSD: 0.1 }),
      month("2026-03", { inputTokens: 100, cachedInputTokens: 30, outputTokens: 30, totalTokens: 300, costUSD: 0.3 }),
    ])} />);
    expect(within(row("2026-01")).getAllByText("Highest")).toHaveLength(1);
    expect(within(row("2026-02")).getAllByText("Highest")).toHaveLength(1);
    expect(within(row("2026-03")).getAllByText("Highest")).toHaveLength(3);

    rerender(<MonthlyUsageTable data={response([
      month("2026-01", { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, totalTokens: 130, costUSD: 0 }),
      month("2026-02", { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, totalTokens: 130, costUSD: 0 }),
      inactive("2026-03"),
    ])} />);

    for (const value of ["2026-01", "2026-02"]) {
      expect(within(row(value)).getAllByText("Highest")).toHaveLength(4);
      expect(within(row(value)).getByText("$0.00")).toBeInTheDocument();
    }
    expect(screen.getAllByText("Highest")).toHaveLength(8);
  });

  it("uses the real previous natural month for normal, new, zero, and missing-baseline deltas after sorting", async () => {
    render(<MonthlyUsageTable data={response([
      month("2026-01", { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0.05 }),
      month("2026-02", { inputTokens: 100, cachedInputTokens: 20, outputTokens: 20, totalTokens: 120, costUSD: 0.1 }),
      month("2026-03", { inputTokens: 200, cachedInputTokens: 0, outputTokens: 20, totalTokens: 220, costUSD: 0.1 }),
    ])} />);

    expect(within(row("2026-01").getElementsByTagName("td")[1]).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row("2026-02").querySelector("[data-metric='totalTokens']") as HTMLElement).getByText("New")).toBeInTheDocument();
    expect(within(row("2026-03").querySelector("[data-metric='totalTokens']") as HTMLElement).getByText("83.3%")).toBeInTheDocument();
    expect(within(row("2026-03").querySelector("[data-metric='cachedInputTokens']") as HTMLElement).getByText("-100.0%")).toBeInTheDocument();
    expect(within(row("2026-03").querySelector("[data-metric='costUSD']") as HTMLElement).getByText("0.0%")).toBeInTheDocument();

    await selectSort("Cost");
    await userEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(activeMonths()).toEqual(["2026-01", "2026-03", "2026-02"]);
    expect(within(row("2026-03").querySelector("[data-metric='totalTokens']") as HTMLElement).getByText("83.3%")).toBeInTheDocument();
  });

  it("exposes legends, the comparison range, and an empty state", () => {
    const { rerender } = render(<MonthlyUsageTable data={response([month("2026-01")])} />);
    expect(screen.getByText("Comparing 2026-01 to 2026-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Token color legend")).toBeInTheDocument();
    expect(screen.getByLabelText(/Cost scale: green/)).toBeInTheDocument();

    rerender(<MonthlyUsageTable data={response([])} />);
    expect(screen.getByText("No monthly data accumulated yet.")).toBeInTheDocument();
  });
});
