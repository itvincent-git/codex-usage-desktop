use crate::{
    date::{date_key_in_timezone, list_date_keys, resolve_app_timezone, shift_date_key},
    db::{query_daily_rows, query_latest_update_at},
    pricing::{calculate_cost_usd, PricingSource},
    types::{
        ModelUsage, MonthlyUsageResponse, MonthlyUsageRow, OverviewDailyRow, OverviewModelRow,
        OverviewProjectRow, OverviewResponse, OverviewTotals, ProjectAnalyticsModelRow,
        ProjectAnalyticsResponse, ProjectUsage,
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

fn resolve_range(range: &str, timezone: &str) -> Result<(String, String, i64), String> {
    if range.starts_with("custom:") {
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
        Ok((start_str.to_string(), end_str.to_string(), days))
    } else {
        let days = range_days(range).ok_or_else(|| format!("Unsupported range: {range}"))?;
        let end_date = date_key_in_timezone(Utc::now(), timezone);
        let start_date = shift_date_key(&end_date, -(days - 1))?;
        Ok((start_date, end_date, days))
    }
}

pub fn get_overview(
    db: &Connection,
    range: &str,
    timezone: Option<String>,
    pricing_source: &PricingSource,
) -> Result<OverviewResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);

    let (start_date, end_date, days) = resolve_range(range, &timezone)?;

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
        .map(|(model, usage)| overview_model_row(model, usage, pricing_source))
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

pub fn get_project_analytics(
    db: &Connection,
    project: &str,
    range: &str,
    timezone: Option<String>,
    pricing_source: &PricingSource,
) -> Result<ProjectAnalyticsResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let (start_date, end_date, _) = resolve_range(range, &timezone)?;
    let rows = query_daily_rows(db, &start_date, &end_date)?;
    let mut usage_by_date = BTreeMap::<String, ProjectUsage>::new();
    let mut summary = ProjectUsage::default();
    let mut found = false;

    for row in rows {
        if let Some(usage) = row.projects.get(project) {
            found = true;
            usage_by_date.insert(row.date, usage.clone());
            summary.input_tokens += usage.input_tokens;
            summary.cached_input_tokens += usage.cached_input_tokens;
            summary.output_tokens += usage.output_tokens;
            summary.reasoning_output_tokens += usage.reasoning_output_tokens;
            summary.total_tokens += usage.total_tokens;
            for (model, model_usage) in &usage.models {
                let total = summary.models.entry(model.clone()).or_default();
                total.input_tokens += model_usage.input_tokens;
                total.cached_input_tokens += model_usage.cached_input_tokens;
                total.output_tokens += model_usage.output_tokens;
                total.reasoning_output_tokens += model_usage.reasoning_output_tokens;
                total.total_tokens += model_usage.total_tokens;
            }
        }
    }

    if !found {
        return Err(format!("Project not found in selected range: {project}"));
    }

    let daily = list_date_keys(&start_date, &end_date)?
        .into_iter()
        .map(|date| {
            let usage = usage_by_date.get(&date);
            let cost_usd = usage
                .map(|usage| {
                    usage
                        .models
                        .iter()
                        .map(|(model, model_usage)| {
                            calculate_cost_usd(model_usage, pricing_source.pricing_for_model(model))
                        })
                        .sum()
                })
                .unwrap_or(0.0);
            OverviewDailyRow {
                date,
                input_tokens: usage.map(|usage| usage.input_tokens).unwrap_or(0),
                cached_input_tokens: usage.map(|usage| usage.cached_input_tokens).unwrap_or(0),
                output_tokens: usage.map(|usage| usage.output_tokens).unwrap_or(0),
                total_tokens: usage.map(|usage| usage.total_tokens).unwrap_or(0),
                cost_usd,
            }
        })
        .collect::<Vec<_>>();
    let cost_usd = daily.iter().map(|day| day.cost_usd).sum();
    let mut models = summary
        .models
        .iter()
        .map(|(model, usage)| ProjectAnalyticsModelRow {
            model: model.clone(),
            total_tokens: usage.total_tokens,
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.model.cmp(&b.model))
    });
    let display_name = project_display_name(project);

    Ok(ProjectAnalyticsResponse {
        project: project.to_string(),
        display_name: display_name.clone(),
        range: range.to_string(),
        start_date,
        end_date,
        timezone,
        summary: OverviewProjectRow {
            project: project.to_string(),
            display_name,
            input_tokens: summary.input_tokens,
            cached_input_tokens: summary.cached_input_tokens,
            output_tokens: summary.output_tokens,
            total_tokens: summary.total_tokens,
            cost_usd,
        },
        models,
        daily,
    })
}

