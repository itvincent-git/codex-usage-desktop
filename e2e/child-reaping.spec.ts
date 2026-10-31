import { browser, expect } from "@wdio/globals";
import { readFileSync } from "node:fs";

type SpawnRecord = { pid: number; parent: number };

function records(): SpawnRecord[] {
  const path = process.env.REPRO_LOG!;
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpawnRecord);
  } catch {
    return [];
  }
}

describe("native Codex limits without CLI fallback", () => {
  const run = process.env.REPRO_LOG ? it : it.skip;

  run("returns authentication errors without starting Codex CLI", async () => {
    await expect(browser).toHaveTitle("Codex Usage Desktop");
    expect(records()).toHaveLength(0);

    for (let i = 0; i < 5; i += 1) {
      const result = await browser.executeAsync((done) => {
        const tauri = (window as unknown as {
          __TAURI__: { core: { invoke: (command: string) => Promise<unknown> } };
        }).__TAURI__;
        tauri.core.invoke("fetch_codex_limits").then(
          () => done("ok"),
          (error) => done(`error: ${String(error)}`),
        );
      });
      expect(result).toBe("error: chatgptLoginRequired");
      expect(records()).toHaveLength(0);
    }
  });
});
