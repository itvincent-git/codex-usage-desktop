use crate::types::{CodexLimitWindow, CodexLimitsResponse};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const SESSION_WINDOW_MINUTES: i64 = 300;
const WEEKLY_WINDOW_MINUTES: i64 = 10_080;

#[derive(Debug, Clone, PartialEq)]
enum WindowRole {
    Session,
    Weekly,
    Unknown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRateLimitsResponse {
    rate_limits: RpcRateLimitSnapshot,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRateLimitSnapshot {
    primary: Option<RpcRateLimitWindow>,
    secondary: Option<RpcRateLimitWindow>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RpcRateLimitWindow {
    used_percent: f64,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}

pub fn fetch_codex_limits() -> Result<CodexLimitsResponse, String> {
    let codex = resolve_codex_binary().ok_or_else(|| {
        "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.".to_string()
    })?;
    let mut rpc = CodexRpcProcess::start(codex)?;
    rpc.initialize()?;
    let limits = rpc.fetch_rate_limits()?;
    rpc.shutdown();

    let (session, weekly) = normalize_windows(limits.primary, limits.secondary);

    Ok(CodexLimitsResponse {
        session: session.map(make_window),
        weekly: weekly.map(make_window),
        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        source: "cli-rpc".to_string(),
    })
}

fn make_window(window: RpcRateLimitWindow) -> CodexLimitWindow {
    let used_percent = clamp_percent(window.used_percent);
    let remaining_percent = clamp_percent(100.0 - used_percent);
    let resets_at = window
        .resets_at
        .and_then(|timestamp| Utc.timestamp_opt(timestamp, 0).single())
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true));

    CodexLimitWindow {
        used_percent,
        remaining_percent,
        window_minutes: window.window_duration_mins,
        resets_at,
    }
}

fn clamp_percent(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }

    value.clamp(0.0, 100.0)
}

fn normalize_windows(
    primary: Option<RpcRateLimitWindow>,
    secondary: Option<RpcRateLimitWindow>,
) -> (Option<RpcRateLimitWindow>, Option<RpcRateLimitWindow>) {
    match (primary, secondary) {
        (Some(primary), Some(secondary)) => {
            match (window_role(&primary), window_role(&secondary)) {
                (WindowRole::Session, WindowRole::Weekly)
                | (WindowRole::Session, WindowRole::Unknown)
                | (WindowRole::Unknown, WindowRole::Weekly) => (Some(primary), Some(secondary)),
                (WindowRole::Weekly, WindowRole::Session)
                | (WindowRole::Weekly, WindowRole::Unknown) => (Some(secondary), Some(primary)),
                _ => (Some(primary), Some(secondary)),
            }
        }
        (Some(primary), None) => match window_role(&primary) {
            WindowRole::Weekly => (None, Some(primary)),
            WindowRole::Session | WindowRole::Unknown => (Some(primary), None),
        },
        (None, Some(secondary)) => match window_role(&secondary) {
            WindowRole::Session | WindowRole::Unknown => (Some(secondary), None),
            WindowRole::Weekly => (None, Some(secondary)),
        },
        (None, None) => (None, None),
    }
}

fn window_role(window: &RpcRateLimitWindow) -> WindowRole {
    match window.window_duration_mins {
        Some(SESSION_WINDOW_MINUTES) => WindowRole::Session,
        Some(WEEKLY_WINDOW_MINUTES) => WindowRole::Weekly,
        _ => WindowRole::Unknown,
    }
}

struct CodexRpcProcess {
    child: Child,
    stdin: std::process::ChildStdin,
    rx: mpsc::Receiver<String>,
    next_id: i64,
}

