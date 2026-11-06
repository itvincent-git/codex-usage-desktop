// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsPage } from "./accounts-page";
import * as api from "@/lib/codex-accounts";
import type { CodexLimitsResponse } from "@/lib/api";
import i18n from "@/i18n";

const events = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, fn: () => void) => { events.set(name, fn); return () => events.delete(name); }) }));
vi.mock("@/lib/codex-accounts");
vi.mock("@/lib/api", () => ({ openUrl: vi.fn() }));

function data(plan: string, remaining: number): CodexLimitsResponse {
  return { session: { usedPercent: 100 - remaining, remainingPercent: remaining, windowMinutes: 300, resetsAt: "2030-01-01T00:00:00Z" }, weekly: null, membershipLevel: plan, subscriptionActive: true, credits: { hasCredits: true, unlimited: false, balance: "17.5" }, updatedAt: new Date().toISOString(), source: "oauth" };
}
function account(id: string, plan: string, remaining: number): api.CodexAccount {
  const identity = { userId: `user-${id}`, workspaceId: "shared-workspace" };
  return { id, email: `${id}@example.test`, identity, current: id === "a", credentialVersion: 1, lastRefresh: null,
    status: { accountId: id, identity, credentialVersion: 1, data: data(plan, remaining), errors: {}, updatedAt: { limits: new Date().toISOString() }, needsLogin: false } };
}
let list: api.AccountList;
beforeEach(async () => {
  vi.resetAllMocks(); events.clear(); await i18n.changeLanguage("en");
  list = { accounts: [account("a", "plus", 80), account("b", "pro", 25)], environment: "/isolated/codex", authContext: "context-a", currentIdentity: { userId: "user-a", workspaceId: "shared-workspace" }, switchError: null, recoveryConflict: false };
  vi.mocked(api.listCodexAccounts).mockImplementation(async () => structuredClone(list));
});
const card = (email: string) => screen.getByRole("heading", { name: email }).closest("article")!;

describe("saved Codex accounts", () => {
  it("shows distinct users in the same workspace and refreshes without switching", async () => {
    let resolve!: (status: api.AccountStatus) => void;
    vi.mocked(api.fetchCodexAccountStatus).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    expect(within(card("a@example.test")).getByText("plus")).toBeInTheDocument();
    expect(within(card("b@example.test")).getByText("pro")).toBeInTheDocument();
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Refresh" }));
    expect(within(card("b@example.test")).getByText("Refreshing…")).toBeInTheDocument();
    expect(within(card("a@example.test")).getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(api.switchCodexAccount).not.toHaveBeenCalled();
    await act(async () => resolve({ ...list.accounts[1].status!, data: data("pro", 60) }));
    expect(within(card("b@example.test")).getByText(/60% remaining/)).toBeInTheDocument();
    expect(within(card("a@example.test")).getByText(/80% remaining/)).toBeInTheDocument();
  });
  it("retains successful data and shows independent errors without inventing zero or inactive values", async () => {
    list.accounts[1].status = { ...list.accounts[1].status!, errors: { subscription: "accountNetworkError", limits: "accountRateLimited" } };
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByText(/25% remaining/)).toBeInTheDocument();
    expect(b.getByText("Active")).toBeInTheDocument();
    expect(b.getByText("17.5")).toBeInTheDocument();
    expect(b.getByText(/Stale data/)).toBeInTheDocument();
    expect(b.getByText(/Rate limited/)).toBeInTheDocument();
    expect(b.getByText(/Subscription: Could not update/)).toBeInTheDocument();
  });
  it("shows the applicable monthly window for a free account", async () => {
    list.accounts[1].status!.data = data("free", 40);
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByText("Monthly usage limit")).toBeInTheDocument();
    expect(b.getByText(/40% remaining/)).toBeInTheDocument();
    expect(b.queryByText("5-Hour Limit")).not.toBeInTheDocument();
  });
  it("switches with the expected context and displays the restart requirement", async () => {
    vi.mocked(api.switchCodexAccount).mockResolvedValue({ verified: true, restartRequired: true, authContext: "context-b" });
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Switch Codex sign-in" }));
    await screen.findByText(/Restart related Codex CLI/);
    expect(api.switchCodexAccount).toHaveBeenCalledWith("b", "context-a");
  });
  it("does not resurrect a removed account from an in-flight query", async () => {
    let resolve!: (status: api.AccountStatus) => void;
    vi.mocked(api.fetchCodexAccountStatus).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.removeCodexAccount).mockImplementation(async () => { list.accounts = list.accounts.filter((a) => a.id !== "b"); });
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const previous = list.accounts[1].status!;
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Refresh" }));
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "b@example.test" })).not.toBeInTheDocument());
    await act(async () => resolve(previous));
    expect(screen.queryByRole("heading", { name: "b@example.test" })).not.toBeInTheDocument();
  });
  it("ignores a response from an older credential generation after re-login", async () => {
    let resolve!: (status: api.AccountStatus) => void;
    vi.mocked(api.fetchCodexAccountStatus).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const previous = list.accounts[1].status!;
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Refresh" }));
    list.accounts[1] = { ...list.accounts[1], credentialVersion: 2, status: { ...previous, credentialVersion: 2, data: data("new-plan", 70) } };
    await act(async () => events.get("codex-accounts-changed")!());
    await screen.findByText("new-plan");
    await act(async () => resolve(previous));
    expect(screen.getByText("new-plan")).toBeInTheDocument();
  });
});
