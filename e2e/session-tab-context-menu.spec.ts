import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("session tab context menu", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("opens from a tab title that cannot be selected as text", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const title = "Session tab context menu fixture";
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/session-tab-context-menu-test" } },
      { type: "turn_context", payload: { model: "gpt-5" } },
      { type: "event_msg", payload: { type: "user_message", message: title } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, output_tokens: 10 } } } },
    ];
    writeFileSync(join(sessions, "tab-context-menu.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));
    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });
    await browser.refresh();
    await $('[data-testid="sessions-nav-tab"]').click();
    await $(`[data-testid="session-card"]:has(h3[title="${title}"])`).click();
    const tab = $(`[role="tab"]=${title}`);
    await expect(tab).toHaveAttribute("aria-selected", "true");

    const userSelect = await tab.execute((element) => {
      // The embedded driver does not emit contextmenu for a right click.
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }));
      const style = getComputedStyle(element);
      return style.userSelect || style.getPropertyValue("-webkit-user-select");
    });
    const menu = $('[role="menu"]');
    await expect(menu).toHaveAttribute("aria-label", title);
    expect(userSelect).toBe("none");
    await menu.$('[role="menuitem"]=Close').click();
    await expect(tab).not.toBeExisting();
  });
});
