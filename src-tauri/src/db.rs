use crate::types::{DailyUsageRow, ModelUsage, ProjectUsage, SessionDetailRow};
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
          projects_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scanned_at TEXT NOT NULL,
          timezone TEXT NOT NULL,
          imported_days INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_file_rollups (
          path TEXT PRIMARY KEY,
          modified_at_ms INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          rows_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| error.to_string())?;
    ensure_column(
        &db,
        "daily_usage_rollups",
        "projects_json",
        "ALTER TABLE daily_usage_rollups ADD COLUMN projects_json TEXT NOT NULL DEFAULT '{}'",
    )?;
    Ok(db)
}

#[derive(Debug, Clone)]
pub struct SessionFileRollup {
    pub path: String,
    pub modified_at_ms: i64,
    pub size_bytes: i64,
    pub rows: Vec<DailyUsageRow>,
}

fn ensure_column(
    db: &Connection,
    table: &str,
    column: &str,
    alter_statement: &str,
) -> Result<(), String> {
    let mut statement = db
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if !columns.iter().any(|name| name == column) {
        db.execute(alter_statement, [])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
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
                  projects_json,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET
                  input_tokens = excluded.input_tokens,
                  cached_input_tokens = excluded.cached_input_tokens,
                  output_tokens = excluded.output_tokens,
                  reasoning_output_tokens = excluded.reasoning_output_tokens,
                  total_tokens = excluded.total_tokens,
                  cost_usd = excluded.cost_usd,
                  models_json = excluded.models_json,
                  projects_json = excluded.projects_json,
                  updated_at = excluded.updated_at
                "#,
            )
            .map_err(|error| error.to_string())?;

        for row in rows {
            let models_json =
                serde_json::to_string(&row.models).map_err(|error| error.to_string())?;
            let projects_json =
                serde_json::to_string(&row.projects).map_err(|error| error.to_string())?;
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
                    projects_json,
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

pub fn reset_usage_state(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        r#"
        DELETE FROM daily_usage_rollups;
        DELETE FROM session_file_rollups;
        DELETE FROM scan_runs;
        "#,
    )
    .map_err(|error| error.to_string())
}

pub fn delete_missing_daily_rows(db: &Connection, active_dates: &[String]) -> Result<(), String> {
    if active_dates.is_empty() {
        db.execute("DELETE FROM daily_usage_rollups", [])
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let mut statement = db
        .prepare("SELECT date FROM daily_usage_rollups")
        .map_err(|error| error.to_string())?;
    let cached_dates = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    for cached_date in cached_dates {
        if !active_dates.iter().any(|date| date == &cached_date) {
            db.execute(
                "DELETE FROM daily_usage_rollups WHERE date = ?",
                params![cached_date],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

pub fn query_session_file_rollup(
    db: &Connection,
    path: &str,
    modified_at_ms: i64,
    size_bytes: i64,
) -> Result<Option<Vec<DailyUsageRow>>, String> {
    let result = db.query_row(
        r#"
        SELECT rows_json
        FROM session_file_rollups
        WHERE path = ? AND modified_at_ms = ? AND size_bytes = ?
        "#,
        params![path, modified_at_ms, size_bytes],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(rows_json) => serde_json::from_str(&rows_json)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn upsert_session_file_rollups(
    db: &mut Connection,
    rollups: &[SessionFileRollup],
    updated_at: &str,
) -> Result<(), String> {
    let tx = db.transaction().map_err(|error| error.to_string())?;
    {
        let mut statement = tx
            .prepare(
                r#"
                INSERT INTO session_file_rollups (
                  path,
                  modified_at_ms,
                  size_bytes,
                  rows_json,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                  modified_at_ms = excluded.modified_at_ms,
                  size_bytes = excluded.size_bytes,
                  rows_json = excluded.rows_json,
                  updated_at = excluded.updated_at
                "#,
            )
            .map_err(|error| error.to_string())?;

        for rollup in rollups {
            let rows_json =
                serde_json::to_string(&rollup.rows).map_err(|error| error.to_string())?;
            statement
                .execute(params![
                    rollup.path,
                    rollup.modified_at_ms,
                    rollup.size_bytes,
                    rows_json,
                    updated_at
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())
}

pub fn delete_missing_session_file_rollups(
    db: &Connection,
    active_paths: &[String],
) -> Result<(), String> {
    if active_paths.is_empty() {
        db.execute("DELETE FROM session_file_rollups", [])
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let mut statement = db
        .prepare("SELECT path FROM session_file_rollups")
        .map_err(|error| error.to_string())?;
    let cached_paths = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    for cached_path in cached_paths {
        if !active_paths.iter().any(|path| path == &cached_path) {
            db.execute(
                "DELETE FROM session_file_rollups WHERE path = ?",
                params![cached_path],
            )
            .map_err(|error| error.to_string())?;
        }
    }

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
              projects_json,
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
            let projects_json: String = row.get(8)?;
            let models = serde_json::from_str::<BTreeMap<String, ModelUsage>>(&models_json)
                .unwrap_or_default();
            let projects = serde_json::from_str::<BTreeMap<String, ProjectUsage>>(&projects_json)
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
                projects,
                updated_at: row.get(9)?,
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

pub fn query_session_details(db: &Connection) -> Result<Vec<SessionDetailRow>, String> {
    let mut statement = db
        .prepare(
            r#"
            SELECT
              path,
              modified_at_ms,
              size_bytes,
              rows_json
            FROM session_file_rollups
            ORDER BY modified_at_ms DESC
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            let path: String = row.get(0)?;
            let modified_at_ms: i64 = row.get(1)?;
            let size_bytes: i64 = row.get(2)?;
            let rows_json: String = row.get(3)?;

            let daily_rows = serde_json::from_str::<Vec<DailyUsageRow>>(&rows_json)
                .unwrap_or_default();

            let mut input_tokens = 0;
            let mut cached_input_tokens = 0;
            let mut output_tokens = 0;
            let mut reasoning_output_tokens = 0;
            let mut total_tokens = 0;
            let mut cost_usd = 0.0;
            let mut models = std::collections::BTreeSet::new();
            let mut projects = std::collections::BTreeSet::new();

            for r in daily_rows {
                input_tokens += r.input_tokens;
                cached_input_tokens += r.cached_input_tokens;
                output_tokens += r.output_tokens;
                reasoning_output_tokens += r.reasoning_output_tokens;
                total_tokens += r.total_tokens;
                cost_usd += r.cost_usd;
                for model in r.models.keys() {
                    models.insert(model.clone());
                }
                for project in r.projects.keys() {
                    projects.insert(project.clone());
                }
            }

            let session_id = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path)
                .to_string();

            Ok(SessionDetailRow {
                path,
                session_id,
                modified_at_ms,
                size_bytes,
                input_tokens,
                cached_input_tokens,
                output_tokens,
                reasoning_output_tokens,
                total_tokens,
                cost_usd,
                models: models.into_iter().collect(),
                projects: projects.into_iter().collect(),
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn open_database_adds_projects_json_to_existing_rollups() {
        let path = std::env::temp_dir().join(format!(
            "codex-usage-db-migration-{}.sqlite",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch(
                r#"
                CREATE TABLE daily_usage_rollups (
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
                "#,
            )
            .unwrap();
        }

        let db = open_database(&path).unwrap();
        let has_projects_json = db
            .prepare("PRAGMA table_info(daily_usage_rollups)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .iter()
            .any(|column| column == "projects_json");

        assert!(has_projects_json);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn reset_usage_state_clears_cached_tables() {
        let path = std::env::temp_dir().join(format!(
            "codex-usage-db-reset-{}.sqlite",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_database(&path).unwrap();
        db.execute(
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
              projects_json,
              updated_at
            ) VALUES ('2026-05-08', 1, 0, 2, 0, 3, 0.01, '{}', '{}', '2026-05-08T00:00:00.000Z')
            "#,
            [],
        )
        .unwrap();
        db.execute(
            r#"
            INSERT INTO session_file_rollups (
              path,
              modified_at_ms,
              size_bytes,
              rows_json,
              updated_at
            ) VALUES ('/tmp/session.jsonl', 1, 2, '[]', '2026-05-08T00:00:00.000Z')
            "#,
            [],
        )
        .unwrap();
        record_scan_run(&db, "2026-05-08T00:00:00.000Z", "UTC", 1).unwrap();

        reset_usage_state(&db).unwrap();

        for table in ["daily_usage_rollups", "session_file_rollups", "scan_runs"] {
            let count: i64 = db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0);
        }
        let _ = std::fs::remove_file(path);
    }
}
