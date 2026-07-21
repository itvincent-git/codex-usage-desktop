// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DailyUsageTable } from "@/components/daily-usage-table";
import type { OverviewResponse } from "@/lib/api";
import i18n from "@/i18n";

type Day = OverviewResponse["daily"][number];

const day = (date: string, overrides: Partial<Day> = {}): Day => ({
  date,
  inputTokens: 80,
  cachedInputTokens: 20,
  outputTokens: 20,
  totalTokens: 100,
  costUSD: 0.1,
  ...overrides,
});

const inactive = (date: string): Day => day(date, {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUSD: 0,
});

function activeDates() {
  return [...document.querySelectorAll<HTMLElement>("[data-daily-row]")].map((row) => row.dataset.dailyRow);
}

async function selectSort(label: string) {
  const user = userEvent.setup();
  const labels = ["Date", "Total tokens", "Input", "Cached tokens", "Output", "Cost"];
  screen.getByRole("combobox", { name: "Sort by" }).focus();
  await user.keyboard(`[Enter][Home]${"[ArrowDown]".repeat(labels.indexOf(label))}[Enter]`);
}

beforeAll(async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  await i18n.changeLanguage("en");
});

describe("DailyUsageTable", () => {
  it("defaults to newest date and sorts every metric descending with newest-date tie breaking", async () => {
    const rows = [
      day("2026-04-01"),
      day("2026-04-02", { inputTokens: 150, cachedInputTokens: 50, outputTokens: 50, totalTokens: 200, costUSD: 0.3 }),
      day("2026-04-03", { inputTokens: 140, cachedInputTokens: 60, outputTokens: 60, totalTokens: 200, costUSD: 0.2 }),
    ];
    render(<DailyUsageTable range="30d" daily={rows} />);

    expect(activeDates()).toEqual(["2026-04-03", "2026-04-02", "2026-04-01"]);

    const expected: Array<[string, string[]]> = [
      ["Total tokens", ["2026-04-03", "2026-04-02", "2026-04-01"]],
      ["Input", ["2026-04-02", "2026-04-03", "2026-04-01"]],
      ["Cached tokens", ["2026-04-03", "2026-04-02", "2026-04-01"]],
      ["Output", ["2026-04-03", "2026-04-02", "2026-04-01"]],
      ["Cost", ["2026-04-02", "2026-04-03", "2026-04-01"]],
      ["Date", ["2026-04-03", "2026-04-02", "2026-04-01"]],
    ];

    for (const [label, order] of expected) {
      await selectSort(label);
      expect(activeDates()).toEqual(order);
      expect(screen.getByRole("button", { name: "Descending" })).toBeInTheDocument();
    }

    await selectSort("Total tokens");
    await userEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(activeDates()).toEqual(["2026-04-01", "2026-04-03", "2026-04-02"]);
    expect(screen.getByRole("button", { name: "Ascending" })).toBeInTheDocument();

    await selectSort("Cost");
    expect(screen.getByRole("button", { name: "Descending" })).toBeInTheDocument();
  });

  it("marks all positive tied peaks and does not mark zero values", () => {
    render(<DailyUsageTable range="7d" daily={[
      day("2026-04-03", { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, totalTokens: 130, costUSD: 0 }),
      day("2026-04-02", { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, totalTokens: 130, costUSD: 0 }),
      inactive("2026-04-01"),
    ]} />);

    for (const date of ["2026-04-03", "2026-04-02"]) {
      const row = document.querySelector(`[data-daily-row='${date}']`) as HTMLElement;
      expect(within(row).getAllByText("Highest")).toHaveLength(4);
      expect(within(row).queryByText("$0.00")).toBeInTheDocument();
    }
    expect(screen.getAllByText("Highest")).toHaveLength(8);
  });

  it("normalizes total and cost bars to range peaks without double-counting cached input", () => {
    render(<DailyUsageTable range="7d" daily={[
      day("2026-04-03", { inputTokens: 140, cachedInputTokens: 60, outputTokens: 60, totalTokens: 200, costUSD: 0.3 }),
      day("2026-04-02", { inputTokens: 80, cachedInputTokens: 20, outputTokens: 20, totalTokens: 100, costUSD: 0.2 }),
      day("2026-04-01", { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, totalTokens: 50, costUSD: 0.1 }),
    ]} />);

    const peakRow = document.querySelector("[data-daily-row='2026-04-03']") as HTMLElement;
    expect(peakRow.querySelector<HTMLElement>("[data-token-bar]")?.style.width).toBe("100%");
    expect(peakRow.querySelector<HTMLElement>("[data-token-segment='uncached']")?.style.width).toBe("40%");
    expect(peakRow.querySelector<HTMLElement>("[data-token-segment='cached']")?.style.width).toBe("30%");
    expect(peakRow.querySelector<HTMLElement>("[data-token-segment='output']")?.style.width).toBe("30%");

    const middleRow = document.querySelector("[data-daily-row='2026-04-02']") as HTMLElement;
    expect(middleRow.querySelector<HTMLElement>("[data-token-bar]")?.style.width).toBe("50%");
    expect(middleRow.querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "medium");
    expect(Number.parseFloat(middleRow.querySelector<HTMLElement>("[data-cost-bar]")?.style.width ?? "0")).toBeCloseTo(66.6666666667, 5);

    const lowRow = document.querySelector("[data-daily-row='2026-04-01']") as HTMLElement;
    expect(lowRow.querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "low");
    expect(peakRow.querySelector("[data-cost-bar]")).toHaveAttribute("data-cost-tone", "high");
  });

  it("merges consecutive inactive dates in date order and puts inactive ranges last for metric sorts", async () => {
    render(<DailyUsageTable range="30d" daily={[
      day("2026-04-02", { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, totalTokens: 50, costUSD: 0.05 }),
      day("2026-04-05"),
      inactive("2026-04-04"),
      inactive("2026-04-03"),
      day("2026-04-01", { inputTokens: 20, cachedInputTokens: 5, outputTokens: 5, totalTokens: 25, costUSD: 0.025 }),
    ]} />);

    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.findIndex((text) => text?.includes("2026-04-03 to 2026-04-04"))).toBeLessThan(cells.findIndex((text) => text?.includes("2026-04-02")));

    await userEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(activeDates()).toEqual(["2026-04-01", "2026-04-02", "2026-04-05"]);
    expect(screen.getByRole("cell", { name: "2026-04-03 to 2026-04-04" })).toBeInTheDocument();

    await selectSort("Total tokens");
    expect(document.querySelector("tbody tr")?.getAttribute("data-daily-row")).toBe("2026-04-05");
    const tableRows = [...document.querySelectorAll("tbody tr")];
    expect(tableRows.slice(0, 3).every((row) => row.hasAttribute("data-daily-row"))).toBe(true);
    expect(tableRows.slice(3).every((row) => !row.hasAttribute("data-daily-row"))).toBe(true);
    expect(screen.getByText("No activity (2 days)")).toBeInTheDocument();
  });

  it("opens an active date with mouse or keyboard and exposes weekday and legends", async () => {
    const onRowClick = vi.fn();
    render(<DailyUsageTable range="7d" daily={[day("2026-04-03")]} onRowClick={onRowClick} />);
    const row = screen.getByRole("row", { name: "View sessions for 2026-04-03" });

    expect(within(row).getByText("Fri")).toBeInTheDocument();
    expect(screen.getByLabelText("Token color legend")).toBeInTheDocument();
    expect(screen.getByLabelText(/Cost scale: green/)).toBeInTheDocument();

    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenNthCalledWith(1, "2026-04-03");
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });
});
