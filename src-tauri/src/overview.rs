use crate::{
    date::{date_key_in_timezone, list_date_keys, resolve_app_timezone, shift_date_key},
    db::{query_daily_rows, query_latest_update_at},
    pricing::{calculate_cost_usd, PricingSource},
    types::{
        ModelUsage, MonthlyUsageResponse, MonthlyUsageRow, OverviewDailyRow, OverviewModelRow,
        OverviewProjectRow, OverviewResponse, OverviewTotals, ProjectUsage,
    },
};
use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::Connection;
use std::collections::BTreeMap;

fn range_days(range: &str) -> Option<i64> {
    if range.ends_with('d') {
        range[..range.len() - 1].parse::<i64>().ok()
    } else {
        match range {
            "1d" => Some(1),
            "2d" => Some(2),
            "7d" => Some(7),
            "14d" => Some(14),
            "30d" => Some(30),
            "60d" => Some(60),
            "90d" => Some(90),
            _ => None,
        }
    }
}

pub fn get_overview(
    db: &Connection,
    range: &str,
    timezone: Option<String>,
    pricing_source: &PricingSource,
) -> Result<OverviewResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    
    let (start_date, end_date, days) = if range.starts_with("custom:") {
        let parts: Vec<&str> = range["custom:".len()..].split('_').collect();
        if parts.len() != 2 {
            return Err(format!("Invalid custom range format: {}", range));
        }
        let start_str = parts[0];
        let end_str = parts[1];
        let start_parsed = NaiveDate::parse_from_str(start_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid start date {}: {}", start_str, e))?;
        let end_parsed = NaiveDate::parse_from_str(end_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid end date {}: {}", end_str, e))?;
        if end_parsed < start_parsed {
            return Err("End date must be after or equal to start date".to_string());
        }
        let days = end_parsed.signed_duration_since(start_parsed).num_days() + 1;
        (start_str.to_string(), end_str.to_string(), days)
    } else {
        let days = range_days(range).ok_or_else(|| format!("Unsupported range: {range}"))?;
        let end_date = date_key_in_timezone(Utc::now(), &timezone);
        let start_date = shift_date_key(&end_date, -(days - 1))?;
        (start_date, end_date, days)
    };

    let rows = query_daily_rows(db, &start_date, &end_date)?;
    let rows_by_date = rows
        .into_iter()
        .map(|row| (row.date.clone(), row))
        .collect::<BTreeMap<_, _>>();

    let daily = list_date_keys(&start_date, &end_date)?
        .into_iter()
        .map(|date| {
            let row = rows_by_date.get(&date);
            OverviewDailyRow {
                date,
                input_tokens: row.map(|row| row.input_tokens).unwrap_or(0),
                cached_input_tokens: row.map(|row| row.cached_input_tokens).unwrap_or(0),
                output_tokens: row.map(|row| row.output_tokens).unwrap_or(0),
                total_tokens: row.map(|row| row.total_tokens).unwrap_or(0),
                cost_usd: row.map(|row| row.cost_usd).unwrap_or(0.0),
            }
        })
        .collect::<Vec<_>>();

    let input_tokens = daily.iter().map(|day| day.input_tokens).sum::<i64>();
    let cached_input_tokens = daily.iter().map(|day| day.cached_input_tokens).sum::<i64>();
    let output_tokens = daily.iter().map(|day| day.output_tokens).sum::<i64>();
    let total_tokens = daily.iter().map(|day| day.total_tokens).sum::<i64>();
    let cost_usd = daily.iter().map(|day| day.cost_usd).sum::<f64>();
    let mut models_by_name = BTreeMap::<String, ModelUsage>::new();
    let mut projects_by_path = BTreeMap::<String, ProjectUsage>::new();
    for row in rows_by_date.values() {
        for (model, usage) in &row.models {
            let summary = models_by_name.entry(model.clone()).or_default();
            summary.input_tokens += usage.input_tokens;
            summary.cached_input_tokens += usage.cached_input_tokens;
            summary.output_tokens += usage.output_tokens;
            summary.reasoning_output_tokens += usage.reasoning_output_tokens;
            summary.total_tokens += usage.total_tokens;
        }
        for (project, usage) in &row.projects {
            let summary = projects_by_path.entry(project.clone()).or_default();
            summary.input_tokens += usage.input_tokens;
            summary.cached_input_tokens += usage.cached_input_tokens;
            summary.output_tokens += usage.output_tokens;
            summary.reasoning_output_tokens += usage.reasoning_output_tokens;
            summary.total_tokens += usage.total_tokens;

            for (model, model_usage) in &usage.models {
                let summary_model = summary.models.entry(model.clone()).or_default();
                summary_model.input_tokens += model_usage.input_tokens;
                summary_model.cached_input_tokens += model_usage.cached_input_tokens;
                summary_model.output_tokens += model_usage.output_tokens;
                summary_model.reasoning_output_tokens += model_usage.reasoning_output_tokens;
                summary_model.total_tokens += model_usage.total_tokens;
            }
        }
    }
    let mut models = models_by_name
        .into_iter()
        .map(|(model, usage)| OverviewModelRow {
            cost_usd: calculate_cost_usd(&usage, pricing_source.pricing_for_model(&model)),
            model,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.model.cmp(&b.model))
    });
    let mut projects = projects_by_path
        .into_iter()
        .map(|(project, usage)| OverviewProjectRow {
            cost_usd: usage
                .models
                .iter()
                .map(|(model, model_usage)| {
                    calculate_cost_usd(model_usage, pricing_source.pricing_for_model(model))
                })
                .sum(),
            display_name: project_display_name(&project),
            project,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
        })
        .collect::<Vec<_>>();
    projects.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.project.cmp(&b.project))
    });

    Ok(OverviewResponse {
        range: range.to_string(),
        days,
        timezone,
        start_date,
        end_date,
        updated_at: query_latest_update_at(db)?,
        daily,
        totals: OverviewTotals {
            input_tokens,
            cached_input_tokens,
            output_tokens,
            total_tokens,
            cost_usd,
            avg_tokens_per_day: total_tokens as f64 / days as f64,
            avg_cost_per_day: cost_usd / days as f64,
            cache_hit_rate: if input_tokens == 0 {
                0.0
            } else {
                cached_input_tokens as f64 / input_tokens as f64
            },
            cost_per_million_tokens: if total_tokens == 0 {
                0.0
            } else {
                cost_usd / total_tokens as f64 * 1_000_000.0
            },
        },
        models,
        projects,
    })
}

