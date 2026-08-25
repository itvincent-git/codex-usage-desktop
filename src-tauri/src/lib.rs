mod codex_environment;
mod codex_limits;
mod date;
mod db;
mod exporter;
mod overview;
mod pricing;
mod scanner;
mod session_index;
mod session_replay;
mod types;

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use types::{
    CodexLimitsResponse, CodexQuotaForecastResponse, ExportResponse, ModelPricingCatalogResponse,
    MonthlyUsageResponse, OverviewResponse, ProjectAnalyticsResponse, ScanResponse,
    SessionDetailRow, SessionReplayDetail, UpdateCheckResponse, UpdateDownloadProgress,
    UpdateInstallResponse, UsageRefreshResponse,
};

const BACKGROUND_RESCAN_INTERVAL: Duration = Duration::from_secs(5 * 60);

struct AppState {
    database_path: PathBuf,
    pricing_cache_path: PathBuf,
}

fn scan_usage_blocking(
    database_path: &Path,
    pricing_cache_path: &Path,
) -> Result<ScanResponse, String> {
    let mut db = db::open_database(database_path)?;
    let pricing_started = Instant::now();
    let pricing_source =
        pricing::PricingSource::load_cached_or_embedded(Some(pricing_cache_path.to_path_buf()));
    let pricing_ms = pricing_started.elapsed().as_millis();
    let mut response = scanner::scan_codex_usage(&mut db, &pricing_source, None, None)?;
    response.metrics.pricing_ms = pricing_ms;
    Ok(response)
}

