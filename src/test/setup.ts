import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, vi } from "vitest";
import "../i18n";

// jsdom does not implement layout or SVG geometry measurements.
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: class {
    observe() {}
    disconnect() {}
  },
});
if (typeof SVGElement !== "undefined") {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
}

vi.mock("recharts", async (importOriginal) => {
  const recharts = await importOriginal<typeof import("recharts")>();

  return {
    ...recharts,
    // jsdom has no layout engine; give real charts a measurable viewport in unit tests.
    ResponsiveContainer: (props: ComponentProps<typeof recharts.ResponsiveContainer>) =>
      createElement(recharts.ResponsiveContainer, { ...props, width: 800, height: 300 }),
  };
});

afterEach(() => {
  cleanup();
});