pub fn get_monthly_usage(
    db: &Connection,
    timezone: Option<String>,
) -> Result<MonthlyUsageResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let end_date = date_key_in_timezone(Utc::now(), &timezone);
    let end_month = month_key_from_date_key(&end_date)?;
    get_monthly_usage_for_end_month(db, &timezone, &end_month, 12)
}

fn get_monthly_usage_for_end_month(
    db: &Connection,
    timezone: &str,
    end_month: &str,
    month_count: usize,
) -> Result<MonthlyUsageResponse, String> {
    let start_month = shift_month_key(end_month, -((month_count as i32) - 1))?;
    let start_date = format!("{start_month}-01");
    let end_date = month_end_date_key(end_month)?;
    let rows = query_daily_rows(db, &start_date, &end_date)?;
    let mut monthly_by_key = list_month_keys(&start_month, end_month)?
        .into_iter()
        .map(|month| {
            (
                month.clone(),
                MonthlyUsageRow {
                    month,
                    input_tokens: 0,
                    cached_input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    cost_usd: 0.0,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    for row in rows {
        let month = month_key_from_date_key(&row.date)?;
        if let Some(summary) = monthly_by_key.get_mut(&month) {
            summary.input_tokens += row.input_tokens;
            summary.cached_input_tokens += row.cached_input_tokens;
            summary.output_tokens += row.output_tokens;
            summary.total_tokens += row.total_tokens;
            summary.cost_usd += row.cost_usd;
        }
    }

    Ok(MonthlyUsageResponse {
        timezone: timezone.to_string(),
        start_month,
        end_month: end_month.to_string(),
        updated_at: query_latest_update_at(db)?,
        monthly: monthly_by_key.into_values().collect(),
    })
}

fn month_key_from_date_key(date_key: &str) -> Result<String, String> {
    let date =
        NaiveDate::parse_from_str(date_key, "%Y-%m-%d").map_err(|error| error.to_string())?;
    Ok(format!("{:04}-{:02}", date.year(), date.month()))
}

fn shift_month_key(month_key: &str, delta_months: i32) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(&format!("{month_key}-01"), "%Y-%m-%d")
        .map_err(|error| error.to_string())?;
    let total_months = date.year() * 12 + date.month0() as i32 + delta_months;
    if total_months < 0 {
        return Err("month shift overflow".to_string());
    }
    let year = total_months / 12;
    let month = total_months % 12 + 1;
    Ok(format!("{year:04}-{month:02}"))
}

fn list_month_keys(start_month: &str, end_month: &str) -> Result<Vec<String>, String> {
    let mut months = Vec::new();
    let mut current = start_month.to_string();

    while current.as_str() <= end_month {
        months.push(current.clone());
        current = shift_month_key(&current, 1)?;
    }

    Ok(months)
}

fn month_end_date_key(month_key: &str) -> Result<String, String> {
    let next_month = shift_month_key(month_key, 1)?;
    shift_date_key(&format!("{next_month}-01"), -1)
}

fn project_display_name(project: &str) -> String {
    if project == "Unknown" {
        return project.to_string();
    }

    project
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(project)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db::{open_database, upsert_daily_rows},
        types::DailyUsageRow,
    };

    #[test]
    fn aggregates_usage_by_natural_month() {
        let path = temp_db_path("monthly-aggregation");
        let mut db = open_database(&path).unwrap();
        upsert_daily_rows(
            &mut db,
            &[
                daily_row("2025-06-30", 100, 20, 30, 130, 0.11),
                daily_row("2025-07-01", 200, 50, 40, 240, 0.22),
                daily_row("2025-07-31", 300, 60, 70, 370, 0.33),
                daily_row("2026-05-01", 400, 80, 90, 490, 0.44),
            ],
        )
        .unwrap();

        let response = get_monthly_usage_for_end_month(&db, "UTC", "2026-05", 12).unwrap();

        assert_eq!(response.start_month, "2025-06");
        assert_eq!(response.end_month, "2026-05");
        assert_eq!(response.monthly.len(), 12);
        assert_eq!(response.monthly[0].month, "2025-06");
        assert_eq!(response.monthly[0].total_tokens, 130);
        assert_eq!(response.monthly[1].month, "2025-07");
        assert_eq!(response.monthly[1].input_tokens, 500);
        assert_eq!(response.monthly[1].cached_input_tokens, 110);
        assert_eq!(response.monthly[1].output_tokens, 110);
        assert_eq!(response.monthly[1].total_tokens, 610);
        assert!((response.monthly[1].cost_usd - 0.55).abs() < f64::EPSILON);
        assert_eq!(response.monthly[10].month, "2026-04");
        assert_eq!(response.monthly[10].total_tokens, 0);
        assert_eq!(response.monthly[11].month, "2026-05");
        assert_eq!(response.monthly[11].total_tokens, 490);
        assert_eq!(response.updated_at.as_deref(), Some("2026-05-01T00:00:00Z"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn shifts_month_keys_across_years() {
        assert_eq!(shift_month_key("2026-01", -1).unwrap(), "2025-12");
        assert_eq!(shift_month_key("2025-12", 1).unwrap(), "2026-01");
        assert_eq!(shift_month_key("2026-05", -11).unwrap(), "2025-06");
    }

    fn daily_row(
        date: &str,
        input_tokens: i64,
        cached_input_tokens: i64,
        output_tokens: i64,
        total_tokens: i64,
        cost_usd: f64,
    ) -> DailyUsageRow {
        DailyUsageRow {
            date: date.to_string(),
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_output_tokens: 0,
            total_tokens,
            cost_usd,
            models: BTreeMap::new(),
            projects: BTreeMap::new(),
            updated_at: format!("{date}T00:00:00Z"),
        }
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "codex-usage-{name}-{}.sqlite",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }
}
