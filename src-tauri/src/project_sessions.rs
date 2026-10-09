use crate::{
    codex_projects::CodexProjectCatalog,
    date::{date_key_in_timezone, resolve_app_timezone},
    db::{self, SessionHierarchyRecord},
    overview::resolve_range,
    session_index, session_replay,
    types::{
        ProjectSessionDay, ProjectSessionDaysResponse, SessionDailyUsageRow, SessionDetailRow,
    },
};
use chrono::DateTime;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    hash::{Hash, Hasher},
    path::Path,
};

pub fn create_tables(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS project_session_index (
            path TEXT PRIMARY KEY, source_updated_at TEXT NOT NULL,
            revision TEXT NOT NULL, detail_json TEXT NOT NULL, search_text TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_session_days (
            project TEXT NOT NULL, date TEXT NOT NULL, path TEXT NOT NULL,
            total_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, usage_json TEXT NOT NULL,
            PRIMARY KEY (project, date, path)
        );
        CREATE INDEX IF NOT EXISTS project_session_days_path ON project_session_days(path);
        CREATE TABLE IF NOT EXISTS project_session_quota (
            path TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
            end_at INTEGER NOT NULL, reset_at INTEGER, end_percent REAL NOT NULL,
            PRIMARY KEY (path, date, kind, end_at)
        );
        CREATE INDEX IF NOT EXISTS project_session_quota_window
            ON project_session_quota(kind, reset_at, end_at);",
    )
    .map_err(|error| error.to_string())
}

fn revision(codex_home: &Path, timezone: &str) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    timezone.hash(&mut hash);
    std::fs::read(codex_home.join("session_index.jsonl"))
        .unwrap_or_default()
        .hash(&mut hash);
    let state = std::fs::read_to_string(codex_home.join(".codex-global-state.json"))
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok());
    // Codex writes unrelated window/UI preferences into this file frequently.
    for key in ["local-projects", "thread-project-assignments"] {
        state
            .as_ref()
            .and_then(|state| state.get(key))
            .map(|value| value.to_string())
            .hash(&mut hash);
    }
    format!("1:{:x}", hash.finish())
}

