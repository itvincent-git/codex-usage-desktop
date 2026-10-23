use crate::{
    date::{
        date_key_in_timezone, list_date_keys, list_hour_buckets_until, resolve_app_timezone,
        shift_date_key,
    },
    db::{
        hourly_rollups_ready, query_all_session_file_rollups, query_daily_quota_percents,
        query_daily_rows, query_latest_update_at, query_model_quota_samples, ModelQuotaAggregate,
    },
    pricing::{calculate_cost_usd, PricingSource},
    types::{
        ModelQuotaEstimate, ModelUsage, MonthlyUsageResponse, MonthlyUsageRow, OverviewDailyRow,
        OverviewModelRow, OverviewProjectRow, OverviewResponse, OverviewTotals,
        ProjectAnalyticsModelRow, ProjectAnalyticsResponse, ProjectUsage,
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

pub(crate) fn resolve_range(range: &str, timezone: &str) -> Result<(String, String, i64), String> {
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
    let quota_by_date = query_daily_quota_percents(db, &start_date, &end_date)?;

    let daily = list_date_keys(&start_date, &end_date)?
        .into_iter()
        .map(|date| {
            let row = rows_by_date.get(&date);
            let quota = quota_by_date.get(&date);
            OverviewDailyRow {
                date,
                input_tokens: row.map(|row| row.input_tokens).unwrap_or(0),
                cached_input_tokens: row.map(|row| row.cached_input_tokens).unwrap_or(0),
                output_tokens: row.map(|row| row.output_tokens).unwrap_or(0),
                total_tokens: row.map(|row| row.total_tokens).unwrap_or(0),
                cost_usd: row.map(|row| row.cost_usd).unwrap_or(0.0),
                five_hour_percent: quota.and_then(|quota| quota.0),
                weekly_percent: quota.and_then(|quota| quota.1),
            }
        })
        .collect::<Vec<_>>();
    let hourly = if matches!(range, "1d" | "2d") && hourly_rollups_ready(db, &timezone)? {
        let buckets = list_hour_buckets_until(&start_date, &timezone, Utc::now())?;
        let start_hour = buckets.first().map(|bucket| bucket.key.as_str()).unwrap_or_default();
        let end_hour = buckets.last().map(|bucket| bucket.key.as_str()).unwrap_or_default();
        let mut rows_by_hour = BTreeMap::<String, OverviewDailyRow>::new();
        for row in query_all_session_file_rollups(db)?
            .into_iter()
            .flat_map(|rollup| rollup.hourly_rows)
            .filter(|row| row.hour.as_str() >= start_hour && row.hour.as_str() <= end_hour)
        {
            let summary =
                rows_by_hour
                    .entry(row.hour.clone())
                    .or_insert_with(|| OverviewDailyRow {
                        date: row.hour,
                        input_tokens: 0,
                        cached_input_tokens: 0,
                        output_tokens: 0,
                        total_tokens: 0,
                        cost_usd: 0.0,
                        five_hour_percent: None,
                        weekly_percent: None,
                    });
            summary.input_tokens += row.input_tokens;
            summary.cached_input_tokens += row.cached_input_tokens;
            summary.output_tokens += row.output_tokens;
            summary.total_tokens += row.total_tokens;
            summary.cost_usd += row
                .models
                .iter()
                .map(|(model, usage)| {
                    calculate_cost_usd(usage, pricing_source.pricing_for_model(model))
                })
                .sum::<f64>();
        }
        buckets.into_iter()
            .map(|bucket| {
                rows_by_hour.remove(&bucket.key).map(|mut row| {
                    row.date = bucket.label.clone();
                    row
                }).unwrap_or(OverviewDailyRow {
                    date: bucket.label,
                    input_tokens: 0,
                    cached_input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    cost_usd: 0.0,
                    five_hour_percent: None,
                    weekly_percent: None,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let input_tokens = daily.iter().map(|day| day.input_tokens).sum::<i64>();
    let cached_input_tokens = daily.iter().map(|day| day.cached_input_tokens).sum::<i64>();
    let output_tokens = daily.iter().map(|day| day.output_tokens).sum::<i64>();
    let total_tokens = daily.iter().map(|day| day.total_tokens).sum::<i64>();
    let cost_usd = daily.iter().map(|day| day.cost_usd).sum::<f64>();
    let mut models_by_name = BTreeMap::<String, ModelUsage>::new();
    let mut projects_by_path = BTreeMap::<String, ProjectUsage>::new();
    let mut project_last_active_dates = BTreeMap::<String, String>::new();
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
            project_last_active_dates.insert(project.clone(), row.date.clone());
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
    let quota_samples = query_model_quota_samples(db, &start_date, &end_date)?;
    for row in &mut models {
        row.five_hour_quota = quota_samples
            .get(&(row.model.clone(), 300))
            .and_then(|samples| estimate_model_quota(samples, row.total_tokens));
        row.weekly_quota = quota_samples
            .get(&(row.model.clone(), 10080))
            .and_then(|samples| estimate_model_quota(samples, row.total_tokens));
    }
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
            last_active_date: project_last_active_dates
                .remove(&project)
                .unwrap_or_else(|| start_date.clone()),
            codex_project_id: None,
            codex_project_name: None,
            codex_project_root: None,
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
    let project_daily = projects
        .iter()
        .map(|project| {
            let days = daily
                .iter()
                .map(|day| {
                    project_daily_row(
                        day.date.clone(),
                        rows_by_date
                            .get(&day.date)
                            .and_then(|row| row.projects.get(&project.project)),
                        pricing_source,
                    )
                })
                .collect();
            (project.project.clone(), days)
        })
        .collect();

    Ok(OverviewResponse {
        range: range.to_string(),
        days,
        timezone,
        start_date,
        end_date,
        updated_at: query_latest_update_at(db)?,
        daily,
        hourly,
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
        project_daily,
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
        .map(|date| project_daily_row(date.clone(), usage_by_date.get(&date), pricing_source))
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
    let last_active_date = usage_by_date
        .last_key_value()
        .map(|(date, _)| date.clone())
        .unwrap_or_else(|| start_date.clone());

    Ok(ProjectAnalyticsResponse {
        project: project.to_string(),
        display_name: display_name.clone(),
        codex_project_id: None,
        codex_project_name: None,
        codex_project_root: None,
        range: range.to_string(),
        start_date,
        end_date,
        timezone,
        summary: OverviewProjectRow {
            project: project.to_string(),
            display_name,
            last_active_date,
            codex_project_id: None,
            codex_project_name: None,
            codex_project_root: None,
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

fn project_daily_row(
    date: String,
    usage: Option<&ProjectUsage>,
    pricing_source: &PricingSource,
) -> OverviewDailyRow {
    OverviewDailyRow {
        date,
        input_tokens: usage.map(|usage| usage.input_tokens).unwrap_or(0),
        cached_input_tokens: usage.map(|usage| usage.cached_input_tokens).unwrap_or(0),
        output_tokens: usage.map(|usage| usage.output_tokens).unwrap_or(0),
        total_tokens: usage.map(|usage| usage.total_tokens).unwrap_or(0),
        cost_usd: usage
            .map(|usage| {
                usage
                    .models
                    .iter()
                    .map(|(model, model_usage)| {
                        calculate_cost_usd(model_usage, pricing_source.pricing_for_model(model))
                    })
                    .sum()
            })
            .unwrap_or(0.0),
        five_hour_percent: None,
        weekly_percent: None,
    }
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
        five_hour_quota: None,
        weekly_quota: None,
    }
}

fn estimate_model_quota(
    samples: &ModelQuotaAggregate,
    total_tokens: i64,
) -> Option<ModelQuotaEstimate> {
    if samples.tokens <= 0 || total_tokens <= 0 {
        return None;
    }
    let rate = 1_000_000.0 / samples.tokens as f64;
    let lower = (samples.observed_percent - samples.samples as f64).max(0.0);
    let upper = samples.observed_percent + samples.samples as f64;
    let scale = total_tokens as f64 / samples.tokens as f64;
    Some(ModelQuotaEstimate {
        percent: samples.observed_percent * scale,
        lower_percent: lower * scale,
        upper_percent: upper * scale,
        percent_per_million_tokens: samples.observed_percent * rate,
        lower_percent_per_million_tokens: lower * rate,
        upper_percent_per_million_tokens: upper * rate,
        sampled_tokens: samples.tokens,
        samples: samples.samples,
    })
}

#[cfg(test)]
mod quota_estimate_tests {
    use super::*;

    #[test]
    fn includes_integer_snapshot_uncertainty_and_zero_deltas() {
        let samples = ModelQuotaAggregate {
            tokens: 1_000_000,
            observed_percent: 2.0,
            samples: 2,
        };
        let estimate = estimate_model_quota(&samples, 2_000_000).unwrap();
        assert_eq!(estimate.percent, 4.0);
        assert_eq!(estimate.lower_percent, 0.0);
        assert_eq!(estimate.upper_percent, 8.0);
        assert_eq!(estimate.percent_per_million_tokens, 2.0);
        assert_eq!(estimate.upper_percent_per_million_tokens, 4.0);

        let below_resolution = ModelQuotaAggregate {
            tokens: 100_000,
            observed_percent: 0.0,
            samples: 1,
        };
        let estimate = estimate_model_quota(&below_resolution, 100_000).unwrap();
        assert_eq!(estimate.lower_percent, 0.0);
        assert_eq!(estimate.upper_percent, 1.0);
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
                    five_hour_percent: None,
                    weekly_percent: None,
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

    for (date, (five_hour, weekly)) in query_daily_quota_percents(db, &start_date, &end_date)? {
        let month = month_key_from_date_key(&date)?;
        if let Some(summary) = monthly_by_key.get_mut(&month) {
            if let Some(percent) = five_hour {
                summary.five_hour_percent =
                    Some(summary.five_hour_percent.unwrap_or(0.0) + percent);
            }
            if let Some(percent) = weekly {
                summary.weekly_percent = Some(summary.weekly_percent.unwrap_or(0.0) + percent);
            }
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
        db::{open_database, upsert_daily_rows, upsert_session_file_rollups, SessionFileRollup},
        types::{DailyUsageRow, HourlyUsageRow, PricingStatus},
    };
    use chrono::Timelike;

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
    fn one_day_overview_includes_continuous_hourly_usage_through_the_current_hour() {
        let path = temp_db_path("hourly-overview");
        let mut db = open_database(&path).unwrap();
        let now = Utc::now();
        let date = date_key_in_timezone(now, "UTC");
        let hour = crate::date::local_hour_key(now, "UTC");
        let usage = ModelUsage {
            input_tokens: 1_000,
            cached_input_tokens: 200,
            output_tokens: 300,
            total_tokens: 1_300,
            ..Default::default()
        };
        let mut daily = daily_row(&date, 1_000, 200, 300, 1_300, 0.0);
        daily.models = BTreeMap::from([("gpt-5".to_string(), usage.clone())]);
        upsert_daily_rows(&mut db, &[daily.clone()]).unwrap();
        upsert_session_file_rollups(
            &mut db,
            &[SessionFileRollup {
                path: "/tmp/hourly.jsonl".to_string(),
                modified_at_ms: 1,
                size_bytes: 1,
                rows: vec![daily],
                hourly_rows: vec![HourlyUsageRow {
                    hour: hour.clone(),
                    input_tokens: usage.input_tokens,
                    cached_input_tokens: usage.cached_input_tokens,
                    output_tokens: usage.output_tokens,
                    reasoning_output_tokens: usage.reasoning_output_tokens,
                    total_tokens: usage.total_tokens,
                    models: BTreeMap::from([("gpt-5".to_string(), usage)]),
                }],
                timezone: "UTC".to_string(),
                prompt_title: None,
                turn_count: 0,
                quota_usage: None,
            }],
            &now.to_rfc3339(),
        )
        .unwrap();

        let response = get_overview(
            &db,
            "1d",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap();

        assert_eq!(response.hourly.len(), now.hour() as usize + 1);
        assert_eq!(
            response.hourly.first().unwrap().date,
            format!("{date}T00:00+00:00")
        );
        let current = response.hourly.last().unwrap();
        assert_eq!(current.date, format!("{date}T{:02}:00+00:00", now.hour()));
        assert_eq!(current.total_tokens, 1_300);
        assert!(current.cost_usd < 1.0);
        assert_eq!(response.daily.len(), 1);
        assert_eq!(response.totals.total_tokens, 1_300);

        let two_day_response = get_overview(
            &db,
            "2d",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap();
        assert_eq!(two_day_response.hourly.len(), now.hour() as usize + 25);
        assert_eq!(
            two_day_response.hourly.first().unwrap().date,
            format!("{}T00:00+00:00", shift_date_key(&date, -1).unwrap())
        );
        assert_eq!(
            two_day_response.hourly.last().unwrap().date,
            format!("{date}T{:02}:00+00:00", now.hour())
        );

        db.execute(
            "UPDATE session_file_rollups SET quota_parser_version = quota_parser_version - 1",
            [],
        )
        .unwrap();
        let stale_response = get_overview(
            &db,
            "1d",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap();
        assert!(stale_response.hourly.is_empty());
        assert_eq!(stale_response.totals.total_tokens, 1_300);
        let _ = std::fs::remove_file(path);
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
    fn monthly_quota_sums_daily_consumption_and_preserves_missing_snapshots() {
        let path = temp_db_path("monthly-quota");
        let db = open_database(&path).unwrap();
        let window = |start, end, reset: &str| crate::types::SessionQuotaWindowUsage {
            window_minutes: 300,
            resets_at: Some(reset.to_string()),
            observed_start_at: "2026-04-01T00:00:00Z".to_string(),
            observed_end_at: "2026-04-01T01:00:00Z".to_string(),
            observed_start_percent: start,
            observed_end_percent: end,
            observed_delta_percent: end - start,
            below_resolution: false,
        };
        let usage = |five_hour, weekly| crate::types::SessionQuotaUsage { five_hour, weekly };
        let rollup = crate::db::SessionQuotaRollup {
            daily: BTreeMap::from([
                (
                    "2026-03-31".to_string(),
                    usage(vec![window(0.0, 90.0, "outside")], vec![]),
                ),
                (
                    "2026-04-01".to_string(),
                    usage(
                        vec![window(0.0, 80.0, "reset-1")],
                        vec![window(10.0, 30.0, "weekly")],
                    ),
                ),
                (
                    "2026-04-02".to_string(),
                    usage(
                        vec![window(0.0, 70.0, "reset-2")],
                        vec![window(30.0, 45.0, "weekly")],
                    ),
                ),
                (
                    "2026-05-01".to_string(),
                    usage(vec![], vec![window(0.0, 0.0, "weekly-2")]),
                ),
            ]),
            ..Default::default()
        };
        db.execute(
            "INSERT INTO session_file_rollups (path, modified_at_ms, size_bytes, rows_json, quota_usage_json, updated_at) VALUES ('quota', 0, 0, '[]', ?, '2026-05-01T00:00:00Z')",
            [serde_json::to_string(&rollup).unwrap()],
        ).unwrap();

        let response = get_monthly_usage_for_end_month(&db, "UTC", "2026-06", 3).unwrap();
        assert_eq!(response.monthly[0].five_hour_percent, Some(150.0));
        assert_eq!(response.monthly[0].weekly_percent, Some(35.0));
        assert_eq!(response.monthly[1].five_hour_percent, None);
        assert_eq!(response.monthly[1].weekly_percent, Some(0.0));
        assert_eq!(response.monthly[2].five_hour_percent, None);
        assert_eq!(response.monthly[2].weekly_percent, None);

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

        let overview = get_overview(
            &db,
            "custom:2026-07-01_2026-07-03",
            Some("UTC".to_string()),
            &PricingSource::embedded(),
        )
        .unwrap();
        let project_dates = overview
            .projects
            .iter()
            .map(|project| (project.project.as_str(), project.last_active_date.as_str()))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(project_dates["/repo/app"], "2026-07-03");
        assert_eq!(project_dates["/repo/other"], "2026-07-01");
        let app_daily = &overview.project_daily["/repo/app"];
        assert_eq!(app_daily.len(), 3);
        assert_eq!(app_daily[0].total_tokens, 1_100_000);
        assert_eq!(app_daily[1].date, "2026-07-02");
        assert_eq!(app_daily[1].total_tokens, 0);
        assert_eq!(app_daily[2].total_tokens, 550_000);
        assert_eq!(overview.project_daily["/repo/other"][2].total_tokens, 0);
        let app_total = overview
            .projects
            .iter()
            .find(|project| project.project == "/repo/app")
            .unwrap();
        assert!(
            (app_daily.iter().map(|day| day.cost_usd).sum::<f64>() - app_total.cost_usd).abs()
                < 1e-12
        );

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
        assert_eq!(response.summary.last_active_date, "2026-07-03");
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
