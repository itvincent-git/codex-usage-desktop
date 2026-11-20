import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("sidebar navigation", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("keeps navigation available beside dialogs and returns from fullscreen settings", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/sidebar-navigation" } },
      { type: "turn_context", payload: { model: "gpt-5", cwd: "/sidebar-navigation" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "sidebar-turn" } },
      { type: "event_msg", payload: { type: "user_message", message: "Sidebar navigation task" } },
      { type: "event_msg", payload: { type: "agent_message", message: "Sidebar navigation reply" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } },
    ];
    writeFileSync(join(sessions, "sidebar.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n") + "\n");
    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_collapsed", "false");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });
    await browser.refresh();
    const sidebar = $("[data-app-sidebar]");
    await sidebar.waitForDisplayed();
    const expandedWidth = await sidebar.getSize("width");
    await $('[data-testid="projects-nav-tab"]').click();
    const projectRow = $('//*[@data-testid="project-comparison"]//tr[@role="button"][contains(., "sidebar-navigation")]');
    await projectRow.waitForDisplayed({ timeout: 90_000 });
    await projectRow.click();
    const project = $('[aria-labelledby="modal-project-title"]');
    await project.waitForDisplayed();

    const expectContentBounds = async (selector: string) => {
      const bounds = await browser.execute((dialogSelector) => {
        const nav = document.querySelector("[data-app-sidebar]")!.getBoundingClientRect();
        const content = document.querySelector("[data-app-content]")!.getBoundingClientRect();
        const dialog = document.querySelector(dialogSelector)!.getBoundingClientRect();
        return { navRight: nav.right, contentLeft: content.left, dialogLeft: dialog.left, dialogRight: dialog.right, contentRight: content.right };
      }, selector);
      expect(bounds.dialogLeft).toBe(bounds.contentLeft);
      expect(bounds.dialogLeft).toBeGreaterThanOrEqual(bounds.navRight);
      expect(bounds.dialogRight).toBe(bounds.contentRight);
    };
    await expectContentBounds('[aria-labelledby="modal-project-title"]');
    await project.$("button=Load more days").waitForExist();
    await project.$("button=Load more days").execute((element) => element.focus());
    await browser.keys("Tab");
    expect(await browser.execute(() => document.activeElement?.getAttribute("aria-label"))).toBe("Collapse sidebar");
    await $('button[aria-label="Collapse sidebar"]').click();
    expect(await sidebar.getSize("width")).toBeLessThan(expandedWidth);
    await expectContentBounds('[aria-labelledby="modal-project-title"]');
    await expect($('[data-testid="projects-nav-tab"]')).toHaveAttribute("aria-label", "Project");
    await project.$('[data-testid="session-card"]').waitForDisplayed();
    await project.$('[data-testid="session-card"]').click();
    const detail = $('[aria-labelledby="session-detail-title"]');
    await detail.waitForDisplayed();
    await expect(detail).toHaveText(expect.stringContaining("Sidebar navigation reply"));
    await expectContentBounds('[aria-labelledby="session-detail-title"]');
    await browser.saveScreenshot("/tmp/codex-usage-sidebar-session.png");

    // Keyboard focus can leave the dialog for the persistent navigation.
    await sidebar.$('button[aria-label="Settings"]').execute((element) => element.focus());
    expect(await browser.execute(() => document.activeElement?.getAttribute("aria-label"))).toBe("Settings");
    await $('[data-testid="sessions-nav-tab"]').click();
    await detail.waitForExist({ reverse: true });
    const sessionTab = () => $('[data-session-tabs] [role="tab"]');
    await expect(sessionTab()).toHaveText("Sidebar navigation task");
    await expect(sessionTab()).toHaveAttribute("aria-selected", "false");
    await project.waitForExist({ reverse: true });
    await expect($('[data-testid="sessions-nav-tab"]')).toHaveAttribute("aria-selected", "true");

    await $('button[aria-label="Settings"]').click();
    await expect($("h1=Settings")).toBeDisplayed();
    await expect(sidebar).not.toBeExisting();
    await expect(sessionTab()).not.toBeExisting();
    expect(await $("[data-app-content]").getLocation("x")).toBe(0);
    await browser.saveScreenshot("/tmp/codex-usage-fullscreen-settings.png");
    await $("button=Back").click();
    await expect($('[data-testid="sessions-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    await expect(sessionTab()).toBeDisplayed();
    await expect($('button[aria-label="Expand sidebar"]')).toBeDisplayed();
    await $('button[aria-label="Expand sidebar"]').click();
    expect(await sidebar.getSize("width")).toBe(expandedWidth);

    // Switching pages also closes a project dialog without first opening a session.
    await $('[data-testid="projects-nav-tab"]').click();
    await projectRow.click();
    const reopenedProject = $('[aria-labelledby="modal-project-title"]');
    await reopenedProject.waitForDisplayed();
    await $('[data-testid="dashboard-nav-tab"]').click();
    await reopenedProject.waitForExist({ reverse: true });
    await expect($('[data-testid="dashboard-nav-tab"]')).toHaveAttribute("aria-selected", "true");
    await browser.saveScreenshot("/tmp/codex-usage-sidebar-dashboard.png");
  }).timeout(180_000);
});
