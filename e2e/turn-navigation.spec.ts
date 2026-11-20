import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";

describe("session turn navigation", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("keeps navigation beside the content and jumps to each turn's start and end", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "16");
    mkdirSync(sessions, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c3999";
    const name = `rollout-2026-10-16T09-00-00-${id}.jsonl`;
    const path = join(sessions, name);
    const timestamp = "2026-10-16T09:00:00Z";
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
    writeFileSync(path, [
      { type: "session_meta", payload: { id, cwd: "/turn-navigation-test" } },
      ...[1, 2, 3].flatMap((turn) => [
        { type: "turn_context", payload: { turn_id: `nav-${turn}`, model: "gpt-5" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: `nav-${turn}` } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "  # AGENTS.md instructions for /turn-navigation-test\n\n<INSTRUCTIONS>\nFollow repository guidelines.\n</INSTRUCTIONS>\n<environment_context>\n  <cwd>/turn-navigation-test</cwd>\n</environment_context>" }] } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/turn-navigation-test</cwd>\n</environment_context>" }] } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Navigate turn ${turn}\nCheck AGENTS.md\nThird prompt line\nFourth prompt line: verify that the full user message is available without the previous 140-character truncation.` }] } },
        ...Array.from({ length: 14 }, (_, step) => ({
          type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `Turn ${turn}, step ${step + 1}.\n\nChecking the replay navigation.\n\nThis content makes the turn taller than the viewport.` }] },
        })),
        { type: "event_msg", payload: { type: "task_complete", turn_id: `nav-${turn}` } },
      ]),
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    ].map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));

    const previousPreferences = await browser.execute(() => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "360");
      localStorage.setItem("sidebar_collapsed", "false");
      return previous;
    });
    try {
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      expect(detail.turns.map((turn) => turn.turnId)).toEqual(["nav-1", "nav-2", "nav-3"]);
      expect(detail.turns[0].userMessages[0].text).toContain("# AGENTS.md instructions for");

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${name.replace(/\.jsonl$/, "")}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      async function expectHeaderVisible() {
        const state = await browser.execute(() => {
          const dialog = document.querySelector('[aria-labelledby="session-detail-title"]')!;
          const header = dialog.querySelector("header")!;
          const title = dialog.querySelector("#session-detail-title")!.getBoundingClientRect();
          const close = document.querySelector('[data-session-tabs] button[aria-label^="Close tab:"]')!.getBoundingClientRect();
          const bounds = dialog.getBoundingClientRect();
          let outerScrolled = false;
          for (let ancestor = header.parentElement; ancestor; ancestor = ancestor.parentElement) {
            outerScrolled ||= ancestor.scrollTop !== 0;
          }
          return {
            titleVisible: title.height > 0 && title.top >= Math.max(0, bounds.top) && title.bottom <= Math.min(innerHeight, bounds.bottom),
            closeVisible: close.height > 0 && close.top >= 0 && close.bottom <= bounds.top,
            outerScrolled,
          };
        });
        expect(state).toEqual({ titleVisible: true, closeVisible: true, outerScrolled: false });
      }
      const navigation = dialog.$('nav[aria-label="Quick navigation"]');
      await navigation.waitForDisplayed();
      await dialog.$('p=This content makes the turn taller than the viewport.').waitForExist();
      await expectHeaderVisible();
      await expect(navigation.$$('button')).toBeElementsArrayOfSize(6);
      const layout = await browser.execute(() => {
        const element = document.querySelector('nav[aria-label="Quick navigation"]')!;
        const nav = element.getBoundingClientRect();
        const content = element.nextElementSibling!;
        const sections = Array.from(content.children);
        const viewport = document.querySelector('[data-testid="session-detail-scroll"]')!;
        return {
          sidebarWidth: document.querySelector('[data-app-sidebar]')!.getBoundingClientRect().width,
          hasGap: sections.every((section) => section.getBoundingClientRect().right + 15 <= nav.left),
          fitsViewport: nav.right <= viewport.getBoundingClientRect().right,
          overflows: content.scrollWidth > content.clientWidth || element.scrollWidth > element.clientWidth,
        };
      });
      expect(layout.sidebarWidth).toBe(360);
      expect(layout.hasGap).toBe(true);
      expect(layout.fitsViewport).toBe(true);
      expect(layout.overflows).toBe(false);
      const navigationText = await navigation.getText();
      expect(navigationText).not.toContain("AGENTS.md instructions");
      expect(navigationText).not.toContain("environment_context");
      expect(navigationText).toContain("Check AGENTS.md");
      for (const turn of [1, 2, 3]) {
        expect(navigationText).toContain(`Navigate turn ${turn}`);
        expect(navigationText).not.toContain(`nav-${turn}`);
      }
      for (const button of await navigation.$$('button')) {
        expect(await button.getText()).toBe("");
        await expect(button).not.toHaveAttribute("aria-label", /AGENTS\.md instructions|environment_context/);
        await expect(button).toHaveAttribute("title", /Navigate to (start|end) of turn/);
      }
      const firstStart = navigation.$('button[aria-label^="Navigate to start of turn nav-1"]');
      const firstEnd = navigation.$('button[aria-label^="Navigate to end of turn nav-1"]');
      const cardLayout = await browser.execute(() => {
        const button = document.querySelector('nav[aria-label="Quick navigation"] button')!;
        const card = button.parentElement!;
        const preview = card.querySelector("span")!;
        const [start, end] = Array.from(card.querySelectorAll("button")).map((element) => element.getBoundingClientRect());
        const bounds = card.getBoundingClientRect();
        return {
          previewLines: preview.clientHeight / parseFloat(getComputedStyle(preview).lineHeight),
          clampedLines: getComputedStyle(preview).webkitLineClamp,
          preservesLineBreaks: getComputedStyle(preview).whiteSpace === "pre-wrap",
          coversCard: start.left === bounds.left && start.right === bounds.right && start.top === bounds.top
            && start.bottom === end.top && end.left === bounds.left && end.right === bounds.right && end.bottom === bounds.bottom,
          fullPreview: preview.textContent,
        };
      });
      expect(cardLayout.previewLines).toBe(3);
      expect(cardLayout.clampedLines).toBe("3");
      expect(cardLayout.preservesLineBreaks).toBe(true);
      expect(cardLayout.coversCard).toBe(true);
      expect(cardLayout.fullPreview).toContain("without the previous 140-character truncation.");
      expect(await firstStart.$("span").execute((element) => getComputedStyle(element).opacity)).toBe("0");
      expect(await firstEnd.$("span").execute((element) => getComputedStyle(element).opacity)).toBe("0");

      await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_focus", { label: "main" }));
      await browser.waitUntil(() => browser.execute(() => document.hasFocus()));
      for (const position of ["start", "end"] as const) {
        const button = position === "start" ? firstStart : firstEnd;
        const other = position === "start" ? firstEnd : firstStart;
        // The embedded driver dispatches synthetic mouse events, which cannot activate CSS :hover.
        // Focus exercises the same direction indicator through its keyboard interaction instead.
        await button.execute((element) => (element as HTMLElement).focus({ preventScroll: true }));
        await browser.waitUntil(async () => button.$("span").execute((element) => getComputedStyle(element).opacity === "1"));
        await browser.waitUntil(async () => other.$("span").execute((element) => getComputedStyle(element).opacity === "0"));
        await expect(button.$("svg")).toHaveElementClass(position === "start" ? "lucide-arrow-up-to-line" : "lucide-arrow-down-to-line");
      }

      async function clickTurnHalf(turn: number, position: "start" | "end") {
        const selector = `nav[aria-label="Quick navigation"] button[aria-label^="Navigate to ${position} of turn nav-${turn}"]`;
        await $(selector).waitForStable();
        const point = await browser.execute((turn, position) => {
          const button = document.querySelector(`nav[aria-label="Quick navigation"] button[aria-label^="Navigate to ${position} of turn nav-${turn}"]`)!;
          const bounds = button.getBoundingClientRect();
          // Click the card's left edge, away from the direction icon.
          const x = Math.round(bounds.left + 4);
          const y = Math.round(bounds.top + bounds.height / 2);
          return { x, y, hit: document.elementFromPoint(x, y)?.closest("button") === button };
        }, turn, position);
        expect(point.hit).toBe(true);
        // Element-origin actions auto-scroll the sticky navigation before clicking it.
        await browser.action("pointer").move({ x: point.x, y: point.y }).down().up().perform();
      }

      for (const turn of [1, 2, 3]) {
        const toggle = dialog.$(`button*=Turn nav-${turn}`);
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const section = toggle.$("./parent::section");
        expect(await section.getSize("height")).toBeGreaterThan(await $('[data-testid="session-detail-scroll"]').getSize("height"));
        for (const position of ["end", "start"] as const) {
          await clickTurnHalf(turn, position);
          await browser.waitUntil(async () => section.execute((element, position) => {
            const viewport = document.querySelector('[data-testid="session-detail-scroll"]')!.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            // The summary collapses during scrolling, so verify the edge is visible near its destination.
            const gap = position === "start" ? bounds.top - viewport.top : viewport.bottom - bounds.bottom;
            return gap >= 0 && gap < viewport.height / 4;
          }, position), { timeoutMsg: `Turn ${turn} ${position} should be visible near the viewport edge` });
          await expectHeaderVisible();
        }
        if (turn === 2) {
          // Avoid the embedded driver's scrollIntoView changing ancestors before the navigation click.
          await toggle.execute((element) => (element as HTMLButtonElement).click());
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await clickTurnHalf(2, "end");
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await browser.waitUntil(async () => section.execute((element) => {
            const viewport = document.querySelector('[data-testid="session-detail-scroll"]')!.getBoundingClientRect();
            const gap = viewport.bottom - element.getBoundingClientRect().bottom;
            return gap >= 0 && gap < viewport.height / 4;
          }));
          await expectHeaderVisible();
        }
      }
      await browser.saveScreenshot("/tmp/codex-usage-turn-navigation.png");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } catch (error) {
      await browser.saveScreenshot("/tmp/codex-usage-turn-navigation-failure.png");
      throw error;
    } finally {
      await browser.execute((preferences) => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, previousPreferences);
    }
  }).timeout(180_000);
});
