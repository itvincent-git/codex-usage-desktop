// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import dayjs from "dayjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResetHistorySummary, CodexResetHistoryModal } from "./codex-reset-history";
import { fetchCodexResetHistory, openUrl } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  fetchCodexResetHistory: vi.fn(),
  openUrl: vi.fn(),
}));

describe("CodexResetHistoryModal", () => {
  beforeEach(() => {
    vi.mocked(fetchCodexResetHistory).mockResolvedValue([
      {
        id: "2091688655828246890",
        resetType: "regular",
        announcedAt: "2026-08-24T00:46:51.000Z",
        text: "Reset has been propagated.",
        source: {
          author: "thsottiaux",
          url: "https://x.com/thsottiaux/status/2091688655828246890",
        },
      },
      {
        id: "2",
        resetType: "banked",
        announcedAt: "2026-08-21T00:46:51.000Z",
        text: "A banked reset is available.",
        source: {
          author: "thsottiaux",
          url: "https://x.com/thsottiaux/status/2",
        },
      },
      {
        id: "3",
        resetType: "regular",
        announcedAt: "2026-08-18T00:46:51.000Z",
        text: "Third reset announcement.",
        source: { author: "thsottiaux", url: "https://x.com/thsottiaux/status/3" },
      },
      {
        id: "4",
        resetType: "regular",
        announcedAt: "2026-08-15T00:46:51.000Z",
        text: "Fourth reset announcement.",
        source: { author: "thsottiaux", url: "https://x.com/thsottiaux/status/4" },
      },
      {
        id: "5",
        resetType: "regular",
        announcedAt: "2026-08-12T00:46:51.000Z",
        text: "Fifth reset announcement.",
        source: { author: "thsottiaux", url: "https://x.com/thsottiaux/status/5" },
      },
      {
        id: "6",
        resetType: "regular",
        announcedAt: "2026-08-09T00:46:51.000Z",
        text: "Oldest reset announcement.",
        source: { author: "thsottiaux", url: "https://x.com/thsottiaux/status/6" },
      },
    ]);
    vi.mocked(openUrl).mockResolvedValue();
  });

  it("loads and summarizes the last 30 days", async () => {
    render(<StrictMode><CodexResetHistoryModal onClose={() => {}} /></StrictMode>);

    expect(await screen.findByText("1 day ago")).toBeInTheDocument();
    expect(fetchCodexResetHistory).toHaveBeenCalledWith(30);
    expect(fetchCodexResetHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Resets").nextElementSibling).toHaveTextContent("6");
    expect(screen.getByText("Average interval").nextElementSibling).toHaveTextContent("3d");
    expect(screen.getAllByTestId("reset-history-day")).toHaveLength(30);
    expect(document.querySelectorAll('[data-reset-type="regular"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-reset-type="banked"]')).toHaveLength(1);
    expect(screen.getByText("Reset has been propagated.")).toBeInTheDocument();
    expect(screen.getByText("Fifth reset announcement.")).toBeInTheDocument();
    expect(screen.queryByText("Oldest reset announcement.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Oldest reset announcement.")).toBeInTheDocument();
    expect(screen.getByText("Showing 6 of 6 announcements")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("Oldest reset announcement.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "@thsottiaux" }));
    expect(openUrl).toHaveBeenCalledWith("https://x.com/thsottiaux/status/2091688655828246890");
  });

  it("calculates adjacent reset intervals and mixed days", () => {
    const summary = buildResetHistorySummary([
      {
        id: "1",
        resetType: "regular",
        announcedAt: "2026-08-24T12:00:00.000Z",
        text: "Regular reset",
        source: { author: "source", url: "https://example.com/1" },
      },
      {
        id: "2",
        resetType: "banked",
        announcedAt: "2026-08-24T00:00:00.000Z",
        text: "Banked reset",
        source: { author: "source", url: "https://example.com/2" },
      },
      {
        id: "3",
        resetType: "regular",
        announcedAt: "2026-08-20T00:00:00.000Z",
        text: "Earlier reset",
        source: { author: "source", url: "https://example.com/3" },
      },
    ], dayjs("2026-08-25T00:46:51.000Z"));

    expect(summary.averageIntervalDays).toBe(2.25);
    expect(summary.longestIntervalDays).toBe(4);
    expect(summary.calendarDays.find((day) => day.date.format("YYYY-MM-DD") === "2026-08-24")?.resetType).toBe("mixed");
  });
});
