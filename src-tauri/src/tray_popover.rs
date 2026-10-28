use serde_json::Value;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct TrayPopoverState(pub Mutex<Option<Value>>);

pub fn update(app: &tauri::AppHandle, data: Value) -> Result<(), String> {
    *app.state::<TrayPopoverState>().0.lock().unwrap() = Some(data.clone());
    app.emit_to("tray", "tray-popover-updated", data)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_tray_popover(state: tauri::State<'_, TrayPopoverState>) -> Option<Value> {
    state.0.lock().unwrap().clone()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayPopoverAction {
    Toggle,
    ShowMain,
    Quit,
}

#[tauri::command]
pub fn tray_popover_action(app: tauri::AppHandle, action: TrayPopoverAction) -> Result<(), String> {
    match action {
        TrayPopoverAction::Toggle => {
            #[cfg(target_os = "macos")]
            toggle(&app).map_err(|error| error.to_string())?;
        }
        TrayPopoverAction::ShowMain => {
            if let Some(window) = app.get_webview_window("main") {
                window.show().map_err(|error| error.to_string())?;
                window.unminimize().map_err(|error| error.to_string())?;
                window.set_focus().map_err(|error| error.to_string())?;
            }
            if let Some(window) = app.get_webview_window("tray") {
                window.hide().map_err(|error| error.to_string())?;
            }
        }
        TrayPopoverAction::Quit => app.exit(0),
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    tauri::WebviewWindowBuilder::new(
        app,
        "tray",
        tauri::WebviewUrl::App("index.html#tray".into()),
    )
    .title("Codex Usage")
    .inner_size(390.0, 490.0)
    .visible(false)
    .focused(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .effects(
        EffectsBuilder::new()
            .effect(Effect::Popover)
            .state(EffectState::Active)
            .radius(18.0)
            .build(),
    )
    .build()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn toggle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray") else {
        return Ok(());
    };
    if window.is_visible()? {
        return window.hide();
    }
    if let Some(rect) = app
        .tray_by_id("main")
        .and_then(|tray| tray.rect().ok().flatten())
    {
        // Tray rectangles can be logical or physical; use the target monitor's scale.
        let scale = window.scale_factor()?;
        let position = rect.position.to_physical::<f64>(scale);
        if let Some(monitor) = app.monitor_from_point(position.x, position.y)? {
            let scale = monitor.scale_factor();
            let position = rect.position.to_physical::<f64>(scale);
            let size = rect.size.to_physical::<f64>(scale);
            let window_size = window.outer_size()?;
            let area = monitor.work_area();
            let (x, y) = popover_position(
                (position.x + size.width / 2.0, position.y + size.height),
                (f64::from(window_size.width), f64::from(window_size.height)),
                (
                    f64::from(area.position.x),
                    f64::from(area.position.y),
                    f64::from(area.size.width),
                    f64::from(area.size.height),
                ),
                6.0 * scale,
            );
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
    }
    window.show()?;
    window.set_focus()
}

#[cfg(any(target_os = "macos", test))]
fn popover_position(
    anchor: (f64, f64),
    size: (f64, f64),
    area: (f64, f64, f64, f64),
    gap: f64,
) -> (f64, f64) {
    let left = area.0 + gap;
    let top = area.1 + gap;
    let right = (area.0 + area.2 - size.0 - gap).max(left);
    let bottom = (area.1 + area.3 - size.1 - gap).max(top);
    (
        (anchor.0 - size.0 / 2.0).clamp(left, right),
        (anchor.1 + gap).clamp(top, bottom),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_below_the_tray_and_keeps_the_panel_on_screen() {
        assert_eq!(
            popover_position(
                (700.0, 25.0),
                (390.0, 490.0),
                (0.0, 25.0, 1440.0, 875.0),
                6.0
            ),
            (505.0, 31.0)
        );
        assert_eq!(
            popover_position(
                (1430.0, 25.0),
                (390.0, 490.0),
                (0.0, 25.0, 1440.0, 875.0),
                6.0
            ),
            (1044.0, 31.0)
        );
        assert_eq!(
            popover_position(
                (-1430.0, 25.0),
                (390.0, 490.0),
                (-1440.0, 25.0, 1440.0, 875.0),
                6.0
            ),
            (-1434.0, 31.0)
        );
        assert_eq!(
            popover_position(
                (700.0, 25.0),
                (390.0, 490.0),
                (0.0, 25.0, 1440.0, 400.0),
                6.0
            ),
            (505.0, 31.0)
        );
    }
}
