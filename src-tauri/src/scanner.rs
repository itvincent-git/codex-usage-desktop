use crate::{
    codex_environment::selected_codex_environment,
    date::{date_key_in_timezone, resolve_app_timezone},
    db::{
        delete_missing_daily_rows, delete_missing_session_file_rollups, query_session_file_rollup,
        record_scan_run, upsert_daily_rows, upsert_session_file_rollups, ModelQuotaSample,
        SessionFileRollup, SessionQuotaRollup,
    },
    pricing::{calculate_cost_usd, PricingSource},
    types::{
        DailyUsageRow, ModelUsage, ProjectUsage, ScanMetrics, ScanResponse, SessionQuotaWindowUsage,
    },
};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Instant, SystemTime},
};
use walkdir::WalkDir;

pub(crate) static SCAN_MUTEX: Mutex<()> = Mutex::new(());

const LEGACY_FALLBACK_MODEL: &str = "gpt-5";

#[derive(Debug, Clone, Default)]
struct RawUsage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Clone)]
struct UsageEvent {
    timestamp: DateTime<Utc>,
    model: String,
    project_path: String,
    usage: ModelUsage,
    is_fallback_model: bool,
}

#[derive(Debug, Clone)]
struct QuotaSnapshot {
    timestamp: DateTime<Utc>,
    window_minutes: i64,
    used_percent: f64,
    resets_at: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionFile {
    path: PathBuf,
    cache_key: String,
    modified_at_ms: i64,
    size_bytes: i64,
}

pub fn scan_codex_usage(
    db: &mut Connection,
    pricing_source: &PricingSource,
    codex_home: Option<PathBuf>,
    timezone: Option<String>,
) -> Result<ScanResponse, String> {
    let _guard = SCAN_MUTEX.lock().map_err(|error| error.to_string())?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let db = &tx;
    let total_started = Instant::now();
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    let index_home = codex_home.clone().unwrap_or_else(default_codex_home);
    let scan = load_daily_rows(db, codex_home, &timezone, &scanned_at, pricing_source)?;
    let db_started = Instant::now();

    upsert_daily_rows(db, &scan.rows)?;
    let active_dates = scan
        .rows
        .iter()
        .map(|row| row.date.clone())
        .collect::<Vec<_>>();
    delete_missing_daily_rows(db, &active_dates)?;
    upsert_session_file_rollups(db, &scan.changed_rollups, &scanned_at)?;
    delete_missing_session_file_rollups(db, &scan.active_paths)?;
    crate::project_sessions::sync_index(db, &index_home, &timezone)?;
    record_scan_run(db, &scanned_at, &timezone, scan.rows.len())?;

    tx.commit().map_err(|error| error.to_string())?;
    let mut metrics = scan.metrics;
    metrics.db_ms = db_started.elapsed().as_millis();
    metrics.total_ms = total_started.elapsed().as_millis();

    Ok(ScanResponse {
        imported_days: scan.rows.len(),
        scanned_at,
        timezone,
        metrics,
    })
}

/// Scoped scans only replace selected cache entries. Global totals always use the entire cache.
pub fn rescan_session(
    db: &mut Connection,
    pricing: &PricingSource,
    codex_home: Option<PathBuf>,
    timezone: Option<String>,
    path: &str,
) -> Result<crate::types::SessionRescanResponse, String> {
    let _guard = SCAN_MUTEX.lock().map_err(|error| error.to_string())?;
    let started = Instant::now();
    let home = codex_home.unwrap_or_else(default_codex_home);
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let cached = crate::db::query_all_session_file_rollups(&tx)?;
    let id = session_file_id(Path::new(path));
    if !cached.iter().any(|rollup| {
        rollup.path == path
            || id
                .as_ref()
                .is_some_and(|id| session_file_id(Path::new(&rollup.path)).as_ref() == Some(id))
    }) {
        return Err("Session file is not indexed".into());
    }
    let files = find_session_files(Some(home.clone()))?;
    let file = files
        .iter()
        .find(|file| file.cache_key == path)
        .or_else(|| {
            id.as_ref().and_then(|id| {
                files
                    .iter()
                    .find(|file| session_file_id(&file.path).as_ref() == Some(id))
            })
        })
        .ok_or_else(|| "Session file no longer exists".to_string())?;
    let raw = fs::read_to_string(&file.path).map_err(|error| error.to_string())?;
    let rollup = parse_rollup(file, &raw, &timezone, &scanned_at, pricing)?;
    remove_duplicate_rollups(&tx, file, &cached)?;
    upsert_session_file_rollups(&tx, &[rollup], &scanned_at)?;
    let scan = finish_scoped_scan(
        &tx,
        &home,
        &timezone,
        &scanned_at,
        pricing,
        started,
        ScanMetrics {
            files_scanned: files.len(),
            files_parsed: 1,
            bytes_read: raw.len() as u64,
            parse_ms: started.elapsed().as_millis(),
            ..ScanMetrics::default()
        },
    )?;
    let mut detail =
        crate::session_replay::fetch_session_detail_with_raw(&tx, &file.cache_key, raw)?;
    let mut session = crate::db::query_session_detail(&tx, &file.cache_key)?;
    let names = crate::session_index::read_thread_names(&home).unwrap_or_default();
    detail.thread_name =
        crate::session_index::resolve_thread_name(&detail.path, detail.thread_name.take(), &names);
    session.thread_name = detail.thread_name.clone();
    if let Some(agent) = detail
        .agents
        .iter()
        .find(|agent| agent.path == session.path)
    {
        session.agent_session_id = Some(agent.session_id.clone());
        session.parent_session_id = agent.parent_session_id.clone();
        session.agent_depth = agent.depth;
        session.agent_path = Some(agent.agent_path.clone());
        session.agent_nickname = agent.nickname.clone();
        session.agent_role = agent.role.clone();
    }
    crate::codex_projects::CodexProjectCatalog::load(&home)
        .enrich_sessions(std::slice::from_mut(&mut session));
    tx.commit().map_err(|error| error.to_string())?;
    Ok(crate::types::SessionRescanResponse {
        scan,
        session,
        detail,
    })
}

pub fn rescan_project(
    db: &mut Connection,
    pricing: &PricingSource,
    codex_home: Option<PathBuf>,
    timezone: Option<String>,
    project: &str,
) -> Result<ScanResponse, String> {
    let _guard = SCAN_MUTEX.lock().map_err(|error| error.to_string())?;
    let started = Instant::now();
    let home = codex_home.unwrap_or_else(default_codex_home);
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let cached = crate::db::query_all_session_file_rollups(&tx)?;
    let files = find_session_files(Some(home.clone()))?;
    let mut metrics = ScanMetrics {
        files_scanned: files.len(),
        ..ScanMetrics::default()
    };
    for file in &files {
        let id = session_file_id(&file.path);
        let previous = cached
            .iter()
            .find(|rollup| rollup.path == file.cache_key)
            .or_else(|| {
                id.as_ref().and_then(|id| {
                    cached.iter().find(|rollup| {
                        session_file_id(Path::new(&rollup.path)).as_ref() == Some(id)
                    })
                })
            });
        let belonged = previous.is_some_and(|rollup| rollup_has_project(rollup, project));
        let unchanged = previous.is_some_and(|rollup| {
            rollup.modified_at_ms == file.modified_at_ms && rollup.size_bytes == file.size_bytes
        });
        // Changed or new files need only a metadata pass to discover project membership.
        let raw = if belonged || !unchanged || previous.is_some_and(|rollup| rollup.rows.is_empty())
        {
            Some(fs::read_to_string(&file.path).map_err(|error| error.to_string())?)
        } else {
            None
        };
        let belongs = raw
            .as_deref()
            .is_some_and(|raw| log_has_project(raw, project));
        if !belonged && !belongs {
            continue;
        }
        let raw = raw.unwrap_or_default();
        let rollup = parse_rollup(file, &raw, &timezone, &scanned_at, pricing)?;
        remove_duplicate_rollups(&tx, file, &cached)?;
        upsert_session_file_rollups(&tx, &[rollup], &scanned_at)?;
        metrics.files_parsed += 1;
        metrics.bytes_read += raw.len() as u64;
    }
    for rollup in &cached {
        if rollup_has_project(rollup, project)
            && !files.iter().any(|file| file.cache_key == rollup.path)
        {
            tx.execute(
                "DELETE FROM session_file_rollups WHERE path = ?",
                [&rollup.path],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    metrics.parse_ms = started.elapsed().as_millis();
    let response = finish_scoped_scan(
        &tx,
        &home,
        &timezone,
        &scanned_at,
        pricing,
        started,
        metrics,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(response)
}

fn rollup_has_project(rollup: &SessionFileRollup, project: &str) -> bool {
    rollup
        .rows
        .iter()
        .any(|row| row.projects.contains_key(project))
}

fn log_has_project(raw: &str, project: &str) -> bool {
    let mut current_project = None;
    for entry in raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
    {
        let payload = entry.get("payload").unwrap_or(&Value::Null);
        match entry.get("type").and_then(Value::as_str) {
            Some("session_meta") => current_project = extract_project_path(payload),
            Some("turn_context") => {
                if let Some(path) = extract_project_path(payload) {
                    current_project = Some(path);
                }
            }
            Some("event_msg")
                if payload.get("type").and_then(Value::as_str) == Some("token_count") =>
            {
                if current_project.as_deref().unwrap_or("Unknown") == project {
                    return true;
                }
            }
            _ => continue,
        }
        if current_project.as_deref() == Some(project) {
            return true;
        }
    }
    false
}

fn parse_rollup(
    file: &SessionFile,
    raw: &str,
    timezone: &str,
    updated_at: &str,
    pricing: &PricingSource,
) -> Result<SessionFileRollup, String> {
    let mut events = Vec::new();
    let (title, quota) = parse_session_file_with_quota(raw, &mut events, timezone)?;
    Ok(SessionFileRollup {
        path: file.cache_key.clone(),
        modified_at_ms: file.modified_at_ms,
        size_bytes: raw.len() as i64,
        rows: build_daily_rows(&events, timezone, updated_at, pricing),
        prompt_title: Some(title),
        quota_usage: Some(quota),
    })
}

fn remove_duplicate_rollups(
    db: &Connection,
    file: &SessionFile,
    cached: &[SessionFileRollup],
) -> Result<(), String> {
    let Some(id) = session_file_id(&file.path) else {
        return Ok(());
    };
    for rollup in cached {
        if rollup.path != file.cache_key
            && session_file_id(Path::new(&rollup.path)).as_ref() == Some(&id)
        {
            db.execute(
                "DELETE FROM session_file_rollups WHERE path = ?",
                [&rollup.path],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn finish_scoped_scan(
    db: &Connection,
    home: &Path,
    timezone: &str,
    scanned_at: &str,
    pricing: &PricingSource,
    started: Instant,
    mut metrics: ScanMetrics,
) -> Result<ScanResponse, String> {
    let db_started = Instant::now();
    let cached = crate::db::query_all_session_file_rollups(db)?;
    let mut rows = merge_daily_rows(
        cached.into_iter().flat_map(|rollup| rollup.rows).collect(),
        scanned_at,
    );
    apply_daily_costs(&mut rows, pricing);
    upsert_daily_rows(db, &rows)?;
    delete_missing_daily_rows(
        db,
        &rows.iter().map(|row| row.date.clone()).collect::<Vec<_>>(),
    )?;
    crate::project_sessions::sync_index(db, home, timezone)?;
    record_scan_run(db, scanned_at, timezone, rows.len())?;
    metrics.db_ms = db_started.elapsed().as_millis();
    metrics.total_ms = started.elapsed().as_millis();
    Ok(ScanResponse {
        imported_days: rows.len(),
        scanned_at: scanned_at.into(),
        timezone: timezone.into(),
        metrics,
    })
}

pub(crate) fn default_codex_home() -> PathBuf {
    selected_codex_environment().home.clone()
}

#[cfg(test)]
fn load_token_usage_events(codex_home: Option<PathBuf>) -> Result<Vec<UsageEvent>, String> {
    let mut events = Vec::new();
    for file in find_session_files(codex_home)? {
        load_session_file(&file.path, &mut events)?;
    }

    events.sort_by_key(|event| event.timestamp);
    Ok(events)
}

struct DailyRowsScan {
    rows: Vec<DailyUsageRow>,
    changed_rollups: Vec<SessionFileRollup>,
    active_paths: Vec<String>,
    metrics: ScanMetrics,
}

fn load_daily_rows(
    db: &Connection,
    codex_home: Option<PathBuf>,
    timezone: &str,
    updated_at: &str,
    pricing_source: &PricingSource,
) -> Result<DailyRowsScan, String> {
    let parse_started = Instant::now();
    let files = find_session_files(codex_home)?;
    let mut metrics = ScanMetrics {
        files_scanned: files.len(),
        ..ScanMetrics::default()
    };
    let mut all_rows = Vec::new();
    let mut changed_rollups = Vec::new();
    let mut active_paths = Vec::with_capacity(files.len());

    for file in files {
        active_paths.push(file.cache_key.clone());
        if let Some(mut rollup) =
            query_session_file_rollup(db, &file.cache_key, file.modified_at_ms, file.size_bytes)?
        {
            metrics.files_reused += 1;
            if rollup
                .prompt_title
                .as_deref()
                .unwrap_or_default()
                .is_empty()
                || rollup.quota_usage.is_none()
            {
                if backfill_session_metadata(&file.path, timezone, &mut rollup) {
                    changed_rollups.push(rollup.clone());
                }
            }
            all_rows.extend(rollup.rows);
            continue;
        }

        let mut events = Vec::new();
        let (prompt_title, quota_usage) =
            load_session_file_with_quota(&file.path, &mut events, timezone)?;
        let rows = build_daily_rows(&events, timezone, updated_at, pricing_source);
        metrics.files_parsed += 1;
        metrics.bytes_read += file.size_bytes as u64;
        changed_rollups.push(SessionFileRollup {
            path: file.cache_key,
            modified_at_ms: file.modified_at_ms,
            size_bytes: file.size_bytes,
            rows: rows.clone(),
            prompt_title: Some(prompt_title),
            quota_usage: Some(quota_usage),
        });
        all_rows.extend(rows);
    }

    let mut rows = merge_daily_rows(all_rows, updated_at);
    apply_daily_costs(&mut rows, pricing_source);
    metrics.parse_ms = parse_started.elapsed().as_millis();

    Ok(DailyRowsScan {
        rows,
        changed_rollups,
        active_paths,
        metrics,
    })
}

fn find_session_files(codex_home: Option<PathBuf>) -> Result<Vec<SessionFile>, String> {
    let codex_home = codex_home.unwrap_or_else(default_codex_home);
    let mut files = Vec::new();
    let mut seen = BTreeSet::new();
    // Active copies take precedence; archived rollouts can have a flat layout.
    for directory in ["sessions", "archived_sessions"] {
        let sessions_dir = codex_home.join(directory);
        if !sessions_dir.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&sessions_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let key = session_file_id(path)
                .map(|id| format!("id:{id}"))
                .unwrap_or_else(|| {
                    format!(
                        "path:{}",
                        path.strip_prefix(&sessions_dir).unwrap().display()
                    )
                });
            if !seen.insert(key) {
                continue;
            }

            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            files.push(SessionFile {
                path: path.to_path_buf(),
                cache_key: path.to_string_lossy().to_string(),
                modified_at_ms: modified_at_ms(&metadata),
                size_bytes: metadata.len() as i64,
            });
        }
    }

    Ok(files)
}

fn session_file_id(path: &Path) -> Option<String> {
    if let Some(id) = crate::session_index::rollout_thread_id(path) {
        return Some(id.to_string());
    }
    let file = fs::File::open(path).ok()?;
    let line = BufReader::new(file).lines().next()?.ok()?;
    let entry: Value = serde_json::from_str(&line).ok()?;
    if entry.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    entry
        .get("payload")?
        .get("id")?
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn modified_at_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
fn load_session_file(path: &Path, events: &mut Vec<UsageEvent>) -> Result<String, String> {
    load_session_file_with_quota(path, events, "UTC").map(|(title, _)| title)
}

fn load_session_file_with_quota(
    path: &Path,
    events: &mut Vec<UsageEvent>,
    timezone: &str,
) -> Result<(String, SessionQuotaRollup), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    parse_session_file_with_quota(&content, events, timezone)
}

fn parse_session_file_with_quota(
    content: &str,
    events: &mut Vec<UsageEvent>,
    timezone: &str,
) -> Result<(String, SessionQuotaRollup), String> {
    let mut previous_totals: Option<RawUsage> = None;
    let mut current_model: Option<String> = None;
    let mut current_model_is_fallback = false;
    let mut current_project_path: Option<String> = None;
    let mut prompt_title = None;
    let mut has_turn_context = false;
    let mut quota_snapshots = Vec::new();
    let event_start = events.len();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        let entry_type = entry.get("type").and_then(Value::as_str);
        if entry_type == Some("turn_context") {
            has_turn_context = true;
        }
        if prompt_title.is_none() {
            prompt_title = prompt_title_from_entry(&entry, has_turn_context);
        }

        if entry_type == Some("session_meta") {
            current_project_path =
                extract_project_path(entry.get("payload").unwrap_or(&Value::Null));
            continue;
        }

        if entry_type == Some("turn_context") {
            let payload = entry.get("payload").unwrap_or(&Value::Null);
            if let Some(model) = extract_model(payload) {
                current_model = Some(model);
                current_model_is_fallback = false;
            }
            if let Some(project_path) = extract_project_path(payload) {
                current_project_path = Some(project_path);
            }
            continue;
        }

        if entry_type != Some("event_msg") {
            continue;
        }

        let payload = entry.get("payload").unwrap_or(&Value::Null);
        if payload.get("type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }

        let Some(timestamp) = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc))
        else {
            continue;
        };

        let info = payload.get("info").unwrap_or(&Value::Null);
        extract_quota_snapshots(payload, timestamp, &mut quota_snapshots);
        let last_usage = normalize_raw_usage(info.get("last_token_usage"));
        let total_usage = normalize_raw_usage(info.get("total_token_usage"));
        let raw = last_usage.or_else(|| {
            total_usage
                .as_ref()
                .map(|current| subtract_raw_usage(current, previous_totals.as_ref()))
        });

        if let Some(total_usage) = total_usage {
            previous_totals = Some(total_usage);
        }

        let Some(raw) = raw else {
            continue;
        };

        let usage = convert_to_delta(&raw);
        if usage.input_tokens == 0
            && usage.cached_input_tokens == 0
            && usage.output_tokens == 0
            && usage.reasoning_output_tokens == 0
        {
            continue;
        }

        let extracted_model = extract_model(&merge_payload_info(payload, info));
        let mut is_fallback_model = false;
        if let Some(model) = extracted_model.clone() {
            current_model = Some(model);
            current_model_is_fallback = false;
        }

        let model = extracted_model
            .or_else(|| current_model.clone())
            .unwrap_or_else(|| {
                is_fallback_model = true;
                current_model_is_fallback = true;
                current_model = Some(LEGACY_FALLBACK_MODEL.to_string());
                LEGACY_FALLBACK_MODEL.to_string()
            });

        if current_model_is_fallback && current_model.as_deref() == Some(model.as_str()) {
            is_fallback_model = true;
        }

        events.push(UsageEvent {
            timestamp,
            model,
            project_path: current_project_path
                .clone()
                .unwrap_or_else(|| "Unknown".to_string()),
            usage,
            is_fallback_model,
        });
    }

    Ok((
        prompt_title.unwrap_or_default(),
        build_quota_rollup(&quota_snapshots, &events[event_start..], timezone),
    ))
}

fn backfill_session_metadata(path: &Path, timezone: &str, rollup: &mut SessionFileRollup) -> bool {
    match load_session_file_with_quota(path, &mut Vec::new(), timezone) {
        Ok((title, quota_usage)) => {
            if rollup
                .prompt_title
                .as_deref()
                .unwrap_or_default()
                .is_empty()
            {
                rollup.prompt_title = Some(title);
            }
            if rollup.quota_usage.is_none() {
                rollup.quota_usage = Some(quota_usage);
            }
            true
        }
        Err(error) => {
            log::warn!(
                "Failed to backfill session metadata from {}: {error}",
                path.display()
            );
            false
        }
    }
}

fn extract_quota_snapshots(
    payload: &Value,
    timestamp: DateTime<Utc>,
    output: &mut Vec<QuotaSnapshot>,
) {
    let limits = payload
        .get("rate_limits")
        .or_else(|| payload.get("rateLimits"))
        .or_else(|| {
            let info = payload.get("info")?;
            info.get("rate_limits").or_else(|| info.get("rateLimits"))
        });
    let Some(limits) = limits else { return };

    for key in ["primary", "secondary"] {
        let Some(window) = limits.get(key) else {
            continue;
        };
        let window_minutes = window
            .get("window_minutes")
            .or_else(|| window.get("windowMinutes"))
            .or_else(|| window.get("window_duration_mins"))
            .or_else(|| window.get("windowDurationMins"))
            .and_then(Value::as_i64);
        let used_percent = window
            .get("used_percent")
            .or_else(|| window.get("usedPercent"))
            .and_then(Value::as_f64);
        let (Some(window_minutes @ (300 | 10080)), Some(used_percent)) =
            (window_minutes, used_percent)
        else {
            continue;
        };
        let resets_at = window
            .get("resets_at")
            .or_else(|| window.get("resetsAt"))
            .and_then(format_reset_at);
        output.push(QuotaSnapshot {
            timestamp,
            window_minutes,
            used_percent,
            resets_at,
        });
    }
}

fn format_reset_at(value: &Value) -> Option<String> {
    if let Some(value) = value.as_str() {
        return Some(value.to_string());
    }
    value
        .as_i64()
        .and_then(|seconds| DateTime::<Utc>::from_timestamp(seconds, 0))
        .map(|timestamp| timestamp.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn build_quota_rollup(
    snapshots: &[QuotaSnapshot],
    events: &[UsageEvent],
    timezone: &str,
) -> SessionQuotaRollup {
    let mut rollup = SessionQuotaRollup::default();
    for window_minutes in [300, 10080] {
        let mut matching = snapshots
            .iter()
            .filter(|snapshot| snapshot.window_minutes == window_minutes)
            .cloned()
            .collect::<Vec<_>>();
        matching.sort_by_key(|snapshot| snapshot.timestamp);
        let (windows, daily) = summarize_quota_windows(&matching, timezone);
        if window_minutes == 300 {
            rollup.session.five_hour = windows;
            for (date, windows) in daily {
                rollup.daily.entry(date).or_default().five_hour = windows;
            }
        } else {
            rollup.session.weekly = windows;
            for (date, windows) in daily {
                rollup.daily.entry(date).or_default().weekly = windows;
            }
        }
    }
    for (date, usage) in &rollup.daily {
        for window in usage.five_hour.iter().chain(&usage.weekly) {
            let (Ok(start), Ok(end)) = (
                DateTime::parse_from_rfc3339(&window.observed_start_at),
                DateTime::parse_from_rfc3339(&window.observed_end_at),
            ) else {
                continue;
            };
            let matching = events
                .iter()
                .filter(|event| event.timestamp > start && event.timestamp <= end);
            let mut model = None;
            let mut tokens = 0;
            let mut mixed = false;
            for event in matching {
                if event.is_fallback_model || model.is_some_and(|name| name != event.model.as_str())
                {
                    mixed = true;
                    break;
                }
                model = Some(event.model.as_str());
                tokens += event.usage.total_tokens;
            }
            if !mixed && tokens > 0 {
                rollup.model_samples.push(ModelQuotaSample {
                    date: date.clone(),
                    model: model.expect("positive token count has a model").to_string(),
                    window_minutes: window.window_minutes,
                    observed_start_at: window.observed_start_at.clone(),
                    observed_end_at: window.observed_end_at.clone(),
                    tokens,
                    observed_delta_percent: window.observed_delta_percent,
                });
            }
        }
    }
    rollup
}

fn summarize_quota_windows(
    snapshots: &[QuotaSnapshot],
    timezone: &str,
) -> (
    Vec<SessionQuotaWindowUsage>,
    BTreeMap<String, Vec<SessionQuotaWindowUsage>>,
) {
    let mut windows = Vec::new();
    let mut daily = BTreeMap::<String, Vec<SessionQuotaWindowUsage>>::new();
    let mut start = 0;

    for index in 1..=snapshots.len() {
        let reset = index < snapshots.len()
            && snapshots[index].used_percent < snapshots[index - 1].used_percent;
        if index == snapshots.len() || reset {
            let segment = &snapshots[start..index];
            if segment.len() >= 2 {
                windows.push(quota_window_usage(segment));
                let mut daily_segments = BTreeMap::<String, Vec<QuotaSnapshot>>::new();
                for pair in segment.windows(2) {
                    let date = date_key_in_timezone(pair[1].timestamp, timezone);
                    let entry = daily_segments.entry(date).or_default();
                    if entry.is_empty() {
                        entry.push(pair[0].clone());
                    }
                    entry.push(pair[1].clone());
                }
                for (date, daily_segment) in daily_segments {
                    daily
                        .entry(date)
                        .or_default()
                        .push(quota_window_usage(&daily_segment));
                }
            }
            start = index;
        }
    }

    (windows, daily)
}

fn quota_window_usage(snapshots: &[QuotaSnapshot]) -> SessionQuotaWindowUsage {
    let first = snapshots.first().expect("quota segment has snapshots");
    let last = snapshots.last().expect("quota segment has snapshots");
    let observed_delta_percent = snapshots
        .windows(2)
        .map(|pair| (pair[1].used_percent - pair[0].used_percent).max(0.0))
        .sum::<f64>();
    SessionQuotaWindowUsage {
        window_minutes: first.window_minutes,
        resets_at: snapshots
            .iter()
            .rev()
            .find_map(|snapshot| snapshot.resets_at.clone()),
        observed_start_at: first
            .timestamp
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        observed_end_at: last
            .timestamp
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        observed_start_percent: first.used_percent,
        observed_end_percent: last.used_percent,
        observed_delta_percent,
        below_resolution: observed_delta_percent.round() == 0.0,
    }
}

#[cfg(test)]
fn load_prompt_title(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut has_turn_context = false;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| error.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) == Some("turn_context") {
            has_turn_context = true;
        }
        if let Some(title) = prompt_title_from_entry(&entry, has_turn_context) {
            return Ok(title);
        }
    }
    Ok(String::new())
}

fn prompt_title_from_entry(entry: &Value, has_turn_context: bool) -> Option<String> {
    let entry_type = entry.get("type").and_then(Value::as_str)?;
    let payload = entry.get("payload")?;

    if entry_type == "event_msg"
        && payload.get("type").and_then(Value::as_str) == Some("user_message")
    {
        return ["message", "text"].into_iter().find_map(|field| {
            payload
                .get(field)
                .and_then(Value::as_str)
                .and_then(normalize_prompt_title)
        });
    }

    if entry_type != "response_item"
        || !has_turn_context
        || payload.get("type").and_then(Value::as_str) != Some("message")
        || payload.get("role").and_then(Value::as_str) != Some("user")
    {
        return None;
    }

    payload
        .get("content")?
        .as_array()?
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("input_text"))
        .find_map(|item| {
            item.get("text")
                .and_then(Value::as_str)
                .and_then(normalize_prompt_title)
        })
}

fn normalize_prompt_title(message: &str) -> Option<String> {
    const MAX_CHARS: usize = 80;

    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    if normalized.chars().count() <= MAX_CHARS {
        return Some(normalized);
    }

    let mut title = normalized.chars().take(MAX_CHARS - 1).collect::<String>();
    title.push('…');
    Some(title)
}

fn merge_payload_info(payload: &Value, info: &Value) -> Value {
    let mut merged = payload.as_object().cloned().unwrap_or_default();
    merged.insert("info".to_string(), info.clone());
    Value::Object(merged)
}

fn normalize_raw_usage(value: Option<&Value>) -> Option<RawUsage> {
    let value = value?;
    if !value.is_object() {
        return None;
    }

    let input = number_field(value, "input_tokens");
    let cached = number_field(value, "cached_input_tokens")
        .or_else(|| number_field(value, "cache_read_input_tokens"))
        .unwrap_or(0);
    let output = number_field(value, "output_tokens").unwrap_or(0);
    let reasoning = number_field(value, "reasoning_output_tokens").unwrap_or(0);
    let total = number_field(value, "total_tokens").unwrap_or(0);

    Some(RawUsage {
        input_tokens: input.unwrap_or(0),
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: if total > 0 {
            total
        } else {
            input.unwrap_or(0) + output
        },
    })
}

fn number_field(value: &Value, field: &str) -> Option<i64> {
    value.get(field).and_then(Value::as_i64)
}

fn subtract_raw_usage(current: &RawUsage, previous: Option<&RawUsage>) -> RawUsage {
    RawUsage {
        input_tokens: (current.input_tokens
            - previous.map(|value| value.input_tokens).unwrap_or(0))
        .max(0),
        cached_input_tokens: (current.cached_input_tokens
            - previous.map(|value| value.cached_input_tokens).unwrap_or(0))
        .max(0),
        output_tokens: (current.output_tokens
            - previous.map(|value| value.output_tokens).unwrap_or(0))
        .max(0),
        reasoning_output_tokens: (current.reasoning_output_tokens
            - previous
                .map(|value| value.reasoning_output_tokens)
                .unwrap_or(0))
        .max(0),
        total_tokens: (current.total_tokens
            - previous.map(|value| value.total_tokens).unwrap_or(0))
        .max(0),
    }
}

fn convert_to_delta(raw: &RawUsage) -> ModelUsage {
    ModelUsage {
        input_tokens: raw.input_tokens,
        cached_input_tokens: raw.cached_input_tokens.min(raw.input_tokens),
        output_tokens: raw.output_tokens,
        reasoning_output_tokens: raw.reasoning_output_tokens,
        total_tokens: if raw.total_tokens > 0 {
            raw.total_tokens
        } else {
            raw.input_tokens + raw.output_tokens
        },
        is_fallback: None,
    }
}

fn extract_model(value: &Value) -> Option<String> {
    if let Some(info) = value.get("info") {
        if let Some(model) =
            string_field(info, "model").or_else(|| string_field(info, "model_name"))
        {
            return Some(model);
        }
        if let Some(model) = info
            .get("metadata")
            .and_then(|metadata| string_field(metadata, "model"))
        {
            return Some(model);
        }
    }

    string_field(value, "model").or_else(|| {
        value
            .get("metadata")
            .and_then(|metadata| string_field(metadata, "model"))
    })
}

fn extract_project_path(value: &Value) -> Option<String> {
    string_field(value, "cwd")
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_daily_rows(
    events: &[UsageEvent],
    timezone: &str,
    updated_at: &str,
    pricing_source: &PricingSource,
) -> Vec<DailyUsageRow> {
    let mut rows = build_daily_rows_without_cost(events, timezone, updated_at);
    apply_daily_costs(&mut rows, pricing_source);
    rows
}

fn build_daily_rows_without_cost(
    events: &[UsageEvent],
    timezone: &str,
    updated_at: &str,
) -> Vec<DailyUsageRow> {
    let mut summaries = BTreeMap::<String, DailyUsageRow>::new();

    for event in events {
        let date = date_key_in_timezone(event.timestamp, timezone);
        let summary = summaries
            .entry(date.clone())
            .or_insert_with(|| DailyUsageRow {
                date,
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 0,
                cost_usd: 0.0,
                models: BTreeMap::new(),
                projects: BTreeMap::new(),
                updated_at: updated_at.to_string(),
            });

        add_usage_to_row(summary, &event.usage);
        let model_usage = summary.models.entry(event.model.clone()).or_default();
        add_usage(model_usage, &event.usage);
        if event.is_fallback_model {
            model_usage.is_fallback = Some(true);
        }

        let project_usage = summary
            .projects
            .entry(event.project_path.clone())
            .or_default();
        add_usage_to_project(
            project_usage,
            &event.model,
            &event.usage,
            event.is_fallback_model,
        );
    }

    summaries.into_values().collect()
}

fn merge_daily_rows(rows: Vec<DailyUsageRow>, updated_at: &str) -> Vec<DailyUsageRow> {
    let mut summaries = BTreeMap::<String, DailyUsageRow>::new();

    for row in rows {
        let summary = summaries
            .entry(row.date.clone())
            .or_insert_with(|| DailyUsageRow {
                date: row.date,
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 0,
                cost_usd: 0.0,
                models: BTreeMap::new(),
                projects: BTreeMap::new(),
                updated_at: updated_at.to_string(),
            });

        summary.input_tokens += row.input_tokens;
        summary.cached_input_tokens += row.cached_input_tokens;
        summary.output_tokens += row.output_tokens;
        summary.reasoning_output_tokens += row.reasoning_output_tokens;
        summary.total_tokens += row.total_tokens;

        for (model, usage) in row.models {
            let target = summary.models.entry(model).or_default();
            let is_fallback = usage.is_fallback == Some(true);
            add_usage(target, &usage);
            if is_fallback {
                target.is_fallback = Some(true);
            }
        }

        for (project, usage) in row.projects {
            let target = summary.projects.entry(project).or_default();
            target.input_tokens += usage.input_tokens;
            target.cached_input_tokens += usage.cached_input_tokens;
            target.output_tokens += usage.output_tokens;
            target.reasoning_output_tokens += usage.reasoning_output_tokens;
            target.total_tokens += usage.total_tokens;

            for (model, model_usage) in usage.models {
                let target_model = target.models.entry(model).or_default();
                let is_fallback = model_usage.is_fallback == Some(true);
                add_usage(target_model, &model_usage);
                if is_fallback {
                    target_model.is_fallback = Some(true);
                }
            }
        }
    }

    summaries.into_values().collect()
}

fn apply_daily_costs(rows: &mut [DailyUsageRow], pricing_source: &PricingSource) {
    for row in rows {
        row.cost_usd = row
            .models
            .iter()
            .map(|(model, usage)| {
                calculate_cost_usd(usage, pricing_source.pricing_for_model(model))
            })
            .sum();
    }
}

fn add_usage_to_row(row: &mut DailyUsageRow, usage: &ModelUsage) {
    row.input_tokens += usage.input_tokens;
    row.cached_input_tokens += usage.cached_input_tokens;
    row.output_tokens += usage.output_tokens;
    row.reasoning_output_tokens += usage.reasoning_output_tokens;
    row.total_tokens += usage.total_tokens;
}

fn add_usage(target: &mut ModelUsage, usage: &ModelUsage) {
    target.input_tokens += usage.input_tokens;
    target.cached_input_tokens += usage.cached_input_tokens;
    target.output_tokens += usage.output_tokens;
    target.reasoning_output_tokens += usage.reasoning_output_tokens;
    target.total_tokens += usage.total_tokens;
}

fn add_usage_to_project(
    target: &mut ProjectUsage,
    model: &str,
    usage: &ModelUsage,
    is_fallback_model: bool,
) {
    target.input_tokens += usage.input_tokens;
    target.cached_input_tokens += usage.cached_input_tokens;
    target.output_tokens += usage.output_tokens;
    target.reasoning_output_tokens += usage.reasoning_output_tokens;
    target.total_tokens += usage.total_tokens;

    let model_usage = target.models.entry(model.to_string()).or_default();
    add_usage(model_usage, usage);
    if is_fallback_model {
        model_usage.is_fallback = Some(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn imports_daily_codex_usage() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions").join("project-alpha");
        fs::create_dir_all(&sessions).unwrap();
        let mut file = fs::File::create(sessions.join("session.jsonl")).unwrap();
        write!(
            file,
            "{}\n{}\n{}\n{}",
            token_context("2026-04-18T09:00:00.000Z", "gpt-5"),
            token_event(
                "2026-04-18T09:00:00.000Z",
                "gpt-5",
                1000,
                200,
                300,
                1300,
                1000,
                200,
                300,
                1300
            ),
            token_context("2026-04-21T12:00:00.000Z", "gpt-5"),
            token_event(
                "2026-04-21T12:00:00.000Z",
                "gpt-5",
                1800,
                300,
                500,
                2300,
                800,
                100,
                200,
                1000
            )
        )
        .unwrap();

        let events = load_token_usage_events(Some(codex_home)).unwrap();
        let pricing_source = PricingSource::embedded();
        let rows = build_daily_rows(&events, "UTC", "2026-04-26T00:00:00.000Z", &pricing_source);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].date, "2026-04-18");
        assert_eq!(rows[1].total_tokens, 1000);
        assert_eq!(rows[1].projects["Unknown"].total_tokens, 1000);
        assert!((rows[1].cost_usd - 0.0028875).abs() < f64::EPSILON);
    }

    #[test]
    fn groups_usage_by_project_directory() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home
            .join("sessions")
            .join("2026")
            .join("05")
            .join("08");
        fs::create_dir_all(&sessions).unwrap();
        let mut first_file = fs::File::create(sessions.join("first.jsonl")).unwrap();
        write!(
            first_file,
            "{}\n{}\n{}",
            session_meta("2026-05-08T08:00:00.000Z", "/repo/alpha"),
            token_context_with_cwd("2026-05-08T08:00:00.000Z", "gpt-5", "/repo/alpha"),
            token_event(
                "2026-05-08T08:00:00.000Z",
                "gpt-5",
                1000,
                200,
                300,
                1300,
                1000,
                200,
                300,
                1300
            )
        )
        .unwrap();

        let mut second_file = fs::File::create(sessions.join("second.jsonl")).unwrap();
        write!(
            second_file,
            "{}\n{}\n{}",
            session_meta("2026-05-08T09:00:00.000Z", "/repo/beta"),
            token_context_with_cwd("2026-05-08T09:00:00.000Z", "gpt-5.5", "/repo/beta"),
            token_event(
                "2026-05-08T09:00:00.000Z",
                "gpt-5.5",
                400,
                100,
                200,
                600,
                400,
                100,
                200,
                600
            )
        )
        .unwrap();

        let events = load_token_usage_events(Some(codex_home)).unwrap();
        let pricing_source = PricingSource::embedded();
        let rows = build_daily_rows(&events, "UTC", "2026-05-08T00:00:00.000Z", &pricing_source);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].projects["/repo/alpha"].total_tokens, 1300);
        assert_eq!(
            rows[0].projects["/repo/alpha"].models["gpt-5"].total_tokens,
            1300
        );
        assert_eq!(rows[0].projects["/repo/beta"].total_tokens, 600);
        assert_eq!(
            rows[0].projects["/repo/beta"].models["gpt-5.5"].total_tokens,
            600
        );
    }

    #[test]
    fn imports_gpt_5_5_with_non_zero_cost() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions").join("project-alpha");
        fs::create_dir_all(&sessions).unwrap();
        let mut file = fs::File::create(sessions.join("session.jsonl")).unwrap();
        write!(
            file,
            "{}\n{}",
            token_context("2026-05-08T09:00:00.000Z", "gpt-5.5"),
            token_event(
                "2026-05-08T09:00:00.000Z",
                "gpt-5.5",
                1000,
                200,
                300,
                1300,
                1000,
                200,
                300,
                1300
            )
        )
        .unwrap();

        let events = load_token_usage_events(Some(codex_home)).unwrap();
        let pricing_source = PricingSource::embedded();
        let rows = build_daily_rows(&events, "UTC", "2026-05-08T00:00:00.000Z", &pricing_source);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].models["gpt-5.5"].total_tokens, 1300);
        assert!((rows[0].cost_usd - 0.0131).abs() < f64::EPSILON);
    }

    #[test]
    fn extracts_first_real_user_message_for_prompt_title() {
        let temp_dir = tempfile_dir();
        let path = temp_dir.join("session.jsonl");
        let raw = [
            serde_json::json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "AGENTS and environment injection" }]
                }
            })
            .to_string(),
            serde_json::json!({
                "type": "event_msg",
                "payload": { "type": "user_message", "message": " \n\t " }
            })
            .to_string(),
            serde_json::json!({
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "  Build\n\t the dashboard  🙂 " }
            })
            .to_string(),
            serde_json::json!({
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "Later request" }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&path, raw).unwrap();

        let title = load_session_file(&path, &mut Vec::new()).unwrap();
        let legacy_text_entry = serde_json::json!({
            "type": "event_msg",
            "payload": { "type": "user_message", "text": "Legacy text field" }
        });

        assert_eq!(title, "Build the dashboard 🙂");
        assert_eq!(
            prompt_title_from_entry(&legacy_text_entry, false).as_deref(),
            Some("Legacy text field")
        );
    }

    #[test]
    fn extracts_response_item_title_after_turn_context() {
        let temp_dir = tempfile_dir();
        let path = temp_dir.join("session.jsonl");
        let raw = [
            serde_json::json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "AGENTS and environment injection" }]
                }
            })
            .to_string(),
            serde_json::json!({ "type": "turn_context", "payload": {} }).to_string(),
            serde_json::json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "  Fix\n the session titles  " }]
                }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&path, raw).unwrap();

        assert_eq!(
            load_session_file(&path, &mut Vec::new()).unwrap(),
            "Fix the session titles"
        );
    }

    #[test]
    fn normalizes_truncates_and_marks_missing_prompt_titles() {
        assert_eq!(
            normalize_prompt_title("  first\n\tsecond   third  ").as_deref(),
            Some("first second third")
        );

        let long = format!("{}🙂🙂🙂", "中".repeat(78));
        let truncated = normalize_prompt_title(&long).unwrap();
        assert_eq!(truncated.chars().count(), 80);
        assert_eq!(truncated, format!("{}🙂…", "中".repeat(78)));

        let temp_dir = tempfile_dir();
        let path = temp_dir.join("session.jsonl");
        fs::write(
            &path,
            serde_json::json!({
                "type": "response_item",
                "payload": { "type": "message", "role": "user", "content": [] }
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(load_prompt_title(&path).unwrap(), "");
    }

    #[test]
    fn backfills_empty_prompt_title_without_reparsing_usage() {
        let temp_dir = tempfile_dir();
        let db_path = temp_dir.join("usage.sqlite");
        let mut db = crate::db::open_database(&db_path).unwrap();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions").join("project-alpha");
        fs::create_dir_all(&sessions).unwrap();
        let session_path = sessions.join("session.jsonl");
        let initial_raw = format!(
            "{}\n{}\n{}",
            serde_json::json!({
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "Initial request" }
            }),
            token_context("2026-05-08T09:00:00.000Z", "gpt-5"),
            token_event(
                "2026-05-08T09:00:00.000Z",
                "gpt-5",
                1000,
                200,
                300,
                1300,
                1000,
                200,
                300,
                1300
            )
        );
        fs::write(&session_path, &initial_raw).unwrap();

        let pricing_source = PricingSource::embedded();
        scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home.clone()),
            Some("UTC".into()),
        )
        .unwrap();
        db.execute(
            "UPDATE session_file_rollups SET prompt_title = '', updated_at = 'legacy'",
            [],
        )
        .unwrap();

        let migrated = scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home.clone()),
            Some("UTC".into()),
        )
        .unwrap();
        let record = crate::db::query_session_rollup_record(&db, &session_path.to_string_lossy())
            .unwrap()
            .unwrap();

        assert_eq!(migrated.metrics.files_parsed, 0);
        assert_eq!(migrated.metrics.files_reused, 1);
        assert_eq!(record.prompt_title.as_deref(), Some("Initial request"));
        let has_quota_usage: bool = db
            .query_row(
                "SELECT quota_usage_json IS NOT NULL FROM session_file_rollups WHERE path = ?",
                [&session_path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_quota_usage);
        assert_eq!(record.rows[0].total_tokens, 1300);

        let unchanged = load_daily_rows(
            &db,
            Some(codex_home.clone()),
            "UTC",
            "2026-05-08T00:00:00.000Z",
            &pricing_source,
        )
        .unwrap();
        assert!(unchanged.changed_rollups.is_empty());

        let changed_raw = initial_raw.replace("Initial request", "Changed request with more text");
        fs::write(&session_path, changed_raw).unwrap();
        let changed = scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home),
            Some("UTC".into()),
        )
        .unwrap();
        let record = crate::db::query_session_rollup_record(&db, &session_path.to_string_lossy())
            .unwrap()
            .unwrap();

        assert_eq!(changed.metrics.files_parsed, 1);
        assert_eq!(
            record.prompt_title.as_deref(),
            Some("Changed request with more text")
        );
    }

    #[test]
    fn failed_title_backfill_preserves_usage_and_does_not_prevent_other_sessions() {
        let temp_dir = tempfile_dir();
        let db_path = temp_dir.join("usage.sqlite");
        let mut db = crate::db::open_database(&db_path).unwrap();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        let failed_path = sessions.join("failed.jsonl");
        let valid_path = sessions.join("valid.jsonl");
        fs::write(&failed_path, [0xff]).unwrap();
        fs::write(
            &valid_path,
            serde_json::json!({
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "Valid request" }
            })
            .to_string(),
        )
        .unwrap();
        let failed_metadata = fs::metadata(&failed_path).unwrap();
        let valid_metadata = fs::metadata(&valid_path).unwrap();
        let cached_row = DailyUsageRow {
            date: "2026-07-16".to_string(),
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 2,
            reasoning_output_tokens: 0,
            total_tokens: 3,
            cost_usd: 0.0,
            models: BTreeMap::new(),
            projects: BTreeMap::new(),
            updated_at: "legacy".to_string(),
        };
        crate::db::upsert_session_file_rollups(
            &mut db,
            &[
                SessionFileRollup {
                    path: failed_path.to_string_lossy().to_string(),
                    modified_at_ms: modified_at_ms(&failed_metadata),
                    size_bytes: failed_metadata.len() as i64,
                    rows: vec![cached_row],
                    prompt_title: None,
                    quota_usage: None,
                },
                SessionFileRollup {
                    path: valid_path.to_string_lossy().to_string(),
                    modified_at_ms: modified_at_ms(&valid_metadata),
                    size_bytes: valid_metadata.len() as i64,
                    rows: vec![],
                    prompt_title: None,
                    quota_usage: None,
                },
            ],
            "legacy",
        )
        .unwrap();

        let scan = scan_codex_usage(
            &mut db,
            &PricingSource::embedded(),
            Some(codex_home),
            Some("UTC".into()),
        )
        .unwrap();
        let failed = crate::db::query_session_rollup_record(&db, &failed_path.to_string_lossy())
            .unwrap()
            .unwrap();
        let valid = crate::db::query_session_rollup_record(&db, &valid_path.to_string_lossy())
            .unwrap()
            .unwrap();

        assert_eq!(scan.metrics.files_parsed, 0);
        assert_eq!(scan.metrics.files_reused, 2);
        assert_eq!(scan.imported_days, 1);
        assert_eq!(failed.rows[0].total_tokens, 3);
        assert_eq!(failed.prompt_title, None);
        assert_eq!(valid.prompt_title.as_deref(), Some("Valid request"));
    }

    #[test]
    fn reuses_unchanged_session_file_rollups() {
        let temp_dir = tempfile_dir();
        let db_path = temp_dir.join("usage.sqlite");
        let mut db = crate::db::open_database(&db_path).unwrap();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions").join("project-alpha");
        fs::create_dir_all(&sessions).unwrap();
        let mut file = fs::File::create(sessions.join("session.jsonl")).unwrap();
        write!(
            file,
            "{}\n{}",
            token_context("2026-05-08T09:00:00.000Z", "gpt-5"),
            token_event(
                "2026-05-08T09:00:00.000Z",
                "gpt-5",
                1000,
                200,
                300,
                1300,
                1000,
                200,
                300,
                1300
            )
        )
        .unwrap();
        drop(file);

        let pricing_source = PricingSource::embedded();
        let first = scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home.clone()),
            Some("UTC".into()),
        )
        .unwrap();
        let second = scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home.clone()),
            Some("UTC".into()),
        )
        .unwrap();

        assert_eq!(first.metrics.files_parsed, 1);
        assert_eq!(first.metrics.files_reused, 0);
        assert_eq!(
            crate::db::query_session_rollup_record(
                &db,
                &sessions.join("session.jsonl").to_string_lossy(),
            )
            .unwrap()
            .unwrap()
            .prompt_title
            .as_deref(),
            Some("")
        );
        assert_eq!(second.metrics.files_parsed, 0);
        assert_eq!(second.metrics.files_reused, 1);
        assert_eq!(second.imported_days, 1);

        crate::db::reset_usage_state(&db).unwrap();
        let third = scan_codex_usage(
            &mut db,
            &pricing_source,
            Some(codex_home),
            Some("UTC".into()),
        )
        .unwrap();

        assert_eq!(third.metrics.files_parsed, 1);
        assert_eq!(third.metrics.files_reused, 0);
    }

    #[test]
    fn imports_archived_sessions_without_active_sessions() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let archived = codex_home.join("archived_sessions").join("2026/09/01");
        fs::create_dir_all(&archived).unwrap();
        let path = archived.join("session.jsonl");
        write_usage_session(&path, "archived", 1000, 300);
        fs::write(archived.join("ignored.txt"), "not a session").unwrap();
        let mut db = crate::db::open_database(&temp_dir.join("usage.sqlite")).unwrap();

        let scan = scan_codex_usage(
            &mut db,
            &PricingSource::embedded(),
            Some(codex_home),
            Some("UTC".into()),
        )
        .unwrap();
        let rows = crate::db::query_all_daily_rows(&db).unwrap();

        assert_eq!(scan.metrics.files_scanned, 1);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].date, "2026-09-01");
        assert_eq!(rows[0].total_tokens, 1300);
        assert_eq!(rows[0].models["gpt-5"].total_tokens, 1300);
        assert_eq!(rows[0].projects["/repo/alpha"].total_tokens, 1300);
        assert!(rows[0].cost_usd > 0.0);
        assert_eq!(crate::db::query_session_details(&db).unwrap().len(), 1);
    }

    #[test]
    fn preserves_usage_when_a_session_is_archived_and_reuses_its_cache() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions/2026/09/01");
        let archived = codex_home.join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        let id = "01977e3d-d9f6-72b7-93cf-f3f2f83c382c";
        let active_path = sessions.join(format!("rollout-2026-09-01T09-00-00-{id}.jsonl"));
        let archived_path = archived.join(format!("rollout-2026-09-01T10-00-00-{id}.jsonl"));
        write_usage_session(&active_path, id, 1000, 300);
        let mut db = crate::db::open_database(&temp_dir.join("usage.sqlite")).unwrap();
        let pricing = PricingSource::embedded();
        let scan = |db: &mut Connection| {
            scan_codex_usage(db, &pricing, Some(codex_home.clone()), Some("UTC".into())).unwrap()
        };
        scan(&mut db);
        let initial = crate::db::query_all_daily_rows(&db).unwrap().remove(0);

        // An archived copy must not override the active file, even if it differs.
        write_usage_session(&archived_path, id, 4000, 900);
        let duplicate = scan(&mut db);
        assert_eq!(duplicate.metrics.files_scanned, 1);
        assert_eq!(duplicate.metrics.files_reused, 1);
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
            initial.total_tokens
        );

        fs::rename(&active_path, &archived_path).unwrap();
        let moved = scan(&mut db);
        let after = crate::db::query_all_daily_rows(&db).unwrap().remove(0);
        assert_eq!(moved.metrics.files_parsed, 1);
        assert_eq!(after.date, initial.date);
        assert_eq!(after.input_tokens, initial.input_tokens);
        assert_eq!(after.cached_input_tokens, initial.cached_input_tokens);
        assert_eq!(after.output_tokens, initial.output_tokens);
        assert_eq!(after.total_tokens, initial.total_tokens);
        assert_eq!(after.cost_usd, initial.cost_usd);
        assert!(
            crate::db::query_session_rollup_record(&db, &active_path.to_string_lossy())
                .unwrap()
                .is_none()
        );
        let indexed = crate::db::query_session_details(&db).unwrap();
        assert_eq!(indexed.len(), 1);
        assert_eq!(indexed[0].path, archived_path.to_string_lossy());
        let cached = scan(&mut db);
        assert_eq!(cached.metrics.files_parsed, 0);
        assert_eq!(cached.metrics.files_reused, 1);
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
            initial.total_tokens
        );
    }

    #[test]
    fn deduplicates_archived_sessions_by_metadata_with_nonstandard_filenames() {
        let temp_dir = tempfile_dir();
        let codex_home = temp_dir.join(".codex");
        let sessions = codex_home.join("sessions/2026/09/01");
        let archived = codex_home.join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        write_usage_session(&sessions.join("session.jsonl"), "same-session", 1000, 300);
        write_usage_session(&archived.join("renamed.jsonl"), "same-session", 4000, 900);
        write_usage_session(&archived.join("session.jsonl"), "other-session", 400, 200);
        let mut db = crate::db::open_database(&temp_dir.join("usage.sqlite")).unwrap();

        let scan = scan_codex_usage(
            &mut db,
            &PricingSource::embedded(),
            Some(codex_home),
            Some("UTC".into()),
        )
        .unwrap();

        assert_eq!(scan.metrics.files_scanned, 2);
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
            1900
        );
        assert_eq!(crate::db::query_session_details(&db).unwrap().len(), 2);
    }

    fn write_usage_session(path: &Path, id: &str, input: i64, output: i64) {
        let timestamp = "2026-09-01T09:00:00.000Z";
        let total = input + output;
        fs::write(path, [
            serde_json::json!({ "timestamp": timestamp, "type": "session_meta", "payload": { "id": id, "cwd": "/repo/alpha" } }).to_string(),
            token_context(timestamp, "gpt-5"),
            token_event(timestamp, "gpt-5", input, 0, output, total, input, 0, output, total),
        ].join("\n")).unwrap();
    }

    #[test]
    fn parses_five_hour_and_weekly_quota_snapshots() {
        let temp_dir = tempfile_dir();
        let path = temp_dir.join("quota.jsonl");
        fs::write(
            &path,
            [
                quota_event("2026-07-01T10:00:00Z", 10.0, 20.0, 1_783_000_000),
                quota_event("2026-07-01T10:05:00Z", 13.0, 21.0, 1_783_000_003),
            ]
            .join("\n"),
        )
        .unwrap();

        let (_, quota) = load_session_file_with_quota(&path, &mut Vec::new(), "UTC").unwrap();

        assert_eq!(quota.session.five_hour.len(), 1);
        assert_eq!(quota.session.weekly.len(), 1);
        assert_eq!(quota.session.five_hour[0].observed_delta_percent, 3.0);
        assert_eq!(quota.session.weekly[0].observed_delta_percent, 1.0);
        assert_eq!(quota.session.five_hour[0].observed_start_percent, 10.0);
        assert_eq!(quota.session.five_hour[0].observed_end_percent, 13.0);
        assert_eq!(quota.session.weekly[0].observed_start_percent, 20.0);
        assert_eq!(quota.session.weekly[0].observed_end_percent, 21.0);
        assert_eq!(quota.session.five_hour[0].window_minutes, 300);
    }

    #[test]
    fn quota_windows_handle_duplicates_missing_values_and_single_snapshots() {
        let timestamp = |value: &str| value.parse::<DateTime<Utc>>().unwrap();
        let snapshots = vec![
            QuotaSnapshot {
                timestamp: timestamp("2026-07-01T10:00:00Z"),
                window_minutes: 300,
                used_percent: 10.0,
                resets_at: None,
            },
            QuotaSnapshot {
                timestamp: timestamp("2026-07-01T10:01:00Z"),
                window_minutes: 300,
                used_percent: 10.0,
                resets_at: None,
            },
        ];

        let duplicate = build_quota_rollup(&snapshots, &[], "UTC");
        assert!(duplicate.session.five_hour[0].below_resolution);
        assert_eq!(duplicate.session.five_hour[0].observed_delta_percent, 0.0);
        assert!(duplicate.session.weekly.is_empty());

        let single = build_quota_rollup(&snapshots[..1], &[], "UTC");
        assert!(single.session.five_hour.is_empty());
    }

    #[test]
    fn quota_usage_splits_on_reset_but_ignores_reset_timestamp_drift() {
        let timestamp = |value: &str| value.parse::<DateTime<Utc>>().unwrap();
        let snapshot = |time: &str, used_percent: f64, reset: &str| QuotaSnapshot {
            timestamp: timestamp(time),
            window_minutes: 300,
            used_percent,
            resets_at: Some(reset.to_string()),
        };
        let snapshots = vec![
            snapshot("2026-07-01T10:00:00Z", 10.0, "2026-07-01T15:00:00Z"),
            snapshot("2026-07-01T10:05:00Z", 12.0, "2026-07-01T15:00:03Z"),
            snapshot("2026-07-01T15:01:00Z", 1.0, "2026-07-01T20:00:00Z"),
            snapshot("2026-07-01T15:05:00Z", 4.0, "2026-07-01T20:00:02Z"),
        ];

        let quota = build_quota_rollup(&snapshots, &[], "UTC");

        assert_eq!(quota.session.five_hour.len(), 2);
        assert_eq!(quota.session.five_hour[0].observed_delta_percent, 2.0);
        assert_eq!(quota.session.five_hour[1].observed_delta_percent, 3.0);
    }

    #[test]
    fn quota_increments_belong_to_the_later_snapshot_application_date() {
        let timestamp = |value: &str| value.parse::<DateTime<Utc>>().unwrap();
        let snapshots = vec![
            QuotaSnapshot {
                timestamp: timestamp("2026-07-01T15:59:00Z"),
                window_minutes: 10080,
                used_percent: 20.0,
                resets_at: None,
            },
            QuotaSnapshot {
                timestamp: timestamp("2026-07-01T16:01:00Z"),
                window_minutes: 10080,
                used_percent: 22.0,
                resets_at: None,
            },
            QuotaSnapshot {
                timestamp: timestamp("2026-07-02T01:00:00Z"),
                window_minutes: 10080,
                used_percent: 23.0,
                resets_at: None,
            },
        ];

        let quota = build_quota_rollup(&snapshots, &[], "Asia/Shanghai");

        assert_eq!(
            quota.daily["2026-07-02"].weekly[0].observed_delta_percent,
            3.0
        );
        assert!(!quota.daily.contains_key("2026-07-01"));
    }

    #[test]
    fn model_quota_samples_require_one_known_model_between_snapshots() {
        let timestamp = |value: &str| value.parse::<DateTime<Utc>>().unwrap();
        let snapshot = |time: &str, percent: f64| QuotaSnapshot {
            timestamp: timestamp(time),
            window_minutes: 300,
            used_percent: percent,
            resets_at: None,
        };
        let event = |time: &str, model: &str, fallback: bool| UsageEvent {
            timestamp: timestamp(time),
            model: model.to_string(),
            project_path: "test".to_string(),
            usage: ModelUsage {
                total_tokens: 250_000,
                ..ModelUsage::default()
            },
            is_fallback_model: fallback,
        };
        let snapshots = vec![
            snapshot("2026-07-01T10:00:00Z", 10.0),
            snapshot("2026-07-01T10:05:00Z", 10.0),
            snapshot("2026-07-01T10:10:00Z", 12.0),
            snapshot("2026-07-01T15:00:00Z", 1.0),
            snapshot("2026-07-01T15:05:00Z", 3.0),
        ];
        let events = vec![
            event("2026-07-01T10:00:00Z", "earlier", false),
            event("2026-07-01T10:05:00Z", "gpt-a", false),
            event("2026-07-01T10:10:00Z", "gpt-a", false),
            event("2026-07-01T15:05:00Z", "gpt-b", false),
        ];
        let quota = build_quota_rollup(&snapshots, &events, "UTC");
        assert_eq!(quota.model_samples.len(), 2);
        assert_eq!(quota.model_samples[0].model, "gpt-a");
        assert_eq!(quota.model_samples[0].tokens, 500_000);
        assert_eq!(quota.model_samples[0].observed_delta_percent, 2.0);
        assert_eq!(quota.model_samples[1].model, "gpt-b");

        let mixed = build_quota_rollup(
            &snapshots[..3],
            &[
                events[1].clone(),
                event("2026-07-01T10:10:00Z", "gpt-b", false),
            ],
            "UTC",
        );
        assert!(mixed.model_samples.is_empty());
        let fallback = build_quota_rollup(
            &snapshots[..3],
            &[event("2026-07-01T10:05:00Z", "gpt-a", true)],
            "UTC",
        );
        assert!(fallback.model_samples.is_empty());
    }

    fn tempfile_dir() -> PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "codex-usage-desktop-rust-{}-{}",
            Utc::now().timestamp_nanos_opt().unwrap(),
            counter
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn token_context(timestamp: &str, model: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": { "model": model }
        })
        .to_string()
    }

    fn token_context_with_cwd(timestamp: &str, model: &str, cwd: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": { "model": model, "cwd": cwd }
        })
        .to_string()
    }

    fn session_meta(timestamp: &str, cwd: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": { "cwd": cwd }
        })
        .to_string()
    }

    #[allow(clippy::too_many_arguments)]
    fn token_event(
        timestamp: &str,
        model: &str,
        total_input: i64,
        total_cached_input: i64,
        total_output: i64,
        total_tokens: i64,
        last_input: i64,
        last_cached_input: i64,
        last_output: i64,
        last_tokens: i64,
    ) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "model": model,
                    "total_token_usage": {
                        "input_tokens": total_input,
                        "cached_input_tokens": total_cached_input,
                        "output_tokens": total_output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": total_tokens
                    },
                    "last_token_usage": {
                        "input_tokens": last_input,
                        "cached_input_tokens": last_cached_input,
                        "output_tokens": last_output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": last_tokens
                    }
                }
            }
        })
        .to_string()
    }

    fn quota_event(timestamp: &str, five_hour: f64, weekly: f64, resets_at: i64) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {},
                "rate_limits": {
                    "primary": {
                        "used_percent": five_hour,
                        "window_minutes": 300,
                        "resets_at": resets_at
                    },
                    "secondary": {
                        "used_percent": weekly,
                        "window_minutes": 10080,
                        "resets_at": resets_at + 100
                    }
                }
            }
        })
        .to_string()
    }
    fn scoped_fixture() -> (PathBuf, PathBuf, Connection) {
        let directory = tempfile_dir();
        let home = directory.join("codex");
        fs::create_dir_all(home.join("sessions")).unwrap();
        let db = crate::db::open_database(&directory.join("usage.sqlite")).unwrap();
        (directory, home, db)
    }

    fn scoped_log(project: &str, tokens: i64, message: &str) -> String {
        [
            serde_json::json!({"timestamp":"2026-09-01T09:00:00Z", "type":"session_meta", "payload":{"cwd":project}}),
            serde_json::json!({"timestamp":"2026-09-01T09:00:00Z", "type":"turn_context", "payload":{"model":"gpt-5", "cwd":project}}),
            serde_json::json!({"timestamp":"2026-09-01T09:00:00Z", "type":"event_msg", "payload":{"type":"user_message", "message":message}}),
            serde_json::json!({"timestamp":"2026-09-01T09:00:00Z", "type":"event_msg", "payload":{"type":"token_count", "info":{"last_token_usage":{"input_tokens":tokens,"output_tokens":10,"total_tokens":tokens+10}}, "rate_limits":{"primary":{"window_minutes":300,"used_percent":10}}}}),
            serde_json::json!({"timestamp":"2026-09-01T09:01:00Z", "type":"event_msg", "payload":{"type":"token_count", "rate_limits":{"primary":{"window_minutes":300,"used_percent":12}}}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
    }

    fn scoped_snapshot(db: &Connection) -> Vec<String> {
        [
            "SELECT rows_json FROM session_file_rollups ORDER BY path",
            "SELECT models_json FROM daily_usage_rollups ORDER BY date",
            "SELECT detail_json FROM project_session_index ORDER BY path",
        ]
        .into_iter()
        .flat_map(|sql| {
            db.prepare(sql)
                .unwrap()
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        })
        .collect()
    }

    #[test]
    fn session_rescan_updates_only_target_and_replaces_daily_totals() {
        let (_directory, home, mut db) = scoped_fixture();
        let a = home.join("sessions").join("a.jsonl");
        let b = home.join("sessions").join("b.jsonl");
        fs::write(&a, scoped_log("/repo/a", 100, "before")).unwrap();
        fs::write(&b, scoped_log("/repo/b", 200, "unrelated")).unwrap();
        let pricing = PricingSource::embedded();
        scan_codex_usage(&mut db, &pricing, Some(home.clone()), Some("UTC".into())).unwrap();
        let original_b = serde_json::to_string(
            &crate::db::query_session_detail(&db, b.to_str().unwrap()).unwrap(),
        )
        .unwrap();
        fs::write(&a, scoped_log("/repo/a", 500, "after refresh")).unwrap();
        fs::write(&b, scoped_log("/repo/b", 9999, "must remain cached")).unwrap();
        for _ in 0..2 {
            let result = rescan_session(
                &mut db,
                &pricing,
                Some(home.clone()),
                Some("UTC".into()),
                a.to_str().unwrap(),
            )
            .unwrap();
            assert_eq!(result.scan.metrics.files_parsed, 1);
            assert_eq!(result.session.total_tokens, 510);
            assert_eq!(
                result.detail.summary.total_tokens,
                result.session.total_tokens
            );
            assert_eq!(result.detail.summary.cost_usd, result.session.cost_usd);
            assert!(result.detail.raw_jsonl.contains("after refresh"));
            assert_eq!(
                result.session.quota_usage.unwrap().five_hour[0].observed_delta_percent,
                2.0
            );
            assert_eq!(
                crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
                720
            );
            assert_eq!(
                serde_json::to_string(
                    &crate::db::query_session_detail(&db, b.to_str().unwrap()).unwrap()
                )
                .unwrap(),
                original_b
            );
        }
        let snapshot = scoped_snapshot(&db);
        fs::remove_file(&a).unwrap();
        assert!(rescan_session(
            &mut db,
            &pricing,
            Some(home),
            Some("UTC".into()),
            a.to_str().unwrap()
        )
        .unwrap_err()
        .contains("no longer exists"));
        assert_eq!(scoped_snapshot(&db), snapshot);
    }

    #[test]
    fn project_rescan_discovers_changes_new_sessions_and_cross_project_contexts() {
        let (_directory, home, mut db) = scoped_fixture();
        let a = home.join("sessions").join("a.jsonl");
        let b = home.join("sessions").join("b.jsonl");
        let moved = home.join("sessions").join("moved.jsonl");
        fs::write(&a, scoped_log("/repo/alpha", 100, "delete me")).unwrap();
        fs::write(&b, scoped_log("/repo/beta", 200, "unrelated")).unwrap();
        fs::write(&moved, scoped_log("/repo/alpha", 50, "moves to beta")).unwrap();
        let pricing = PricingSource::embedded();
        scan_codex_usage(&mut db, &pricing, Some(home.clone()), Some("UTC".into())).unwrap();
        fs::remove_file(&a).unwrap();
        fs::write(&b, scoped_log("/repo/beta", 9999, "unrelated changed")).unwrap();
        fs::write(&moved, scoped_log("/repo/beta", 75, "now beta")).unwrap();
        fs::write(
            home.join("sessions").join("new.jsonl"),
            scoped_log("/repo/alpha", 300, "new session"),
        )
        .unwrap();
        let cross = format!(
            "{}\n{}",
            scoped_log("/repo/beta", 40, "cross project"),
            scoped_log("/repo/alpha", 60, "second cwd")
        );
        fs::write(home.join("sessions").join("cross.jsonl"), cross).unwrap();
        let result = rescan_project(
            &mut db,
            &pricing,
            Some(home.clone()),
            Some("UTC".into()),
            "/repo/alpha",
        )
        .unwrap();
        assert_eq!(result.metrics.files_parsed, 3);
        let sessions = crate::db::query_session_details(&db).unwrap();
        assert_eq!(sessions.len(), 4);
        assert_eq!(
            sessions
                .iter()
                .find(|session| session.path == b.to_string_lossy())
                .unwrap()
                .total_tokens,
            210
        );
        let daily = crate::db::query_all_daily_rows(&db).unwrap();
        assert_eq!(daily[0].projects["/repo/alpha"].total_tokens, 380);
        assert_eq!(daily[0].projects["/repo/beta"].total_tokens, 345);
        assert_eq!(daily[0].total_tokens, 725);
        let days = crate::project_sessions::query_days(
            &db,
            "/repo/alpha",
            "custom:2026-09-01_2026-09-01",
            "",
            None,
            "UTC",
        )
        .unwrap();
        assert_eq!(days.total_sessions, 2);
        rescan_project(
            &mut db,
            &pricing,
            Some(home),
            Some("UTC".into()),
            "/repo/alpha",
        )
        .unwrap();
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
            725
        );
    }

    #[test]
    fn scoped_scans_resolve_archived_paths_and_deduplicate_copies() {
        let (_directory, home, mut db) = scoped_fixture();
        let name = "rollout-2026-09-01T09-00-00-01977e3d-d9f6-72b7-93cf-f3f2f83c382c.jsonl";
        let active = home.join("sessions").join(name);
        let archived = home.join("archived_sessions").join(name);
        fs::create_dir_all(archived.parent().unwrap()).unwrap();
        fs::write(&active, scoped_log("/repo/a", 100, "active")).unwrap();
        fs::copy(&active, &archived).unwrap();
        let pricing = PricingSource::embedded();
        scan_codex_usage(&mut db, &pricing, Some(home.clone()), Some("UTC".into())).unwrap();
        let result = rescan_session(
            &mut db,
            &pricing,
            Some(home.clone()),
            Some("UTC".into()),
            active.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(result.session.path, active.to_string_lossy());
        fs::remove_file(&active).unwrap();
        fs::write(&archived, scoped_log("/repo/a", 500, "archived update")).unwrap();
        let result = rescan_session(
            &mut db,
            &pricing,
            Some(home.clone()),
            Some("UTC".into()),
            active.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(result.session.path, archived.to_string_lossy());
        assert_eq!(crate::db::query_session_details(&db).unwrap().len(), 1);
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].total_tokens,
            510
        );
        // A project scan also follows the cached ID when the file moves and its cwd changes.
        fs::rename(&archived, &active).unwrap();
        fs::write(&active, scoped_log("/repo/b", 600, "moved project")).unwrap();
        rescan_project(&mut db, &pricing, Some(home), Some("UTC".into()), "/repo/a").unwrap();
        assert_eq!(
            crate::db::query_session_details(&db).unwrap()[0].total_tokens,
            610
        );
        assert_eq!(
            crate::db::query_all_daily_rows(&db).unwrap()[0].projects["/repo/b"].total_tokens,
            610
        );
    }

    #[test]
    fn scans_roll_back_cache_totals_and_index_on_write_failure() {
        let (_directory, home, mut db) = scoped_fixture();
        let path = home.join("sessions").join("a.jsonl");
        fs::write(&path, scoped_log("/repo/a", 100, "initial")).unwrap();
        let pricing = PricingSource::embedded();
        scan_codex_usage(&mut db, &pricing, Some(home.clone()), Some("UTC".into())).unwrap();
        let snapshot = scoped_snapshot(&db);
        fs::write(&path, scoped_log("/repo/a", 500, "changed")).unwrap();
        db.execute_batch("CREATE TRIGGER reject_scan BEFORE INSERT ON scan_runs BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        assert!(rescan_session(
            &mut db,
            &pricing,
            Some(home.clone()),
            Some("UTC".into()),
            path.to_str().unwrap()
        )
        .unwrap_err()
        .contains("injected failure"));
        assert_eq!(scoped_snapshot(&db), snapshot);
        assert!(rescan_project(
            &mut db,
            &pricing,
            Some(home.clone()),
            Some("UTC".into()),
            "/repo/a"
        )
        .unwrap_err()
        .contains("injected failure"));
        assert_eq!(scoped_snapshot(&db), snapshot);
        assert!(
            scan_codex_usage(&mut db, &pricing, Some(home), Some("UTC".into()))
                .unwrap_err()
                .contains("injected failure")
        );
        assert_eq!(scoped_snapshot(&db), snapshot);
    }

    #[test]
    fn concurrent_full_and_scoped_scans_keep_cache_and_totals_consistent() {
        let (directory, home, mut db) = scoped_fixture();
        let path = home.join("sessions").join("a.jsonl");
        fs::write(&path, scoped_log("/repo/a", 100, "initial")).unwrap();
        scan_codex_usage(
            &mut db,
            &PricingSource::embedded(),
            Some(home.clone()),
            Some("UTC".into()),
        )
        .unwrap();
        fs::write(&path, scoped_log("/repo/a", 500, "changed")).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let threads = (0..3)
            .map(|kind| {
                let mut connection =
                    crate::db::open_database(&directory.join("usage.sqlite")).unwrap();
                let (home, path, barrier) = (home.clone(), path.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    match kind {
                        0 => {
                            scan_codex_usage(
                                &mut connection,
                                &PricingSource::embedded(),
                                Some(home),
                                Some("UTC".into()),
                            )
                            .unwrap();
                        }
                        1 => {
                            rescan_session(
                                &mut connection,
                                &PricingSource::embedded(),
                                Some(home),
                                Some("UTC".into()),
                                path.to_str().unwrap(),
                            )
                            .unwrap();
                        }
                        _ => {
                            rescan_project(
                                &mut connection,
                                &PricingSource::embedded(),
                                Some(home),
                                Some("UTC".into()),
                                "/repo/a",
                            )
                            .unwrap();
                        }
                    }
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().unwrap();
        }
        let session = crate::db::query_session_details(&db).unwrap().remove(0);
        let daily = crate::db::query_all_daily_rows(&db).unwrap().remove(0);
        assert_eq!(daily.total_tokens, 510);
        assert_eq!(daily.total_tokens, session.total_tokens);
        assert_eq!(daily.cost_usd, session.cost_usd);
    }
}
