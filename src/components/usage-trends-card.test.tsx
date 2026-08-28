// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageTrendTooltip } from "./usage-trends-card";

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
});
