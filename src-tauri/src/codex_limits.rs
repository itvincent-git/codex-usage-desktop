use crate::types::{CodexLimitWindow, CodexLimitsResponse};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const SESSION_WINDOW_MINUTES: i64 = 300;
const WEEKLY_WINDOW_MINUTES: i64 = 10_080;
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

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

#[derive(Debug, Deserialize)]
struct OAuthUsageResponse {
    rate_limit: Option<OAuthRateLimitSnapshot>,
}

#[derive(Debug, Deserialize)]
struct OAuthRateLimitSnapshot {
    primary_window: Option<OAuthRateLimitWindow>,
    secondary_window: Option<OAuthRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
struct OAuthRateLimitWindow {
    used_percent: f64,
    reset_at: Option<i64>,
    limit_window_seconds: Option<i64>,
}

#[derive(Debug, Clone)]
struct CodexAuth {
    access_token: String,
    account_id: Option<String>,
}

#[derive(Debug)]
struct LimitsSnapshot {
    primary: Option<RpcRateLimitWindow>,
    secondary: Option<RpcRateLimitWindow>,
    source: &'static str,
}

pub fn fetch_codex_limits() -> Result<CodexLimitsResponse, String> {
    log::info!("Starting fetch_codex_limits...");
    fetch_codex_limits_with(fetch_oauth_limits, fetch_cli_limits)
}

fn fetch_codex_limits_with(
    fetch_oauth: impl FnOnce() -> Result<LimitsSnapshot, String>,
    fetch_cli: impl FnOnce() -> Result<LimitsSnapshot, String>,
) -> Result<CodexLimitsResponse, String> {
    match fetch_oauth() {
        Ok(limits) => {
            log::info!("Successfully fetched limits via OAuth.");
            Ok(make_response(limits))
        }
        Err(oauth_error) => {
            log::warn!("OAuth limits fetch failed: {oauth_error}. Falling back to CLI...");
            match fetch_cli() {
                Ok(limits) => {
                    log::info!("Successfully fetched limits via CLI fallback.");
                    Ok(make_response(limits))
                }
                Err(cli_error) => {
                    log::error!("Both OAuth and CLI failed. CLI error: {cli_error}");
                    Err(format!(
                        "OAuth unavailable: {oauth_error}; CLI RPC unavailable: {cli_error}"
                    ))
                }
            }
        }
    }
}

fn fetch_oauth_limits() -> Result<LimitsSnapshot, String> {
    log::info!("Attempting to load codex auth...");
    let auth = load_codex_auth()?;
    log::info!("Building reqwest client for OAuth...");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to create Codex usage client: {error}"))?;

    let mut request = client
        .get(CODEX_USAGE_URL)
        .bearer_auth(auth.access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "codex-usage-desktop");

    if let Some(account_id) = auth.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request
        .send()
        .map_err(|error| format!("Failed to fetch Codex usage API: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read Codex usage API response: {error}"))?;

    if !status.is_success() {
        return Err(format!("Codex usage API returned {status}: {body}"));
    }

    let usage = serde_json::from_str::<OAuthUsageResponse>(&body)
        .map_err(|error| format!("Failed to parse Codex usage API response: {error}"))?;
    let rate_limit = usage
        .rate_limit
        .ok_or_else(|| "Codex usage API response was missing rate_limit.".to_string())?;

    Ok(LimitsSnapshot {
        primary: rate_limit.primary_window.map(RpcRateLimitWindow::from),
        secondary: rate_limit.secondary_window.map(RpcRateLimitWindow::from),
        source: "oauth",
    })
}

fn fetch_cli_limits() -> Result<LimitsSnapshot, String> {
    let codex = resolve_codex_binary().ok_or_else(|| {
        "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.".to_string()
    })?;
    let mut rpc = CodexRpcProcess::start(codex)?;
    rpc.initialize()?;
    let limits = rpc.fetch_rate_limits()?;
    rpc.shutdown();

    Ok(LimitsSnapshot {
        primary: limits.primary,
        secondary: limits.secondary,
        source: "cli-rpc",
    })
}

fn make_response(limits: LimitsSnapshot) -> CodexLimitsResponse {
    let (session, weekly) = normalize_windows(limits.primary, limits.secondary);
    CodexLimitsResponse {
        session: session.map(make_window),
        weekly: weekly.map(make_window),
        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        source: limits.source.to_string(),
    }
}

impl From<OAuthRateLimitWindow> for RpcRateLimitWindow {
    fn from(window: OAuthRateLimitWindow) -> Self {
        Self {
            used_percent: window.used_percent,
            window_duration_mins: window.limit_window_seconds.map(|seconds| seconds / 60),
            resets_at: window.reset_at,
        }
    }
}

fn load_codex_auth() -> Result<CodexAuth, String> {
    let path = codex_auth_path().ok_or_else(|| "Codex auth path is unavailable.".to_string())?;
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read Codex auth at {}: {error}", path.display()))?;
    parse_codex_auth(&content)
}

fn codex_auth_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("CODEX_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed).join("auth.json"));
        }
    }

    dirs::home_dir().map(|home| home.join(".codex/auth.json"))
}

