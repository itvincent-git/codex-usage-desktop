import { $, browser, expect } from "@wdio/globals";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse, SessionDetailRow } from "../src/lib/api";

// CODEX_USAGE_REFRESH_E2E=1 isolates both the Codex home and the application database.
describe("keyboard navigation and targeted refresh", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("refreshes session content, project dates and dashboard totals without scanning unrelated usage", async () => {
    const home = process.env.CODEX_HOME!;
    const sessions = join(home, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const target = join(sessions, "target.jsonl");
    const unrelated = join(sessions, "unrelated.jsonl");
    const encode = (entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    const usage = (tokens: number) => ({ timestamp, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens, output_tokens: 10, total_tokens: tokens + 10 } } } });
    const log = (project: string, title: string, tokens: number) => encode([
      { timestamp, type: "session_meta", payload: { cwd: project } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5", cwd: project } },
      { timestamp, type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      { timestamp, type: "event_msg", payload: { type: "user_message", message: title } },
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: "Original reply" } },
      usage(tokens),
    ]);
    writeFileSync(target, log("/targeted-refresh", "Refresh target", 100));
    writeFileSync(unrelated, log("/unrelated-refresh", "Unrelated target", 200));
    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      localStorage.setItem("auto_refresh_interval_minutes", "60");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });
    await browser.refresh();
    await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    for (const [index, page] of ["dashboard", "sessions", "models", "daily", "monthly", "projects"].entries()) {
      await browser.keys([modifier, String(index + 1)]);
      await expect($(`[data-testid="${page}-nav-tab"]`)).toHaveAttribute("aria-selected", "true");
    }
    await browser.keys([modifier, ","]);
    await expect($("h1=Settings")).toBeDisplayed();
    await $("button=Back").click();
    await expect($('[data-testid="projects-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    await browser.keys([modifier, "Shift", "l"]);
    await expect($('button[aria-label="Expand sidebar"]')).toBeDisplayed();
    await browser.keys([modifier, "Shift", "l"]);
    await expect($('button[aria-label="Collapse sidebar"]')).toBeDisplayed();
    appendFileSync(unrelated, encode([usage(9000)]));
    const rangeButton = $('button[aria-label="Select time range"]');
    await rangeButton.waitForDisplayed();
    // The embedded driver does not emit the pointerdown event Radix menus require.
    await rangeButton.execute((element) => element.focus());
    await browser.keys("Enter");
    await $('[role="menu"]').waitForDisplayed();
    const customRange = $('//*[@role="menuitem" and normalize-space(.)="Select Custom Range..."]');
    await customRange.waitForDisplayed();
    await customRange.click();
    const rangeDialog = $('[role="dialog"][aria-label="Select Custom Range"]');
    await rangeDialog.waitForDisplayed();
    await expect(rangeDialog.$('button[aria-label="Close custom range modal"]')).toBeFocused();
    await browser.keys([modifier, "r"]);
    await browser.keys([modifier, "1"]);
    await expect($('[data-testid="projects-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    await browser.keys("Escape");
    await rangeDialog.waitForExist({ reverse: true });
    await browser.execute(() => { (window as unknown as { shortcutMarker: string }).shortcutMarker = "preserved"; });
    await $('[data-testid="project-comparison"] tbody tr[role="button"]').waitForDisplayed({ timeout: 90_000 });
    const projectRowSelector = '//tr[@role="button" and .//p[text()="/targeted-refresh"]]';
    const row = $(projectRowSelector);
    await row.click();
    const project = $('[aria-labelledby="modal-project-title"]');
    await project.waitForDisplayed();
    const targetCard = project.$('[data-testid="session-card"]:has(h3[title="Refresh target"])');
    await targetCard.waitForDisplayed();
    await targetCard.click();
    const detail = $('[aria-labelledby="session-detail-title"]');
    await detail.waitForDisplayed();
    await expect(detail).toHaveText(expect.stringContaining("Original reply"));
    await browser.keys([modifier, "1"]);
    await expect(detail).toBeDisplayed();
    await expect($('[data-testid="projects-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    await browser.keys([modifier, "f"]);
    const searchInput = detail.$('input[type="search"]');
    await expect(searchInput).toBeFocused();
    await searchInput.setValue("Original");
    await browser.keys([modifier, "f"]);
    expect(await searchInput.execute((element) => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([0, 8]);
    await browser.keys("Escape");
    await expect(searchInput).toHaveValue("");
    await expect(detail).toBeDisplayed();
    await browser.keys("Escape");
    await expect(searchInput).not.toExist();
    await expect(detail).toBeDisplayed();
    appendFileSync(target, encode([
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: "Appended reply from session refresh" } }, usage(400),
    ]));
    const refreshSession = detail.$('button=Refresh this session');
    await refreshSession.waitForEnabled();
    await browser.keys([modifier, "r"]);
    await expect(detail).toHaveText(expect.stringContaining("Appended reply from session refresh"));
    await expect(detail.$('[aria-label="Session summary"]')).toHaveText(expect.stringContaining("520"));
    await browser.keys("Escape");
    await detail.waitForExist({ reverse: true });
    await expect(project.$('[data-testid="project-modal-header"]')).toHaveText(expect.stringContaining("520"));
    await expect(project.$('[data-testid="session-card"]')).toHaveText(expect.stringContaining("520"));
    const inspectCache = () => browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      return {
        sessions: await runtime.invoke<SessionDetailRow[]>("fetch_session_details"),
        overview: await runtime.invoke<OverviewResponse>("fetch_overview", { range: "30d" }),
      };
    });
    const afterSession = await inspectCache();
    expect(afterSession.sessions.find((session) => session.path === unrelated)!.totalTokens).toBe(210);
    expect(afterSession.overview.totals.totalTokens).toBe(730);
    expect(afterSession.overview.totals.costUSD).toBeGreaterThan(0);
    writeFileSync(join(sessions, "new.jsonl"), log("/targeted-refresh", "New project session", 300));
    appendFileSync(target, encode([
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: "Appended reply from project refresh" } }, usage(100),
    ]));
    const day = afterSession.sessions.find((session) => session.path === target)!.dailyUsage[0].date;
    const dayToggle = project.$(`#date-group-${day} > button`);
    await expect(dayToggle).toHaveAttribute("aria-expanded", "true");
    const refreshProject = project.$('button=Refresh project sessions');
    await refreshProject.waitForEnabled();
    await browser.keys([modifier, "r"]);
    await project.$('[data-testid="session-card"]:has(h3[title="New project session"])').waitForDisplayed();
    await expect(dayToggle).toHaveAttribute("aria-expanded", "true");
    await expect(project.$('[data-testid="project-modal-header"]')).toHaveText(expect.stringContaining("940"));
    const afterProject = await inspectCache();
    expect(afterProject.sessions.find((session) => session.path === unrelated)!.totalTokens).toBe(210);
    expect(afterProject.overview.totals.totalTokens).toBe(1150);
    const refreshedCard = project.$('[data-testid="session-card"]:has(h3[title="Refresh target"])');
    await refreshedCard.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    await refreshedCard.click();
    const reopenedDetail = $('[aria-labelledby="session-detail-title"]');
    await reopenedDetail.waitForDisplayed();
    await expect(reopenedDetail).toHaveText(expect.stringContaining("Appended reply from project refresh"));
    await browser.keys("Escape");
    await reopenedDetail.waitForExist({ reverse: true });
    await browser.keys("Escape");
    await project.waitForExist({ reverse: true });
    await expect($(projectRowSelector)).toHaveText(expect.stringContaining("940"));
    await browser.keys([modifier, "r"]);
    await browser.waitUntil(async () => (await inspectCache()).sessions.find((session) => session.path === unrelated)!.totalTokens === 9220);
    await expect($('[data-testid="projects-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    expect(await browser.execute(() => (window as unknown as { shortcutMarker: string }).shortcutMarker)).toBe("preserved");
  }).timeout(240_000);
});