fn refresh_usage_data_with<S, L>(
    force_limits: bool,
    scan_fn: S,
    limits_fn: L,
) -> Result<UsageRefreshResponse, String>
where
    S: FnOnce() -> Result<ScanResponse, String>,
    L: FnOnce() -> Result<CodexLimitsResponse, String>,
{
    log::info!("Background rescan started. force_limits={force_limits}");
    let scan = scan_fn().map_err(|error| {
        log::warn!("Background rescan failed: {error}");
        error
    })?;
    let files_scanned = scan.metrics.files_scanned;
    let files_parsed = scan.metrics.files_parsed;
    let files_reused = scan.metrics.files_reused;
    log::info!(
        "Background rescan completed. filesScanned={files_scanned} filesParsed={files_parsed} filesReused={files_reused}"
    );

    let should_fetch_limits = force_limits || files_parsed > 0;
    let (limits, limits_error, limits_skipped) = if should_fetch_limits {
        log::info!("Starting fetch_codex_limits after rescan.");
        match limits_fn() {
            Ok(limits) => {
                log::info!("Completed fetch_codex_limits after rescan.");
                (Some(limits), None, false)
            }
            Err(error) => {
                log::warn!("fetch_codex_limits failed after rescan: {error}");
                (None, Some(error), false)
            }
        }
    } else {
        log::info!("Skipping fetch_codex_limits because no Codex session files changed.");
        (None, None, true)
    };

    Ok(UsageRefreshResponse {
        scan,
        limits,
        limits_error,
        limits_skipped,
        refreshed_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
}

fn refresh_usage_data_blocking(
    database_path: &Path,
    pricing_cache_path: &Path,
    force_limits: bool,
) -> Result<UsageRefreshResponse, String> {
    refresh_usage_data_with(
        force_limits,
        || scan_usage_blocking(database_path, pricing_cache_path),
        codex_limits::fetch_codex_limits,
    )
}

#[tauri::command]
async fn scan_usage(state: tauri::State<'_, AppState>) -> Result<ScanResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        scan_usage_blocking(&database_path, &pricing_cache_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn refresh_usage_data(
    state: tauri::State<'_, AppState>,
    force_limits: bool,
) -> Result<UsageRefreshResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        refresh_usage_data_blocking(&database_path, &pricing_cache_path, force_limits)
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
async fn fetch_project_analytics(
    state: tauri::State<'_, AppState>,
    project: String,
    range: String,
) -> Result<ProjectAnalyticsResponse, String> {
    let database_path = state.database_path.clone();
    let pricing_cache_path = state.pricing_cache_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        let pricing_source = pricing::PricingSource::load(Some(pricing_cache_path));
        overview::get_project_analytics(&db, &project, &range, None, &pricing_source)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_model_pricing_catalog(
    state: tauri::State<'_, AppState>,
) -> Result<ModelPricingCatalogResponse, String> {
    let pricing_cache_path = state.pricing_cache_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(pricing::PricingSource::load(Some(pricing_cache_path)).catalog())
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
async fn fetch_codex_quota_forecast() -> Result<CodexQuotaForecastResponse, String> {
    tauri::async_runtime::spawn_blocking(codex_limits::fetch_codex_quota_forecast)
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
        let mut sessions = db::query_session_details(&db)?;
        let names = session_index::load_thread_names();
        let agents = session_replay::load_session_agents(&db)?
            .into_iter()
            .map(|agent| (agent.path.clone(), agent))
            .collect::<std::collections::BTreeMap<_, _>>();
        for session in &mut sessions {
            session.thread_name = session_index::resolve_thread_name(
                &session.path,
                session.thread_name.take(),
                &names,
            );
            if let Some(agent) = agents.get(&session.path) {
                session.agent_session_id = Some(agent.session_id.clone());
                session.parent_session_id = agent.parent_session_id.clone();
                session.agent_depth = agent.depth;
                session.agent_path = Some(agent.agent_path.clone());
                session.agent_nickname = agent.nickname.clone();
                session.agent_role = agent.role.clone();
            }
        }
        Ok(sessions)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_session_detail(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<SessionReplayDetail, String> {
    let database_path = state.database_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let db = db::open_database(&database_path)?;
        let mut detail = session_replay::fetch_session_detail(&db, &path)?;
        let names = session_index::load_thread_names();
        detail.thread_name =
            session_index::resolve_thread_name(&detail.path, detail.thread_name.take(), &names);
        Ok(detail)
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
        let patch_clean: String = parts[2]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
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

        // The updater manifest is uploaded only after every platform build succeeds.
        // Do not use the version committed to main because it can get ahead of the
        // latest installable release when a release workflow fails.
        #[derive(serde::Deserialize)]
        struct UpdaterManifestDto {
            version: String,
        }

        let manifest_url = "https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/latest.json";
        let manifest_response = client
            .get(manifest_url)
            .header("User-Agent", "codex-usage-desktop")
            .header("Accept", "application/json")
            .send()
            .map_err(|e| format!("Update manifest request failed: {e}"))?;

        if !manifest_response.status().is_success() {
            return Err(format!(
                "Update manifest returned status {}",
                manifest_response.status()
            ));
        }

        let manifest: UpdaterManifestDto = manifest_response
            .json()
            .map_err(|e| format!("Failed to parse update manifest: {e}"))?;
        let version = manifest.version;
        let has_update = is_newer(&current_version, &version);

        if !has_update {
            log::info!(
                "Updater manifest version {} is not newer than current {}.",
                version,
                current_version
            );
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

        log::info!(
            "Updater manifest reports installable version {}. Querying release notes.",
            version
        );
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
            log::info!("GitHub API returned 304. Using updater manifest details.");
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

        if !status.is_success() {
            log::warn!("GitHub API returned status {status}. Using updater manifest details.");
            return Ok(UpdateCheckResponse {
                has_update: true,
                current_version,
                latest_version: version.clone(),
                latest_tag: format!("app-v{}", version),
                release_name: Some(format!("Codex Usage Desktop v{}", version)),
                release_notes: None,
                release_url: "https://github.com/itvincent-git/codex-usage-desktop/releases/latest".to_string(),
                etag: None,
                not_modified: Some(false),
            });
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

        let release: GithubReleaseDto = response.json().map_err(|e| {
            let err_msg = format!("Failed to parse release JSON: {e}");
            log::error!("{}", err_msg);
            err_msg
        })?;
        let release_version = release
            .tag_name
            .trim_start_matches("app-v")
            .trim_start_matches('v');

        if release_version != version {
            log::warn!(
                "Release API version {} does not match updater manifest version {}.",
                release_version,
                version
            );
            return Ok(UpdateCheckResponse {
                has_update: true,
                current_version,
                latest_version: version.clone(),
                latest_tag: format!("app-v{}", version),
                release_name: Some(format!("Codex Usage Desktop v{}", version)),
                release_notes: None,
                release_url: "https://github.com/itvincent-git/codex-usage-desktop/releases/latest".to_string(),
                etag: None,
                not_modified: Some(false),
            });
        }

        log::info!(
            "Update check completed. Latest installable version: {} (Tag: {}), ETag: {:?}",
            version,
            release.tag_name,
            response_etag
        );

        Ok(UpdateCheckResponse {
            has_update,
            current_version,
            latest_version: version,
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
    let downloaded = Arc::new(AtomicU64::new(0));
    let finished_downloaded = Arc::clone(&downloaded);
    let progress_app = app.clone();
    update
        .download_and_install(
            |chunk_length, content_length| {
                let downloaded = downloaded
                    .fetch_add(chunk_length as u64, Ordering::Relaxed)
                    .saturating_add(chunk_length as u64);
                let _ = progress_app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded,
                        total: content_length,
                        finished: false,
                    },
                );
                log::debug!("Downloaded updater chunk: {chunk_length} bytes of {content_length:?}");
            },
            || {
                let downloaded = finished_downloaded.load(Ordering::Relaxed);
                let _ = app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded,
                        total: Some(downloaded),
                        finished: true,
                    },
                );
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
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(Some(&payload.title));
        #[cfg(not(target_os = "macos"))]
        let _ = tray.set_tooltip(Some(if payload.title.is_empty() {
            "Codex Usage".to_string()
        } else {
            payload.title.clone()
        }));

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

        let show_main_label = payload
            .show_main_text
            .unwrap_or_else(|| "显示主窗口 / Show Main Window".to_string());
        let quit_label = payload
            .quit_text
            .unwrap_or_else(|| "退出 / Quit".to_string());

        menu_builder = menu_builder
            .separator()
            .item(
                &tauri::menu::MenuItemBuilder::with_id("show_main", &show_main_label)
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            )
            .item(
                &tauri::menu::MenuItemBuilder::with_id("quit", &quit_label)
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            );

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

fn setup_app_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let reload_item = MenuItem::with_id(app, "reload_page", "Reload", true, Some("CmdOrCtrl+R"))?;
    #[cfg(debug_assertions)]
    let inspect_item = MenuItem::with_id(
        app,
        "inspect_page",
        "Inspect",
        true,
        Some(if cfg!(target_os = "macos") {
            "CmdOrCtrl+Option+I"
        } else {
            "Ctrl+Shift+I"
        }),
    )?;

    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "View" {
                #[cfg(debug_assertions)]
                submenu.prepend(&inspect_item)?;
                submenu.prepend(&reload_item)?;
                break;
            }
        }
    }

    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
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
        .on_menu_event(|app, event| match event.id.as_ref() {
            "reload_page" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.reload();
                }
            }
            #[cfg(debug_assertions)]
            "inspect_page" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--hidden"]),
            ))?;

            setup_app_menu(app)?;

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("codex-usage-desktop.db");
            let pricing_cache_path = app_data_dir.join("codex-pricing-cache.json");
            app.manage(AppState {
                database_path: database_path.clone(),
                pricing_cache_path: pricing_cache_path.clone(),
            });

            // Set up system tray icon
            #[cfg(target_os = "macos")]
            let tray_icon_bytes = include_bytes!("../icons/tray_iconTemplate@2x.png");
            #[cfg(not(target_os = "macos"))]
            let tray_icon_bytes = include_bytes!("../icons/tray_icon.png");
            let tray_icon_image =
                tauri::image::Image::from_bytes(tray_icon_bytes).map_err(|e| e.to_string())?;

            let tray_builder = TrayIconBuilder::with_id("main")
                .icon(tray_icon_image)
                .tooltip("Codex Usage")
                .on_menu_event(|app, event| match event.id.as_ref() {
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
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);
            #[cfg(target_os = "windows")]
            let tray_builder = tray_builder.show_menu_on_left_click(false);

            let _tray = tray_builder.build(app).map_err(|e| e.to_string())?;

            if std::env::args().any(|arg| arg == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            let database_path = database_path.clone();
            let pricing_cache_path = pricing_cache_path.clone();
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn_blocking(move || loop {
                std::thread::sleep(BACKGROUND_RESCAN_INTERVAL);

                match refresh_usage_data_blocking(&database_path, &pricing_cache_path, false) {
                    Ok(refresh_response) => {
                        let _ = app_handle.emit("background-refresh-completed", refresh_response);
                    }
                    Err(error) => {
                        log::warn!("Background usage refresh failed: {error}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_usage,
            refresh_usage_data,
            fetch_overview,
            fetch_project_analytics,
            fetch_model_pricing_catalog,
            fetch_monthly_usage,
            fetch_codex_limits,
            fetch_codex_quota_forecast,
            reset_usage_state,
            export_usage,
            check_for_updates,
            download_and_install_update,
            restart_app,
            open_url,
            fetch_session_details,
            fetch_session_detail,
            update_tray
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::cell::Cell;

    fn scan_response(files_parsed: usize) -> ScanResponse {
        ScanResponse {
            imported_days: 1,
            scanned_at: "2026-06-11T00:00:00.000Z".to_string(),
            timezone: "UTC".to_string(),
            metrics: types::ScanMetrics {
                files_scanned: 2,
                files_parsed,
                files_reused: 2usize.saturating_sub(files_parsed),
                ..types::ScanMetrics::default()
            },
        }
    }

    fn limits_response() -> CodexLimitsResponse {
        CodexLimitsResponse {
            session: None,
            weekly: None,
            reset_credits_available_count: None,
            reset_credits: None,
            updated_at: "2026-06-11T00:00:00.000Z".to_string(),
            source: "test".to_string(),
            account: None,
            membership_level: None,
            subscription_expires_at: None,
            subscription_will_renew: None,
        }
    }

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

    #[test]
    fn refresh_skips_limits_when_scan_has_no_changed_files() {
        let limits_called = Cell::new(false);

        let response = refresh_usage_data_with(
            false,
            || Ok(scan_response(0)),
            || {
                limits_called.set(true);
                Ok(limits_response())
            },
        )
        .unwrap();

        assert!(!limits_called.get());
        assert!(response.limits.is_none());
        assert!(response.limits_error.is_none());
        assert!(response.limits_skipped);
    }

    #[test]
    fn refresh_fetches_limits_when_scan_has_changed_files() {
        let limits_called = Cell::new(false);

        let response = refresh_usage_data_with(
            false,
            || Ok(scan_response(1)),
            || {
                limits_called.set(true);
                Ok(limits_response())
            },
        )
        .unwrap();

        assert!(limits_called.get());
        assert!(response.limits.is_some());
        assert!(response.limits_error.is_none());
        assert!(!response.limits_skipped);
    }

    #[test]
    fn refresh_force_mode_always_fetches_limits() {
        let limits_called = Cell::new(false);

        let response = refresh_usage_data_with(
            true,
            || Ok(scan_response(0)),
            || {
                limits_called.set(true);
                Ok(limits_response())
            },
        )
        .unwrap();

        assert!(limits_called.get());
        assert!(response.limits.is_some());
        assert!(response.limits_error.is_none());
        assert!(!response.limits_skipped);
    }

    #[test]
    fn refresh_returns_scan_when_limits_fetch_fails() {
        let response = refresh_usage_data_with(
            true,
            || Ok(scan_response(0)),
            || Err("limits unavailable".to_string()),
        )
        .unwrap();

        assert_eq!(response.scan.metrics.files_parsed, 0);
        assert!(response.limits.is_none());
        assert_eq!(response.limits_error.as_deref(), Some("limits unavailable"));
        assert!(!response.limits_skipped);
    }
}
