mod date;
mod db;
mod overview;
mod pricing;
mod scanner;
mod types;

use std::path::PathBuf;
use tauri::Manager;
use types::{OverviewResponse, ScanResponse};

struct AppState {
    database_path: PathBuf,
    pricing_cache_path: PathBuf,
}

#[tauri::command]
fn scan_usage(state: tauri::State<'_, AppState>) -> Result<ScanResponse, String> {
    let mut db = db::open_database(&state.database_path)?;
    let pricing_source = pricing::PricingSource::load(Some(state.pricing_cache_path.clone()));
    scanner::scan_codex_usage(&mut db, &pricing_source, None, None)
}

#[tauri::command]
fn fetch_overview(
    state: tauri::State<'_, AppState>,
    range: String,
) -> Result<OverviewResponse, String> {
    let db = db::open_database(&state.database_path)?;
    overview::get_overview(&db, &range, None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            app.manage(AppState {
                database_path: app_data_dir.join("codex-usage-desktop.db"),
                pricing_cache_path: app_data_dir.join("codex-pricing-cache.json"),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_usage, fetch_overview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