impl CodexRpcProcess {
    fn start(codex: PathBuf) -> Result<Self, String> {
        let mut child = Command::new("/usr/bin/env")
            .arg(codex)
            .args(["-s", "read-only", "-a", "untrusted", "app-server"])
            .env("PATH", effective_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to start Codex CLI app-server: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open Codex RPC stdin.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open Codex RPC stdout.".to_string())?;
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            rx,
            next_id: 1,
        })
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.request(
            "initialize",
            Some(json!({
                "clientInfo": {
                    "name": "codex-usage-desktop",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
            Duration::from_secs(8),
        )?;
        self.send_notification("initialized", json!({}))?;
        Ok(())
    }

    fn fetch_rate_limits(&mut self) -> Result<RpcRateLimitSnapshot, String> {
        let value = self.request("account/rateLimits/read", None, Duration::from_secs(3))?;
        let response = serde_json::from_value::<RpcRateLimitsResponse>(value)
            .map_err(|error| format!("Failed to parse Codex rate limits: {error}"))?;
        Ok(response.rate_limits)
    }

    fn request(
        &mut self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = json!({
            "id": id,
            "method": method,
            "params": params.unwrap_or_else(|| json!({})),
        });
        self.write_payload(&payload)?;

        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let _ = self.child.kill();
                return Err(format!("Codex RPC `{method}` timed out."));
            }

            let line = self
                .rx
                .recv_timeout(remaining)
                .map_err(|_| format!("Codex RPC `{method}` timed out."))?;
            let message = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if message.get("id").and_then(Value::as_i64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex RPC request failed.");
                return Err(message.to_string());
            }
            return message
                .get("result")
                .cloned()
                .ok_or_else(|| "Codex RPC response was missing result.".to_string());
        }
    }

    fn send_notification(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write_payload(&json!({
            "method": method,
            "params": params,
        }))
    }

    fn write_payload(&mut self, payload: &Value) -> Result<(), String> {
        let data = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
        self.stdin
            .write_all(&data)
            .and_then(|_| self.stdin.write_all(b"\n"))
            .map_err(|error| format!("Failed to write Codex RPC request: {error}"))
    }

    fn shutdown(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
    }
}

impl Drop for CodexRpcProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn resolve_codex_binary() -> Option<PathBuf> {
    if let Ok(path) = env::var("CODEX_CLI_PATH") {
        let path = PathBuf::from(path);
        if is_executable(&path) {
            return Some(path);
        }
    }

    if let Some(path) = find_in_path("codex", &effective_path()) {
        return Some(path);
    }

    if let Some(path) = command_v_codex() {
        return Some(path);
    }

    let home = dirs::home_dir();
    let mut candidates = Vec::new();
    if let Some(home) = home {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".bun/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));

    candidates.into_iter().find(|path| is_executable(path))
}

fn command_v_codex() -> Option<PathBuf> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = Command::new(shell)
        .args(["-lc", "command -v codex"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if child.try_wait().ok().flatten().is_some() {
            let output = child.wait_with_output().ok()?;
            let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
            let path = PathBuf::from(path);
            return is_executable(&path).then_some(path);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn effective_path() -> String {
    let mut parts = env::var("PATH")
        .ok()
        .map(|path| path.split(':').map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default();
    parts.extend([
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ]);

    let mut seen = Vec::<String>::new();
    for part in parts {
        if !part.is_empty() && !seen.contains(&part) {
            seen.push(part);
        }
    }
    seen.join(":")
}

fn find_in_path(binary: &str, path: &str) -> Option<PathBuf> {
    path.split(':')
        .filter(|part| !part.is_empty())
        .map(|part| PathBuf::from(part).join(binary))
        .find(|path| is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &PathBuf) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &PathBuf) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(used_percent: f64, window_minutes: Option<i64>) -> RpcRateLimitWindow {
        RpcRateLimitWindow {
            used_percent,
            window_duration_mins: window_minutes,
            resets_at: Some(1_800_000_000),
        }
    }

    #[test]
    fn normalize_keeps_session_then_weekly() {
        let (session, weekly) = normalize_windows(
            Some(window(20.0, Some(SESSION_WINDOW_MINUTES))),
            Some(window(40.0, Some(WEEKLY_WINDOW_MINUTES))),
        );

        assert_eq!(session.unwrap().used_percent, 20.0);
        assert_eq!(weekly.unwrap().used_percent, 40.0);
    }

    #[test]
    fn normalize_swaps_weekly_then_session() {
        let (session, weekly) = normalize_windows(
            Some(window(40.0, Some(WEEKLY_WINDOW_MINUTES))),
            Some(window(20.0, Some(SESSION_WINDOW_MINUTES))),
        );

        assert_eq!(session.unwrap().used_percent, 20.0);
        assert_eq!(weekly.unwrap().used_percent, 40.0);
    }

    #[test]
    fn normalize_places_single_weekly_in_weekly_slot() {
        let (session, weekly) =
            normalize_windows(Some(window(40.0, Some(WEEKLY_WINDOW_MINUTES))), None);

        assert!(session.is_none());
        assert_eq!(weekly.unwrap().used_percent, 40.0);
    }

    #[test]
    fn normalize_keeps_unknown_in_primary_slot() {
        let (session, weekly) = normalize_windows(Some(window(15.0, Some(60))), None);

        assert_eq!(session.unwrap().used_percent, 15.0);
        assert!(weekly.is_none());
    }

    #[test]
    fn make_window_clamps_used_and_remaining_percent() {
        let low = make_window(window(-10.0, Some(SESSION_WINDOW_MINUTES)));
        let high = make_window(window(140.0, Some(WEEKLY_WINDOW_MINUTES)));

        assert_eq!(low.used_percent, 0.0);
        assert_eq!(low.remaining_percent, 100.0);
        assert_eq!(high.used_percent, 100.0);
        assert_eq!(high.remaining_percent, 0.0);
        assert_eq!(high.resets_at, Some("2027-01-15T08:00:00.000Z".to_string()));
    }
}
