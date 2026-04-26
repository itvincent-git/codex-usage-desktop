import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createTokenEvent(params: {
  timestamp: string;
  model: string;
  totalInput: number;
  totalCachedInput: number;
  totalOutput: number;
  totalReasoningOutput?: number;
  totalTokens: number;
  lastInput: number;
  lastCachedInput: number;
  lastOutput: number;
  lastReasoningOutput?: number;
  lastTokens: number;
}) {
  return [
    JSON.stringify({
      timestamp: params.timestamp,
      type: "turn_context",
      payload: {
        model: params.model,
      },
    }),
    JSON.stringify({
      timestamp: params.timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: params.model,
          total_token_usage: {
            input_tokens: params.totalInput,
            cached_input_tokens: params.totalCachedInput,
            output_tokens: params.totalOutput,
            reasoning_output_tokens: params.totalReasoningOutput ?? 0,
            total_tokens: params.totalTokens,
          },
          last_token_usage: {
            input_tokens: params.lastInput,
            cached_input_tokens: params.lastCachedInput,
            output_tokens: params.lastOutput,
            reasoning_output_tokens: params.lastReasoningOutput ?? 0,
            total_tokens: params.lastTokens,
          },
        },
      },
    }),
  ];
}

export async function createCodexFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-desktop-"));
  const codexHome = path.join(root, ".codex");
  const sessionsDir = path.join(codexHome, "sessions", "project-alpha");
  await mkdir(sessionsDir, { recursive: true });

  const sessionAlpha = [
    ...createTokenEvent({
      timestamp: "2026-04-18T09:00:00.000Z",
      model: "gpt-5",
      totalInput: 1000,
      totalCachedInput: 200,
      totalOutput: 300,
      totalTokens: 1300,
      lastInput: 1000,
      lastCachedInput: 200,
      lastOutput: 300,
      lastTokens: 1300,
    }),
    ...createTokenEvent({
      timestamp: "2026-04-21T12:00:00.000Z",
      model: "gpt-5",
      totalInput: 1800,
      totalCachedInput: 300,
      totalOutput: 500,
      totalTokens: 2300,
      lastInput: 800,
      lastCachedInput: 100,
      lastOutput: 200,
      lastTokens: 1000,
    }),
    ...createTokenEvent({
      timestamp: "2026-04-26T03:00:00.000Z",
      model: "gpt-5",
      totalInput: 3000,
      totalCachedInput: 500,
      totalOutput: 900,
      totalTokens: 3900,
      lastInput: 1200,
      lastCachedInput: 200,
      lastOutput: 400,
      lastTokens: 1600,
    }),
  ].join("\n");

  const sessionBetaDir = path.join(codexHome, "sessions", "project-beta");
  await mkdir(sessionBetaDir, { recursive: true });
  const sessionBeta = createTokenEvent({
    timestamp: "2026-04-24T16:30:00.000Z",
    model: "gpt-5-mini",
    totalInput: 600,
    totalCachedInput: 100,
    totalOutput: 200,
    totalTokens: 800,
    lastInput: 600,
    lastCachedInput: 100,
    lastOutput: 200,
    lastTokens: 800,
  }).join("\n");

  await writeFile(path.join(sessionsDir, "session-alpha.jsonl"), sessionAlpha, "utf8");
  await writeFile(path.join(sessionBetaDir, "session-beta.jsonl"), sessionBeta, "utf8");

  return {
    root,
    codexHome,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

