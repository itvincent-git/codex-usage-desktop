use crate::types::{CodexLimitsResponse, ModelUsage};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

mod geometry;
#[cfg(target_os = "macos")]
mod native;
use geometry::{Dock, COMPACT_SIZE};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedQuota {
    identity: String,
    remaining: f64,
    updated_at: String,
    resets_at: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Preferences {
    enabled: bool,
    expanded: bool,
    anchor: Option<(i32, i32)>,
    dock: Dock,
    extension_length: Option<f64>,
    size_revision: u8,
    saved_quota: Option<SavedQuota>,
}

pub(crate) struct FloatingState {
    preferences: Mutex<Preferences>,
    limits: Mutex<Option<CodexLimitsResponse>>,
    quota_failed: Mutex<bool>,
    database: PathBuf,
    path: PathBuf,
}

impl FloatingState {
    fn persist(&self, preferences: &Preferences) -> Result<(), String> {
        let bytes = serde_json::to_vec(preferences).map_err(|error| error.to_string())?;
        let temporary = self.path.with_extension("tmp");
        std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        std::fs::rename(temporary, &self.path).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Default, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenTotals {
    input: i64,
    cached: i64,
    output: i64,
    total: i64,
}

impl TokenTotals {
    fn add(&mut self, usage: &ModelUsage) {
        self.input += (usage.input_tokens - usage.cached_input_tokens).max(0);
        self.cached += usage.cached_input_tokens;
        self.output += usage.output_tokens;
        self.total += usage.total_tokens;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectTokens {
    path: String,
    name: String,
    tokens: TokenTotals,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelPeriods {
    today: Vec<ModelTokens>,
    week: Vec<ModelTokens>,
    month: Vec<ModelTokens>,
    total: Vec<ModelTokens>,
}
#[derive(Serialize)]
struct ModelTokens {
    name: String,
    tokens: TokenTotals,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FloatingUsage {
    today: TokenTotals,
    week: Option<TokenTotals>,
    month: TokenTotals,
    total: TokenTotals,
    projects: Vec<ProjectTokens>,
    models: ModelPeriods,
    remaining_percent: Option<f64>,
    quota_updated_at: Option<String>,
    quota_warning: Option<String>,
    updated_at: String,
    first_record_at: Option<String>,
}

fn snapshot_identity(snapshot: &crate::codex_accounts::native::Snapshot) -> Option<String> {
    let auth = crate::codex_auth::parse_codex_auth(snapshot.content.as_deref()?).ok()?;
    if !auth.is_chatgpt {
        return None;
    }
    use sha2::{Digest, Sha256};
    let (user, workspace) = (auth.user_id?, auth.account_id?);
    Some(format!(
        "{:x}",
        Sha256::digest(format!("{user}\0{workspace}").as_bytes())
    ))
}

pub(crate) fn observe_limits(app: &tauri::AppHandle, limits: &CodexLimitsResponse) {
    let Some(state) = app.try_state::<FloatingState>() else {
        return;
    };
    let Ok(snapshot) = crate::codex_accounts::native::snapshot(
        &crate::codex_environment::selected_codex_environment(),
    ) else {
        return;
    };
    if limits.auth_context.as_deref() != Some(snapshot.context().as_str()) {
        return;
    }
    let Some(identity) = snapshot_identity(&snapshot) else {
        return;
    };
    *state.limits.lock().unwrap() = Some(limits.clone());
    let mut preferences = state.preferences.lock().unwrap();
    *state.quota_failed.lock().unwrap() = limits.weekly.is_none();
    if let Some(weekly) = &limits.weekly {
        preferences.saved_quota = Some(SavedQuota {
            identity: identity.clone(),
            remaining: weekly.remaining_percent.clamp(0.0, 100.0),
            updated_at: limits.updated_at.clone(),
            resets_at: weekly.resets_at.clone(),
        });
    }
    if let Err(error) = state.persist(&preferences) {
        log::warn!("Saving floating period: {error}");
    }
    drop(preferences);
    let _ = app.emit_to("floating", "floating-updated", ());
}

pub(crate) fn observe_limits_failure(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<FloatingState>() {
        *state.quota_failed.lock().unwrap() = true;
        let _ = app.emit_to("floating", "floating-updated", ());
    }
}

pub(crate) fn is_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<FloatingState>()
        .is_some_and(|state| state.preferences.lock().unwrap().enabled)
}

fn totals(input: i64, cached: i64, output: i64, total: i64) -> TokenTotals {
    TokenTotals {
        input: (input - cached).max(0),
        cached,
        output,
        total,
    }
}

impl std::ops::AddAssign<TokenTotals> for TokenTotals {
    fn add_assign(&mut self, value: TokenTotals) {
        self.input += value.input;
        self.cached += value.cached;
        self.output += value.output;
        self.total += value.total;
    }
}

fn aggregate(
    rows: &[crate::types::DailyUsageRow],
    now: DateTime<Utc>,
    timezone: chrono_tz::Tz,
) -> FloatingUsage {
    let local = now.with_timezone(&timezone).date_naive();
    let monday = local - chrono::Days::new(u64::from(local.weekday().num_days_from_monday()));
    let mut periods: [TokenTotals; 4] = Default::default();
    let mut models: [BTreeMap<String, TokenTotals>; 4] = Default::default();
    let mut projects = BTreeMap::<String, TokenTotals>::new();
    let mut first_record = None;
    for row in rows {
        let Ok(day) = chrono::NaiveDate::parse_from_str(&row.date, "%Y-%m-%d") else {
            continue;
        };
        if day > local {
            continue;
        }
        first_record =
            Some(first_record.map_or(day, |earlier: chrono::NaiveDate| earlier.min(day)));
        for (index, included) in [
            day == local,
            day >= monday,
            (day.year(), day.month()) == (local.year(), local.month()),
            true,
        ]
        .into_iter()
        .enumerate()
        {
            if !included {
                continue;
            }
            periods[index] += totals(
                row.input_tokens,
                row.cached_input_tokens,
                row.output_tokens,
                row.total_tokens,
            );
            for (name, model) in &row.models {
                models[index].entry(name.clone()).or_default().add(model);
            }
        }
        if day >= monday {
            for (path, row) in &row.projects {
                *projects.entry(path.clone()).or_default() += totals(
                    row.input_tokens,
                    row.cached_input_tokens,
                    row.output_tokens,
                    row.total_tokens,
                );
            }
        }
    }
    let mut projects: Vec<_> = projects
        .into_iter()
        .map(|(path, tokens)| {
            let name = path
                .trim_end_matches(['/', '\\'])
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&path)
                .to_string();
            ProjectTokens { path, name, tokens }
        })
        .collect();
    projects.sort_by(|a, b| {
        b.tokens
            .total
            .cmp(&a.tokens.total)
            .then(a.path.cmp(&b.path))
    });
    let [model_today, model_week, model_month, model_total] = models.map(|map| {
        let mut rows: Vec<_> = map
            .into_iter()
            .map(|(name, tokens)| ModelTokens { name, tokens })
            .collect();
        rows.sort_by(|a, b| {
            b.tokens
                .total
                .cmp(&a.tokens.total)
                .then(a.name.cmp(&b.name))
        });
        rows
    });
    let [today, week, month, total] = periods;
    FloatingUsage {
        today,
        week: Some(week),
        month,
        total,
        projects,
        models: ModelPeriods {
            today: model_today,
            week: model_week,
            month: model_month,
            total: model_total,
        },
        remaining_percent: None,
        quota_updated_at: None,
        quota_warning: None,
        updated_at: now.to_rfc3339(),
        first_record_at: first_record.map(|date| date.to_string()),
    }
}

// Cache is scoped to stable account identity, never to a refreshable credential.
fn apply_saved_quota(
    usage: &mut FloatingUsage,
    saved: Option<&SavedQuota>,
    identity: Option<&str>,
    failed: bool,
    now: i64,
) {
    let Some(saved) = saved.filter(|saved| identity == Some(saved.identity.as_str())) else {
        return;
    };
    if usage.remaining_percent.is_none() {
        usage.remaining_percent = Some(saved.remaining);
        usage.quota_updated_at = Some(saved.updated_at.clone());
    }
    let expired = saved
        .resets_at
        .as_deref()
        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
        .is_some_and(|at| at.timestamp() <= now);
    if failed || expired {
        usage.quota_warning = Some(
            if expired {
                "额度周期已结束，等待联网更新；当前为上次成功数据"
            } else {
                "额度连接失败，显示上次成功数据"
            }
            .into(),
        );
    }
}

#[tauri::command]
pub(crate) async fn fetch_floating_usage(app: tauri::AppHandle) -> Result<FloatingUsage, String> {
    tauri::async_runtime::spawn_blocking(move || read_floating_usage(&app))
        .await
        .map_err(|error| error.to_string())?
}

fn read_floating_usage(app: &tauri::AppHandle) -> Result<FloatingUsage, String> {
    let state = app.state::<FloatingState>();
    let now = Utc::now();
    let snapshot = crate::codex_accounts::native::snapshot(
        &crate::codex_environment::selected_codex_environment(),
    )
    .ok();
    let identity = snapshot.as_ref().and_then(snapshot_identity);
    let context = snapshot.as_ref().map(|snapshot| snapshot.context());
    let db = crate::db::open_database(&state.database)?;
    let rows = crate::db::query_all_daily_rows(&db)?;
    let timezone = crate::date::resolve_app_timezone()
        .parse()
        .unwrap_or(chrono_tz::UTC);
    let mut usage = aggregate(&rows, now, timezone);
    if let Some(limits) = state
        .limits
        .lock()
        .unwrap()
        .as_ref()
        .filter(|limits| limits.auth_context == context)
    {
        usage.remaining_percent = limits
            .weekly
            .as_ref()
            .filter(|window| {
                window
                    .resets_at
                    .as_deref()
                    .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                    .is_some_and(|reset| reset.timestamp() > now.timestamp())
            })
            .map(|window| window.remaining_percent.clamp(0.0, 100.0));
        usage.quota_updated_at = Some(limits.updated_at.clone());
    }
    let preferences = state.preferences.lock().unwrap();
    apply_saved_quota(
        &mut usage,
        preferences.saved_quota.as_ref(),
        identity.as_deref(),
        *state.quota_failed.lock().unwrap(),
        now.timestamp(),
    );
    Ok(usage)
}

#[tauri::command]
pub(crate) fn floating_preferences(state: tauri::State<'_, FloatingState>) -> Preferences {
    state.preferences.lock().unwrap().clone()
}

fn place_window(
    window: &tauri::WebviewWindow,
    preferences: &mut Preferences,
    animate: bool,
) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = preferences
        .anchor
        .and_then(|(x, y)| {
            monitors.iter().find(|m| {
                let p = m.position();
                let s = m.size();
                x >= p.x && y >= p.y && x <= p.x + s.width as i32 && y <= p.y + s.height as i32
            })
        })
        .or_else(|| monitors.first())
        .ok_or("No display available")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let screen = geometry::Rect {
        x: monitor.position().x as f64 / scale,
        y: monitor.position().y as f64 / scale,
        w: monitor.size().width as f64 / scale,
        h: monitor.size().height as f64 / scale,
    };
    let work = geometry::Rect {
        x: area.position.x as f64 / scale,
        y: area.position.y as f64 / scale,
        w: area.size.width as f64 / scale,
        h: area.size.height as f64 / scale,
    };
    let anchor = preferences
        .anchor
        .map(|(x, y)| (x as f64 / scale, y as f64 / scale));
    let extension_length = preferences
        .extension_length
        .unwrap_or(76.0)
        .clamp(60.0, 120.0);
    preferences.dock = geometry::normalize_dock(screen, preferences.dock, extension_length);
    let rect = geometry::place(
        screen,
        work,
        anchor,
        preferences.dock,
        preferences.expanded,
        extension_length,
    );
    #[cfg(target_os = "macos")]
    native::place(
        window,
        rect,
        scale,
        preferences.dock,
        preferences.expanded,
        animate,
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = animate;
        window
            .set_size(tauri::LogicalSize::new(rect.w, rect.h))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(
                (rect.x * scale).round() as i32,
                (rect.y * scale).round() as i32,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn floating_action(
    app: tauri::AppHandle,
    action: String,
    extension_length: Option<f64>,
) -> Result<Preferences, String> {
    let window = app
        .get_webview_window("floating")
        .ok_or("Floating window unavailable")?;
    let state = app.state::<FloatingState>();
    let mut preferences = state.preferences.lock().unwrap();
    match action.as_str() {
        "show" => {
            preferences.enabled = true;
            place_window(&window, &mut preferences, false)?;
            window.show().map_err(|error| error.to_string())?;
        }
        "hide" => {
            preferences.enabled = false;
            window.hide().map_err(|error| error.to_string())?;
        }
        "expand" | "collapse" => {
            let position = window.outer_position().map_err(|error| error.to_string())?;
            let size = window.outer_size().map_err(|error| error.to_string())?;
            if preferences.dock == Dock::Free {
                preferences.anchor = Some((
                    position.x + size.width as i32,
                    position.y + size.height as i32,
                ));
            }
            preferences.expanded = action == "expand";
            app.emit("floating-preferences", preferences.clone())
                .map_err(|e| e.to_string())?;
            place_window(&window, &mut preferences, true)?;
        }
        "savePosition" | "finishDrag" => {
            let position = window.outer_position().map_err(|error| error.to_string())?;
            let size = window.outer_size().map_err(|error| error.to_string())?;
            preferences.anchor = Some((
                position.x + size.width as i32,
                position.y + size.height as i32,
            ));
            if action == "finishDrag" {
                preferences.dock = Dock::Free;
                if !preferences.expanded {
                    if let Some(m) = window.current_monitor().map_err(|e| e.to_string())? {
                        let scale = m.scale_factor();
                        let p = m.position();
                        let s = m.size();
                        preferences.dock = geometry::snap(
                            geometry::Rect {
                                x: p.x as f64 / scale,
                                y: p.y as f64 / scale,
                                w: s.width as f64 / scale,
                                h: s.height as f64 / scale,
                            },
                            geometry::Rect {
                                x: position.x as f64 / scale,
                                y: position.y as f64 / scale,
                                w: size.width as f64 / scale,
                                h: size.height as f64 / scale,
                            },
                            cfg!(target_os = "macos"),
                            preferences
                                .extension_length
                                .unwrap_or(76.0)
                                .clamp(60.0, 120.0),
                        );
                    }
                }
                app.emit("floating-preferences", preferences.clone())
                    .map_err(|e| e.to_string())?;
                place_window(&window, &mut preferences, true)?;
            }
        }
        "detach" => {
            if !preferences.expanded {
                preferences.dock = Dock::Free;
                window
                    .set_size(tauri::LogicalSize::new(COMPACT_SIZE.0, COMPACT_SIZE.1))
                    .map_err(|e| e.to_string())?;
            }
        }
        "setLength" => {
            let length = extension_length
                .filter(|value| value.is_finite())
                .ok_or("Invalid extension length")?;
            preferences.extension_length = Some(length.clamp(60.0, 120.0));
            if !preferences.expanded {
                place_window(&window, &mut preferences, true)?;
            }
        }
        "main" => {
            if let Some(main) = app.get_webview_window("main") {
                main.show()
                    .and_then(|_| main.unminimize())
                    .and_then(|_| main.set_focus())
                    .map_err(|error| error.to_string())?;
            }
        }
        _ => return Err("Unknown floating window action".into()),
    }
    state.persist(&preferences)?;
    app.emit("floating-preferences", preferences.clone())
        .map_err(|error| error.to_string())?;
    Ok(preferences.clone())
}

pub(crate) fn setup(app: &tauri::App, path: PathBuf, database: PathBuf) -> tauri::Result<()> {
    let mut preferences: Preferences = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if preferences.size_revision < 1 {
        preferences.extension_length =
            Some((preferences.extension_length.unwrap_or(128.0) / 2.0).clamp(76.0, 120.0));
        preferences.size_revision = 1;
    }
    app.manage(FloatingState {
        preferences: Mutex::new(preferences.clone()),
        limits: Mutex::new(None),
        quota_failed: Mutex::new(true),
        database,
        path,
    });
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "floating",
        tauri::WebviewUrl::App("index.html#floating".into()),
    )
    .title("Token 浮窗")
    .inner_size(COMPACT_SIZE.0, COMPACT_SIZE.1)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .accept_first_mouse(true)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .focused(false);
    #[cfg(target_os = "macos")]
    let builder = builder.visible_on_all_workspaces(true);
    let window = builder.build()?;
    // Tauri inherits the app menu even for an undecorated Windows utility window.
    // The native menu can draw outside the transparent capsule when it loses focus.
    #[cfg(target_os = "windows")]
    window.remove_menu()?;
    if let Err(error) = place_window(&window, &mut preferences, false) {
        log::warn!("Preparing floating window: {error}");
    }
    *app.state::<FloatingState>().preferences.lock().unwrap() = preferences.clone();
    if preferences.enabled {
        window.show()?;
    }
    Ok(())
}
