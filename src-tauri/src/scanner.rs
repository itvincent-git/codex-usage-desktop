use crate::{
    codex_environment::selected_codex_environment,
    date::{date_key_in_timezone, resolve_app_timezone},
    db::{
        delete_missing_daily_rows, delete_missing_session_file_rollups, query_session_file_rollup,
        record_scan_run, upsert_daily_rows, upsert_session_file_rollups, SessionAgentMetadata,
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
#[cfg(test)]
use std::io::{BufRead, BufReader};
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
    selected_codex_environment().home.clone()
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
        if let Some(mut rollup) =
            query_session_file_rollup(db, &file.cache_key, file.modified_at_ms, file.size_bytes)?
        {
            metrics.files_reused += 1;
            if rollup.prompt_title.is_none()
                || rollup.quota_usage.is_none()
                || rollup.agent_metadata.is_none()
            {
                if backfill_session_metadata(&file.path, timezone, &mut rollup) {
                    changed_rollups.push(rollup.clone());
                }
            }
            all_rows.extend(rollup.rows);
            continue;
        }

        let mut events = Vec::new();
        let (prompt_title, quota_usage, agent_metadata) =
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
            agent_metadata: Some(agent_metadata),
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

#[cfg(test)]
fn load_session_file(path: &Path, events: &mut Vec<UsageEvent>) -> Result<String, String> {
    load_session_file_with_quota(path, events, "UTC").map(|(title, _, _)| title)
}

fn load_session_file_with_quota(
    path: &Path,
    events: &mut Vec<UsageEvent>,
    timezone: &str,
) -> Result<(String, SessionQuotaRollup, SessionAgentMetadata), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut previous_totals: Option<RawUsage> = None;
    let mut current_model: Option<String> = None;
    let mut current_model_is_fallback = false;
    let mut current_project_path: Option<String> = None;
    let mut prompt_title = None;
    let mut agent_metadata = None;
    let mut quota_snapshots = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if prompt_title.is_none() {
            prompt_title = prompt_title_from_entry(&entry);
        }

        let entry_type = entry.get("type").and_then(Value::as_str);
        if entry_type == Some("session_meta") {
            if agent_metadata.is_none() {
                agent_metadata = Some(session_agent_metadata_from_entry(&entry));
            }
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
        build_quota_rollup(&quota_snapshots, timezone),
        agent_metadata.unwrap_or_default(),
    ))
}

fn backfill_session_metadata(path: &Path, timezone: &str, rollup: &mut SessionFileRollup) -> bool {
    match load_session_file_with_quota(path, &mut Vec::new(), timezone) {
        Ok((title, quota_usage, agent_metadata)) => {
            if rollup.prompt_title.is_none() {
                rollup.prompt_title = Some(title);
            }
            if rollup.quota_usage.is_none() {
                rollup.quota_usage = Some(quota_usage);
            }
            if rollup.agent_metadata.is_none() {
                rollup.agent_metadata = Some(agent_metadata);
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

fn build_quota_rollup(snapshots: &[QuotaSnapshot], timezone: &str) -> SessionQuotaRollup {
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
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| error.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if let Some(title) = prompt_title_from_entry(&entry) {
            return Ok(title);
        }
    }
    Ok(String::new())
}

fn prompt_title_from_entry(entry: &Value) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("event_msg") {
        return None;
    }
    let payload = entry.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("user_message") {
        return None;
    }

    ["message", "text"].into_iter().find_map(|field| {
        payload
            .get(field)
            .and_then(Value::as_str)
            .and_then(normalize_prompt_title)
    })
}

fn session_agent_metadata_from_entry(entry: &Value) -> SessionAgentMetadata {
    let payload = entry.get("payload").unwrap_or(&Value::Null);
    let thread_spawn = payload
        .get("source")
        .and_then(|source| source.get("subagent"))
        .and_then(|subagent| subagent.get("thread_spawn"));

    SessionAgentMetadata {
        thread_id: string_field(payload, "id"),
        parent_thread_id: thread_spawn.and_then(|spawn| string_field(spawn, "parent_thread_id")),
        agent_path: thread_spawn.and_then(|spawn| string_field(spawn, "agent_path")),
        agent_nickname: thread_spawn.and_then(|spawn| string_field(spawn, "agent_nickname")),
        agent_role: thread_spawn.and_then(|spawn| string_field(spawn, "agent_role")),
    }
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
            prompt_title_from_entry(&legacy_text_entry).as_deref(),
            Some("Legacy text field")
        );
    }

    #[test]
    fn extracts_subagent_parentage_from_session_metadata() {
        let entry = serde_json::json!({
            "type": "session_meta",
            "payload": {
                "id": "child-thread",
                "source": {
                    "subagent": {
                        "thread_spawn": {
                            "parent_thread_id": "parent-thread",
                            "agent_path": "/root/inspect_sidebar",
                            "agent_nickname": "Ada",
                            "agent_role": "explorer"
                        }
                    }
                }
            }
        });

        assert_eq!(
            session_agent_metadata_from_entry(&entry),
            SessionAgentMetadata {
                thread_id: Some("child-thread".to_string()),
                parent_thread_id: Some("parent-thread".to_string()),
                agent_path: Some("/root/inspect_sidebar".to_string()),
                agent_nickname: Some("Ada".to_string()),
                agent_role: Some("explorer".to_string()),
            }
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
    fn backfills_legacy_prompt_title_without_reparsing_usage() {
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
            "UPDATE session_file_rollups SET prompt_title = NULL, quota_usage_json = NULL, agent_metadata_json = NULL, updated_at = 'legacy'",
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
        let has_agent_metadata: bool = db
            .query_row(
                "SELECT agent_metadata_json IS NOT NULL FROM session_file_rollups WHERE path = ?",
                [&session_path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_agent_metadata);
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
                    agent_metadata: None,
                },
                SessionFileRollup {
                    path: valid_path.to_string_lossy().to_string(),
                    modified_at_ms: modified_at_ms(&valid_metadata),
                    size_bytes: valid_metadata.len() as i64,
                    rows: vec![],
                    prompt_title: None,
                    quota_usage: None,
                    agent_metadata: None,
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

        let (_, quota, _) = load_session_file_with_quota(&path, &mut Vec::new(), "UTC").unwrap();

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

        let duplicate = build_quota_rollup(&snapshots, "UTC");
        assert!(duplicate.session.five_hour[0].below_resolution);
        assert_eq!(duplicate.session.five_hour[0].observed_delta_percent, 0.0);
        assert!(duplicate.session.weekly.is_empty());

        let single = build_quota_rollup(&snapshots[..1], "UTC");
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

        let quota = build_quota_rollup(&snapshots, "UTC");

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

        let quota = build_quota_rollup(&snapshots, "Asia/Shanghai");

        assert_eq!(
            quota.daily["2026-07-02"].weekly[0].observed_delta_percent,
            3.0
        );
        assert!(!quota.daily.contains_key("2026-07-01"));
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
}
