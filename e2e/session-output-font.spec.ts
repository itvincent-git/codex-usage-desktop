import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("session tool output typography", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("keeps individually displayed exec results compact when collapsed and expanded", async () => {
    const now = new Date();
    const timestamp = now.toISOString();
    const sessions = join(process.env.CODEX_HOME!, "sessions", ...timestamp.slice(0, 10).split("-"));
    mkdirSync(sessions, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c3999";
    const path = join(sessions, `rollout-${timestamp.slice(0, 19).replaceAll(":", "-")}-${id}.jsonl`);
    const prompt = "Check terminal output font size";
    const output = ["### Browser opened", "### Ran Playwright code", "```js", "console.log('ready');", "```", "### Snapshot", "- Saved snapshot"].join("\n");
    const entries = [
      { type: "session_meta", payload: { id, cwd: "/session-output-font-test" } },
      { type: "turn_context", payload: { turn_id: "output-font", model: "gpt-5" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "output-font" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } },
      { type: "response_item", payload: { type: "custom_tool_call", call_id: "exec-output-font", name: "exec", input: 'await Promise.allSettled([101, 102].map(async (id) => text(await tools.write_stdin({ session_id: id, chars: "" }))));' } },
      { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "exec-output-font", output: [
        { type: "input_text", text: "Script completed\nOutput:\n" },
        { type: "input_text", text: JSON.stringify({ output, exit_code: 0 }) },
        { type: "input_text", text: JSON.stringify({ output: "Second terminal output", exit_code: 0 }) },
      ] } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } } } },
    ];
    writeFileSync(path, entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));

    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(async () => {
        localStorage.setItem("language", "en");
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
      });
      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]:has(h3[title="${prompt}"])`);
      await card.waitForDisplayed();
      await card.click();

      const dialog = $('[aria-labelledby="session-detail-title"]');
      const result = dialog.$('button=Output #1');
      const preview = result.$('../pre');
      await result.waitForDisplayed();
      await expect(result).toHaveAttribute("aria-expanded", "false");
      await expect(preview).toHaveText(expect.stringContaining("### Browser opened"));
      await expect(preview).not.toHaveText(expect.stringContaining("console.log"));
      expect(await result.getCSSProperty("font-size")).toMatchObject({ value: "12px" });
      expect(await preview.getCSSProperty("font-size")).toMatchObject({ value: "12px" });

      await result.click();
      await expect(result).toHaveAttribute("aria-expanded", "true");
      await expect(preview).toHaveText(expect.stringContaining("console.log"));
      expect(await preview.getCSSProperty("font-size")).toMatchObject({ value: "12px" });
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