fn parse_codex_auth(content: &str) -> Result<CodexAuth, String> {
    let value = serde_json::from_str::<Value>(content)
        .map_err(|error| format!("Failed to parse Codex auth.json: {error}"))?;

    if let Some(api_key) = string_field(&value, "OPENAI_API_KEY") {
        return Ok(CodexAuth {
            access_token: api_key,
            account_id: None,
        });
    }

    let tokens = value
        .get("tokens")
        .ok_or_else(|| "Codex auth.json exists but contains no tokens.".to_string())?;
    let access_token = string_field(tokens, "access_token")
        .or_else(|| string_field(tokens, "accessToken"))
        .ok_or_else(|| "Codex auth.json exists but contains no access token.".to_string())?;
    let account_id =
        string_field(tokens, "account_id").or_else(|| string_field(tokens, "accountId"));

    Ok(CodexAuth {
        access_token,
        account_id,
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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
    stderr: Arc<Mutex<String>>,
    next_id: i64,
}

impl CodexRpcProcess {
    fn start(codex: PathBuf) -> Result<Self, String> {
        let path = effective_path_with_codex(&codex);
        let mut child = Command::new("/usr/bin/env")
            .arg(&codex)
            .args(codex_app_server_args())
            .env("PATH", path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start Codex CLI app-server at {}: {error}",
                    codex.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open Codex RPC stdin.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open Codex RPC stdout.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open Codex RPC stderr.".to_string())?;
        let (tx, rx) = mpsc::channel();
        let stderr_output = Arc::new(Mutex::new(String::new()));

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        let stderr_buffer = Arc::clone(&stderr_output);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut output) = stderr_buffer.lock() {
                    if !output.is_empty() {
                        output.push('\n');
                    }
                    output.push_str(&line);
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            rx,
            stderr: stderr_output,
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
            Duration::from_secs(20),
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
                return Err(self.timeout_error(method));
            }

            let line = self
                .rx
                .recv_timeout(remaining)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => self.timeout_error(method),
                    mpsc::RecvTimeoutError::Disconnected => self.closed_stdout_error(method),
                })?;
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

    fn timeout_error(&mut self, method: &str) -> String {
        let _ = self.child.kill();
        let stderr = self.stderr_text();
        if stderr.is_empty() {
            format!("Codex RPC `{method}` timed out.")
        } else {
            format!("Codex RPC `{method}` timed out. stderr: {stderr}")
        }
    }

    fn closed_stdout_error(&mut self, method: &str) -> String {
        let status = self.child.try_wait().ok().flatten();
        let stderr = self.stderr_text();
        let status_text = status
            .map(|status| format!(" with status {status}"))
            .unwrap_or_default();

        if stderr.is_empty() {
            format!("Codex RPC `{method}` closed stdout{status_text}.")
        } else {
            format!("Codex RPC `{method}` closed stdout{status_text}. stderr: {stderr}")
        }
    }

    fn stderr_text(&self) -> String {
        self.stderr
            .lock()
            .map(|output| output.trim().to_string())
            .unwrap_or_default()
    }
}

impl Drop for CodexRpcProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn codex_app_server_args() -> [&'static str; 7] {
    [
        "-c",
        "mcp_servers={}",
        "-s",
        "read-only",
        "-a",
        "untrusted",
        "app-server",
    ]
}

fn resolve_codex_binary() -> Option<PathBuf> {
    if let Ok(path) = env::var("CODEX_CLI_PATH") {
        let path = PathBuf::from(path);
        if is_executable(&path) {
            return Some(path);
        }
    }

    if let Ok(path) = env::var("PATH") {
        if let Some(bin) = find_in_path("codex", &path) {
            return Some(bin);
        }
    }

    if let Some(path) = command_v_codex() {
        return Some(path);
    }

    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".bun/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
        candidates.extend(nvm_codex_candidates(&home));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));

    candidates.into_iter().find(|path| is_executable(&path))
}