fn overview_model_row(
    model: String,
    usage: ModelUsage,
    pricing_source: &PricingSource,
) -> OverviewModelRow {
    let resolved = pricing_source.resolve_pricing_for_model(&model);
    let cost_usd = calculate_cost_usd(&usage, resolved.pricing);
    let prices =
        (resolved.status != crate::types::PricingStatus::Unavailable).then_some(resolved.pricing);
    OverviewModelRow {
        model,
        input_tokens: usage.input_tokens,
        cached_input_tokens: usage.cached_input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        cost_usd,
        pricing_status: resolved.status,
        input_cost_per_million_tokens: prices.map(|price| price.input_cost_per_m_token),
        cached_input_cost_per_million_tokens: prices
            .map(|price| price.cached_input_cost_per_m_token),
        output_cost_per_million_tokens: prices.map(|price| price.output_cost_per_m_token),
        effective_cost_per_million_tokens: if usage.total_tokens > 0
            && resolved.status != crate::types::PricingStatus::Unavailable
        {
            Some(cost_usd / usage.total_tokens as f64 * 1_000_000.0)
        } else {
            None
        },
    }
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
        types::{DailyUsageRow, PricingStatus},
    };

    #[test]
    fn model_rows_expose_pricing_and_effective_cost_without_treating_unknown_as_free() {
        let source = PricingSource::embedded();
        let usage = ModelUsage {
            input_tokens: 1_000_000,
            cached_input_tokens: 200_000,
            output_tokens: 500_000,
            reasoning_output_tokens: 0,
            total_tokens: 1_500_000,
            is_fallback: None,
        };

        let priced = overview_model_row("gpt-5".to_string(), usage.clone(), &source);
        assert_eq!(priced.pricing_status, PricingStatus::Priced);
        assert_eq!(priced.input_cost_per_million_tokens, Some(1.25));
        assert_eq!(priced.cached_input_cost_per_million_tokens, Some(0.125));
        assert_eq!(priced.output_cost_per_million_tokens, Some(10.0));
        assert!((priced.cost_usd - 6.025).abs() < f64::EPSILON);
        assert!(
            (priced.effective_cost_per_million_tokens.unwrap() - 4.016666666666667).abs() < 1e-12
        );

        let free = overview_model_row("openrouter/free".to_string(), usage.clone(), &source);
        assert_eq!(free.pricing_status, PricingStatus::Free);
        assert_eq!(free.input_cost_per_million_tokens, Some(0.0));
        assert_eq!(free.effective_cost_per_million_tokens, Some(0.0));

        let unknown = overview_model_row("unknown-model".to_string(), usage, &source);
        assert_eq!(unknown.pricing_status, PricingStatus::Unavailable);
        assert_eq!(unknown.input_cost_per_million_tokens, None);
        assert_eq!(unknown.effective_cost_per_million_tokens, None);
    }

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

    #[test]
    fn project_analytics_filters_project_fills_days_and_aggregates_models_and_cost() {
        let path = temp_db_path("project-analytics");
        let mut db = open_database(&path).unwrap();
        let project_usage = |input, cached, output, model: &str| {
            let total = input + output;
            ProjectUsage {
                input_tokens: input,
                cached_input_tokens: cached,
                output_tokens: output,
                reasoning_output_tokens: 0,
                total_tokens: total,
                models: BTreeMap::from([(
                    model.to_string(),
                    ModelUsage {
                        input_tokens: input,
                        cached_input_tokens: cached,
                        output_tokens: output,
                        reasoning_output_tokens: 0,
                        total_tokens: total,
                        is_fallback: None,
                    },
                )]),
            }
        };
        let mut first = daily_row("2026-07-01", 0, 0, 0, 0, 0.0);
        first.projects = BTreeMap::from([
            (
                "/repo/app".to_string(),
                project_usage(1_000_000, 200_000, 100_000, "gpt-5"),
            ),
            (
                "/repo/other".to_string(),
                project_usage(9_000_000, 0, 0, "gpt-5"),
            ),
        ]);
        let mut third = daily_row("2026-07-03", 0, 0, 0, 0, 0.0);
        third.projects = BTreeMap::from([(
            "/repo/app".to_string(),
            project_usage(500_000, 100_000, 50_000, "gpt-5-mini"),
        )]);
        let mut outside = daily_row("2026-06-30", 0, 0, 0, 0, 0.0);
        outside.projects = BTreeMap::from([(
            "/repo/app".to_string(),
            project_usage(8_000_000, 0, 0, "gpt-5"),
        )]);
        upsert_daily_rows(&mut db, &[outside, first, third]).unwrap();

        let response = get_project_analytics(
            &db,
            "/repo/app",
            "custom:2026-07-01_2026-07-03",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap();

        assert_eq!(response.project, "/repo/app");
        assert_eq!(response.display_name, "app");
        assert_eq!(response.start_date, "2026-07-01");
        assert_eq!(response.end_date, "2026-07-03");
        assert_eq!(response.summary.input_tokens, 1_500_000);
        assert_eq!(response.summary.cached_input_tokens, 300_000);
        assert_eq!(response.summary.output_tokens, 150_000);
        assert_eq!(response.summary.total_tokens, 1_650_000);
        assert_eq!(response.daily.len(), 3);
        assert_eq!(response.daily[1].date, "2026-07-02");
        assert_eq!(response.daily[1].total_tokens, 0);
        assert_eq!(
            response
                .models
                .iter()
                .map(|row| row.model.as_str())
                .collect::<Vec<_>>(),
            vec!["gpt-5", "gpt-5-mini"]
        );
        let expected = calculate_cost_usd(
            &project_usage(1_000_000, 200_000, 100_000, "gpt-5").models["gpt-5"],
            PricingSource::embedded().pricing_for_model("gpt-5"),
        ) + calculate_cost_usd(
            &project_usage(500_000, 100_000, 50_000, "gpt-5-mini").models["gpt-5-mini"],
            PricingSource::embedded().pricing_for_model("gpt-5-mini"),
        );
        assert!((response.summary.cost_usd - expected).abs() < 1e-12);
        assert!(
            (response.daily.iter().map(|day| day.cost_usd).sum::<f64>() - expected).abs() < 1e-12
        );

        let error = get_project_analytics(
            &db,
            "/repo/missing",
            "custom:2026-07-01_2026-07-03",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap_err();
        assert!(error.contains("Project not found"));
        let _ = std::fs::remove_file(path);
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
