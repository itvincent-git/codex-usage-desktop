// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { UsageRecoveryCard } from "./usage-recovery-card";
import { ScanWaitNotice } from "./scan-wait-notice";
import { usageFailureKind } from "../lib/usage-recovery";
import { scheduleCacheRebuild } from "../lib/api";

vi.mock("../lib/api", () => ({ scheduleCacheRebuild: vi.fn() }));
const props = {
  scanning: false, pending: false, error: null, diagnostics: null, diagnosticsError: null,
  hasCachedData: true, busy: false, onRetry: vi.fn(), onDetect: vi.fn(), onChoose: vi.fn(), onExpandRange: vi.fn(),
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("actionable usage failures", () => {
  it.each([
    ["database disk image is malformed", "cacheCorrupt"],
    ["file is not a database", "cacheCorrupt"],
    ["database is locked", "cacheBusy"],
    ["database table is locked", "cacheBusy"],
    ["database or disk is full", "diskFull"],
    ["No space left on device", "diskFull"],
    ["attempt to write a readonly database", "cachePermission"],
    ["unable to open database file", "cachePermission"],
    ["Failed to parse session /logs/broken.jsonl: Invalid JSON at line 2", "sessionParseError"],
    ["Failed to read session /logs/broken.jsonl.zst: Unknown frame descriptor", "sessionReadError"],
    ["Cannot access Codex directory", null],
  ])("classifies %s as %s", (error, expected) => {
    expect(usageFailureKind(error)).toBe(expected);
  });

  it("shows file and line without expanding details, and does not suggest changing directories", () => {
    render(<UsageRecoveryCard {...props} error="Failed to parse session /logs/broken.jsonl: Invalid JSON at line 2" />);
    expect(screen.getByText("A session log could not be parsed")).toBeInTheDocument();
    expect(screen.getByText(/Failed to parse session/).closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/This scan did not replace existing usage/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Codex directory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back up and rebuild cache" })).not.toBeInTheDocument();
  });

  it("requires confirmation before scheduling corruption recovery", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(scheduleCacheRebuild).mockResolvedValue("/app-data/cache-backups");
    render(<UsageRecoveryCard {...props} error="file is not a database" />);
    const rebuild = screen.getByRole("button", { name: "Back up and rebuild cache" });
    fireEvent.click(rebuild);
    expect(scheduleCacheRebuild).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { fireEvent.click(rebuild); });
    expect(scheduleCacheRebuild).toHaveBeenCalledOnce();
    expect(screen.getByText(/Recovery is scheduled/)).toBeInTheDocument();
    expect(screen.getByText("/app-data/cache-backups")).toBeInTheDocument();
    expect(rebuild).toBeDisabled();
  });

  it.each(["database is locked", "database or disk is full", "attempt to write a readonly database"])("does not offer destructive recovery for %s", (error) => {
    render(<UsageRecoveryCard {...props} error={error} />);
    expect(screen.queryByRole("button", { name: "Back up and rebuild cache" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeEnabled();
  });

  it("shows the real elapsed wait after 30 seconds, allows diagnostic copying and clears on completion", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { rerender, unmount } = render(<ScanWaitNotice active diagnostics={null} />);
    expect(screen.queryByTestId("scan-wait-notice")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId("scan-wait-notice")).toHaveTextContent("30 seconds");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })); });
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({ elapsedSeconds: 30, status: "waitingForLocalData" });
    rerender(<ScanWaitNotice active={false} diagnostics={null} />);
    expect(screen.queryByTestId("scan-wait-notice")).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
