// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@/lib/api";
import { MarkdownContent } from "./markdown-content";

vi.mock("@/lib/api", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownContent", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockReset();
  });

  it("renders GFM tables, highlighted code, and math", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "## Markdown heading",
          "",
          "**Bold text** and `inline code`",
          "",
          "| Feature | Status |",
          "| --- | --- |",
          "| Table | Ready |",
          "",
          "```typescript",
          "const answer = 42;",
          "```",
          "",
          "$$",
          "E = mc^2",
          "$$",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("heading", { name: "Markdown heading" })).toBeInTheDocument();
    expect(screen.getByText("Bold text").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("code.language-typescript.hljs .hljs-keyword")).toHaveTextContent("const");
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });

  it("keeps raw HTML inert and opens external links outside the webview", async () => {
    vi.mocked(openUrl).mockResolvedValue();
    const { container } = render(
      <MarkdownContent content={'<img src="x" onerror="alert(1)">\n\n[Example](https://example.com)'} />,
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<img src="x" onerror="alert(1)">');
    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");

    await userEvent.click(link);

    expect(openUrl).toHaveBeenCalledWith("https://example.com/");
  });
});
