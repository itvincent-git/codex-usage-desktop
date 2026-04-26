import { DatabaseSync } from "node:sqlite";
import type { DailyUsageRow } from "./types";

export function openDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_usage_rollups (
      date TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL,
      cached_input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      models_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanned_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      imported_days INTEGER NOT NULL
    );
  `);
  return db;
}

export function closeDatabase(db: DatabaseSync) {
  db.close();
}

export function upsertDailyRows(db: DatabaseSync, rows: DailyUsageRow[]) {
  const statement = db.prepare(`
    INSERT INTO daily_usage_rollups (
      date,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_output_tokens,
      total_tokens,
      cost_usd,
      models_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens,
      reasoning_output_tokens = excluded.reasoning_output_tokens,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      models_json = excluded.models_json,
      updated_at = excluded.updated_at
  `);

  db.exec("BEGIN");

  try {
    for (const row of rows) {
      statement.run(
        row.date,
        row.inputTokens,
        row.cachedInputTokens,
        row.outputTokens,
        row.reasoningOutputTokens,
        row.totalTokens,
        row.costUSD,
        JSON.stringify(row.models),
        row.updatedAt,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordScanRun(db: DatabaseSync, scannedAt: string, timezone: string, importedDays: number) {
  db.prepare(`
    INSERT INTO scan_runs (scanned_at, timezone, imported_days)
    VALUES (?, ?, ?)
  `).run(scannedAt, timezone, importedDays);
}

export function queryDailyRows(db: DatabaseSync, startDate: string, endDate: string): DailyUsageRow[] {
  const statement = db.prepare(`
    SELECT
      date,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_output_tokens,
      total_tokens,
      cost_usd,
      models_json,
      updated_at
    FROM daily_usage_rollups
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `);

  return statement.all(startDate, endDate).map((row) => ({
    date: String(row.date),
    inputTokens: Number(row.input_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    outputTokens: Number(row.output_tokens),
    reasoningOutputTokens: Number(row.reasoning_output_tokens),
    totalTokens: Number(row.total_tokens),
    costUSD: Number(row.cost_usd),
    models: JSON.parse(String(row.models_json)) as DailyUsageRow["models"],
    updatedAt: String(row.updated_at),
  }));
}

export function queryLatestUpdateAt(db: DatabaseSync) {
  const row = db.prepare("SELECT MAX(updated_at) AS updated_at FROM daily_usage_rollups").get() as
    | { updated_at: string | null }
    | undefined;
  return row?.updated_at ?? null;
}
