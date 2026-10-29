// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionCredits } from "./use-session-credits";
import { fetchSessionCredits, sessionCreditsIdentity, setSessionCreditsScope, type SessionCreditThread, type SessionCreditsResult } from "@/lib/api";

vi.mock("@/lib/api", () => ({ fetchSessionCredits: vi.fn(), sessionCreditsIdentity: vi.fn(), setSessionCreditsScope: vi.fn() }));
const row = { threadId: "a", dataStatus: "available" as const, balanceUsageCredits: "12.34", usageSource: "credits", dataAsOf: null, fetchedAt: "now", stale: false, isMock: false };
const result: SessionCreditsResult = { identity: "account-a", rows: [row], requestStatus: null, retryAt: null };
function Harness({ enabled = true, threads = [{ threadId: "a", modifiedAtMs: 1 }] }: { enabled?: boolean; threads?: SessionCreditThread[] }) {
  const credits = useSessionCredits(enabled, threads);
  return <><button onClick={credits.refresh}>refresh</button><output>{JSON.stringify(credits.rows)}</output><span>{credits.error}</span></>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setSessionCreditsScope).mockResolvedValue();
  vi.mocked(sessionCreditsIdentity).mockResolvedValue("account-a");
  vi.mocked(fetchSessionCredits).mockResolvedValue(result);
});
afterEach(cleanup);

describe("optional session credits", () => {
  it("does not load or read credentials while disabled", async () => {
    render(<Harness enabled={false} />);
    await act(async () => {});
    expect(fetchSessionCredits).not.toHaveBeenCalled();
    expect(sessionCreditsIdentity).not.toHaveBeenCalled();
  });
  it("deduplicates and sorts threads through StrictMode effects", async () => {
    const threads = [{ threadId: "b", modifiedAtMs: 1 }, { threadId: "a", modifiedAtMs: 1 }, { threadId: "a", modifiedAtMs: 2 }];
    const { rerender } = render(<StrictMode><Harness threads={threads} /></StrictMode>);
    await waitFor(() => expect(fetchSessionCredits).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchSessionCredits).mock.calls[0][0]).toEqual([{ threadId: "a", modifiedAtMs: 2 }, { threadId: "b", modifiedAtMs: 1 }]);
    rerender(<StrictMode><Harness threads={[...threads]} /></StrictMode>);
    await act(async () => {});
    expect(fetchSessionCredits).toHaveBeenCalledTimes(2);
  });
  it("hides late results after disabling and invalidates queued Rust work", async () => {
    let resolve!: (result: SessionCreditsResult) => void;
    vi.mocked(fetchSessionCredits).mockReturnValue(new Promise((done) => { resolve = done; }));
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(fetchSessionCredits).toHaveBeenCalledTimes(1));
    rerender(<Harness enabled={false} />);
    await act(async () => resolve(result));
    expect(screen.getByRole("status")).toHaveTextContent("{}");
    expect(fetchSessionCredits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setSessionCreditsScope).mock.calls.at(-1)?.[2]).toBe(false);
  });
  it("keeps old successful data after a loader error and marks it cached", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("12.34"));
    vi.mocked(fetchSessionCredits).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(screen.getByText("loadFailed")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent('"stale":true');
  });
  it("clears old identity data before publishing the new account", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("12.34"));
    vi.mocked(sessionCreditsIdentity).mockResolvedValue("account-b");
    vi.mocked(fetchSessionCredits).mockResolvedValue({ ...result, identity: "account-b", rows: [] });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("{}"));
  });
});
