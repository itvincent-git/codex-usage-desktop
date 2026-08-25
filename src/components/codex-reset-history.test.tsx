// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexResetHistoryModal } from "./codex-reset-history";
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
    ]);
    vi.mocked(openUrl).mockResolvedValue();
  });

  it("loads the last 30 days and opens the announcement source", async () => {
    render(<StrictMode><CodexResetHistoryModal onClose={() => {}} /></StrictMode>);

    expect(await screen.findByText("Reset has been propagated.")).toBeInTheDocument();
    expect(fetchCodexResetHistory).toHaveBeenCalledWith(30);
    expect(fetchCodexResetHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Regular reset")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /@thsottiaux/ }));
    expect(openUrl).toHaveBeenCalledWith("https://x.com/thsottiaux/status/2091688655828246890");
  });
});
