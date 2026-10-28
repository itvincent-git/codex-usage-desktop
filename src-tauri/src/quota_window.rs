use tauri::{LogicalSize, Manager, PhysicalPosition, WebviewWindow};

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(QuotaPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

pub fn configure(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                use objc2_app_kit::NSWindowCollectionBehavior as Behavior;
                use tauri_nspanel::{ManagerExt, StyleMask, WebviewWindowExt};
                let result = (|| -> Result<(), String> {
                    let panel = match target.app_handle().get_webview_panel(target.label()) {
                        Ok(panel) => panel,
                        Err(_) => target.to_panel::<QuotaPanel>().map_err(|e| e.to_string())?,
                    };
                    // Keep Tao's structural styles. Non-activating panels follow other
                    // applications' fullscreen Spaces without bringing our dashboard forward.
                    panel
                        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
                        .map_err(|e| e.to_string())?;
                    let mut behavior = Behavior::CanJoinAllSpaces
                        | Behavior::FullScreenAuxiliary
                        | Behavior::IgnoresCycle;
                    if objc2::available!(macos = 13.0) {
                        behavior.insert(Behavior::CanJoinAllApplications);
                    }
                    panel.set_collection_behavior(behavior);
                    panel.set_hides_on_deactivate(false);
                    Ok(())
                })();
                if let Err(error) = result {
                    log::error!("Failed to configure quota panel: {error}");
                }
            })
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

pub fn show(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                use tauri_nspanel::ManagerExt;
                match target.app_handle().get_webview_panel(target.label()) {
                    Ok(panel) => panel.show(),
                    Err(error) => log::error!("Failed to show quota panel: {error:?}"),
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_quota_collapsed(app: tauri::AppHandle, collapsed: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("quota")
        .ok_or("Quota window is unavailable")?;
    let (width, height) = if collapsed {
        (88.0, 88.0)
    } else {
        (352.0, 178.0)
    };
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    // Expanding a ball parked at the screen edge must keep the controls reachable.
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let max_x = area.position.x + (area.size.width as f64 - width * scale).max(0.0) as i32;
        let max_y = area.position.y + (area.size.height as f64 - height * scale).max(0.0) as i32;
        window
            .set_position(PhysicalPosition::new(
                position.x.clamp(area.position.x, max_x),
                position.y.clamp(area.position.y, max_y),
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn quota_native_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let window = app
        .get_webview_window("quota")
        .ok_or("Quota window is unavailable")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let value = {
                use objc2_app_kit::{
                    NSPanel, NSWindow, NSWindowCollectionBehavior as Behavior, NSWindowOcclusionState,
                    NSWindowStyleMask, NSWorkspace,
                };
                use objc2::ClassType;
                use tauri_nspanel::objc2_foundation::NSObjectProtocol;
                let pointer = target.ns_window().unwrap();
                let native = unsafe { &*pointer.cast::<NSWindow>() };
                let behavior = native.collectionBehavior();
                let frame = native.frame();
                let screen = native.screen().map(|screen| {
                    let frame = screen.frame();
                    serde_json::json!({ "x": frame.origin.x, "y": frame.origin.y, "width": frame.size.width, "height": frame.size.height })
                });
                serde_json::json!({
                    "frontmostPid": NSWorkspace::sharedWorkspace().frontmostApplication().map(|app| app.processIdentifier()),
                    "appPid": std::process::id(),
                    "isPanel": native.isKindOfClass(NSPanel::class()),
                    "nonActivating": native.styleMask().contains(NSWindowStyleMask::NonactivatingPanel),
                    "canJoinAllSpaces": behavior.contains(Behavior::CanJoinAllSpaces),
                    "level": native.level(),
                    "visible": native.isVisible(),
                    "frame": { "x": frame.origin.x, "y": frame.origin.y, "width": frame.size.width, "height": frame.size.height },
                    "screen": screen,
                    "fullScreenAuxiliary": behavior.contains(Behavior::FullScreenAuxiliary),
                    "canJoinAllApplications": behavior.contains(Behavior::CanJoinAllApplications),
                    "onActiveSpace": native.isOnActiveSpace(),
                    "visibleOnScreen": native.occlusionState().contains(NSWindowOcclusionState::Visible),
                })
            };
            #[cfg(not(target_os = "macos"))]
            let value = {
                let _ = target;
                serde_json::json!({})
            };
            let _ = sender.send(value);
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
