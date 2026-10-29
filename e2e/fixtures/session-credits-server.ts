import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const creditId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function writeCreditAuth(home: string, account: string, user = "fixture-user", apiKey = false) {
  const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_user_id: user } })).toString("base64url");
  writeFileSync(join(home, "auth.json"), JSON.stringify(apiKey ? { auth_mode: "apikey", OPENAI_API_KEY: "fixture-api-key" } : {
    auth_mode: "chatgpt", tokens: { access_token: "fixture-token", account_id: account, id_token: `e30.${claims}.fixture` },
  }));
}

export async function startCreditsFixture(home: string) {
  const requests: { ids: string[]; account: string; authorization: string; path: string }[] = [];
  let status = 200;
  let delay = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/stats") { res.end(JSON.stringify(requests)); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (req.url === "/control") {
      status = body.status ?? 200; delay = body.delay ?? 0;
      res.end("{}"); return;
    }
    const threads = body.threads as { thread_id: string; created_at: null; descendant_thread_ids: string[] }[];
    if (req.method !== "POST" || !threads?.length || threads.length > 100
      || threads.some((thread) => thread.created_at !== null || thread.descendant_thread_ids.length !== 0)) {
      res.writeHead(400).end(); return;
    }
    requests.push({ ids: threads.map((thread) => thread.thread_id), account: String(req.headers["chatgpt-account-id"]), authorization: String(req.headers.authorization), path: req.url! });
    const responseStatus = status;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Retry-After", "600");
    res.writeHead(responseStatus);
    res.end(JSON.stringify({ data_as_of: new Date().toISOString(), threads: threads.filter((thread) => thread.thread_id !== creditId(7)).map((thread) => ({
      thread_id: thread.thread_id, data_status: thread.thread_id === creditId(4) ? "partial" : "available", usage_source: "credits",
      balance_usage_credits: thread.thread_id === creditId(2) ? "0E-10" : thread.thread_id === creditId(3) ? null : thread.thread_id === creditId(5) ? "-2.5" : thread.thread_id === creditId(6) ? "1e-20" : String(req.headers["chatgpt-account-id"]) === "account-b" ? "98.76" : "12.34", groups: [],
    })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  writeCreditAuth(home, "account-a");
  const sessions = join(home, "sessions"); mkdirSync(sessions, { recursive: true });
  const dates = [1, 2].map((days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
  const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
  for (let n = 1; n <= 36; n++) {
    const day = n === 36 ? dates[1] : dates[0];
    const timestamp = `${day}T04:00:00Z`;
    const parent = n === 34 || n === 35 ? { source: { subagent: { thread_spawn: { parent_thread_id: creditId(1), depth: 1 } } } } : {};
    const lines: unknown[] = [
      { timestamp, type: "session_meta", payload: { id: creditId(n), cwd: "/credits-fixture", ...parent } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5" } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    ];
    if (n === 1) {
      // The same thread appears on two dates with a single lifetime debit result.
      lines.splice(1, 0, { timestamp: `${dates[1]}T04:00:00Z`, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } });
      lines.push({ timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { ...usage, input_tokens: 2000, output_tokens: 600, total_tokens: 2600 }, last_token_usage: usage } } });
    }
    writeFileSync(join(sessions, `rollout-${day}T04-00-00-${creditId(n)}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n"));
  }
  writeFileSync(join(home, "session_index.jsonl"), Array.from({ length: 36 }, (_, n) => JSON.stringify({ id: creditId(n + 1), thread_name: `Credits fixture ${n + 1}` })).join("\n"));
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
