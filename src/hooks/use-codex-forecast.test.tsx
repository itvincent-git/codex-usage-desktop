// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCodexForecast } from "./use-codex-forecast";
import { fetchCodexQuotaForecast } from "@/lib/api";
import fixture from "../../e2e/fixtures/reset-forecast.json";

vi.mock("@/lib/api", () => ({ fetchCodexQuotaForecast: vi.fn() }));
function Harness({ active = true, language = "en" }: { active?: boolean; language?: string }) {
  const forecast = useCodexForecast(active, language);
  return <><button onClick={() => void forecast.refresh()}>refresh</button><span>{forecast.data?.recentPosts?.[0]?.text}</span><span>{forecast.error}</span><span>{forecast.isRefreshing ? "refreshing" : "idle"}</span></>;
}
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe("useCodexForecast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(fetchCodexQuotaForecast).mockResolvedValue(fixture);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("deduplicates StrictMode startup and in-flight manual/focus requests", async () => {
    let resolve!: (value: typeof fixture) => void;
    vi.mocked(fetchCodexQuotaForecast).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<StrictMode><Harness /></StrictMode>);
    fireEvent.click(screen.getByText("refresh"));
    fireEvent(window, new Event("focus"));
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(1);
    await act(async () => resolve(fixture));
    expect(screen.getByText(fixture.recentPosts[0].text)).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("polls once per minute only while dashboard is visible, and refreshes on return and foreground", async () => {
    const { rerender } = render(<Harness />);
    await settle();
    await act(async () => vi.advanceTimersByTime(59_999));
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(3);
    fireEvent(window, new Event("focus"));
    await settle();
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(4);
    rerender(<Harness active={false} />);
    await act(async () => vi.advanceTimersByTime(120_000));
    fireEvent(window, new Event("focus"));
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(4);
    rerender(<Harness />);
    await settle();
    expect(fetchCodexQuotaForecast).toHaveBeenCalledTimes(5);
  });

  it("retries initial failures and keeps successful data after refresh failure", async () => {
    vi.mocked(fetchCodexQuotaForecast).mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    await settle();
    expect(screen.getByText("offline")).toBeInTheDocument();
    fireEvent.click(screen.getByText("refresh"));
    await settle();
    expect(screen.getByText(fixture.recentPosts[0].text)).toBeInTheDocument();
    expect(screen.queryByText("offline")).not.toBeInTheDocument();
    vi.mocked(fetchCodexQuotaForecast).mockRejectedValueOnce("rate limited");
    fireEvent.click(screen.getByText("refresh"));
    await settle();
    expect(screen.getByText(fixture.recentPosts[0].text)).toBeInTheDocument();
    expect(screen.getByText("rate limited")).toBeInTheDocument();
  });

  it.each([["zh", "zh"], ["zh-Hant", "zh"], ["ja", "ja"], ["ko", "en"], ["en", "en"]])("maps %s to API locale %s", async (language, locale) => {
    render(<Harness language={language} />);
    await settle();
    expect(fetchCodexQuotaForecast).toHaveBeenCalledWith(locale);
  });

  it("ignores an older language response after the language changes", async () => {
    let resolve!: (value: typeof fixture) => void;
    vi.mocked(fetchCodexQuotaForecast).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { rerender } = render(<Harness />);
    rerender(<Harness language="ja" />);
    await settle();
    await act(async () => resolve({ ...fixture, recentPosts: [{ ...fixture.recentPosts[0], text: "Older language response" }] }));
    expect(screen.getByText(fixture.recentPosts[0].text)).toBeInTheDocument();
    expect(screen.queryByText("Older language response")).not.toBeInTheDocument();
  });
});
