#[cfg(not(debug_assertions))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            start_sidecar(_app.handle())?;

            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(not(debug_assertions))]
            if matches!(_event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(sidecar) = _window.try_state::<SidecarProcess>() {
                    if let Ok(mut child) = sidecar.0.lock() {
                        if let Some(mut child) = child.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(debug_assertions))]
struct SidecarProcess(std::sync::Mutex<Option<std::process::Child>>);

#[cfg(not(debug_assertions))]
fn start_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use std::{
        fs,
        net::{SocketAddr, TcpStream},
        process::Command,
        time::Duration,
    };

    let addr: SocketAddr = "127.0.0.1:43110".parse()?;
    if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
        return Ok(());
    }

    let resource_dir = app.path().resource_dir()?;
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;

    let sidecar_script = resource_dir.join("sidecar").join("index.js");
    let codex_binary = resource_dir
        .join("sidecar")
        .join("ccusage-codex")
        .join("dist")
        .join("index.js");

    let mut command = Command::new(resolve_node_binary());
    command
        .arg(sidecar_script)
        .env(
            "CODEX_USAGE_DESKTOP_DB_PATH",
            app_data_dir.join("codex-usage-desktop.db"),
        )
        .env("CODEX_USAGE_CODEX_BINARY", codex_binary)
        .current_dir(&resource_dir);

    let child = command.spawn()?;
    app.manage(SidecarProcess(std::sync::Mutex::new(Some(child))));

    Ok(())
}

#[cfg(not(debug_assertions))]
fn resolve_node_binary() -> std::path::PathBuf {
    use std::{
        env,
        path::{Path, PathBuf},
    };

    if let Ok(node_path) = env::var("CODEX_USAGE_NODE_PATH") {
        return PathBuf::from(node_path);
    }

    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if Path::new(candidate).exists() {
            return PathBuf::from(candidate);
        }
    }

    PathBuf::from("node")
}
