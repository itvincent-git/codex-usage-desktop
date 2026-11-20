//! Public AppKit window behavior and frame animation. The white surface is drawn by WKWebView.
use super::geometry::{Dock, Rect};
use objc2::{class, msg_send, runtime::AnyObject};
use objc2_app_kit::NSWindow;

pub(super) fn place(
    window: &tauri::WebviewWindow,
    rect: Rect,
    scale: f64,
    _dock: Dock,
    _expanded: bool,
    animate: bool,
) -> Result<(), String> {
    let old_position = window.outer_position().map_err(|e| e.to_string())?;
    let old_scale = window.scale_factor().map_err(|e| e.to_string())?;
    window
        .with_webview(move |webview| unsafe {
            let ns: &NSWindow = &*webview.ns_window().cast();
            // Stationary keeps this utility visible during Show Desktop / Mission Control.
            // Managed, Transient and Stationary are mutually exclusive. Preserve AllSpaces.
            #[cfg(feature = "e2e")]
            let original_level: isize = msg_send![ns, level];
            let behavior: usize = msg_send![ns, collectionBehavior];
            let behavior = (behavior & !((1usize << 2) | (1usize << 3))) | (1usize << 4);
            let _: () = msg_send![ns, setCollectionBehavior: behavior];
            #[cfg(feature = "e2e")]
            {
                let actual: usize = msg_send![ns, collectionBehavior];
                let level: isize = msg_send![ns, level];
                assert_eq!(actual & (1 | 4 | 8 | 16), 1 | 16);
                assert_eq!(level, original_level); // Preserve Tauri's configured level.
            }
            let mut target = ns.frame();
            target.origin.x += (rect.x * scale - old_position.x as f64) / old_scale;
            target.origin.y +=
                target.size.height - rect.h - (rect.y * scale - old_position.y as f64) / old_scale;
            target.size.width = rect.w;
            target.size.height = rect.h;
            let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
            let reduce_motion: bool = msg_send![workspace, accessibilityDisplayShouldReduceMotion];
            if animate && !reduce_motion {
                let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
                let context: *mut AnyObject = msg_send![class!(NSAnimationContext), currentContext];
                let _: () = msg_send![context, setDuration: 0.18f64];
                let animator: *mut AnyObject = msg_send![ns, animator];
                let _: () = msg_send![animator, setFrame: target, display: true];
                let _: () = msg_send![class!(NSAnimationContext), endGrouping];
            } else {
                let _: () = msg_send![ns, setFrame: target, display: true];
            }
        })
        .map_err(|e| e.to_string())
}