fn command_v_codex() -> Option<PathBuf> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c", "command -v codex"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if child.try_wait().ok().flatten().is_some() {
            let output = child.wait_with_output().ok()?;
            return parse_command_v_output(&String::from_utf8(output.stdout).ok()?);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn parse_command_v_output(output: &str) -> Option<PathBuf> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        .map(PathBuf::from)
        .find(|path| is_executable(path))
}

fn effective_path_with_codex(codex: &Path) -> String {
    let mut parts = Vec::new();
    if let Some(parent) = codex.parent() {
        parts.push(parent.to_string_lossy().to_string());
    }
    parts.extend(path_parts(&effective_path()));
    dedupe_path(parts).join(":")
}

fn effective_path() -> String {
    let mut parts = env::var("PATH")
        .ok()
        .map(|path| path_parts(&path))
        .unwrap_or_default();
    parts.extend([
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ]);

    dedupe_path(parts).join(":")
}

fn path_parts(path: &str) -> Vec<String> {
    path.split(':').map(str::to_string).collect()
}

fn dedupe_path(parts: Vec<String>) -> Vec<String> {
    let mut seen = Vec::<String>::new();
    for part in parts {
        if !part.is_empty() && !seen.contains(&part) {
            seen.push(part);
        }
    }
    seen
}

fn find_in_path(binary: &str, path: &str) -> Option<PathBuf> {
    path.split(':')
        .filter(|part| !part.is_empty())
        .map(|part| PathBuf::from(part).join(binary))
        .find(|path| is_executable(path))
}

