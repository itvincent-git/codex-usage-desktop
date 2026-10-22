// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { CodexLimitsResponse, OverviewResponse } from "../lib/api";
import { DashboardHeroCard } from "./dashboard-hero-card";

const overview: OverviewResponse = {
  range: "30d", days: 30, timezone: "UTC", startDate: "2026-10-01", endDate: "2026-10-30", updatedAt: null,
  daily: [], models: [], projects: [],
  totals: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0, avgTokensPerDay: 0, avgCostPerDay: 0, cacheHitRate: 0, costPerMillionTokens: 0 },
};

const limits: CodexLimitsResponse = {
  session: null, weekly: null, account: "user@example.com", membershipLevel: "plus", updatedAt: "2026-10-22T00:00:00Z", source: "test",
};

function hero(codexLimits: CodexLimitsResponse | null) {
  return <DashboardHeroCard overview={overview} range="30d" isBusy={false} isExporting={null} onRangeChange={vi.fn()} onExport={vi.fn()} metrics={[]} codexLimits={codexLimits} />;
}

describe("Dashboard credits balance", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    [{ hasCredits: true, unlimited: false, balance: "1250.500001" }, "1250.500001"],
    [{ hasCredits: false, unlimited: false, balance: "0" }, "0"],
    [{ hasCredits: false, unlimited: false, balance: null }, "0"],
    [{ hasCredits: true, unlimited: false, balance: null }, "Unavailable"],
    [{ hasCredits: true, unlimited: false, balance: " " }, "Unavailable"],
    [{ hasCredits: true, unlimited: true, balance: "100" }, "Unlimited"],
    [null, "Unavailable"],
    [undefined, "Unavailable"],
  ] as const)("displays credits state %j as %s", (credits, expected) => {
    render(hero({ ...limits, credits }));

    expect(screen.getByTestId("credits-balance")).toHaveTextContent(`Credits balance: ${expected}`);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Simulated data")).not.toBeInTheDocument();
  });

  it("updates the balance and clears the simulated label when real data arrives", () => {
    const { rerender } = render(hero({ ...limits, credits: { hasCredits: true, unlimited: false, balance: "1250.5" }, creditsIsMock: true }));
    expect(screen.getByTestId("credits-balance")).toHaveTextContent("1250.5");
    expect(screen.getByText("Simulated data")).toBeInTheDocument();

    rerender(hero({ ...limits, credits: { hasCredits: false, unlimited: false, balance: "0" } }));
    expect(screen.getByTestId("credits-balance")).toHaveTextContent("Credits balance: 0");
    expect(screen.queryByText("Simulated data")).not.toBeInTheDocument();
  });

  it.each([
    ["en", "Credits balance", "Unavailable", "Simulated data"],
    ["zh", "Credits 余额", "暂不可用", "模拟数据"],
    ["zh-Hant", "Credits 餘額", "暫時無法取得", "模擬資料"],
    ["ja", "クレジット残高", "取得できません", "シミュレーションデータ"],
  ])("translates unknown simulated credits in %s", async (language, label, unavailable, mock) => {
    await i18n.changeLanguage(language);
    render(hero({ ...limits, credits: null, creditsIsMock: true }));

    expect(screen.getByTestId("credits-balance")).toHaveTextContent(`${label}: ${unavailable}`);
    expect(screen.getByText(mock)).toBeInTheDocument();
  });

  it("waits for account data before showing the balance", () => {
    render(hero(null));
    expect(screen.queryByTestId("credits-balance")).not.toBeInTheDocument();
  });
});
