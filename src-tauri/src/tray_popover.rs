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
    #[cfg(all(target_os = "macos", feature = "e2e"))]
    ToggleAt {
        position: tauri::PhysicalPosition<i32>,
        size: tauri::PhysicalSize<u32>,
        cursor: tauri::LogicalPosition<f64>,
    },
    ShowMain,
    Quit,
}

#[tauri::command]
pub fn tray_popover_action(app: tauri::AppHandle, action: TrayPopoverAction) -> Result<(), String> {
    match action {
        TrayPopoverAction::Toggle => {
            #[cfg(target_os = "macos")]
            toggle(&app, None).map_err(|error| error.to_string())?;
        }
        #[cfg(all(target_os = "macos", feature = "e2e"))]
        TrayPopoverAction::ToggleAt {
            position,
            size,
            cursor,
        } => {
            let rect = tauri::Rect {
                position: position.into(),
                size: size.into(),
            };
            toggle_at(&app, Some(rect), cursor).map_err(|error| error.to_string())?;
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
pub fn toggle(app: &tauri::AppHandle, rect: Option<tauri::Rect>) -> tauri::Result<()> {
    // Tao reports the global cursor using the primary screen's scale on macOS.
    let scale = app
        .primary_monitor()?
        .map_or(1.0, |monitor| monitor.scale_factor());
    let cursor = app.cursor_position()?.to_logical::<f64>(scale);
    toggle_at(app, rect, cursor)
}

#[cfg(target_os = "macos")]
fn toggle_at(
    app: &tauri::AppHandle,
    rect: Option<tauri::Rect>,
    cursor: tauri::LogicalPosition<f64>,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray") else {
        return Ok(());
    };
    if window.is_visible()? {
        return window.hide();
    }
    let rect = rect.or_else(|| {
        app.tray_by_id("main")
            .and_then(|tray| tray.rect().ok().flatten())
    });
    if let Some(rect) = rect {
        // Mixed-DPI screens have different physical coordinate spaces. Select the
        // clicked screen in global logical coordinates, independent of the old window.
        let monitor = app.available_monitors()?.into_iter().find(|monitor| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            cursor.x >= position.x
                && cursor.x < position.x + size.width
                && cursor.y >= position.y
                && cursor.y < position.y + size.height
        });
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let position = rect.position.to_logical::<f64>(scale);
            let size = rect.size.to_logical::<f64>(scale);
            let window_size = window
                .outer_size()?
                .to_logical::<f64>(window.scale_factor()?);
            let area = monitor.work_area();
            let area_position = area.position.to_logical::<f64>(scale);
            let area_size = area.size.to_logical::<f64>(scale);
            let (x, y) = popover_position(
                (position.x + size.width / 2.0, position.y + size.height),
                (window_size.width, window_size.height),
                (
                    area_position.x,
                    area_position.y,
                    area_size.width,
                    area_size.height,
                ),
                6.0,
            );
            window.set_position(tauri::LogicalPosition::new(x, y))?;
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
