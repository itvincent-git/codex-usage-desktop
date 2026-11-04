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
    #[cfg(all(any(target_os = "macos", target_os = "windows"), feature = "e2e"))]
    LeftClick,
    #[cfg(all(any(target_os = "macos", target_os = "windows"), feature = "e2e"))]
    RightClick,
    #[cfg(all(target_os = "macos", feature = "e2e"))]
    AssertHighlighted {
        expected: bool,
    },
    #[cfg(all(target_os = "macos", feature = "e2e"))]
    AssertTemplate,
    #[cfg(all(target_os = "macos", feature = "e2e"))]
    ToggleAt {
        position: tauri::PhysicalPosition<i32>,
        size: tauri::PhysicalSize<u32>,
        cursor: tauri::LogicalPosition<f64>,
    },
    #[cfg(all(target_os = "macos", feature = "e2e"))]
    FocusLostAt {
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
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            toggle(&app, None).map_err(|error| error.to_string())?;
        }
        #[cfg(all(any(target_os = "macos", target_os = "windows"), feature = "e2e"))]
        TrayPopoverAction::LeftClick => {
            crate::handle_tray_click(&app, tauri::tray::MouseButton::Left, None);
        }
        #[cfg(all(any(target_os = "macos", target_os = "windows"), feature = "e2e"))]
        TrayPopoverAction::RightClick => {
            crate::handle_tray_click(&app, tauri::tray::MouseButton::Right, None);
        }
        #[cfg(all(target_os = "macos", feature = "e2e"))]
        TrayPopoverAction::AssertHighlighted { expected } => {
            let tray = app.tray_by_id("main").ok_or("Tray icon is missing")?;
            let highlighted = tray
                .with_inner_tray_icon(|tray| {
                    let status_item = tray.ns_status_item().expect("Tray status item is missing");
                    let mtm =
                        objc2::MainThreadMarker::new().expect("Tauri runs this on main thread");
                    status_item.button(mtm).unwrap().isHighlighted()
                })
                .map_err(|error| error.to_string())?;
            if highlighted != expected {
                return Err(format!(
                    "Expected tray highlight {expected}, received {highlighted}"
                ));
            }
        }
        #[cfg(all(target_os = "macos", feature = "e2e"))]
        TrayPopoverAction::AssertTemplate => {
            let tray = app.tray_by_id("main").ok_or("Tray icon is missing")?;
            let is_template = tray
                .with_inner_tray_icon(|tray| {
                    let mtm =
                        objc2::MainThreadMarker::new().expect("Tauri runs this on main thread");
                    tray.ns_status_item()
                        .and_then(|item| item.button(mtm))
                        .and_then(|button| button.image())
                        .is_some_and(|image| image.isTemplate())
                })
                .map_err(|error| error.to_string())?;
            if !is_template {
                return Err("Expected a native template tray image".to_string());
            }
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
        #[cfg(all(target_os = "macos", feature = "e2e"))]
        TrayPopoverAction::FocusLostAt {
            position,
            size,
            cursor,
        } => {
            let rect = tauri::Rect {
                position: position.into(),
                size: size.into(),
            };
            dismiss_on_focus_loss_at(&app, Some(rect), cursor)
                .map_err(|error| error.to_string())?;
        }
        TrayPopoverAction::ShowMain => {
            if let Some(window) = app.get_webview_window("main") {
                window.show().map_err(|error| error.to_string())?;
                window.unminimize().map_err(|error| error.to_string())?;
                window.set_focus().map_err(|error| error.to_string())?;
            }
            dismiss(&app).map_err(|error| error.to_string())?;
        }
        TrayPopoverAction::Quit => app.exit(0),
    }
    Ok(())
}

pub fn dismiss(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("tray") {
        window.hide()?;
    }
    #[cfg(target_os = "macos")]
    set_highlighted(app, false)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_highlighted(app: &tauri::AppHandle, highlighted: bool) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.with_inner_tray_icon(move |tray| {
            let mtm = objc2::MainThreadMarker::new().expect("Tauri runs this on main thread");
            if let Some(button) = tray.ns_status_item().and_then(|item| item.button(mtm)) {
                button.highlight(highlighted);
            }
        })?;
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let builder = tauri::WebviewWindowBuilder::new(
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
    .always_on_top(true);
    #[cfg(target_os = "macos")]
    let builder = builder.visible_on_all_workspaces(true).effects(
        EffectsBuilder::new()
            .effect(Effect::Popover)
            .state(EffectState::Active)
            .radius(18.0)
            .build(),
    );
    builder.build()?;
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
pub fn dismiss_on_focus_loss(app: &tauri::AppHandle) -> tauri::Result<()> {
    let scale = app
        .primary_monitor()?
        .map_or(1.0, |monitor| monitor.scale_factor());
    let cursor = app.cursor_position()?.to_logical::<f64>(scale);
    let rect = app
        .tray_by_id("main")
        .and_then(|tray| tray.rect().ok().flatten());
    dismiss_on_focus_loss_at(app, rect, cursor)
}

#[cfg(target_os = "macos")]
fn dismiss_on_focus_loss_at(
    app: &tauri::AppHandle,
    rect: Option<tauri::Rect>,
    cursor: tauri::LogicalPosition<f64>,
) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("tray") {
        if !window.is_visible()? {
            return set_highlighted(app, false);
        }
    }
    if let (Some(rect), Some(monitor)) = (rect, app.monitor_from_point(cursor.x, cursor.y)?) {
        let scale = monitor.scale_factor();
        let position = rect.position.to_logical::<f64>(scale);
        let size = rect.size.to_logical::<f64>(scale);
        if cursor.x >= position.x
            && cursor.x < position.x + size.width
            && cursor.y >= position.y
            && cursor.y < position.y + size.height
        {
            // Clicking the status item blurs the panel before mouse-up.
            // Leave it visible so that the click toggles it closed.
            return Ok(());
        }
    }
    dismiss(app)
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
        return dismiss(app);
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
    set_highlighted(app, true)?;
    window.set_focus()
}

#[cfg(target_os = "windows")]
pub fn toggle(app: &tauri::AppHandle, rect: Option<tauri::Rect>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray") else {
        return Ok(());
    };
    if window.is_visible()? {
        return dismiss(app);
    }
    position_windows(app, rect)?;
    window.show()?;
    window.set_focus()
}

