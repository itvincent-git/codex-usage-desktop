mod codex_limits;
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
use types::{
    CodexLimitsResponse, ExportResponse, MonthlyUsageResponse, OverviewResponse, ScanResponse,
    UpdateCheckResponse,
};

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
async fn fetch_codex_limits() -> Result<CodexLimitsResponse, String> {
    tauri::async_runtime::spawn_blocking(codex_limits::fetch_codex_limits)
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

fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let clean = v.trim_start_matches("app-v").trim_start_matches('v');
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse::<u32>().ok()?;
        let minor = parts[1].parse::<u32>().ok()?;
        let patch_clean: String = parts[2].chars().take_while(|c| c.is_ascii_digit()).collect();
        let patch = patch_clean.parse::<u32>().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_version(current), parse_version(latest)) {
        (Some((c_maj, c_min, c_pat)), Some((l_maj, l_min, l_pat))) => {
            if l_maj != c_maj {
                l_maj > c_maj
            } else if l_min != c_min {
                l_min > c_min
            } else {
                l_pat > c_pat
            }
        }
        _ => false,
    }
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheckResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_version = app.package_info().version.to_string();
        
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
            
        let response = client
            .get("https://api.github.com/repos/itvincent-git/codex-usage-desktop/releases/latest")
            .header("User-Agent", "codex-usage-desktop")
            .header("Accept", "application/json")
            .send()
            .map_err(|e| format!("Network request failed: {e}"))?;
            
        if !response.status().is_success() {
            return Err(format!("GitHub API returned error status: {}", response.status()));
        }
        
        #[derive(serde::Deserialize)]
        struct GithubReleaseDto {
            tag_name: String,
            name: Option<String>,
            html_url: String,
            body: Option<String>,
        }
        
        let release: GithubReleaseDto = response
            .json()
            .map_err(|e| format!("Failed to parse release JSON: {e}"))?;
            
        let has_update = is_newer(&current_version, &release.tag_name);
        
        Ok(UpdateCheckResponse {
            has_update,
            current_version,
            latest_version: release.tag_name.trim_start_matches("app-v").trim_start_matches('v').to_string(),
            latest_tag: release.tag_name,
            release_name: release.name,
            release_notes: release.body,
            release_url: release.html_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
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
            fetch_codex_limits,
            reset_usage_state,
            export_usage,
            check_for_updates,
            open_url
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

    #[test]
    fn test_parse_version() {
        assert_eq!(parse_version("0.4.0"), Some((0, 4, 0)));
        assert_eq!(parse_version("v0.4.0"), Some((0, 4, 0)));
        assert_eq!(parse_version("app-v0.4.0"), Some((0, 4, 0)));
        assert_eq!(parse_version("app-v1.12.3-beta"), Some((1, 12, 3)));
        assert_eq!(parse_version("invalid"), None);
    }

    #[test]
    fn test_is_newer() {
        assert!(is_newer("0.4.0", "0.5.0"));
        assert!(is_newer("0.4.0", "v0.4.1"));
        assert!(is_newer("0.4.0", "app-v1.0.0"));
        assert!(!is_newer("0.4.0", "0.4.0"));
        assert!(!is_newer("0.4.0", "0.3.9"));
        assert!(!is_newer("0.4.0", "invalid"));
    }
}
