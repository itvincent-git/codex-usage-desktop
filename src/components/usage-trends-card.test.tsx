// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { UsageTrendsCard, UsageTrendTooltip } from "./usage-trends-card";
import { formatTrendDateLabel } from "@/lib/usage-dashboard";

describe("UsageTrendTooltip", () => {
  it("formats hourly trend labels with the date and hour", () => {
    expect(formatTrendDateLabel("2026-10-23T17:00+08:00", true)).toBe("10-23 17:00+08:00");
    expect(formatTrendDateLabel("2026-10-23", false)).toBe("10-23");
  });

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
    const costLegend = screen.getByRole("button", { name: "Cost" });

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
});
