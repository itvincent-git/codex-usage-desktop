import { $, browser, expect } from "@wdio/globals";
import type { OverviewResponse, ProjectSessionDaysResponse, SessionDetailRow } from "../src/lib/api";

describe("project day quota summary", () => {
  it("shows quota usage between the date and totals and keeps it visible after collapse", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "zh"));
      await browser.refresh();
      await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
      await $('[data-testid="projects-nav-tab"]').click();
      await $('[data-testid="project-comparison"] tbody tr[role="button"]').waitForDisplayed({ timeout: 90_000 });
      const candidate = await browser.execute(async () => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        const overview = await runtime.invoke<OverviewResponse>("fetch_overview", { range: "30d" });
        for (const project of overview.projects) {
          const page = await runtime.invoke<ProjectSessionDaysResponse>("fetch_project_session_days", { project: project.project, range: "30d", query: "", before: null });
          for (const day of page.days) {
            const sessions = await runtime.invoke<SessionDetailRow[]>("fetch_project_day_sessions", { project: project.project, range: "30d", date: day.date, query: "" });
            if (sessions.some((session) => session.dailyUsage.some((usage) => usage.quotaUsage?.fiveHour.length && usage.quotaUsage.weekly.length))) {
              return { project: project.project, date: day.date };
            }
          }
        }
        throw new Error("Quota layout regression needs a project day with five-hour and weekly quota snapshots");
      });
      const rowIndex = await browser.execute((path) => [...document.querySelectorAll('[data-testid="project-comparison"] tbody tr[role="button"]')].findIndex((row) => row.querySelector("td > p")?.textContent === path), candidate.project);
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      const row = $(`[data-testid="project-comparison"] tbody tr[role="button"]:nth-child(${rowIndex + 1})`);
      await row.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await row.click();
      const group = $(`#date-group-${candidate.date}`);
      await group.waitForExist();
      const toggle = group.$("button");
      await toggle.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      const summary = toggle.$('[data-testid="day-quota-summary"]');
      await summary.waitForDisplayed({ timeout: 90_000 });
      await expect(summary).toHaveText(expect.stringContaining("5h 使用了"));
      await expect(summary).toHaveText(expect.stringContaining("周 使用了"));
      expect(await group.getText()).not.toContain("当天额度消耗");
      await expect(group.$$('[data-testid="day-quota-summary"]')).toBeElementsArrayOfSize(1);
      const layout = await toggle.execute((header) => {
        const date = header.firstElementChild!.getBoundingClientRect();
        const quota = header.querySelector('[data-testid="day-quota-summary"]')!.getBoundingClientRect();
        const totals = header.lastElementChild!.lastElementChild!.getBoundingClientRect();
        return { between: quota.left >= date.right && quota.right <= totals.left, sameLine: quota.top < date.bottom && quota.bottom > date.top };
      });
      expect(layout.between).toBe(true);
      expect(layout.sameLine).toBe(true);
      await group.$('[data-testid="session-card"]').waitForDisplayed();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(summary).toBeDisplayed();
      await expect(group.$('[data-testid="session-card"]')).not.toBeDisplayed();
      await toggle.click();
      await expect(group.$('[data-testid="session-card"]')).toBeDisplayed();
      await expect(summary).toBeDisplayed();
      await browser.keys("Escape");
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
