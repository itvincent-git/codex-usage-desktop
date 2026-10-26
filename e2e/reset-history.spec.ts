import { $, browser, expect } from "@wdio/globals";
import type { CodexResetAnnouncement } from "../src/lib/api";

describe("Codex Reset timeline history", () => {
  let previousLanguage: string | null;

  before(async () => {
    previousLanguage = await browser.execute(() => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      return previous;
    });
    await browser.refresh();
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
    const source = $('[data-testid="reset-area"]').$("a=codex-reset.com");
    await expect(source).toHaveAttribute("href", "https://codex-reset.com/");
    await expect($('[role="dialog"]')).not.toExist();
    for (const width of [1100, 1440]) {
      await browser.setWindowSize(width, 960);
      const area = $('[data-testid="reset-area"]');
      await area.scrollIntoView({ block: "center" });
      expect(await area.execute((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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