#[cfg(target_os = "windows")]
pub fn dismiss_on_focus_loss(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(rect) = app
        .tray_by_id("main")
        .and_then(|tray| tray.rect().ok().flatten())
    {
        let cursor = app.cursor_position()?;
        // Windows reports tray bounds in physical screen coordinates.
        let position = rect.position.to_physical::<f64>(1.0);
        let size = rect.size.to_physical::<f64>(1.0);
        if cursor.x >= position.x
            && cursor.x < position.x + size.width
            && cursor.y >= position.y
            && cursor.y < position.y + size.height
        {
            // Preserve the open state until the tray mouse-up toggles it closed.
            return Ok(());
        }
    }
    dismiss(app)
}

#[cfg(target_os = "windows")]
pub fn position_windows(app: &tauri::AppHandle, rect: Option<tauri::Rect>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray") else {
        return Ok(());
    };
    let cursor = app.cursor_position()?;
    let rect = rect.or_else(|| {
        app.tray_by_id("main")
            .and_then(|tray| tray.rect().ok().flatten())
    });
    let (position, size) = rect.map_or((cursor, tauri::PhysicalSize::new(0.0, 0.0)), |rect| {
        (
            rect.position.to_physical::<f64>(1.0),
            rect.size.to_physical::<f64>(1.0),
        )
    });
    let Some(monitor) = app.monitor_from_point(
        position.x + size.width / 2.0,
        position.y + size.height / 2.0,
    )?
    else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let window_size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    // Keep all global coordinates physical; only scale the panel size and gap.
    // Dividing global origins by each monitor's DPI breaks mixed-DPI layouts.
    let (x, y) = windows_popover_position(
        (position.x, position.y, size.width, size.height),
        (window_size.width * scale, window_size.height * scale),
        (
            area.position.x as f64,
            area.position.y as f64,
            area.size.width as f64,
            area.size.height as f64,
        ),
        6.0 * scale,
    );
    window.set_position(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ))
}

#[cfg(any(target_os = "windows", test))]
fn windows_popover_position(
    tray: (f64, f64, f64, f64),
    size: (f64, f64),
    area: (f64, f64, f64, f64),
    gap: f64,
) -> (f64, f64) {
    let left = area.0 + gap;
    let top = area.1 + gap;
    let right = (area.0 + area.2 - size.0 - gap).max(left);
    let bottom = (area.1 + area.3 - size.1 - gap).max(top);
    let below = tray.1 + tray.3 + gap;
    let y = if below + size.1 <= area.1 + area.3 - gap {
        below
    } else {
        tray.1 - size.1 - gap
    };
    (
        (tray.0 + tray.2 / 2.0 - size.0 / 2.0).clamp(left, right),
        y.clamp(top, bottom),
    )
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
    fn windows_panel_follows_taskbar_edges_and_content_height() {
        let area = (0.0, 0.0, 1920.0, 1032.0);
        let tray = (1800.0, 1040.0, 24.0, 24.0);
        assert_eq!(
            windows_popover_position(tray, (390.0, 490.0), area, 6.0),
            (1524.0, 536.0)
        );
        assert_eq!(
            windows_popover_position(tray, (390.0, 600.0), area, 6.0),
            (1524.0, 426.0)
        );
        // Top, left and right taskbars use the available work area.
        assert_eq!(
            windows_popover_position(
                (1800.0, 0.0, 24.0, 24.0),
                (390.0, 490.0),
                (0.0, 48.0, 1920.0, 1032.0),
                6.0
            ),
            (1524.0, 54.0)
        );
        assert_eq!(
            windows_popover_position(
                (8.0, 900.0, 24.0, 24.0),
                (390.0, 490.0),
                (48.0, 0.0, 1872.0, 1080.0),
                6.0
            ),
            (54.0, 404.0)
        );
        assert_eq!(
            windows_popover_position(
                (1880.0, 900.0, 24.0, 24.0),
                (390.0, 490.0),
                (0.0, 0.0, 1872.0, 1080.0),
                6.0
            ),
            (1476.0, 404.0)
        );
    }

    #[test]
    fn windows_panel_stays_on_a_negative_origin_high_dpi_monitor() {
        // 150% monitor to the left of the primary screen, with a bottom taskbar.
        assert_eq!(
            windows_popover_position(
                (-180.0, 1460.0, 36.0, 36.0),
                (585.0, 735.0),
                (-2560.0, 0.0, 2560.0, 1440.0),
                9.0
            ),
            (-594.0, 696.0)
        );
    }

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
