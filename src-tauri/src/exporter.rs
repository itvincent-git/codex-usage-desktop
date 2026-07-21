use crate::types::{ExportResponse, OverviewResponse};
use chrono::Utc;
use rust_xlsxwriter::{Format, Workbook, Worksheet};
use std::{fs, path::Path};

const SUMMARY_ROWS: [(&str, &str); 9] = [
    ("Range", "range"),
    ("Date Range", "date_range"),
    ("Timezone", "timezone"),
    ("Total Tokens", "total_tokens"),
    ("Input Tokens", "input_tokens"),
    ("Cached Input Tokens", "cached_input_tokens"),
    ("Output Tokens", "output_tokens"),
    ("Total Cost USD", "cost_usd"),
    ("Updated At", "updated_at"),
];

pub fn export_overview(
    overview: &OverviewResponse,
    format: &str,
    path: &Path,
) -> Result<ExportResponse, String> {
    match format {
        "xlsx" => write_xlsx(overview, path)?,
        "markdown" => {
            fs::write(path, render_markdown(overview)).map_err(|error| error.to_string())?
        }
        _ => return Err(format!("Unsupported export format: {format}")),
    }

    Ok(ExportResponse {
        path: path.to_string_lossy().into_owned(),
        format: format.to_string(),
        range: overview.range.clone(),
        exported_at: Utc::now().to_rfc3339(),
    })
}