// Backfill existing databases once; later scans and queries only rebuild changed entries.
pub fn sync_index(db: &Connection, codex_home: &Path, timezone: &str) -> Result<(), String> {
    let revision = revision(codex_home, timezone);
    let transaction = if db.is_autocommit() {
        Some(
            db.unchecked_transaction()
                .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };
    let tx = transaction.as_deref().unwrap_or(db);
    tx.execute_batch(
        "DELETE FROM project_session_days WHERE path NOT IN (SELECT path FROM session_file_rollups);
         DELETE FROM project_session_quota WHERE path NOT IN (SELECT path FROM session_file_rollups);
         DELETE FROM project_session_index WHERE path NOT IN (SELECT path FROM session_file_rollups);",
    ).map_err(|error| error.to_string())?;
    let pending = {
        let mut statement = tx
            .prepare(
                "SELECT f.path, f.updated_at, i.detail_json FROM session_file_rollups f
             LEFT JOIN project_session_index i ON i.path = f.path
             WHERE i.path IS NULL OR i.source_updated_at != f.updated_at OR i.revision != ?",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([&revision], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    if !pending.is_empty() {
        let names = session_index::read_thread_names(codex_home).unwrap_or_default();
        let catalog = CodexProjectCatalog::load(codex_home);
        for (path, updated_at, previous) in pending {
            let mut session = db::query_session_detail(&tx, &path)?;
            let previous =
                previous.and_then(|json| serde_json::from_str::<SessionDetailRow>(&json).ok());
            if let Some(previous) = previous.filter(|previous| {
                previous.modified_at_ms == session.modified_at_ms
                    && previous.size_bytes == session.size_bytes
            }) {
                session.agent_session_id = previous.agent_session_id;
                session.parent_session_id = previous.parent_session_id;
                session.agent_depth = previous.agent_depth;
                session.agent_path = previous.agent_path;
                session.agent_nickname = previous.agent_nickname;
                session.agent_role = previous.agent_role;
            } else if let Some(agent) = session_replay::read_session_agent(SessionHierarchyRecord {
                path: path.clone(),
                prompt_title: session.thread_name.clone(),
                input_tokens: session.input_tokens,
                cached_input_tokens: session.cached_input_tokens,
                output_tokens: session.output_tokens,
                cost_usd: session.cost_usd,
            }) {
                session.agent_session_id = Some(agent.session_id);
                session.parent_session_id = agent.parent_session_id;
                session.agent_depth = agent.depth;
                session.agent_path = Some(agent.agent_path);
                session.agent_nickname = agent.nickname;
                session.agent_role = agent.role;
            }
            session.thread_name =
                session_index::resolve_thread_name(&path, session.thread_name.take(), &names);
            catalog.enrich_sessions(std::slice::from_mut(&mut session));
            store_session(&tx, &session, &updated_at, &revision, timezone)?;
        }
    }
    if let Some(transaction) = transaction {
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn store_session(
    db: &Connection,
    session: &SessionDetailRow,
    updated_at: &str,
    revision: &str,
    timezone: &str,
) -> Result<(), String> {
    let mut search = vec![
        session.thread_name.clone().unwrap_or_default(),
        session.session_id.clone(),
    ];
    search.extend(session.models.clone());
    search.extend(session.projects.clone());
    for reference in &session.project_references {
        search.push(reference.display_name.clone());
        search.extend(reference.codex_project_name.clone());
    }
    let mut detail = session.clone();
    detail.daily_usage.clear();
    db.execute(
        "INSERT OR REPLACE INTO project_session_index VALUES (?, ?, ?, ?, ?)",
        params![
            session.path,
            updated_at,
            revision,
            serde_json::to_string(&detail).map_err(|error| error.to_string())?,
            search.join("\n").to_lowercase()
        ],
    )
    .map_err(|error| error.to_string())?;
    db.execute(
        "DELETE FROM project_session_days WHERE path = ?",
        [&session.path],
    )
    .map_err(|error| error.to_string())?;
    db.execute(
        "DELETE FROM project_session_quota WHERE path = ?",
        [&session.path],
    )
    .map_err(|error| error.to_string())?;
    let fallback;
    let usage = if session.total_tokens == 0 || session.daily_usage.is_empty() {
        fallback = vec![SessionDailyUsageRow {
            date: date_key_in_timezone(
                DateTime::from_timestamp_millis(session.modified_at_ms)
                    .ok_or("Invalid session timestamp")?,
                timezone,
            ),
            input_tokens: session.input_tokens,
            cached_input_tokens: session.cached_input_tokens,
            output_tokens: session.output_tokens,
            reasoning_output_tokens: session.reasoning_output_tokens,
            total_tokens: session.total_tokens,
            cost_usd: session.cost_usd,
            models: session.models.clone(),
            projects: session.projects.clone(),
            quota_usage: session.quota_usage.clone(),
        }];
        &fallback
    } else {
        &session.daily_usage
    };
    for day in usage {
        let json = serde_json::to_string(day).map_err(|error| error.to_string())?;
        for project in &day.projects {
            db.execute(
                "INSERT OR REPLACE INTO project_session_days VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    project,
                    day.date,
                    session.path,
                    day.total_tokens,
                    day.cost_usd,
                    json
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        if let Some(quota) = &day.quota_usage {
            for (kind, windows) in [("fiveHour", &quota.five_hour), ("weekly", &quota.weekly)] {
                for window in windows {
                    let end_at = DateTime::parse_from_rfc3339(&window.observed_end_at)
                        .map_err(|error| error.to_string())?
                        .timestamp_millis();
                    let reset_at = window
                        .resets_at
                        .as_deref()
                        .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
                        .map(|date| date.timestamp_millis());
                    db.execute(
                        "INSERT OR REPLACE INTO project_session_quota VALUES (?, ?, ?, ?, ?, ?)",
                        params![
                            session.path,
                            day.date,
                            kind,
                            end_at,
                            reset_at,
                            window.observed_end_percent
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(())
}

pub fn query_days(
    db: &Connection,
    project: &str,
    range: &str,
    query: &str,
    before: Option<&str>,
    timezone: &str,
) -> Result<ProjectSessionDaysResponse, String> {
    let (start, end, range_days) = resolve_range(range, timezone)?;
    let days_per_page = range_days as usize;
    let query = query.trim().to_lowercase();
    let (total_sessions, matching_sessions) = db.query_row(
        "SELECT COUNT(DISTINCT d.path), COUNT(DISTINCT CASE WHEN instr(i.search_text, ?4) > 0 OR ?4 = '' THEN d.path END)
         FROM project_session_days d JOIN project_session_index i ON i.path = d.path
         WHERE d.project = ?1 AND d.date BETWEEN ?2 AND ?3",
        params![project, start, end, query], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|error| error.to_string())?;
    let mut statement = db.prepare(
        "SELECT d.date, COUNT(*), SUM(d.total_tokens), SUM(d.cost_usd)
         FROM project_session_days d JOIN project_session_index i ON i.path = d.path
         WHERE d.project = ?1 AND d.date BETWEEN ?2 AND ?3 AND (?4 = '' OR instr(i.search_text, ?4) > 0)
         AND (?5 IS NULL OR d.date < ?5) GROUP BY d.date ORDER BY d.date DESC LIMIT ?6",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![project, start, end, query, before, days_per_page + 1],
            |row| {
                Ok(ProjectSessionDay {
                    date: row.get(0)?,
                    session_count: row.get(1)?,
                    total_tokens: row.get(2)?,
                    cost_usd: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;
    let mut days = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let has_more = days.len() > days_per_page;
    days.truncate(days_per_page);
    let next_before = if has_more {
        days.last().map(|day| day.date.clone())
    } else {
        None
    };
    Ok(ProjectSessionDaysResponse {
        start_date: start,
        end_date: end,
        timezone: timezone.to_string(),
        total_sessions,
        matching_sessions,
        days,
        next_before,
    })
}

pub fn query_day_sessions(
    db: &Connection,
    project: &str,
    range: &str,
    date: &str,
    query: &str,
    timezone: &str,
) -> Result<Vec<SessionDetailRow>, String> {
    let (start, end, _) = resolve_range(range, timezone)?;
    if date < start.as_str() || date > end.as_str() {
        return Err("Session date is outside the selected range".to_string());
    }
    let query = query.trim().to_lowercase();
    let mut statement = db
        .prepare(
            "SELECT i.detail_json, d.usage_json FROM project_session_days d
         JOIN project_session_index i ON i.path = d.path
         WHERE d.project = ?1 AND d.date = ?2 AND (?3 = '' OR instr(i.search_text, ?3) > 0)",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project, date, query], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        let (detail, usage) = row.map_err(|error| error.to_string())?;
        let mut session: SessionDetailRow =
            serde_json::from_str(&detail).map_err(|error| error.to_string())?;
        let mut usage: SessionDailyUsageRow =
            serde_json::from_str(&usage).map_err(|error| error.to_string())?;
        if let Some(quota) = &mut usage.quota_usage {
            for (kind, windows) in [
                ("fiveHour", &mut quota.five_hour),
                ("weekly", &mut quota.weekly),
            ] {
                for window in windows {
                    let start_at = DateTime::parse_from_rfc3339(&window.observed_start_at)
                        .map_err(|error| error.to_string())?
                        .timestamp_millis();
                    let end_at = DateTime::parse_from_rfc3339(&window.observed_end_at)
                        .map_err(|error| error.to_string())?
                        .timestamp_millis();
                    let reset_at = window
                        .resets_at
                        .as_deref()
                        .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
                        .map(|date| date.timestamp_millis());
                    let baseline = db.query_row(
                        "SELECT q.end_at, q.end_percent FROM project_session_quota q
                         WHERE q.kind = ?1 AND q.end_at > ?2 AND q.end_at < ?3 AND q.end_percent <= ?4
                         AND ((q.reset_at IS NULL AND ?5 IS NULL) OR q.reset_at BETWEEN ?5 - 60000 AND ?5 + 60000)
                         AND EXISTS (SELECT 1 FROM project_session_days d WHERE d.path = q.path AND d.date = q.date AND d.project = ?6)
                         ORDER BY q.end_at DESC LIMIT 1",
                        params![kind, start_at, end_at, window.observed_end_percent, reset_at, project],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
                    ).optional().map_err(|error| error.to_string())?;
                    if let Some((end_at, percent)) = baseline {
                        window.observed_start_at = DateTime::from_timestamp_millis(end_at)
                            .unwrap()
                            .to_rfc3339();
                        window.observed_start_percent = percent;
                        window.observed_delta_percent = window.observed_end_percent - percent;
                        window.below_resolution = window.observed_delta_percent.round() == 0.0;
                    }
                }
            }
        }
        session.daily_usage = vec![usage];
        sessions.push(session);
    }
    Ok(sessions)
}

pub fn prepare_index(db: &Connection) -> Result<String, String> {
    let _guard = crate::scanner::SCAN_MUTEX
        .lock()
        .map_err(|error| error.to_string())?;
    let timezone = resolve_app_timezone();
    sync_index(db, &crate::scanner::default_codex_home(), &timezone)?;
    Ok(timezone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{SessionFileRollup, SessionQuotaRollup};
    use crate::types::{
        DailyUsageRow, ModelUsage, ProjectUsage, SessionQuotaUsage, SessionQuotaWindowUsage,
    };
    use std::{collections::BTreeMap, fs, path::PathBuf};

    const RANGE: &str = "custom:2026-07-01_2026-07-10";

    struct Fixture {
        db: Connection,
        home: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let home =
                std::env::temp_dir().join(format!("project-sessions-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&home).unwrap();
            Self {
                db: db::open_database(Path::new(":memory:")).unwrap(),
                home,
            }
        }

        fn seed(&mut self, name: &str, rows: Vec<DailyUsageRow>) -> String {
            let path = self.home.join(format!("{name}.jsonl"));
            fs::write(&path, format!(r#"{{"type":"session_meta","payload":{{"id":"{name}","source":{{"subagent":{{"thread_spawn":{{"parent_thread_id":"root","depth":1}}}}}}}}}}"#)).unwrap();
            db::upsert_session_file_rollups(
                &mut self.db,
                &[SessionFileRollup {
                    path: path.to_string_lossy().into_owned(),
                    modified_at_ms: 1782864000000,
                    size_bytes: 100,
                    rows,
                    prompt_title: Some(name.to_string()),
                    quota_usage: None,
                }],
                "v1",
            )
            .unwrap();
            path.to_string_lossy().into_owned()
        }

        fn sync(&self) {
            sync_index(&self.db, &self.home, "UTC").unwrap();
        }

        fn days(&self, query: &str, before: Option<&str>) -> ProjectSessionDaysResponse {
            query_days(&self.db, "/repo/app", RANGE, query, before, "UTC").unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.home);
        }
    }

    fn day(date: &str, project: &str) -> DailyUsageRow {
        DailyUsageRow {
            date: date.to_string(),
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 40,
            reasoning_output_tokens: 0,
            total_tokens: 140,
            cost_usd: 0.01,
            models: BTreeMap::from([("gpt-5".to_string(), ModelUsage::default())]),
            projects: BTreeMap::from([(project.to_string(), ProjectUsage::default())]),
            updated_at: "v1".to_string(),
        }
    }

    #[test]
    fn loads_all_selected_project_dates_and_counts_resumed_sessions_once() {
        let mut fixture = Fixture::new();
        let mut rows = (1..=10)
            .map(|index| day(&format!("2026-07-{index:02}"), "/repo/app"))
            .collect::<Vec<_>>();
        rows.push(day("2026-06-30", "/repo/app"));
        rows.push(day("2026-07-11", "/repo/app"));
        fixture.seed("resumed", rows);
        fixture.seed("other", vec![day("2026-07-10", "/repo/other")]);
        fixture.sync();
        let first = fixture.days("", None);
        assert_eq!(first.total_sessions, 1);
        assert_eq!(first.days.len(), 10);
        assert_eq!(first.days[0].date, "2026-07-10");
        assert_eq!(first.days[0].total_tokens, 140);
        assert!(first.next_before.is_none());
        let second = fixture.days("", Some("2026-07-04"));
        assert_eq!(
            second
                .days
                .iter()
                .map(|day| day.date.as_str())
                .collect::<Vec<_>>(),
            ["2026-07-03", "2026-07-02", "2026-07-01"]
        );
        assert!(second.next_before.is_none());
        let sessions =
            query_day_sessions(&fixture.db, "/repo/app", RANGE, "2026-07-01", "", "UTC").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].daily_usage.len(), 1);
        assert_eq!(sessions[0].daily_usage[0].date, "2026-07-01");
        assert_eq!(sessions[0].total_tokens, 1680);
        assert!(
            query_day_sessions(&fixture.db, "/repo/app", RANGE, "2026-06-30", "", "UTC").is_err()
        );
    }

    #[test]
    fn searches_all_selected_days_without_changing_total_count() {
        let mut fixture = Fixture::new();
        for index in 1..=10 {
            fixture.seed(
                &format!("task-{index}"),
                vec![day(&format!("2026-07-{index:02}"), "/repo/app")],
            );
        }
        fixture.sync();
        assert!(fixture
            .days("", None)
            .days
            .iter()
            .any(|day| day.date == "2026-07-01"));
        let matches = fixture.days("TASK-1.JSONL", None);
        assert_eq!(matches.total_sessions, 10);
        assert_eq!(matches.matching_sessions, 1);
        assert_eq!(matches.days[0].date, "2026-07-01");
        assert_eq!(fixture.days("gpt-5", None).matching_sessions, 10);
        assert_eq!(fixture.days("/repo/app", None).matching_sessions, 10);
        assert_eq!(fixture.days("%", None).matching_sessions, 0);
    }

    #[test]
    fn loads_every_day_for_short_long_and_custom_ranges() {
        let mut fixture = Fixture::new();
        let timezone = "UTC";
        for range in ["1d", "7d", "30d", "custom:2026-07-01_2026-07-10"] {
            let (start, end, count) = resolve_range(range, timezone).unwrap();
            let dates = crate::date::list_date_keys(&start, &end).unwrap();
            fixture.seed(
                range,
                dates.iter().map(|date| day(date, "/repo/app")).collect(),
            );
            fixture.sync();
            let result = query_days(&fixture.db, "/repo/app", range, "", None, timezone).unwrap();
            assert_eq!(result.start_date, start);
            assert_eq!(result.end_date, end);
            assert_eq!(result.days.len(), count as usize);
            assert_eq!(result.days.first().unwrap().date, end);
            assert_eq!(result.days.last().unwrap().date, start);
            assert!(result.next_before.is_none());
        }
    }

    #[test]
    fn reuses_agent_metadata_and_invalidates_changed_or_deleted_rollups() {
        let mut fixture = Fixture::new();
        let path = fixture.seed("child", vec![day("2026-07-01", "/repo/app")]);
        fixture.sync();
        fs::remove_file(&path).unwrap();
        fixture.db.execute("UPDATE session_file_rollups SET prompt_title = 'Renamed', updated_at = 'v2' WHERE path = ?", [&path]).unwrap();
        fixture.sync();
        let sessions = query_day_sessions(
            &fixture.db,
            "/repo/app",
            RANGE,
            "2026-07-01",
            "renamed",
            "UTC",
        )
        .unwrap();
        assert_eq!(sessions[0].agent_session_id.as_deref(), Some("child"));
        assert_eq!(sessions[0].parent_session_id.as_deref(), Some("root"));
        assert_eq!(sessions[0].agent_depth, 1);
        fixture
            .db
            .execute("DELETE FROM session_file_rollups WHERE path = ?", [&path])
            .unwrap();
        fixture.sync();
        assert_eq!(fixture.days("", None).total_sessions, 0);
        assert_eq!(
            fixture
                .db
                .query_row("SELECT COUNT(*) FROM project_session_index", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
    }

    #[test]
    fn refreshes_search_when_codex_titles_or_project_labels_change() {
        let mut fixture = Fixture::new();
        let id = "01977e3d-d9f6-72b7-93cf-f3f2f83c382c";
        fixture.seed(id, vec![day("2026-07-01", "/repo/app")]);
        fixture.sync();
        fs::write(
            fixture.home.join("session_index.jsonl"),
            format!(r#"{{"id":"{id}","thread_name":"Launch notes"}}"#),
        )
        .unwrap();
        fs::write(
            fixture.home.join(".codex-global-state.json"),
            r#"{"local-projects":{"app":{"name":"Usage Desktop","rootPaths":["/repo/app"]}}}"#,
        )
        .unwrap();
        fixture.sync();
        assert_eq!(fixture.days("LAUNCH NOTES", None).matching_sessions, 1);
        assert_eq!(fixture.days("usage desktop", None).matching_sessions, 1);
        let changes = fixture.db.total_changes();
        fs::write(fixture.home.join(".codex-global-state.json"), r#"{"local-projects":{"app":{"name":"Usage Desktop","rootPaths":["/repo/app"]}},"window-width":1200}"#).unwrap();
        fixture.sync();
        assert_eq!(fixture.db.total_changes(), changes);
    }

    #[test]
    fn preserves_quota_baselines_from_another_day() {
        let mut fixture = Fixture::new();
        let first = fixture.seed("preceding", vec![day("2026-07-01", "/repo/app")]);
        let second = fixture.seed("resumed", vec![day("2026-07-02", "/repo/app")]);
        for (path, date, end_at, end_percent) in [
            (first, "2026-07-01", "2026-07-01T23:00:00Z", 31.0),
            (second, "2026-07-02", "2026-07-02T08:00:00Z", 37.0),
        ] {
            let quota = SessionQuotaUsage {
                five_hour: vec![],
                weekly: vec![SessionQuotaWindowUsage {
                    window_minutes: 10080,
                    resets_at: Some("2026-07-06T00:00:00Z".to_string()),
                    observed_start_at: "2026-07-01T20:00:00Z".to_string(),
                    observed_end_at: end_at.to_string(),
                    observed_start_percent: 0.0,
                    observed_end_percent: end_percent,
                    observed_delta_percent: end_percent,
                    below_resolution: false,
                }],
            };
            let rollup = SessionQuotaRollup {
                session: quota.clone(),
                daily: BTreeMap::from([(date.to_string(), quota)]),
                model_samples: vec![],
            };
            fixture
                .db
                .execute(
                    "UPDATE session_file_rollups SET quota_usage_json = ? WHERE path = ?",
                    params![serde_json::to_string(&rollup).unwrap(), path],
                )
                .unwrap();
        }
        fixture.sync();
        let sessions = query_day_sessions(
            &fixture.db,
            "/repo/app",
            RANGE,
            "2026-07-02",
            "resumed",
            "UTC",
        )
        .unwrap();
        let window = &sessions[0].daily_usage[0]
            .quota_usage
            .as_ref()
            .unwrap()
            .weekly[0];
        assert_eq!(window.observed_start_percent, 31.0);
        assert_eq!(window.observed_delta_percent, 6.0);
    }

    #[test]
    fn assigns_zero_token_sessions_to_the_application_timezone_and_resets_index() {
        let mut fixture = Fixture::new();
        let mut usage = day("2026-07-01", "/repo/app");
        usage.total_tokens = 0;
        let path = fixture.seed("empty", vec![usage]);
        fixture
            .db
            .execute(
                "UPDATE session_file_rollups SET modified_at_ms = ? WHERE path = ?",
                params![
                    DateTime::parse_from_rfc3339("2026-06-30T18:00:00Z")
                        .unwrap()
                        .timestamp_millis(),
                    path
                ],
            )
            .unwrap();
        sync_index(&fixture.db, &fixture.home, "Asia/Singapore").unwrap();
        assert_eq!(fixture.days("", None).days[0].date, "2026-07-01");
        db::reset_usage_state(&fixture.db).unwrap();
        assert_eq!(fixture.days("", None).total_sessions, 0);
    }
}
