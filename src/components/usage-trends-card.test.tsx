// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { UsageTrendsCard, UsageTrendTooltip } from "./usage-trends-card";
import i18n from "@/i18n";
import type { OverviewResponse } from "@/lib/api";

const daily: OverviewResponse["daily"] = [
  { date: "2026-10-25", inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, totalTokens: 130, costUSD: 1, fiveHourPercent: 150, weeklyPercent: 10 },
  { date: "2026-10-26", inputTokens: 200, cachedInputTokens: 40, outputTokens: 60, totalTokens: 260, costUSD: 2, fiveHourPercent: null, weeklyPercent: 0 },
  { date: "2026-10-27", inputTokens: 300, cachedInputTokens: 60, outputTokens: 90, totalTokens: 390, costUSD: 3, fiveHourPercent: 25, weeklyPercent: 5 },
];

describe("UsageTrendTooltip", () => {
  it("uses an opaque surface so dashboard content does not show through", () => {
    const { container } = render(
      <UsageTrendTooltip
        active
        label="08-19"
        payload={[
          { dataKey: "inputTokens", value: 10 },
          { dataKey: "cachedInputTokens", value: 20 },
          { dataKey: "outputTokens", value: 30 },
          { dataKey: "costUSD", value: 0.25 },
        ]}
        t={(key: string) => key}
      />,
    );

    expect(container.firstElementChild).toHaveClass("bg-surface");
    expect(container.firstElementChild).not.toHaveClass("bg-surface/95", "backdrop-blur-md");
  });

  it("keeps the chart tooltip above the summary metrics", () => {
    const warn = vi.spyOn(console, "warn");
    onTestFinished(() => warn.mockRestore());
    const { container } = render(<UsageTrendsCard daily={[]} metrics={[]} cacheHitRate={0} />);

    expect(container.querySelector(".recharts-tooltip-wrapper")).toHaveStyle({ zIndex: "10" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("shows only totals and cost in compact tooltips", () => {
    render(<UsageTrendTooltip active compact label="09-28" payload={[
      { dataKey: "totalTokens", value: 120 },
      { dataKey: "costUSD", value: 0.25 },
    ]} t={(key: string) => key} />);

    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("$0.25")).toBeInTheDocument();
    expect(screen.queryByText("project_modal.input")).not.toBeInTheDocument();
  });

  it("expands the whole chart card and exits with Escape", async () => {
    const user = userEvent.setup();
    render(<UsageTrendsCard daily={[]} metrics={[]} cacheHitRate={0} />);

    await user.click(screen.getByRole("button", { name: "Expand chart to full screen" }));

    expect(screen.getByRole("dialog", { name: "Usage Trends" })).toContainElement(screen.getByTestId("usage-trends-card"));
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");

    await user.click(screen.getByRole("button", { name: "Expand chart to full screen" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Expand chart to full screen" })).toBeInTheDocument();
  });

  it("toggles chart series from the legend", async () => {
    const user = userEvent.setup();
    render(<UsageTrendsCard daily={[]} metrics={[]} cacheHitRate={0} />);

    const inputLegend = screen.getByRole("button", { name: "Input" });
    const costLegend = within(screen.getByRole("group", { name: "Trend series" })).getByRole("button", { name: "Cost" });

    expect(inputLegend).toHaveAttribute("aria-pressed", "true");
    expect(costLegend).toHaveAttribute("aria-pressed", "true");

    await user.click(inputLegend);
    await user.click(costLegend);

    expect(inputLegend).toHaveAttribute("aria-pressed", "false");
    expect(costLegend).toHaveAttribute("aria-pressed", "false");

    await user.click(inputLegend);

    expect(inputLegend).toHaveAttribute("aria-pressed", "true");
    expect(costLegend).toHaveAttribute("aria-pressed", "false");
  });

  it("switches lines while keeping tokens, gaps, and values over 100%", async () => {
    const user = userEvent.setup();
    const { container } = render(<UsageTrendsCard daily={daily} metrics={[]} cacheHitRate={0} />);
    const views = within(screen.getByRole("group", { name: "Trend view" }));
    const tokenBars = container.querySelectorAll(".recharts-bar-rectangle").length;
    expect(tokenBars).toBeGreaterThan(0);
    expect(views.getByRole("button", { name: "Cost" })).toHaveAttribute("aria-pressed", "true");
    expect([...container.querySelectorAll(".recharts-yAxis-tick-labels")].at(-1)).toHaveTextContent("$");
    expect(container.querySelector('.recharts-line-curve[stroke="rgb(var(--primary))"]')).toBeInTheDocument();

    await user.click(views.getByRole("button", { name: "Quota" }));

    expect(views.getByRole("button", { name: "Quota" })).toHaveAttribute("aria-pressed", "true");
    const axis = [...container.querySelectorAll(".recharts-yAxis-tick-labels")].at(-1)!;
    const ticks = [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((tick) => Number(tick.textContent!.replace(/[% ,]/g, "")));
    expect(axis).toHaveTextContent("%");
    expect(axis).not.toHaveTextContent("$");
    expect(Math.min(...ticks)).toBe(0);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(150);
    expect(container.querySelector('.recharts-line-curve[stroke="rgb(var(--primary))"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(tokenBars);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Missing day remains a gap; isolated observations still render as dots.
    expect(container.querySelectorAll('.recharts-line-dot[stroke="#f97316"]')).toHaveLength(2);
    expect(container.querySelector('.recharts-line-curve[stroke="#f97316"]')?.getAttribute("d") ?? "").not.toMatch(/[LC]/);
    expect(container.querySelector('.recharts-line-curve[stroke="#f43f5e"]')).toHaveAttribute("stroke-dasharray", "5 4");

    const fiveHour = screen.getByRole("button", { name: "5h usage" });
    await user.click(fiveHour);
    expect(fiveHour).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector('.recharts-line-dot[stroke="#f97316"]')).not.toBeInTheDocument();
    await user.click(views.getByRole("button", { name: "Cost" }));
    expect(screen.queryByRole("button", { name: "5h usage" })).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-line-curve[stroke="rgb(var(--primary))"]')).toBeInTheDocument();
    await user.click(views.getByRole("button", { name: "Quota" }));
    expect(screen.getByRole("button", { name: "5h usage" })).toHaveAttribute("aria-pressed", "false");
  });

  it("distinguishes unavailable quota from zero and updates when the range changes", async () => {
    const user = userEvent.setup();
    const { rerender, container } = render(<UsageTrendsCard daily={[{ ...daily[0], fiveHourPercent: null, weeklyPercent: undefined }]} metrics={[]} cacheHitRate={0} />);
    await user.click(screen.getByRole("button", { name: "Quota" }));
    expect(screen.getByRole("status")).toHaveTextContent("No quota data for this period");
    expect(container.querySelector(".recharts-bar-rectangle")).toBeInTheDocument();
    rerender(<UsageTrendsCard daily={[{ ...daily[0], fiveHourPercent: 0, weeklyPercent: 0 }]} metrics={[]} cacheHitRate={0} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quota" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll('.recharts-line-dot[stroke="#f97316"]')).toHaveLength(1);
  });

  it("shows daily quota, missing values and accurate totals even when token series are hidden", () => {
    const { rerender } = render(<UsageTrendTooltip active view="quota" payload={[
      { dataKey: "weeklyPercent", value: 0, payload: { ...daily[0], fiveHourPercent: null, weeklyPercent: 0 } },
    ]} t={i18n.t} />);
    expect(screen.getByText("2026-10-25")).toBeInTheDocument();
    expect(screen.getByText("130")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Approx. 0.0%")).toBeInTheDocument();
    expect(screen.queryByText("$1.00")).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("trends.quota_note"))).toBeInTheDocument();
    rerender(<UsageTrendTooltip active view="quota" payload={[
      { dataKey: "fiveHourPercent", value: 150, payload: daily[0] },
    ]} t={i18n.t} />);
    expect(screen.getByText("Approx. 150.0%")).toBeInTheDocument();
  });

  it("supports keyboard switching and retains the quota view in full screen", async () => {
    const user = userEvent.setup();
    render(<UsageTrendsCard daily={daily} metrics={[]} cacheHitRate={0} />);
    screen.getByRole("button", { name: "Quota" }).focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Expand chart to full screen" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Quota" })).toHaveAttribute("aria-pressed", "true");
    expect(dialog.getByRole("button", { name: "5h usage" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Quota" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps compact charts on the existing cost presentation", () => {
    render(<UsageTrendsCard daily={daily} metrics={[]} cacheHitRate={0} compact />);
    expect(screen.queryByRole("group", { name: "Trend view" })).not.toBeInTheDocument();
    expect(screen.queryByText("5h usage")).not.toBeInTheDocument();
  });
});
