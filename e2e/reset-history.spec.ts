import { $, browser, expect } from "@wdio/globals";
import type { CodexResetAnnouncement } from "../src/lib/api";

describe("Codex Reset timeline history", () => {
  let previousLanguage: string | null;

  before(async () => {
    // Finish startup IPC before reloading so Tauri callbacks remain available.
    await $('[data-reset-overview-day]').waitForExist({ timeout: 90_000 });
    previousLanguage = await browser.execute(() => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      return previous;
    });
    await browser.refresh();
    await $('[data-reset-overview-day]').waitForExist({ timeout: 90_000 });
  });

  after(async () => {
    await browser.execute((language) => {
      if (language === null) localStorage.removeItem("language");
      else localStorage.setItem("language", language);
    }, previousLanguage);
  });

  it("loads the public timeline through native IPC and opens the attributed history", async () => {
    const data = await browser.execute(async () => {
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
      }).__TAURI_INTERNALS__;
      const [latest, history] = await Promise.all([
        runtime.invoke<CodexResetAnnouncement | null>("fetch_latest_codex_reset"),
        runtime.invoke<CodexResetAnnouncement[]>("fetch_codex_reset_history", { days: 30 }),
      ]);
      return { latest, history };
    });
    expect(data.latest?.resetType).toBe("regular");
    expect(data.history.length).toBeGreaterThan(0);
    expect(data.history.find((reset) => reset.resetType === "regular")).toEqual(data.latest);
    expect(data.history.every((reset) => ["regular", "banked"].includes(reset.resetType))).toBe(true);

    const openHistory = $('button[aria-label="View token resets from the last 30 days"]');
    await openHistory.waitForDisplayed({ timeout: 90_000 });
    await expect($('[data-testid="reset-area"]').$("a=codex-reset.com")).not.toExist();
    const calendar = openHistory.$('[role="list"][aria-label="Token resets over the last 30 days"]');
    await expect(calendar.$$('[data-reset-overview-day]')).toBeElementsArrayOfSize(30);
    const bankedDays = await browser.execute((history) => {
      return history.filter((reset) => reset.resetType === "banked").map((reset) => {
        const date = new Date(reset.announcedAt);
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const day = document.querySelector(`[data-reset-overview-day][title^="${localDate}:"]`);
        if (!day) return true; // The native rolling window may include the preceding calendar day.
        return day.getAttribute("data-reset-type") === "banked"
          ? day.classList.contains("bg-sky-300")
          : day.getAttribute("data-reset-type") === "mixed" && day.querySelector(".bg-sky-300") !== null;
      });
    }, data.history);
    expect(bankedDays.every(Boolean)).toBe(true);
    await expect($('[role="dialog"]')).not.toExist();
    for (const width of [1100, 1440]) {
      await browser.setWindowSize(width, 960);
      const area = $('[data-testid="reset-area"]');
      await area.scrollIntoView({ block: "center" });
      expect(await area.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const layout = await calendar.execute((element) => {
        const cells = Array.from(element.children).map((cell) => cell.getBoundingClientRect());
        const days = Array.from(element.querySelectorAll("[data-reset-overview-day]"));
        return {
          columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
          weeklyRows: cells.slice(7).every((cell, index) => cell.top > cells[index].top && Math.abs(cell.left - cells[index].left) < 1),
          firstDay: days[0].getAttribute("title")?.slice(0, 10),
          lastDay: days[days.length - 1].getAttribute("title")?.slice(0, 10),
          blocksOnly: days.every((day) => {
            const box = day.getBoundingClientRect();
            const style = getComputedStyle(day);
            return day.textContent === "" && box.width > box.height && style.borderRadius === "3px" && style.borderWidth === "0px";
          }),
        };
      }) as { columns: number; weeklyRows: boolean; firstDay: string; lastDay: string; blocksOnly: boolean };
      expect(layout.columns).toBe(7);
      expect(layout.weeklyRows).toBe(true);
      expect(layout.blocksOnly).toBe(true);
      const textColors = await openHistory.execute((element) => {
        const status = element.querySelector('[data-testid="latest-reset-status"]')!;
        const relative = element.querySelector('[data-testid="latest-reset-relative-time"]')!;
        const timestamp = element.querySelector("time")!;
        const type = element.querySelector('[data-testid="latest-reset-type"]')!;
        const elapsed = Date.now() - Date.parse(timestamp.dateTime);
        const recent = elapsed >= 0 && elapsed <= 24 * 60 * 60 * 1000;
        return {
          distinctDetails: new Set([relative, timestamp, type].map((part) => getComputedStyle(part).color)).size === 3,
          statusMatchesRecency: status.classList.contains(recent ? "text-emerald-700" : "text-muted-foreground"),
          recentStatusEmphasized: !recent || (getComputedStyle(status).color === getComputedStyle(relative).color && getComputedStyle(status).backgroundColor !== "rgba(0, 0, 0, 0)"),
        };
      }) as { distinctDetails: boolean; statusMatchesRecency: boolean; recentStatusEmphasized: boolean };
      expect(textColors.distinctDetails).toBe(true);
      expect(textColors.statusMatchesRecency).toBe(true);
      expect(textColors.recentStatusEmphasized).toBe(true);
      await expect(calendar).toHaveText("");
      const range = await browser.execute(() => {
        const today = new Date();
        const first = new Date(today);
        first.setDate(first.getDate() - 29);
        const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return { first: format(first), last: format(today) };
      });
      expect(layout.firstDay).toBe(range.first);
      expect(layout.lastDay).toBe(range.last);
      await area.saveScreenshot(`/tmp/codex-reset-history-overview-${width}.png`);
    }
    await openHistory.click();

    const dialog = $('[role="dialog"][aria-labelledby="codex-reset-history-title"]');
    await dialog.waitForDisplayed();
    await expect(dialog.$('a=codex-reset.com')).toHaveAttribute("href", "https://codex-reset.com/");
    await expect(dialog.$('ol li')).toHaveText(expect.stringContaining(data.history[0].text));
    await expect(dialog.$$('[data-testid="reset-history-day"]')).toBeElementsArrayOfSize(30);
    await browser.saveScreenshot("/tmp/codex-reset-history.png");
    await dialog.$('button[aria-label="Close"]').click();
    await expect(dialog).not.toExist();
    await expect(openHistory).toBeDisplayed();
  });
});
