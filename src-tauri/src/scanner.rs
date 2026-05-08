use crate::{
    date::{date_key_in_timezone, resolve_app_timezone},
    db::{record_scan_run, upsert_daily_rows},
    pricing::{calculate_cost_usd, PricingSource},
    types::{DailyUsageRow, ModelUsage, ScanResponse},
};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
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
    usage: ModelUsage,
    is_fallback_model: bool,
}

pub fn scan_codex_usage(
    db: &mut Connection,
    pricing_source: &PricingSource,
    codex_home: Option<PathBuf>,
    timezone: Option<String>,
) -> Result<ScanResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let events = load_token_usage_events(codex_home)?;
    let rows = build_daily_rows(&events, &timezone, &scanned_at, pricing_source);

    upsert_daily_rows(db, &rows)?;
    record_scan_run(db, &scanned_at, &timezone, rows.len())?;

    Ok(ScanResponse {
        imported_days: rows.len(),
        scanned_at,
        timezone,
    })
}

fn default_codex_home() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

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

fn load_session_file(path: &Path, events: &mut Vec<UsageEvent>) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut previous_totals: Option<RawUsage> = None;
    let mut current_model: Option<String> = None;
    let mut current_model_is_fallback = false;

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
            if let Some(model) = extract_model(entry.get("payload").unwrap_or(&Value::Null)) {
                current_model = Some(model);
                current_model_is_fallback = false;
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
                updated_at: updated_at.to_string(),
            });

        add_usage_to_row(summary, &event.usage);
        let model_usage = summary.models.entry(event.model.clone()).or_default();
        add_usage(model_usage, &event.usage);
        if event.is_fallback_model {
            model_usage.is_fallback = Some(true);
        }
    }

    summaries
        .into_values()
        .map(|mut row| {
            row.cost_usd = row
                .models
                .iter()
                .map(|(model, usage)| {
                    calculate_cost_usd(usage, pricing_source.pricing_for_model(model))
                })
                .sum();
            row
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
        assert!((rows[1].cost_usd - 0.0028875).abs() < f64::EPSILON);
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

    fn tempfile_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "codex-usage-desktop-rust-{}",
            Utc::now().timestamp_nanos_opt().unwrap()
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
