use crate::{
    date::{date_key_in_timezone, resolve_app_timezone},
    db::{
        delete_missing_daily_rows, delete_missing_session_file_rollups, query_session_file_rollup,
        record_scan_run, upsert_daily_rows, upsert_session_file_rollups, SessionFileRollup,
    },
    pricing::{calculate_cost_usd, PricingSource},
    types::{DailyUsageRow, ModelUsage, ProjectUsage, ScanMetrics, ScanResponse},
};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};
use walkdir::WalkDir;

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
    let total_started = Instant::now();
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
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
    record_scan_run(db, &scanned_at, &timezone, scan.rows.len())?;

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

pub(crate) fn default_codex_home() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

#[cfg(test)]
fn load_token_usage_events(codex_home: Option<PathBuf>) -> Result<Vec<UsageEvent>, String> {
    let sessions_dir = codex_home
        .unwrap_or_else(default_codex_home)
        .join("sessions");
    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut events = Vec::new();
    for entry in WalkDir::new(sessions_dir)
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

        load_session_file(path, &mut events)?;
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
        if let Some(rows) =
            query_session_file_rollup(db, &file.cache_key, file.modified_at_ms, file.size_bytes)?
        {
            metrics.files_reused += 1;
            all_rows.extend(rows);
            continue;
        }

        let mut events = Vec::new();
        load_session_file(&file.path, &mut events)?;
        let rows = build_daily_rows(&events, timezone, updated_at, pricing_source);
        metrics.files_parsed += 1;
        metrics.bytes_read += file.size_bytes as u64;
        changed_rollups.push(SessionFileRollup {
            path: file.cache_key,
            modified_at_ms: file.modified_at_ms,
            size_bytes: file.size_bytes,
            rows: rows.clone(),
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
    let sessions_dir = codex_home
        .unwrap_or_else(default_codex_home)
        .join("sessions");
    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(sessions_dir)
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

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        files.push(SessionFile {
            path: path.to_path_buf(),
            cache_key: path.to_string_lossy().to_string(),
            modified_at_ms: modified_at_ms(&metadata),
            size_bytes: metadata.len() as i64,
        });
    }

    Ok(files)
}

fn modified_at_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn load_session_file(path: &Path, events: &mut Vec<UsageEvent>) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut previous_totals: Option<RawUsage> = None;
    let mut current_model: Option<String> = None;
    let mut current_model_is_fallback = false;
    let mut current_project_path: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        let entry_type = entry.get("type").and_then(Value::as_str);
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

    Ok(())
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
}
