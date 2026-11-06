import { $, browser, expect } from "@wdio/globals";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";

describe("session data search", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("finds text in place while preserving the conversation and raw JSONL controls", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "16");
    mkdirSync(sessions, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c3888";
    const name = `rollout-2026-10-16T09-00-00-${id}.jsonl`;
    const path = join(sessions, name);
    const timestamp = "2026-10-16T09:00:00Z";
    const needle = "NeedleSession42";
    const lines = "A long output line that should stay outside the rendered search window.\n".repeat(30_000);
    const firstOutput = `${lines}${needle} first occurrence\n${lines}${needle} second occurrence`;
    const nestedOutput = `${"x".repeat(2_000_000)}${needle} nested occurrence${"y".repeat(2_000_000)}`;
    const records = [
      { type: "session_meta", payload: { id, cwd: "/session-search-test" } },
      ...[1, 2].flatMap((number) => [
        { type: "turn_context", payload: { turn_id: `search-${number}`, model: "gpt-5" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: `search-${number}` } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Search prompt ${number}` }] } },
        number === 1
          ? { type: "response_item", payload: { type: "function_call", call_id: "read", name: "exec_command", arguments: '{"cmd":"cat first.txt"}' } }
          : { type: "response_item", payload: { type: "custom_tool_call", call_id: "nested", name: "exec", input: 'text(await tools.exec_command({cmd:"echo nested-one"})); text(await tools.exec_command({cmd:"echo nested-two"}));' } },
        number === 1
          ? { type: "response_item", payload: { type: "function_call_output", call_id: "read", output: JSON.stringify({ output: firstOutput, exit_code: 0 }) } }
          : { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "nested", output: [
            { type: "input_text", text: "Script completed\nOutput:\n" },
            { type: "input_text", text: JSON.stringify({ output: "unrelated sibling output", exit_code: 0 }) },
            { type: "input_text", text: JSON.stringify({ output: nestedOutput, exit_code: 0 }) },
          ] } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: `search-${number}` } },
      ]),
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, total_tokens: 1100 } } } },
    ];
    writeFileSync(path, records.map((record) => JSON.stringify({ timestamp, ...record })).join("\n"));
    const previousLanguage = await browser.execute(() => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      return previous;
    });
    try {
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      expect(detail.turns.map((turn) => turn.turnId)).toEqual(["search-1", "search-2"]);
      expect(detail.turns[1].toolCalls[0].output!.length).toBeGreaterThan(4_000_000);
      await browser.refresh();
      await $('button[role="tab"]=Sessions').waitForDisplayed({ timeout: 90_000 });
      await $('button[role="tab"]=Sessions').click();
      const card = $(`[data-testid="session-card"]*=${name.replace(/\.jsonl$/, "")}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      let input = dialog.$('input[type="search"]');
      const searchButton = dialog.$('button[aria-controls="session-detail-search"]');
      await searchButton.waitForEnabled();
      await expect(input).not.toExist();
      await expect(searchButton).toHaveAttribute("aria-expanded", "false");
      expect(await searchButton.execute((element) => element.nextElementSibling?.textContent)).toContain("Details");
      await browser.saveScreenshot("/tmp/codex-usage-session-search-closed.png");
      const scrollTop = await dialog.$('[data-testid="session-detail-scroll"]').getLocation("y");
      await searchButton.click();
      await input.waitForDisplayed();
      expect(await dialog.$('[data-testid="session-detail-scroll"]').getLocation("y")).toBe(scrollTop);
      expect(await dialog.$('[role="search"]').getCSSProperty("position")).toMatchObject({ value: "absolute" });
      await expect(searchButton).toHaveAttribute("aria-expanded", "true");
      await expect(input).toBeFocused();
      await searchButton.click();
      await expect(dialog.$('input[type="search"]')).not.toExist();
      await browser.keys([process.platform === "darwin" ? "Meta" : "Control", "f"]);
      input = dialog.$('input[type="search"]');
      await input.waitForDisplayed();
      await expect(input).toBeFocused();
      await input.setValue("selected query");
      await searchButton.execute((element) => element.focus());
      await browser.keys([process.platform === "darwin" ? "Meta" : "Control", "f"]);
      await expect(input).toBeFocused();
      expect(await input.execute((element) => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([0, 14]);
      await dialog.$('button[aria-label="Close search"]').click();
      await expect(dialog.$('input[type="search"]')).not.toExist();
      await expect(searchButton).toBeFocused();
      await browser.keys([process.platform === "darwin" ? "Meta" : "Control", "f"]);
      input = dialog.$('input[type="search"]');
      await expect(input).toBeFocused();
      const explored = dialog.$('section[aria-label="Explored"]');
      await expect(explored.$("button")).toHaveAttribute("aria-expanded", "false");
      const firstTurn = dialog.$('button*=Turn search-1');
      const secondTurn = dialog.$('button*=Turn search-2');
      await expect(firstTurn).toHaveAttribute("aria-expanded", "true");
      await expect(secondTurn).toHaveAttribute("aria-expanded", "true");

      await input.setValue(needle.toLowerCase());
      const status = dialog.$('[role="search"] [role="status"]');
      const currentMark = () => dialog.$('[data-testid="session-search-current"]');
      const currentWindowText = () => browser.execute(() => document.querySelector('[data-testid="session-search-current"]')?.closest('[data-testid="session-search-window"]')?.textContent ?? "");
      await expect(status).toHaveText("1 / 3");
      await expect(currentMark()).toHaveText(needle);
      await expect(firstTurn).toHaveAttribute("aria-expanded", "true");
      await expect(secondTurn).toHaveAttribute("aria-expanded", "true");
      await expect(dialog.$$('[data-session-search-hit]')).toBeElementsArrayOfSize(2);
      await expect(dialog.$$("mark")).toBeElementsArrayOfSize(3);
      await browser.waitUntil(async () => (await currentWindowText()).includes("first occurrence"));
      await browser.waitUntil(async () => (await currentWindowText()).includes("second occurrence"));
      expect((await currentWindowText()).length).toBeLessThan(25_000);
      await expect(explored.$("button")).toHaveAttribute("aria-expanded", "true");
      expect(await dialog.getText()).toContain("Search prompt 1");
      expect(await dialog.getText()).toContain("Search prompt 2");
      expect(await dialog.getText()).toContain("echo nested-one");

      await dialog.$('button[aria-label="Next match (Enter)"]').click();
      await expect(status).toHaveText("2 / 3");
      await browser.waitUntil(async () => (await currentWindowText()).includes("second occurrence"));
      await input.click();
      await browser.keys("Enter");
      await expect(status).toHaveText("3 / 3");
      await expect(firstTurn).toHaveAttribute("aria-expanded", "true");
      await expect(secondTurn).toHaveAttribute("aria-expanded", "true");
      await browser.waitUntil(async () => (await currentWindowText()).includes("nested occurrence"));
      await expect(dialog.$('nav[aria-label="Quick navigation"] [aria-current="location"]')).toHaveText("Search prompt 2");
      expect((await currentWindowText()).length).toBeLessThan(25_000);
      expect(await dialog.getText()).toContain("unrelated sibling output");
      await expect(dialog.$$('[data-session-search-hit]')).toBeElementsArrayOfSize(2);
      await expect(dialog.$$("mark")).toBeElementsArrayOfSize(3);
      await browser.waitUntil(async () => currentMark().execute((element) => {
        const bounds = element.getBoundingClientRect();
        const viewport = element.closest('[role="dialog"]')!.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
      }), { timeoutMsg: "Deep match should be visible inside its text window" });
      expect(await dialog.$('[role="search"]').execute((element) => {
        const bar = element.getBoundingClientRect();
        const scroll = document.querySelector('[data-testid="session-detail-scroll"]')!.getBoundingClientRect();
        const current = document.querySelector('[data-testid="session-search-current"]')!.getBoundingClientRect();
        return bar.top >= scroll.top && bar.bottom <= current.top && bar.bottom < scroll.top + 80;
      })).toBe(true);
      await browser.saveScreenshot("/tmp/codex-usage-session-search-hit.png");

      // Common prefixes must not flood the WebView with tens of thousands of highlights.
      await input.setValue("A long output");
      await expect(status).toHaveText("1 / 60000");
      expect(await dialog.execute((element) => element.querySelectorAll("mark").length)).toBeLessThanOrEqual(200);
      await dialog.$('button[aria-label="Previous match (Shift+Enter)"]').click();
      await expect(status).toHaveText("60000 / 60000");
      await expect(currentMark()).toHaveText("A long output");
      await dialog.$('button=Raw JSONL').click();
      await expect(status).toHaveText("1 / 60000");
      expect(await dialog.execute((element) => element.querySelectorAll("mark").length)).toBeLessThanOrEqual(200);
      await dialog.$('button=Timeline').click();
      await expect(status).toHaveText("1 / 60000");

      // Rapid typing invalidates both debounced work and already-running worker responses.
      const typingStarted = Date.now();
      await input.addValue("-session-search-text");
      await expect(input).toHaveValue("A long output-session-search-text");
      expect(Date.now() - typingStarted).toBeLessThan(2000);
      await expect(status).toHaveText("No matches");
      await expect(dialog.$$('[data-session-search-hit]')).toBeElementsArrayOfSize(0);
      await expect(firstTurn).toHaveAttribute("aria-expanded", "true");
      await expect(secondTurn).toHaveAttribute("aria-expanded", "true");
      expect(await dialog.getText()).toContain("Search prompt 1");
      expect(await dialog.getText()).toContain("Search prompt 2");
      await input.setValue(needle);
      await expect(status).toHaveText("1 / 3");
      await dialog.$('button=Raw JSONL').click();
      await expect(dialog.$('button=Copy')).toExist();
      await expect(status).toHaveText("1 / 3");
      await expect(dialog.$$('[data-session-search-hit]')).toBeElementsArrayOfSize(1);
      expect((await currentWindowText()).length).toBeLessThan(25_000);
      await expect(dialog.$$("mark")).toBeElementsArrayOfSize(3);
      await dialog.$('button[aria-label="Previous match (Shift+Enter)"]').click();
      await expect(status).toHaveText("3 / 3");
      await dialog.$('button=Timeline').click();
      await expect(status).toHaveText("1 / 3");

      appendFileSync(path, `\n${JSON.stringify({ timestamp, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `${needle} appended after refresh` }] } })}`);
      await dialog.$('button=Refresh this session').click();
      await expect(status).toHaveText("1 / 4");
      await input.click();
      await browser.keys("Escape");
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await browser.keys("Escape");
      await expect(dialog.$('input[type="search"]')).not.toExist();
      await expect(searchButton).toHaveAttribute("aria-expanded", "false");
      await expect(searchButton).toBeFocused();
      await expect(dialog.$$('[data-session-search-hit]')).toBeElementsArrayOfSize(0);
      await expect(dialog).toExist();
      await expect(explored.$("button")).toHaveAttribute("aria-expanded", "false");
      await expect(firstTurn).toHaveAttribute("aria-expanded", "true");
      await expect(secondTurn).toHaveAttribute("aria-expanded", "true");
      await browser.saveScreenshot("/tmp/codex-usage-session-search.png");
      await searchButton.click();
      input = dialog.$('input[type="search"]');
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await browser.keys("Escape");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } catch (error) {
      await browser.saveScreenshot("/tmp/codex-usage-session-search-failure.png");
      throw error;
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
