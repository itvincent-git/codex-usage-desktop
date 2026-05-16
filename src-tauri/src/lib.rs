mod date;
mod db;
mod exporter;
mod overview;
mod pricing;
mod scanner;
mod types;

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::Manager;
use types::{ExportResponse, MonthlyUsageResponse, OverviewResponse, ScanResponse};

struct AppState {
    database_path: PathBuf,
    pricing_cache_path: PathBuf,
}

#[tauri::command]
async fn scan_usage(state: tauri::State<'_, AppState>) -> Result<ScanResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut db = db::open_database(&database_path)?;
        let pricing_started = Instant::now();
        let pricing_source =
            pricing::PricingSource::load_cached_or_embedded(Some(pricing_cache_path));
        let pricing_ms = pricing_started.elapsed().as_millis();
        let mut response = scanner::scan_codex_usage(&mut db, &pricing_source, None, None)?;
        response.metrics.pricing_ms = pricing_ms;
        Ok(response)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_overview(
    state: tauri::State<'_, AppState>,
    range: String,
) -> Result<OverviewResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        let pricing_source = pricing::PricingSource::load(Some(pricing_cache_path));
        overview::get_overview(&db, &range, None, &pricing_source)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_monthly_usage(
    state: tauri::State<'_, AppState>,
) -> Result<MonthlyUsageResponse, String> {
    let database_path = state.database_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        overview::get_monthly_usage(&db, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reset_usage_state(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        db::reset_usage_state(&db)?;
        delete_pricing_cache(&pricing_cache_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_usage(
    state: tauri::State<'_, AppState>,
    range: String,
    format: String,
    path: String,
) -> Result<ExportResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        let pricing_source = pricing::PricingSource::load(Some(pricing_cache_path));
        let overview = overview::get_overview(&db, &range, None, &pricing_source)?;
        exporter::export_overview(&overview, &format, PathBuf::from(path).as_path())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn delete_pricing_cache(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            app.manage(AppState {
                database_path: app_data_dir.join("codex-usage-desktop.db"),
                pricing_cache_path: app_data_dir.join("codex-pricing-cache.json"),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_usage,
            fetch_overview,
            fetch_monthly_usage,
            reset_usage_state,
            export_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn delete_pricing_cache_removes_existing_file() {
        let path = std::env::temp_dir().join(format!(
            "codex-pricing-cache-reset-{}.json",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::write(&path, "{}").unwrap();

        delete_pricing_cache(&path).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn delete_pricing_cache_allows_missing_file() {
        let path = std::env::temp_dir().join(format!(
            "codex-pricing-cache-missing-{}.json",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));

        delete_pricing_cache(&path).unwrap();
    }
}