fn write_xlsx(overview: &OverviewResponse, path: &Path) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let header = Format::new().set_bold();
    let money = Format::new().set_num_format("$0.000000");

    write_summary_sheet(&mut workbook, overview, &header, &money)?;
    write_daily_sheet(&mut workbook, overview, &header, &money)?;
    write_models_sheet(&mut workbook, overview, &header, &money)?;

    workbook.save(path).map_err(|error| error.to_string())
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    overview: &OverviewResponse,
    header: &Format,
    money: &Format,
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Summary")
        .map_err(|error| error.to_string())?;
    worksheet
        .set_column_width(0, 24)
        .map_err(|error| error.to_string())?;
    worksheet
        .set_column_width(1, 28)
        .map_err(|error| error.to_string())?;
    worksheet
        .write_with_format(0, 0, "Metric", header)
        .map_err(|error| error.to_string())?;
    worksheet
        .write_with_format(0, 1, "Value", header)
        .map_err(|error| error.to_string())?;

    for (index, (label, key)) in SUMMARY_ROWS.iter().enumerate() {
        let row = (index + 1) as u32;
        worksheet
            .write_string(row, 0, *label)
            .map_err(|error| error.to_string())?;
        match *key {
            "range" => worksheet.write_string(row, 1, &overview.range),
            "date_range" => worksheet.write_string(
                row,
                1,
                format!("{} to {}", overview.start_date, overview.end_date),
            ),
            "timezone" => worksheet.write_string(row, 1, &overview.timezone),
            "total_tokens" => worksheet.write_number(row, 1, overview.totals.total_tokens as f64),
            "input_tokens" => worksheet.write_number(row, 1, overview.totals.input_tokens as f64),
            "cached_input_tokens" => {
                worksheet.write_number(row, 1, overview.totals.cached_input_tokens as f64)
            }
            "output_tokens" => worksheet.write_number(row, 1, overview.totals.output_tokens as f64),
            "cost_usd" => worksheet.write_with_format(row, 1, overview.totals.cost_usd, money),
            "updated_at" => {
                worksheet.write_string(row, 1, overview.updated_at.as_deref().unwrap_or(""))
            }
            _ => unreachable!("unknown summary row"),
        }
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_daily_sheet(
    workbook: &mut Workbook,
    overview: &OverviewResponse,
    header: &Format,
    money: &Format,
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Daily Usage")
        .map_err(|error| error.to_string())?;
    write_headers(
        worksheet,
        &[
            "Date",
            "Total Tokens",
            "Input Tokens",
            "Cached Input Tokens",
            "Output Tokens",
            "Cost USD",
        ],
        header,
    )?;

    for (index, day) in overview.daily.iter().enumerate() {
        let row = (index + 1) as u32;
        worksheet
            .write_string(row, 0, &day.date)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 1, day.total_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 2, day.input_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 3, day.cached_input_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 4, day.output_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_with_format(row, 5, day.cost_usd, money)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_models_sheet(
    workbook: &mut Workbook,
    overview: &OverviewResponse,
    header: &Format,
    money: &Format,
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Model Usage")
        .map_err(|error| error.to_string())?;
    write_headers(
        worksheet,
        &[
            "Model",
            "Total Tokens",
            "Input Tokens",
            "Cached Input Tokens",
            "Output Tokens",
            "Cost USD",
        ],
        header,
    )?;

    for (index, model) in overview.models.iter().enumerate() {
        let row = (index + 1) as u32;
        worksheet
            .write_string(row, 0, &model.model)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 1, model.total_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 2, model.input_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 3, model.cached_input_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_number(row, 4, model.output_tokens as f64)
            .map_err(|error| error.to_string())?;
        worksheet
            .write_with_format(row, 5, model.cost_usd, money)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_headers(
    worksheet: &mut Worksheet,
    labels: &[&str],
    header: &Format,
) -> Result<(), String> {
    for (index, label) in labels.iter().enumerate() {
        worksheet
            .set_column_width(index as u16, if index == 0 { 18 } else { 20 })
            .map_err(|error| error.to_string())?;
        worksheet
            .write_with_format(0, index as u16, *label, header)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn render_markdown(overview: &OverviewResponse) -> String {
    let mut output = String::new();
    output.push_str("# Codex Usage Export\n\n");
    output.push_str(&format!(
        "- Range: {}\n- Date range: {} to {}\n- Timezone: {}\n- Updated at: {}\n\n",
        overview.range,
        overview.start_date,
        overview.end_date,
        overview.timezone,
        overview.updated_at.as_deref().unwrap_or("N/A")
    ));

    output.push_str("## Summary\n\n");
    output.push_str("| Metric | Value |\n| --- | ---: |\n");
    output.push_str(&format!(
        "| Total Tokens | {} |\n",
        overview.totals.total_tokens
    ));
    output.push_str(&format!(
        "| Input Tokens | {} |\n",
        overview.totals.input_tokens
    ));
    output.push_str(&format!(
        "| Cached Input Tokens | {} |\n",
        overview.totals.cached_input_tokens
    ));
    output.push_str(&format!(
        "| Output Tokens | {} |\n",
        overview.totals.output_tokens
    ));
    output.push_str(&format!(
        "| Total Cost USD | {:.6} |\n",
        overview.totals.cost_usd
    ));
    output.push_str(&format!(
        "| Average Tokens / Day | {:.2} |\n",
        overview.totals.avg_tokens_per_day
    ));
    output.push_str(&format!(
        "| Average Cost / Day | {:.6} |\n",
        overview.totals.avg_cost_per_day
    ));
    output.push_str(&format!(
        "| Cache Hit Rate | {:.2}% |\n",
        overview.totals.cache_hit_rate * 100.0
    ));
    output.push_str(&format!(
        "| Cost / 1M Tokens | {:.6} |\n\n",
        overview.totals.cost_per_million_tokens
    ));

    output.push_str("## Daily Usage\n\n");
    output.push_str("| Date | Total Tokens | Input | Cached Input | Output | Cost USD |\n");
    output.push_str("| --- | ---: | ---: | ---: | ---: | ---: |\n");
    for day in &overview.daily {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {:.6} |\n",
            day.date,
            day.total_tokens,
            day.input_tokens,
            day.cached_input_tokens,
            day.output_tokens,
            day.cost_usd
        ));
    }

    output.push_str("\n## Model Usage\n\n");
    output.push_str("| Model | Total Tokens | Input | Cached Input | Output | Cost USD |\n");
    output.push_str("| --- | ---: | ---: | ---: | ---: | ---: |\n");
    for model in &overview.models {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {:.6} |\n",
            escape_markdown_cell(&model.model),
            model.total_tokens,
            model.input_tokens,
            model.cached_input_tokens,
            model.output_tokens,
            model.cost_usd
        ));
    }

    output
}

fn escape_markdown_cell(value: &str) -> String {
    value.replace('|', "\\|")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{OverviewDailyRow, OverviewModelRow, OverviewProjectRow, OverviewTotals};

    fn sample_overview() -> OverviewResponse {
        OverviewResponse {
            range: "30d".to_string(),
            days: 30,
            timezone: "UTC".to_string(),
            start_date: "2026-04-01".to_string(),
            end_date: "2026-04-30".to_string(),
            updated_at: Some("2026-04-30T00:00:00Z".to_string()),
            daily: vec![OverviewDailyRow {
                date: "2026-04-30".to_string(),
                input_tokens: 1200,
                cached_input_tokens: 200,
                output_tokens: 400,
                total_tokens: 1600,
                cost_usd: 0.005275,
            }],
            totals: OverviewTotals {
                input_tokens: 1200,
                cached_input_tokens: 200,
                output_tokens: 400,
                total_tokens: 1600,
                cost_usd: 0.005275,
                avg_tokens_per_day: 53.33,
                avg_cost_per_day: 0.000175,
                cache_hit_rate: 0.1666,
                cost_per_million_tokens: 3.296875,
            },
            models: vec![OverviewModelRow {
                model: "gpt-5".to_string(),
                input_tokens: 1200,
                cached_input_tokens: 200,
                output_tokens: 400,
                total_tokens: 1600,
                cost_usd: 0.005275,
                pricing_status: crate::types::PricingStatus::Priced,
                input_cost_per_million_tokens: Some(1.25),
                cached_input_cost_per_million_tokens: Some(0.125),
                output_cost_per_million_tokens: Some(10.0),
                effective_cost_per_million_tokens: Some(3.296875),
            }],
            projects: vec![OverviewProjectRow {
                project: "/Users/vincent/Documents/Develop/github/codex-usage-desktop".to_string(),
                display_name: "codex-usage-desktop".to_string(),
                input_tokens: 1200,
                cached_input_tokens: 200,
                output_tokens: 400,
                total_tokens: 1600,
                cost_usd: 0.005275,
            }],
        }
    }

    #[test]
    fn renders_markdown_export() {
        let markdown = render_markdown(&sample_overview());

        assert!(markdown.contains("# Codex Usage Export"));
        assert!(markdown.contains("## Summary"));
        assert!(markdown.contains("## Daily Usage"));
        assert!(markdown.contains("## Model Usage"));
        assert!(markdown.contains("2026-04-30"));
        assert!(markdown.contains("gpt-5"));
    }

    #[test]
    fn writes_xlsx_export() {
        let path = std::env::temp_dir().join(format!(
            "codex-usage-export-test-{}.xlsx",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));

        export_overview(&sample_overview(), "xlsx", &path).unwrap();

        let metadata = fs::metadata(&path).unwrap();
        assert!(metadata.len() > 0);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_unsupported_format() {
        let path = std::env::temp_dir().join("codex-usage-export-test.txt");

        let error = export_overview(&sample_overview(), "txt", &path).unwrap_err();

        assert!(error.contains("Unsupported export format"));
    }
}
