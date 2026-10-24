// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexForecastCard } from "./codex-forecast-card";
import { openUrl, type CodexForecastAlert, type CodexQuotaForecastResponse } from "@/lib/api";
import fixture from "../../e2e/fixtures/reset-forecast.json";
import i18n from "@/i18n";
import { languageCodes, languages } from "@/lib/languages";

vi.mock("@/lib/api", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
const props = { error: null, isRefreshing: false, onRefresh: vi.fn() };
const data: CodexQuotaForecastResponse = fixture;
const withAlert = (alert: CodexForecastAlert | null) => ({ ...data, latestAlert: alert });
const expand = () => fireEvent.click(screen.getByRole("button", { name: "Show details" }));

describe("CodexForecastCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T02:59:59Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows historical probabilities including 0 and 100, local dates, and collapsed details", () => {
    render(<CodexForecastCard {...props} data={{ ...data, probability24h: 0, probability48h: 100, latestAlert: null }} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("No official reset signal");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(new Date(data.updatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }), { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/The historical model uses/)).not.toBeInTheDocument();
    expand();
    expect(screen.getByText("No current announcement.")).toBeInTheDocument();
    expect(screen.getByText(/Waiting longer does not increase/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.getByText("No current announcement.")).toBeInTheDocument();
  });

  it("separates official signal scores and opens source, original and method links", () => {
    render(<CodexForecastCard {...props} data={data} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("Official announcement");
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
    const source = screen.getByRole("link", { name: "codex-reset.com" });
    expect(source).toHaveAttribute("href", "https://codex-reset.com/");
    fireEvent.click(source);
    expect(openUrl).toHaveBeenCalledWith("https://codex-reset.com/");
    expect(screen.getByText(data.latestAlert!.summary!)).toBeInTheDocument();
    expand();
    expect(screen.getByText("Signal score: 93 (not a 24h / 48h probability)")).toBeInTheDocument();
    expect(screen.getByText(data.latestAlert!.summary!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "View original post" }));
    expect(openUrl).toHaveBeenCalledWith(data.latestAlert!.url);
    fireEvent.click(screen.getByRole("link", { name: "Forecast method and accuracy" }));
    expect(openUrl).toHaveBeenCalledWith("https://codex-reset.com/forecast-method");
  });

  it("changes an ended window to waiting without confirming a reset", () => {
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, window: { startAt: "2026-10-24T01:00:00Z", endAt: "2026-10-24T03:00:00Z" } })} />);
    expand();
    expect(screen.getByText("Window ends in 0:00:01")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("Awaiting confirmation");
    expect(screen.getByText("Announcement window ended; awaiting confirmation.")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed reset")).not.toBeInTheDocument();
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getByText(new Date(data.lastResetAt!).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }))).toBeInTheDocument();
  });

  it.each(["done", "on_its_way"])("shows pending %s as awaiting monitoring confirmation", (pending) => {
    render(<CodexForecastCard {...props} data={withAlert({ kind: "watch", state: "active", pending })} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("Awaiting confirmation");
    expand();
    expect(screen.getByText(/awaiting monitoring confirmation/)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed reset")).not.toBeInTheDocument();
  });

  it("retains expired announcements and shows confirmed resets only from API confirmation", () => {
    const { rerender } = render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, state: "expired" })} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("No official reset signal");
    expand();
    expect(screen.getByText("Expired announcement")).toBeInTheDocument();
    const observedAt = "2026-10-24T02:00:00Z";
    rerender(<CodexForecastCard {...props} data={{ ...data, lastResetAt: observedAt, latestAlert: { kind: "reset", state: "confirmed", observedAt } }} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("Reset confirmed · codex-reset");
    expect(screen.getByText(/Confirmed reset time:/)).toHaveTextContent(new Date(observedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }));
    expect(screen.queryByText("Expired announcement")).not.toBeInTheDocument();
  });

  it("keeps probabilities and dates when optional fields or alert states are unknown", () => {
    render(<CodexForecastCard {...props} data={withAlert({ kind: "new", state: "new", summary: "Future API state" })} />);
    expect(screen.getByTestId("forecast-status")).toHaveTextContent("No official reset signal");
    expect(screen.getByText("39%")).toBeInTheDocument();
    expand();
    expect(screen.getByText("Future API state")).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed reset time:/)).not.toBeInTheDocument();
  });

  it("offers first-load retry and preserves data during refresh and later errors", () => {
    const { rerender } = render(<CodexForecastCard {...props} data={null} error="offline" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load");
    expect(screen.getByRole("link", { name: "codex-reset.com" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry forecast" }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    rerender(<CodexForecastCard {...props} data={data} isRefreshing />);
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh forecast" })).toBeDisabled();
    rerender(<CodexForecastCard {...props} data={data} error="offline" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing the last available forecast");
    expect(screen.getByText("39%")).toBeInTheDocument();
  });

  it("shows recent posts and reset labels before expanding, and opens their original links", () => {
    render(<CodexForecastCard {...props} data={data} />);
    expect(screen.getByRole("heading", { name: "Will Codex reset?" })).toBeInTheDocument();
    expect(screen.getByText(data.latestAlert!.summary!)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    for (const post of data.recentPosts!) {
      expect(screen.getByText(post.text)).toBeInTheDocument();
    }
    expect(screen.getByText("Expected reset")).toBeInTheDocument();
    expect(screen.getByText("Reset signal")).toBeInTheDocument();
    expect(screen.getByText("Reset hint")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed reset")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: "View on X ↗" })[1]);
    expect(openUrl).toHaveBeenCalledWith(data.recentPosts![1].url);
    fireEvent.click(screen.getByRole("link", { name: "@thsottiaux ↗" }));
    expect(openUrl).toHaveBeenCalledWith("https://x.com/thsottiaux");
  });

  it("distinguishes unavailable, empty and stale feeds while retaining the announcement", () => {
    const { rerender } = render(<CodexForecastCard {...props} data={{ ...data, recentPosts: null }} />);
    expect(screen.getByText(/Tibo posts are unavailable/)).toBeInTheDocument();
    expect(screen.getByText(data.latestAlert!.summary!)).toBeInTheDocument();
    rerender(<CodexForecastCard {...props} data={{ ...data, recentPosts: [] }} />);
    expect(screen.getByText("No recent posts.")).toBeInTheDocument();
    rerender(<CodexForecastCard {...props} data={{ ...data, postsStale: true }} />);
    expect(screen.getByText(/Showing older posts/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it.each(languageCodes)("provides all labels and localized summaries in %s", async (language) => {
    await i18n.changeLanguage(language);
    expect(Object.keys(languages[language].translations.forecast).sort()).toEqual(Object.keys(languages.en.translations.forecast).sort());
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, localizedSummary: "Localized fixture" })} />);
    expect(screen.getByText(languages[language].translations.forecast.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: languages[language].translations.forecast.details }));
    expect(screen.getByText("Localized fixture")).toBeInTheDocument();
  });
});