fn nvm_codex_candidates(home: &Path) -> Vec<PathBuf> {
    let versions_dir = home.join(".nvm/versions/node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return Vec::new();
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let version = path.file_name()?.to_string_lossy().to_string();
            Some((node_version_key(&version), path.join("bin/codex")))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    candidates.into_iter().map(|(_, path)| path).collect()
}

fn node_version_key(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
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

    #[test]
    fn app_server_args_disable_mcp_config_for_limits_rpc() {
        assert_eq!(
            codex_app_server_args(),
            [
                "-c",
                "mcp_servers={}",
                "-s",
                "read-only",
                "-a",
                "untrusted",
                "app-server",
            ]
        );
    }

    #[test]
    fn oauth_usage_url_uses_wham_usage_endpoint() {
        assert_eq!(
            CODEX_USAGE_URL,
            "https://chatgpt.com/backend-api/wham/usage"
        );
    }

    #[test]
    fn parses_codex_auth_tokens_with_account_id() {
        let auth = parse_codex_auth(
            r#"{
                "tokens": {
                    "access_token": "access",
                    "refresh_token": "refresh",
                    "account_id": "account"
                }
            }"#,
        )
        .unwrap();

        assert_eq!(auth.access_token, "access");
        assert_eq!(auth.account_id, Some("account".to_string()));
    }

    #[test]
    fn parses_codex_auth_camel_case_tokens() {
        let auth = parse_codex_auth(
            r#"{
                "tokens": {
                    "accessToken": "access",
                    "refreshToken": "refresh",
                    "accountId": "account"
                }
            }"#,
        )
        .unwrap();

        assert_eq!(auth.access_token, "access");
        assert_eq!(auth.account_id, Some("account".to_string()));
    }

    #[test]
    fn parses_oauth_usage_windows() {
        let usage = serde_json::from_str::<OAuthUsageResponse>(
            r#"{
                "rate_limit": {
                    "primary_window": {
                        "used_percent": 25,
                        "reset_at": 1800000000,
                        "limit_window_seconds": 18000
                    },
                    "secondary_window": {
                        "used_percent": 60,
                        "reset_at": 1800003600,
                        "limit_window_seconds": 604800
                    }
                }
            }"#,
        )
        .unwrap();
        let rate_limit = usage.rate_limit.unwrap();
        let response = make_response(LimitsSnapshot {
            primary: rate_limit.primary_window.map(RpcRateLimitWindow::from),
            secondary: rate_limit.secondary_window.map(RpcRateLimitWindow::from),
            source: "oauth",
        });

        assert_eq!(response.source, "oauth");
        assert_eq!(response.session.unwrap().remaining_percent, 75.0);
        assert_eq!(
            response.weekly.unwrap().window_minutes,
            Some(WEEKLY_WINDOW_MINUTES)
        );
    }

    #[test]
    fn falls_back_to_cli_when_oauth_fails() {
        let response = fetch_codex_limits_with(
            || Err("no oauth".to_string()),
            || {
                Ok(LimitsSnapshot {
                    primary: Some(window(20.0, Some(SESSION_WINDOW_MINUTES))),
                    secondary: Some(window(40.0, Some(WEEKLY_WINDOW_MINUTES))),
                    source: "cli-rpc",
                })
            },
        )
        .unwrap();

        assert_eq!(response.source, "cli-rpc");
        assert_eq!(response.session.unwrap().remaining_percent, 80.0);
    }

    #[test]
    fn combines_oauth_and_cli_errors_when_both_fail() {
        let error = fetch_codex_limits_with(
            || Err("bad token".to_string()),
            || Err("bad rpc".to_string()),
        )
        .unwrap_err();

        assert_eq!(
            error,
            "OAuth unavailable: bad token; CLI RPC unavailable: bad rpc"
        );
    }

    #[test]
    fn effective_path_prepends_resolved_codex_directory() {
        let path = effective_path_with_codex(Path::new(
            "/Users/test/.nvm/versions/node/v24.11.0/bin/codex",
        ));

        assert!(path.starts_with("/Users/test/.nvm/versions/node/v24.11.0/bin:"));
    }

    #[test]
    fn nvm_candidates_prefer_highest_node_version() {
        let root =
            std::env::temp_dir().join(format!("codex-usage-nvm-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".nvm/versions/node/v18.20.0/bin")).unwrap();
        fs::create_dir_all(root.join(".nvm/versions/node/v24.11.0/bin")).unwrap();

        let candidates = nvm_codex_candidates(&root);

        assert_eq!(
            candidates.first(),
            Some(&root.join(".nvm/versions/node/v24.11.0/bin/codex"))
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn command_v_parser_ignores_shell_startup_noise() {
        let path = command_v_fixture("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "#!/bin/sh\n").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let parsed = parse_command_v_output(&format!("startup noise\n{}\n", path.display()));

        assert_eq!(parsed, Some(path.clone()));
        fs::remove_file(path).unwrap();
    }

    fn command_v_fixture(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("codex-usage-{name}-{}", std::process::id()))
    }
}
