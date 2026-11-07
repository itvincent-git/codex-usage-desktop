// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // jsdom does not implement the native dialog API.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  list = { accounts: [account("a", "plus", 80), account("b", "pro", 25)], environment: "/isolated/codex", authContext: "context-a", currentIdentity: { userId: "user-a", workspaceId: "shared-workspace" }, switchError: null, recoveryConflict: false };
  vi.mocked(api.listCodexAccounts).mockImplementation(async () => structuredClone(list));
});
const card = (email: string) => screen.getByRole("heading", { name: email }).closest("article")!;

describe("saved Codex accounts", () => {
  it.each(["a", "b"])("requires confirmation before removing account %s", async (id) => {
    vi.mocked(api.removeCodexAccount).mockImplementation(async (removedId) => { list.accounts = list.accounts.filter((a) => a.id !== removedId); });
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: `${id}@example.test` });
    const openRemoval = async () => {
      await userEvent.click(within(card(`${id}@example.test`)).getByRole("button", { name: "More" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
      return within(screen.getByRole("alertdialog", { name: "Remove" }));
    };
    const dialog = await openRemoval();
    expect(dialog.getByText(`${id}@example.test`)).toBeVisible();
    expect(dialog.getByText(id === "a" ? "Remove this saved account and its cache? Codex will remain signed in to this account." : "Remove this saved account and its cache?")).toBeVisible();
    expect(api.removeCodexAccount).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(card(`${id}@example.test`)).toBeVisible();
    expect(api.removeCodexAccount).not.toHaveBeenCalled();
    await openRemoval();
    fireEvent(screen.getByRole("alertdialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.removeCodexAccount).not.toHaveBeenCalled();
    const reopened = await openRemoval();
    await userEvent.click(reopened.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: `${id}@example.test` })).not.toBeInTheDocument());
    expect(api.removeCodexAccount).toHaveBeenCalledExactlyOnceWith(id);
  });

  it("allows retrying when copying an authorization code fails", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValue(undefined);
    list.loginTask = { id: "device-login", state: "running", authorizationUrl: "https://auth.openai.com/codex/device", deviceCode: "1234-56789", accountId: null, error: null };
    vi.mocked(api.getCodexAccountLogin).mockResolvedValue(list.loginTask);
    render(<AccountsPage />);
    await user.click(await screen.findByRole("button", { name: "Copy authorization code" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy authorization code" }));
    expect(writeText).toHaveBeenLastCalledWith("1234-56789");
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows distinct users in the same workspace and refreshes without switching", async () => {
    let resolve!: (status: api.AccountStatus) => void;
    vi.mocked(api.fetchCodexAccountStatus).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    expect(within(card("a@example.test")).getByText("plus")).toBeInTheDocument();
    expect(within(card("b@example.test")).getByText("pro")).toBeInTheDocument();
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Refresh" }));
    expect(within(card("b@example.test")).getByText(/Refreshing…/)).toBeInTheDocument();
    expect(within(card("a@example.test")).getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(api.switchCodexAccount).not.toHaveBeenCalled();
    await act(async () => resolve({ ...list.accounts[1].status!, data: data("pro", 60) }));
    expect(within(card("b@example.test")).getByRole("meter", { name: "5-hour quota" })).toHaveAttribute("aria-valuenow", "60");
    expect(within(card("a@example.test")).getByRole("meter", { name: "5-hour quota" })).toHaveAttribute("aria-valuenow", "80");
  });
  it("retains successful data and shows independent errors without inventing zero or inactive values", async () => {
    list.accounts[1].status = { ...list.accounts[1].status!, errors: { subscription: "accountNetworkError", limits: "accountRateLimited" } };
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByRole("meter", { name: "5-hour quota" })).toHaveAttribute("aria-valuenow", "25");
    expect(b.getByText("Subscription unconfirmed")).toBeInTheDocument();
    expect(b.getByText("17.5")).toBeInTheDocument();
    fireEvent.click(b.getByText(/Data details/));
    expect(b.getByText(/Stale data/)).toBeInTheDocument();
    expect(b.getByText(/Rate limited/)).toBeInTheDocument();
    expect(b.getByText(/Subscription: Could not update/)).toBeInTheDocument();
  });
  it("shows the applicable monthly window for a free account", async () => {
    list.accounts[1].status!.data = data("free", 40);
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByText("Monthly quota")).toBeInTheDocument();
    expect(b.getByRole("meter", { name: "Monthly quota" })).toHaveAttribute("aria-valuenow", "40");
    expect(b.queryByRole("meter", { name: "5-hour quota" })).not.toBeInTheDocument();
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
    vi.mocked(api.removeCodexAccount).mockImplementation(async () => { list.accounts = list.accounts.filter((a) => a.id !== "b"); });
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const previous = list.accounts[1].status!;
    fireEvent.click(within(card("b@example.test")).getByRole("button", { name: "Refresh" }));
    await userEvent.click(within(card("b@example.test")).getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
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

describe("account card presentation", () => {
  it.each(["matching", "different", "missing"])("shows %s update times without hiding older or missing data", async (state) => {
    const status = list.accounts[0].status!;
    status.updatedAt = { limits: "2030-01-01T00:00:00.100Z", subscription: "2030-01-01T00:00:00.200Z", resetCredits: "2030-01-01T00:00:00.300Z" };
    if (state === "different") {
      status.updatedAt.subscription = "2029-12-31T23:00:00Z";
      status.errors.subscription = "accountNetworkError";
    }
    if (state === "missing") delete status.updatedAt.subscription;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    const a = within(card("a@example.test"));
    fireEvent.click(a.getByText(/Data details/));
    if (state === "matching") {
      expect(a.getByText(`Data updated · ${new Date(status.updatedAt.limits).toLocaleString("en")}`)).toBeVisible();
      expect(a.queryByText(/Quota and balance updated/)).not.toBeInTheDocument();
      expect(a.queryByText(/Subscription info updated/)).not.toBeInTheDocument();
      expect(a.queryByText(/Reset credits updated/)).not.toBeInTheDocument();
    } else {
      expect(a.queryByText(/^Data updated/)).not.toBeInTheDocument();
      expect(a.getByText(/^Quota and balance updated/)).toBeVisible();
      expect(a.getByText(/^Reset credits updated/)).toBeVisible();
      if (state === "different") expect(a.getByText(`Subscription info updated · ${new Date(status.updatedAt.subscription).toLocaleString("en")}`)).toBeVisible();
      else expect(a.queryByText(/Subscription info updated/)).not.toBeInTheDocument();
    }
  });

  it.each([
    [{ hasCredits: false, unlimited: false, balance: "0" }, "0"],
    [{ hasCredits: true, unlimited: false, balance: "1250.500001" }, "1250.500001"],
    [{ hasCredits: true, unlimited: true, balance: null }, "Unlimited"],
    [{ hasCredits: true, unlimited: false, balance: null }, "Unknown"],
  ])("displays credits balance %j without assuming a currency", async (credits, expected) => {
    list.accounts[0].status!.data!.credits = credits;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    const balance = within(card("a@example.test")).getByText("Credits balance").nextElementSibling;
    expect(balance?.textContent).toBe(expected);
  });

  it("shows workspace names and personal workspace labels without exposing workspace IDs", async () => {
    list.accounts[1].status!.data!.workspaceName = "Example workspace";
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    expect(within(card("a@example.test")).getByText("Personal workspace")).toBeInTheDocument();
    expect(within(card("b@example.test")).getByText("Example workspace")).toBeInTheDocument();
    expect(screen.queryByText("shared-workspace")).not.toBeInTheDocument();
    expect(screen.queryByText(/Credentials are stored locally/)).not.toBeInTheDocument();
    expect(document.querySelector(".accounts-environment")).toBeNull();
  });
  it.each([
    ["team", "Standard seat"],
    ["self_serve_business_prolite", "Premium seat"],
    ["self_serve_business_usage_based", "Codex seat"],
  ])("shows the seat level for %s", async (plan, seat) => {
    list.accounts[1].status!.data!.membershipLevel = plan;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    expect(within(card("b@example.test")).getByText(`Team · ${seat}`)).toBeInTheDocument();
    expect(within(card("b@example.test")).getByText("Workspace unavailable")).toBeInTheDocument();
  });
  it("uses remaining quota and the existing 30 percent warning boundary", async () => {
    list.accounts[0].status!.data = data("plus", 30);
    list.accounts[1].status!.data = data("pro", 29.9);
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const a = within(card("a@example.test"));
    const b = within(card("b@example.test"));
    expect(a.queryByText(/Low remaining quota/)).not.toBeInTheDocument();
    expect(b.getByText(/Low remaining quota/)).toBeInTheDocument();
    expect(b.getByRole("meter", { name: "5-hour quota" }).firstElementChild).toHaveStyle({ width: "30%" });
    expect(a.getByRole("button", { name: "Current account" })).toBeDisabled();
  });
  it("keeps unknown quotas and balances distinct from zero", async () => {
    list.accounts[1].status!.data = null;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByRole("meter", { name: "5-hour quota" })).not.toHaveAttribute("aria-valuenow");
    expect(b.getByText("Credits balance").nextElementSibling).toHaveTextContent("Unknown");
    expect(b.queryByText("Inactive")).not.toBeInTheDocument();
  });
  it("marks only failed parts as cached and keeps renewal cancellation separate from subscription status", async () => {
    const status = list.accounts[1].status!;
    status.errors = { resetCredits: "accountNetworkError" };
    status.data!.subscriptionWillRenew = false;
    status.data!.resetCreditsAvailableCount = 2;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByText("Active")).toBeInTheDocument();
    expect(b.getByText(/Does not renew/)).toBeInTheDocument();
    expect(b.getByText("Last reset credits")).toBeInTheDocument();
    expect(b.getByText("Credits balance")).toBeInTheDocument();
    expect(b.getByRole("meter", { name: "5-hour quota" }).closest("section")).toHaveClass("account-quota-low");
    expect(b.getByRole("status")).toHaveTextContent("Reset credits");
  });
  it("uses the oldest part timestamp and exposes relogin while keeping cached data", async () => {
    const status = list.accounts[1].status!;
    status.updatedAt.subscription = new Date(Date.now() - 3 * 3600_000).toISOString();
    status.needsLogin = true;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "b@example.test" });
    const b = within(card("b@example.test"));
    expect(b.getByText(/3 hours ago · Data details/)).toBeInTheDocument();
    expect(b.getByText("Subscription unconfirmed")).toBeInTheDocument();
    expect(b.getByRole("meter", { name: "5-hour quota" })).toHaveAttribute("aria-valuenow", "25");
    expect(b.getByRole("meter", { name: "5-hour quota" }).closest("section")).toHaveClass("account-quota-stale");
    expect(b.queryByRole("button", { name: "Switch Codex sign-in" })).not.toBeInTheDocument();
    vi.mocked(api.startCodexAccountLogin).mockResolvedValue({ id: "login", state: "completed", authorizationUrl: null, deviceCode: null, accountId: "b", error: null });
    await userEvent.click(b.getByRole("button", { name: "Sign in again" }));
    expect(api.startCodexAccountLogin).toHaveBeenCalledWith(false, "b");
  });
  it("expands reset credit expiries from the available count", async () => {
    list.accounts[0].status!.data!.resetCreditsAvailableCount = 2;
    list.accounts[0].status!.data!.resetCredits = [{ id: "one", expiresAt: "2030-01-01T00:00:00Z" }];
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    const a = within(card("a@example.test"));
    const expiry = a.getByText(/Reset credit expires/);
    expect(expiry).not.toBeVisible();
    fireEvent.click(a.getByLabelText("Reset credits · 2 available"));
    expect(expiry).toBeVisible();
    expect(a.getByText("Expiration details were not returned for 1 more credits")).toBeVisible();
    fireEvent.click(a.getByLabelText("Reset credits · 2 available"));
    expect(expiry).not.toBeVisible();
  });
  it.each([0, null])("shows an explicit reset details state for count %s", async (count) => {
    list.accounts[0].status!.data!.resetCreditsAvailableCount = count;
    render(<AccountsPage />);
    await screen.findByRole("heading", { name: "a@example.test" });
    const a = within(card("a@example.test"));
    const text = count === 0 ? "No reset credits available" : "Expiration details are temporarily unavailable";
    expect(a.getByText(text)).not.toBeVisible();
    fireEvent.click(a.getByLabelText(`Reset credits · ${count === 0 ? "0 available" : "Unknown"}`));
    expect(a.getByText(text)).toBeVisible();
  });
});
