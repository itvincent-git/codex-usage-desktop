import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";

// Reuse the isolated Codex home and app identifier from the archive E2E setup.
describe("session user input rendering", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("renders async questions through the native replay path and retains raw details", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "08");
    mkdirSync(sessions, { recursive: true });
    const id = "01a11abd-cd00-7fd0-b1de-1c76bda0e681";
    const name = `rollout-2026-10-08T17-00-08-${id}.jsonl`;
    const path = join(sessions, name);
    const callId = "call_c1b878e6c86d4fcea9d32aeab086ca8a";
    const itemId = "fc_09eb5b3daf51cd25016ac75bd87b0c81979f6281800b28894e";
    const title = "当前代码的足球首页路径是 `/`（`/football` 已不再是首页路由）。这次我会测足球首页以及英超、曼城、一个有完整数据的球员详情页；如果你说的 `/football` 是比赛详情页，或有出现 250ms 的具体 URL、日志和机器配置，请补充。";
    const timestamp = "2026-10-08T09:01:15.757Z";
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
    writeFileSync(path, [
      { type: "session_meta", payload: { id, cwd: "/user-input-test" } },
      { type: "turn_context", payload: { turn_id: "question-turn", model: "gpt-5" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check question rendering" }] } },
      { type: "response_item", payload: { type: "function_call", id: itemId, name: "request_user_input_async", call_id: callId, arguments: JSON.stringify({ questions: [{ title }] }) } },
      { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: '{"accepted":true}' } },
      { type: "response_item", payload: { type: "function_call", name: "functions.request_user_input_async", call_id: "choices", arguments: JSON.stringify({ questions: [{ title: "Which **page**?", options: ["Home", "Team"] }] }) } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "choices", output: '{"accepted":true}' } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    ].map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));

    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      expect(detail.turns.flatMap((turn) => turn.toolCalls).some((tool) => tool.callId === callId && tool.name === "request_user_input_async")).toBe(true);

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${name.replace(/\.jsonl$/, "")}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const question = dialog.$('span=User input request');
      await question.waitForExist({ timeout: 15_000 });
      await question.execute((element) => element.scrollIntoView({ block: "center" }));
      await expect(question).toBeDisplayed();
      await expect(dialog.$('code=/football')).toBeExisting();
      await expect(dialog.$('strong=page')).toBeExisting();
      await expect(dialog.$('li*=Home')).toBeExisting();
      await expect(dialog.$('li*=Team')).toBeExisting();
      expect(await dialog.getText()).not.toContain('"accepted"');
      expect(await dialog.getText()).not.toContain("request_user_input_async");

      const questionCard = question.$('./ancestor::div[contains(@class, "rounded-lg")][1]');
      const raw = questionCard.$('button=View raw JSONL');
      await raw.execute((element) => element.scrollIntoView({ block: "center" }));
      await raw.click();
      await expect(questionCard.$('pre')).toHaveText(expect.stringContaining(itemId));
      const hideRaw = questionCard.$('button=Hide raw JSONL');
      await hideRaw.execute((element) => element.scrollIntoView({ block: "center" }));
      await hideRaw.click();
      await expect(questionCard.$('pre')).not.toBeExisting();
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
