// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UsageTrendsCard, UsageTrendTooltip } from "./usage-trends-card";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

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
});
