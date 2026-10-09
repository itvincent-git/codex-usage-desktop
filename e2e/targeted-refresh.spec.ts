import { $, browser, expect } from "@wdio/globals";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OverviewResponse, SessionDetailRow } from "../src/lib/api";

// CODEX_USAGE_REFRESH_E2E=1 isolates both the Codex home and the application database.
describe("targeted modal refresh", () => {
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
    await $('[data-testid="projects-nav-tab"]').click();
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
    appendFileSync(target, encode([
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: "Appended reply from session refresh" } }, usage(400),
    ]));
    appendFileSync(unrelated, encode([usage(9000)]));
    const refreshSession = detail.$('button=Refresh this session');
    await refreshSession.waitForEnabled();
    await refreshSession.click();
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
    await refreshProject.click();
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
  }).timeout(240_000);
});
