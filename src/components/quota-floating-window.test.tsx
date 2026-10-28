// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { QuotaFloatingWindow } from "./quota-floating-window";
import i18n from "../i18n";
import type { CodexLimitsResponse } from "../lib/api";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), visible: vi.fn(), hide: vi.fn(), resize: vi.fn(), drag: vi.fn(),
  listeners: new Map<string, (event: { payload: any }) => void>(),
}));
vi.mock("@/lib/api", () => ({ fetchCodexLimits: mocks.fetch }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isVisible: mocks.visible, hide: mocks.hide, startDragging: mocks.drag }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.resize }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: any }) => void) => {
    mocks.listeners.set(name, callback);
    return () => { if (mocks.listeners.get(name) === callback) mocks.listeners.delete(name); };
  }),
}));

const limits: CodexLimitsResponse = {
  session: { usedPercent: 28, remainingPercent: 72, windowMinutes: 300, resetsAt: "2026-10-23T12:30:00Z" },
  weekly: { usedPercent: 65, remainingPercent: 35, windowMinutes: 10080, resetsAt: "2026-10-29T15:00:00Z" },
  source: "test", updatedAt: "2026-10-23T07:30:00Z",
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.visible.mockResolvedValue(true);
  mocks.hide.mockResolvedValue(undefined);
  mocks.resize.mockResolvedValue(undefined);
  mocks.drag.mockResolvedValue(undefined);
  vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.setPointerCapture = vi.fn();
  mocks.fetch.mockResolvedValue(limits);
  await i18n.changeLanguage("en");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("quota overlay", () => {
  it("counts down the outer time ring independently of quota, reaches zero, and restarts on a new window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(limits.updatedAt));
    const view = render(<QuotaFloatingWindow />);
    await act(async () => {});
    const time = () => screen.getByRole("meter", { name: "5-hour time remaining" });
    expect(time()).toHaveAttribute("aria-valuenow", "100");
    expect(time().querySelectorAll("circle")[1]).toHaveAttribute("stroke-dasharray", "100 100");
    expect(screen.getAllByRole("meter", { name: "5-hour time remaining" })).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-23T09:59:30Z"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(time()).toHaveAttribute("aria-valuenow", "50");
    expect(time().querySelectorAll("circle")[1]).toHaveAttribute("stroke-dasharray", "50 100");
    expect(screen.getByRole("meter", { name: "5-Hour Limit" })).toHaveAttribute("aria-valuenow", "72");

    fireEvent.click(screen.getByRole("button", { name: "Collapse to quota ball" }));
    await act(async () => {});
    vi.setSystemTime(new Date("2026-10-23T12:29:30Z"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(time()).toHaveAttribute("aria-valuenow", "0");
    expect(time().querySelectorAll("circle")[1]).toHaveAttribute("opacity", "0");
    expect(screen.getByText("72%")).toBeInTheDocument();
    await act(async () => mocks.listeners.get("codex-limits-updated")?.({ payload: { ...limits, session: { ...limits.session, resetsAt: "2026-10-23T17:30:00Z" } } }));
    expect(time()).toHaveAttribute("aria-valuenow", "100");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["2026-10-23T14:30:00Z", "100"],
    ["2026-10-23T07:00:00Z", "0"],
    [null, null],
    ["invalid", null],
  ])("handles a reset time of %s without inventing time or exceeding the ring bounds", async (resetsAt, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(limits.updatedAt));
    mocks.fetch.mockResolvedValue({ ...limits, session: { ...limits.session, resetsAt } });
    render(<QuotaFloatingWindow />);
    await act(async () => {});
    const time = screen.getByRole("meter", { name: "5-hour time remaining" });
    if (expected === null) expect(time).not.toHaveAttribute("aria-valuenow");
    else expect(time).toHaveAttribute("aria-valuenow", expected);
  });

  it("renders remaining quota and local reset times, keeps the last snapshot on failure, and recovers", async () => {
    render(<QuotaFloatingWindow />);
    await screen.findByText("72%");
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "5-Hour Limit" })).toHaveAttribute("aria-valuenow", "72");
    const date = new Date(limits.session!.resetsAt!).toLocaleString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
    expect(screen.getByText(`Resets ${date}`)).toBeInTheDocument();
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Check limits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Data may be out of date");
    expect(screen.getByText("72%")).toBeInTheDocument();
    await act(async () => mocks.listeners.get("codex-limits-updated")?.({ payload: { ...limits, session: { ...limits.session, remainingPercent: 60 } } }));
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.hide).toHaveBeenCalledOnce();
  });

  it("does not poll while hidden, refreshes on show, and cancels polling after unmount", async () => {
    vi.useFakeTimers();
    mocks.visible.mockResolvedValue(false);
    const view = render(<QuotaFloatingWindow />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => mocks.listeners.get("quota-window-shown")?.({ payload: null }));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.visible.mockResolvedValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.listeners.size).toBe(0);
  });

  it("shows unavailable windows without inventing percentages", async () => {
    mocks.fetch.mockResolvedValue({ ...limits, session: null, weekly: null });
    render(<QuotaFloatingWindow />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(screen.getAllByTitle("No rate-limit window returned by Codex.")).toHaveLength(2);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("collapses to the 5-hour ring, continues receiving quota updates, and expands on click", async () => {
    render(<QuotaFloatingWindow />);
    await screen.findByText("72%");
    fireEvent.click(screen.getByRole("button", { name: "Collapse to quota ball" }));
    const ball = await screen.findByRole("button", { name: "Expand quota overlay" });
    expect(mocks.resize).toHaveBeenCalledWith("set_quota_collapsed", { collapsed: true });
    expect(screen.getAllByRole("meter")).toHaveLength(2);
    expect(screen.queryByText("35%")).not.toBeInTheDocument();
    expect(screen.queryByText(/Resets /)).not.toBeInTheDocument();
    await act(async () => mocks.listeners.get("codex-limits-updated")?.({ payload: { ...limits, session: { ...limits.session, remainingPercent: 62 } } }));
    expect(screen.getByText("62%")).toBeInTheDocument();
    fireEvent.click(ball);
    await screen.findByRole("button", { name: "Collapse to quota ball" });
    expect(mocks.resize).toHaveBeenLastCalledWith("set_quota_collapsed", { collapsed: false });
    expect(screen.getAllByRole("meter")).toHaveLength(3);
  });

  it("drags the ball without expanding, but still permits keyboard expansion", async () => {
    render(<QuotaFloatingWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse to quota ball" }));
    const ball = await screen.findByRole("button", { name: "Expand quota overlay" });
    mocks.resize.mockClear();
    fireEvent.pointerDown(ball, { button: 0, screenX: 20, screenY: 20 });
    fireEvent.pointerMove(ball, { buttons: 1, screenX: 60, screenY: 40 });
    fireEvent.pointerUp(ball);
    fireEvent.click(ball, { detail: 1 });
    expect(mocks.drag).toHaveBeenCalledOnce();
    expect(mocks.resize).not.toHaveBeenCalled();
    fireEvent.click(ball, { detail: 0 });
    await screen.findByRole("button", { name: "Collapse to quota ball" });
    expect(mocks.resize).toHaveBeenCalledWith("set_quota_collapsed", { collapsed: false });
  });
});
