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
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use tauri_plugin_updater::UpdaterExt;
use types::{
    CodexLimitsResponse, ExportResponse, MonthlyUsageResponse, OverviewResponse, ScanResponse,
    UpdateCheckResponse, UpdateInstallResponse, SessionDetailRow,
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
async fn fetch_session_details(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionDetailRow>, String> {
    let database_path = state.database_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        db::query_session_details(&db)
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
async fn check_for_updates(
    app: tauri::AppHandle,
    etag: Option<String>,
) -> Result<UpdateCheckResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_version = app.package_info().version.to_string();
        log::info!(
            "Starting update check. Current version: {}. ETag context: {:?}",
            current_version,
            etag
        );
        
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| {
                let err_msg = format!("Failed to build HTTP client: {e}");
                log::error!("{}", err_msg);
                err_msg
            })?;
            
        // Struct to parse version from tauri.conf.json
        #[derive(serde::Deserialize)]
        struct TauriConfDto {
            version: String,
        }

        let mut latest_version_from_static: Option<String> = None;

        // --- Tier 1: Try jsDelivr CDN ---
        log::info!("Checking version via jsDelivr CDN.");
        let cdn_url = "https://cdn.jsdelivr.net/gh/itvincent-git/codex-usage-desktop@main/src-tauri/tauri.conf.json";
        match client.get(cdn_url).header("User-Agent", "codex-usage-desktop").header("Accept", "application/json").send() {
            Ok(response) if response.status().is_success() => {
                if let Ok(conf) = response.json::<TauriConfDto>() {
                    log::info!("jsDelivr CDN returned version: {}", conf.version);
                    latest_version_from_static = Some(conf.version);
                }
            }
            Ok(response) => {
                log::warn!("jsDelivr CDN check failed with status: {}", response.status());
            }
            Err(err) => {
                log::warn!("jsDelivr CDN check failed with error: {}", err);
            }
        }

        // --- Tier 2: Try Raw GitHub (Fallback) ---
        if latest_version_from_static.is_none() {
            log::info!("Checking version via Raw GitHub.");
            let raw_url = "https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/src-tauri/tauri.conf.json";
            match client.get(raw_url).header("User-Agent", "codex-usage-desktop").header("Accept", "application/json").send() {
                Ok(response) if response.status().is_success() => {
                    if let Ok(conf) = response.json::<TauriConfDto>() {
                        log::info!("Raw GitHub returned version: {}", conf.version);
                        latest_version_from_static = Some(conf.version);
                    }
                }
                Ok(response) => {
                    log::warn!("Raw GitHub check failed with status: {}", response.status());
                }
                Err(err) => {
                    log::warn!("Raw GitHub check failed with error: {}", err);
                }
            }
        }

        // If CDN or Raw GitHub successfully returned version info
        if let Some(version) = latest_version_from_static {
            let has_update = is_newer(&current_version, &version);
            
            if !has_update {
                log::info!("CDN/Raw check: Version {} is not newer than current {}. No update needed.", version, current_version);
                return Ok(UpdateCheckResponse {
                    has_update: false,
                    current_version,
                    latest_version: version.clone(),
                    latest_tag: format!("app-v{}", version),
                    release_name: None,
                    release_notes: None,
                    release_url: "".to_string(),
                    etag: None,
                    not_modified: Some(false),
                });
            }
            
            // If there IS a new version, try to get release details from GitHub API
            log::info!("CDN/Raw check: New version {} detected! Querying GitHub API for release notes.", version);
            let mut api_request = client
                .get("https://api.github.com/repos/itvincent-git/codex-usage-desktop/releases/latest")
                .header("User-Agent", "codex-usage-desktop")
                .header("Accept", "application/json");
                
            if let Some(ref e) = etag {
                api_request = api_request.header("If-None-Match", e);
            }

            match api_request.send() {
                Ok(response) => {
                    let status = response.status();
                    if status == reqwest::StatusCode::NOT_MODIFIED {
                        log::info!("GitHub API returned 304. Utilizing static version details.");
                        return Ok(UpdateCheckResponse {
                            has_update: true,
                            current_version,
                            latest_version: version.clone(),
                            latest_tag: format!("app-v{}", version),
                            release_name: Some(format!("Codex Usage Desktop v{}", version)),
                            release_notes: Some("A new update is available. Please view the release page for details.".to_string()),
                            release_url: "https://github.com/itvincent-git/codex-usage-desktop/releases/latest".to_string(),
                            etag,
                            not_modified: Some(true),
                        });
                    }
                    
                    if status.is_success() {
                        let response_etag = response.headers().get("etag")
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_string());
                        
                        #[derive(serde::Deserialize)]
                        struct GithubReleaseDto {
                            tag_name: String,
                            name: Option<String>,
                            html_url: String,
                            body: Option<String>,
                        }
                        
                        if let Ok(release) = response.json::<GithubReleaseDto>() {
                            log::info!("Successfully retrieved release notes from GitHub API for v{}.", version);
                            return Ok(UpdateCheckResponse {
                                has_update: true,
                                current_version,
                                latest_version: release.tag_name.trim_start_matches("app-v").trim_start_matches('v').to_string(),
                                latest_tag: release.tag_name,
                                release_name: release.name,
                                release_notes: release.body,
                                release_url: release.html_url,
                                etag: response_etag,
                                not_modified: Some(false),
                            });
                        }
                    }
                    log::warn!("GitHub API failed with status {}. Falling back to CDN metadata.", status);
                }
                Err(err) => {
                    log::warn!("GitHub API request failed: {}. Falling back to CDN metadata.", err);
                }
            }

            // Fallback response if GitHub API fails but we know there is an update
            return Ok(UpdateCheckResponse {
                has_update: true,
                current_version,
                latest_version: version.clone(),
                latest_tag: format!("app-v{}", version),
                release_name: Some(format!("Codex Usage Desktop v{}", version)),
                release_notes: Some(
                    "GitHub API rate limit exceeded or network timeout. Please check the release page to view update logs and download the latest version.\n\nGitHub API 访问受限或超时，请直接前往发布页面查看更新日志并下载最新版本。".to_string()
                ),
                release_url: "https://github.com/itvincent-git/codex-usage-desktop/releases/latest".to_string(),
                etag: None,
                not_modified: Some(false),
            });
        }

        // --- Tier 3: Primary GitHub API Check (Fallback if Tiers 1 and 2 both failed completely) ---
        log::info!("CDN and Raw checks both failed. Attempting primary GitHub API query directly.");
        let mut api_request = client
            .get("https://api.github.com/repos/itvincent-git/codex-usage-desktop/releases/latest")
            .header("User-Agent", "codex-usage-desktop")
            .header("Accept", "application/json");
            
        if let Some(ref e) = etag {
            api_request = api_request.header("If-None-Match", e);
        }

        let response = api_request.send().map_err(|e| {
            let err_msg = format!("Update check network request failed: {e}");
            log::error!("{}", err_msg);
            err_msg
        })?;

        let status = response.status();
        
        if status == reqwest::StatusCode::NOT_MODIFIED {
            log::info!("Update check: 304 Not Modified. ETag matched.");
            return Ok(UpdateCheckResponse {
                has_update: false,
                current_version,
                latest_version: "".to_string(),
                latest_tag: "".to_string(),
                release_name: None,
                release_notes: None,
                release_url: "".to_string(),
                etag,
                not_modified: Some(true),
            });
        }
            
        if !status.is_success() {
            let body = response.text().unwrap_or_else(|_| "Unavailable".to_string());
            let err_msg = format!("GitHub API returned error status: {status}. Response: {body}");
            log::error!("{}", err_msg);
            return Err(err_msg);
        }
        
        let response_etag = response.headers().get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        
        #[derive(serde::Deserialize)]
        struct GithubReleaseDto {
            tag_name: String,
            name: Option<String>,
            html_url: String,
            body: Option<String>,
        }
        
        let release: GithubReleaseDto = response
            .json()
            .map_err(|e| {
                let err_msg = format!("Failed to parse release JSON: {e}");
                log::error!("{}", err_msg);
                err_msg
            })?;
            
        let has_update = is_newer(&current_version, &release.tag_name);
        
        log::info!(
            "Update check completed via primary GitHub API. Latest version: {} (Tag: {}), has_update: {}, ETag: {:?}",
            release.tag_name.trim_start_matches("app-v").trim_start_matches('v'),
            release.tag_name,
            has_update,
            response_etag
        );
        
        Ok(UpdateCheckResponse {
            has_update,
            current_version,
            latest_version: release.tag_name.trim_start_matches("app-v").trim_start_matches('v').to_string(),
            latest_tag: release.tag_name,
            release_name: release.name,
            release_notes: release.body,
            release_url: release.html_url,
            etag: response_etag,
            not_modified: Some(false),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_and_install_update(
    app: tauri::AppHandle,
) -> Result<UpdateInstallResponse, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available.".to_string())?;

    let version = update.version.clone();
    update
        .download_and_install(
            |chunk_length, content_length| {
                log::debug!("Downloaded updater chunk: {chunk_length} bytes of {content_length:?}");
            },
            || {
                log::info!("Update download finished.");
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    log::info!("Update {version} installed. Waiting for user restart.");
    Ok(UpdateInstallResponse { version })
}

#[tauri::command]
async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    app.request_restart();
    Ok(())
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

#[derive(serde::Deserialize)]
struct TrayMenuItemDto {
    id: String,
    text: String,
    enabled: bool,
}

#[derive(serde::Deserialize)]
struct TrayMenuUpdate {
    title: String,
    items: Vec<TrayMenuItemDto>,
    show_main_text: Option<String>,
    quit_text: Option<String>,
}

#[tauri::command]
fn update_tray(app: tauri::AppHandle, payload: TrayMenuUpdate) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(payload.title));
        
        let mut menu_builder = tauri::menu::MenuBuilder::new(&app);
        
        for item in payload.items {
            if item.id == "separator" {
                menu_builder = menu_builder.separator();
            } else {
                let menu_item = tauri::menu::MenuItemBuilder::with_id(&item.id, &item.text)
                    .enabled(item.enabled)
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                menu_builder = menu_builder.item(&menu_item);
            }
        }
        
        let show_main_label = payload.show_main_text.unwrap_or_else(|| "显示主窗口 / Show Main Window".to_string());
        let quit_label = payload.quit_text.unwrap_or_else(|| "退出 / Quit".to_string());

        menu_builder = menu_builder
            .separator()
            .item(&tauri::menu::MenuItemBuilder::with_id("show_main", &show_main_label).build(&app).map_err(|e| e.to_string())?)
            .item(&tauri::menu::MenuItemBuilder::with_id("quit", &quit_label).build(&app).map_err(|e| e.to_string())?);
            
        let menu = menu_builder.build().map_err(|e| e.to_string())?;
        let _ = tray.set_menu(Some(menu));
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            app.manage(AppState {
                database_path: app_data_dir.join("codex-usage-desktop.db"),
                pricing_cache_path: app_data_dir.join("codex-pricing-cache.json"),
            });

            // Set up system tray icon
            let tray_icon_bytes = include_bytes!("../icons/tray_iconTemplate@2x.png");
            let tray_icon_image = tauri::image::Image::from_bytes(tray_icon_bytes).map_err(|e| e.to_string())?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon_image)
                .icon_as_template(true)
                .tooltip("Codex Usage")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show_main" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .map_err(|e| e.to_string())?;

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
            download_and_install_update,
            restart_app,
            open_url,
            fetch_session_details,
            update_tray
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
