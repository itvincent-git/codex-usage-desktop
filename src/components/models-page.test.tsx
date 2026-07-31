// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsPage } from "@/components/models-page";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/components/range-switcher", () => ({ RangeSwitcher: () => <div data-testid="range-switcher" /> }));

const entry = (index: number, provider = index % 2 ? "openai" : "anthropic") => ({
  model: `model-${String(index).padStart(2, "0")}`,
  provider,
  pricingStatus: "priced" as const,
  inputCostPerMillionTokens: index,
  cachedInputCostPerMillionTokens: index / 2,
  outputCostPerMillionTokens: null,
});

describe("ModelsPage pricing catalog", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
  });
  beforeEach(() => invokeMock.mockReset());

  it("defaults to usage and lazily loads the catalog only once", async () => {
    invokeMock.mockResolvedValue({ isLimited: false, models: [entry(1)] });
    render(<ModelsPage models={[]} range="30d" onRangeChange={vi.fn()} />);

    expect(screen.getByTestId("range-switcher")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));

    await screen.findByText("model-01");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fetch_model_pricing_catalog");
    expect(screen.queryByTestId("range-switcher")).not.toBeInTheDocument();
  });

  it("searches, filters providers, paginates, and resets pagination", async () => {
    invokeMock.mockResolvedValue({ isLimited: false, models: Array.from({ length: 55 }, (_, index) => entry(index + 1)) });
    render(<ModelsPage models={[]} range="30d" onRangeChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));
    await screen.findByText("model-01");

    expect(screen.queryByText("model-55")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("model-55")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search models or providers..." }), "MODEL-03");
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("model-03")).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("textbox", { name: "Search models or providers..." }));
    await userEvent.click(screen.getByRole("combobox", { name: "Provider" }));
    await userEvent.click(await screen.findByRole("option", { name: "openai" }));
    expect(screen.queryByText("model-02")).not.toBeInTheDocument();
    expect(screen.getByText("model-01")).toBeInTheDocument();
  });

  it("formats free and missing values and shows limited, empty, and error states", async () => {
    invokeMock.mockResolvedValueOnce({ isLimited: true, models: [{ ...entry(1), pricingStatus: "free", inputCostPerMillionTokens: 0, cachedInputCostPerMillionTokens: 0 }] });
    const { unmount } = render(<ModelsPage models={[]} range="30d" onRangeChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));
    const row = await screen.findByRole("row", { name: /model-01/ });
    expect(within(row).getAllByText("Free")).toHaveLength(2);
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/limited built-in/)).toBeInTheDocument();
    unmount();

    invokeMock.mockResolvedValueOnce({ isLimited: false, models: [] });
    const second = render(<ModelsPage models={[]} range="30d" onRangeChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));
    await screen.findByText("No pricing entries match your filters.");
    second.unmount();

    invokeMock.mockRejectedValueOnce(new Error("offline"));
    render(<ModelsPage models={[]} range="30d" onRangeChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Pricing Catalog" }));
    await waitFor(() => expect(screen.getByText("Failed to load the pricing catalog.")).toBeInTheDocument());
  });
});
