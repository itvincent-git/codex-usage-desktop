// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent", () => {
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

  it("keeps raw HTML inert and secures external links", () => {
    const { container } = render(
      <MarkdownContent content={'<img src="x" onerror="alert(1)">\n\n[Example](https://example.com)'} />,
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<img src="x" onerror="alert(1)">');
    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute("rel", "noreferrer");
  });
});
