use crate::types::{DailyUsageRow, ModelUsage};
use rusqlite::{params, Connection};
use std::{collections::BTreeMap, path::Path};

pub fn open_database(database_path: &Path) -> Result<Connection, String> {
    let db = Connection::open(database_path).map_err(|error| error.to_string())?;
    db.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    db.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())?;
    db.execute_batch(
        r#"
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

        CREATE TABLE IF NOT EXISTS scan_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scanned_at TEXT NOT NULL,
          timezone TEXT NOT NULL,
          imported_days INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|error| error.to_string())?;
    Ok(db)
}

pub fn upsert_daily_rows(db: &mut Connection, rows: &[DailyUsageRow]) -> Result<(), String> {
    let tx = db.transaction().map_err(|error| error.to_string())?;
    {
        let mut statement = tx
            .prepare(
                r#"
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
                "#,
            )
            .map_err(|error| error.to_string())?;

        for row in rows {
            let models_json =
                serde_json::to_string(&row.models).map_err(|error| error.to_string())?;
            statement
                .execute(params![
                    row.date,
                    row.input_tokens,
                    row.cached_input_tokens,
                    row.output_tokens,
                    row.reasoning_output_tokens,
                    row.total_tokens,
                    row.cost_usd,
                    models_json,
                    row.updated_at
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())
}

pub fn record_scan_run(
    db: &Connection,
    scanned_at: &str,
    timezone: &str,
    imported_days: usize,
) -> Result<(), String> {
    db.execute(
        "INSERT INTO scan_runs (scanned_at, timezone, imported_days) VALUES (?, ?, ?)",
        params![scanned_at, timezone, imported_days as i64],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn query_daily_rows(
    db: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailyUsageRow>, String> {
    let mut statement = db
        .prepare(
            r#"
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
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![start_date, end_date], |row| {
            let models_json: String = row.get(7)?;
            let models = serde_json::from_str::<BTreeMap<String, ModelUsage>>(&models_json)
                .unwrap_or_default();

            Ok(DailyUsageRow {
                date: row.get(0)?,
                input_tokens: row.get(1)?,
                cached_input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                reasoning_output_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                cost_usd: row.get(6)?,
                models,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn query_latest_update_at(db: &Connection) -> Result<Option<String>, String> {
    db.query_row(
        "SELECT MAX(updated_at) AS updated_at FROM daily_usage_rollups",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}
