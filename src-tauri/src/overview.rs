use crate::{
    date::{date_key_in_timezone, list_date_keys, resolve_app_timezone, shift_date_key},
    db::{query_daily_rows, query_latest_update_at},
    types::{OverviewDailyRow, OverviewResponse, OverviewTotals},
};
use chrono::Utc;
use rusqlite::Connection;

fn range_days(range: &str) -> Option<i64> {
    match range {
        "1d" => Some(1),
        "2d" => Some(2),
        "7d" => Some(7),
        "14d" => Some(14),
        "30d" => Some(30),
        _ => None,
    }
}

pub fn get_overview(
    db: &Connection,
    range: &str,
    timezone: Option<String>,
) -> Result<OverviewResponse, String> {
    let timezone = timezone.unwrap_or_else(resolve_app_timezone);
    let days = range_days(range).ok_or_else(|| format!("Unsupported range: {range}"))?;
    let end_date = date_key_in_timezone(Utc::now(), &timezone);
    let start_date = shift_date_key(&end_date, -(days - 1))?;
    let rows = query_daily_rows(db, &start_date, &end_date)?;
    let rows_by_date = rows
        .into_iter()
        .map(|row| (row.date.clone(), row))
        .collect::<std::collections::BTreeMap<_, _>>();

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
    })
}
