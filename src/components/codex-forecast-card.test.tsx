// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexForecastCard } from "./codex-forecast-card";
import { openUrl, type CodexForecastAlert, type CodexQuotaForecastResponse, type CodexResetAnnouncement } from "@/lib/api";
import fixture from "../../e2e/fixtures/reset-forecast.json";
import i18n from "@/i18n";
import { languageCodes, languages } from "@/lib/languages";

vi.mock("@/lib/api", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
const props = { error: null, isRefreshing: false, onRefresh: vi.fn() };
const data: CodexQuotaForecastResponse = fixture;
const withAlert = (alert: CodexForecastAlert | null) => ({ ...data, latestAlert: alert });
const expand = () => fireEvent.click(screen.getByRole("button", { name: "Show historical reference" }));
const status = () => screen.getByTestId("forecast-status");

describe("CodexForecastCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T01:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows no reliable announcement for past resets and keeps history collapsed", () => {
    render(<CodexForecastCard {...props} data={{ ...data, hasOfficialSignal: false, probability24h: 0, probability48h: 100, latestAlert: {
      kind: "reset", state: "confirmed", summary: "Old reset confirmed",
    } }} />);
    expect(status()).toHaveTextContent("No reliable announcement");
    expect(screen.queryByText("Old reset confirmed")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expand();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/Waiting longer does not increase/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide historical reference" }));
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("No reliable announcement");
  });

  it("prioritizes an explicit timed promise and its full original evidence", () => {
    render(<CodexForecastCard {...props} data={data} />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
    expect(screen.getByText(data.latestAlert!.summary!)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    for (const post of data.evidencePosts!) expect(screen.getByText(post.text)).toBeInTheDocument();
    expect(screen.getByText("Reply context")).toBeInTheDocument();
    expect(screen.getByText(/Original timing: Within the next three hours · UTC/)).toBeInTheDocument();
    expect(screen.getByText(/Provider rule score: 93/)).toHaveTextContent("not a measured success rate");
    expect(screen.queryByText("93%")).not.toBeInTheDocument();
    expect(screen.queryByText("39%")).not.toBeInTheDocument();
    expect(screen.queryByText(/context is missing/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "@thsottiaux ↗" }));
    expect(openUrl).toHaveBeenCalledWith(data.latestAlert!.url);
    fireEvent.click(screen.getAllByRole("link", { name: "View on X ↗" })[1]);
    expect(openUrl).toHaveBeenCalledWith(data.evidencePosts![1].url);
    fireEvent.click(screen.getByRole("link", { name: "codex-reset.com" }));
    expect(openUrl).toHaveBeenCalledWith("https://codex-reset.com/");
    expand();
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Forecast method and accuracy" }));
    expect(openUrl).toHaveBeenCalledWith("https://codex-reset.com/forecast-method");
  });

  it("accepts an active untimed promise without inventing a date or success percentage", () => {
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, score: 83, window: null })} />);
    expect(status()).toHaveTextContent("Explicit announcement · time unknown");
    expect(screen.queryByText(/Expected window/)).not.toBeInTheDocument();
    expect(screen.queryByText("83%")).not.toBeInTheDocument();
  });

  it.each([
    { hasOfficialSignal: false },
    { latestAlert: { ...data.latestAlert, state: "expired" } },
    { latestAlert: { ...data.latestAlert, score: 50 } },
    { latestAlert: { ...data.latestAlert, score: 93, window: null } },
    { latestAlert: { ...data.latestAlert, sourceAt: "invalid" } },
    { latestAlert: { ...data.latestAlert, sourceAt: "2026-10-24T02:00:00Z" } },
    { latestAlert: { ...data.latestAlert, kind: "unknown" } },
    { latestAlert: { ...data.latestAlert, url: null } },
    { latestAlert: { ...data.latestAlert, window: { startAt: "2026-10-25T00:00:00Z", endAt: "2026-10-24T03:00:00Z" } } },
    { lastResetAt: "2026-10-24T00:30:00Z" },
  ])("does not promote inactive, unsupported or already answered signals: %j", (patch) => {
    render(<CodexForecastCard {...props} data={{ ...data, ...patch }} />);
    expect(status()).toHaveTextContent("No reliable announcement");
    expect(screen.queryByText(data.latestAlert!.summary!)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("expires a time window while the app stays open", () => {
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, window: { endAt: "2026-10-24T01:00:01Z" } })} />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
    act(() => vi.advanceTimersByTime(1000));
    expect(status()).toHaveTextContent("No reliable announcement");
    expect(screen.getByText(/previous announcement has expired/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it.each(["done", "on_its_way"])("treats pending %s as taking effect, outside the future prediction", (pending) => {
    render(<CodexForecastCard {...props} data={{ ...withAlert({ ...data.latestAlert, pending, score: null, window: null }), hasOfficialSignal: false }} />);
    expect(status()).toHaveTextContent("Taking effect");
    expect(screen.getByText(/awaiting monitoring confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/Provider rule score/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expected window/)).not.toBeInTheDocument();
  });

  it("closes a promise using the existing regular reset source but ignores banked grants", () => {
    const reset: CodexResetAnnouncement = { id: "existing-source", resetType: "banked", announcedAt: "2026-10-24T00:30:00Z", text: "Grant", source: { url: "https://example.com" } };
    const { rerender } = render(<CodexForecastCard {...props} data={data} resets={[reset]} />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
    rerender(<CodexForecastCard {...props} data={data} resets={[{ ...reset, resetType: "regular" }]} />);
    expect(status()).toHaveTextContent("No reliable announcement");
    expect(screen.queryByText("Grant")).not.toBeInTheDocument();
  });

  it("labels missing, partial and stale evidence without substituting unrelated posts", () => {
    const { rerender } = render(<CodexForecastCard {...props} data={{ ...data, evidencePosts: null }} />);
    expect(screen.getByText(/original posts could not be loaded/)).toBeInTheDocument();
    expect(status()).toHaveTextContent("Explicit announcement · time window");
    rerender(<CodexForecastCard {...props} data={{ ...data, evidencePosts: [data.evidencePosts![0]] }} />);
    expect(screen.getByText(/reply context is missing/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    rerender(<CodexForecastCard {...props} data={{ ...data, evidenceStale: true }} />);
    expect(screen.getByText(/Evidence is out of date/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks an old snapshot as unknown and automatically rechecks freshness in the view", () => {
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, score: 83, window: null })} />);
    expect(status()).toHaveTextContent("Explicit announcement · time unknown");
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(status()).toHaveTextContent("Signal needs rechecking");
    expect(screen.getByText(/Current validity is unknown/)).toBeInTheDocument();
  });

  it("uses the current wall clock after a clock adjustment and a fresh response", () => {
    vi.setSystemTime(new Date("2026-10-24T01:10:00Z"));
    const { rerender } = render(<CodexForecastCard {...props} data={data} />);
    expect(status()).toHaveTextContent("Signal needs rechecking");
    vi.setSystemTime(new Date("2026-10-24T01:00:00Z"));
    rerender(<CodexForecastCard {...props} data={{ ...data }} />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
  });

  it("offers first-load retry and marks retained data as unverified after refresh failure", () => {
    const { rerender } = render(<CodexForecastCard {...props} data={null} error="offline" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load");
    fireEvent.click(screen.getByRole("button", { name: "Retry forecast" }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    rerender(<CodexForecastCard {...props} data={data} isRefreshing />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
    expect(screen.getByRole("button", { name: "Refresh forecast" })).toBeDisabled();
    rerender(<CodexForecastCard {...props} data={data} error="offline" />);
    expect(status()).toHaveTextContent("Signal needs rechecking");
    expect(screen.getByText(data.evidencePosts![0].text)).toBeInTheDocument();
    rerender(<CodexForecastCard {...props} data={data} />);
    expect(status()).toHaveTextContent("Explicit announcement · time window");
  });

  it("does not label an unavailable model as historical probability", () => {
    render(<CodexForecastCard {...props} data={{ ...data, probability24h: null, probability48h: null }} />);
    expand();
    expect(screen.getByText(/separate historical baseline is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("93%")).not.toBeInTheDocument();
  });

  it.each(languageCodes)("provides all labels and localized summaries in %s", async (language) => {
    await i18n.changeLanguage(language);
    expect(Object.keys(languages[language].translations.forecast).sort()).toEqual(Object.keys(languages.en.translations.forecast).sort());
    render(<CodexForecastCard {...props} data={withAlert({ ...data.latestAlert, localizedSummary: "Localized fixture" })} />);
    expect(screen.getByText(languages[language].translations.forecast.title)).toBeInTheDocument();
    expect(screen.getByText("Localized fixture")).toBeInTheDocument();
    expect(screen.getByText(data.evidencePosts![0].text)).toBeInTheDocument();
  });
});
