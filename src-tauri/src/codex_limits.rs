use crate::{
    codex_environment::{selected_codex_environment, CodexEnvironment, CodexRuntime},
    types::{CodexLimitWindow, CodexLimitsResponse, CodexQuotaForecastResponse, CodexResetCredit},
};
use chrono::{Local, SecondsFormat, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
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
const CODEX_RESET_CREDITS_URL: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CHATGPT_ACCOUNT_CHECK_URL: &str =
    "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const CODEX_QUOTA_FORECAST_URL: &str = "https://www.willcodexquotareset.com/api/forecast";

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
    rate_limit_reset_credits: Option<RpcRateLimitResetCredits>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRateLimitResetCredits {
    available_count: Option<i64>,
    #[serde(default)]
    credits: Vec<RpcResetCredit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcResetCredit {
    id: String,
    status: String,
    expires_at: Option<i64>,
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
    rate_limit_reset_credits: Option<OAuthRateLimitResetCredits>,
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

#[derive(Debug, Deserialize)]
struct OAuthRateLimitResetCredits {
    available_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct OAuthResetCreditsResponse {
    #[serde(default)]
    credits: Vec<OAuthResetCredit>,
}

#[derive(Debug, Deserialize)]
struct OAuthResetCredit {
    id: String,
    status: String,
    expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexQuotaForecastApiResponse {
    fetched_at: String,
    next_refresh_at: String,
    forecast: CodexQuotaForecastScore,
}

#[derive(Debug, Deserialize)]
struct CodexQuotaForecastScore {
    score: i64,
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
    reset_credits_available_count: Option<i64>,
    reset_credits: Option<Vec<CodexResetCredit>>,
    source: &'static str,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct AccountSnapshot {
    account: Option<String>,
    membership_level: Option<String>,
    subscription: SubscriptionInfo,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct SubscriptionInfo {
    expires_at: Option<String>,
    will_renew: Option<bool>,
    has_active_subscription: Option<bool>,
}

pub fn fetch_codex_limits() -> Result<CodexLimitsResponse, String> {
    log::info!("Starting fetch_codex_limits...");
    fetch_codex_limits_with(fetch_oauth_limits, fetch_cli_limits, fetch_account_snapshot)
}

pub fn fetch_codex_quota_forecast() -> Result<CodexQuotaForecastResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|error| format!("Failed to build forecast HTTP client: {error}"))?;

    let response = client
        .get(CODEX_QUOTA_FORECAST_URL)
        .header("User-Agent", "codex-usage-desktop")
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Forecast request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Forecast endpoint returned status {status}"));
    }

    let body = response
        .text()
        .map_err(|error| format!("Failed to read forecast response: {error}"))?;

    parse_codex_quota_forecast(&body)
}

fn parse_codex_quota_forecast(body: &str) -> Result<CodexQuotaForecastResponse, String> {
    let response: CodexQuotaForecastApiResponse = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse forecast JSON: {error}"))?;

    Ok(CodexQuotaForecastResponse {
        score: response.forecast.score,
        fetched_at: response.fetched_at,
        next_refresh_at: response.next_refresh_at,
    })
}

fn fetch_codex_limits_with(
    fetch_oauth: impl FnOnce() -> Result<LimitsSnapshot, String>,
    fetch_cli: impl FnOnce() -> Result<LimitsSnapshot, String>,
    fetch_account: impl FnOnce() -> AccountSnapshot,
) -> Result<CodexLimitsResponse, String> {
    let account = fetch_account();
    match fetch_oauth() {
        Ok(limits) => {
            log::info!("Successfully fetched limits via OAuth.");
            Ok(make_response(limits, account))
        }
        Err(oauth_error) => {
            log::warn!("OAuth limits fetch failed: {oauth_error}. Falling back to CLI...");
            match fetch_cli() {
                Ok(limits) => {
                    log::info!("Successfully fetched limits via CLI fallback.");
                    Ok(make_response(limits, account))
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
        .bearer_auth(&auth.access_token)
        .header("Accept", "application/json")
        .header("Origin", "https://chatgpt.com")
        .header("Referer", "https://chatgpt.com/")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Some(account_id) = &auth.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request.send().map_err(|error| {
        log::error!("Request failed: {error:?}");
        format!("Failed to fetch Codex usage API: {error}")
    })?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read Codex usage API response: {error}"))?;

    if !status.is_success() {
        log::error!("Codex API error status: {status}, body: {body}");
        return Err(format!("Codex usage API returned {status}: {body}"));
    }

    let usage = serde_json::from_str::<OAuthUsageResponse>(&body)
        .map_err(|error| format!("Failed to parse Codex usage API response: {error}"))?;
    let reset_credits = fetch_oauth_reset_credits(&client, &auth);

    make_oauth_snapshot(usage, reset_credits)
}

fn fetch_oauth_reset_credits(
    client: &reqwest::blocking::Client,
    auth: &CodexAuth,
) -> Result<Vec<CodexResetCredit>, String> {
    let mut request = client
        .get(CODEX_RESET_CREDITS_URL)
        .timeout(Duration::from_secs(5))
        .bearer_auth(&auth.access_token)
        .header("Accept", "application/json")
        .header("Origin", "https://chatgpt.com")
        .header("Referer", "https://chatgpt.com/")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Some(account_id) = &auth.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request
        .send()
        .map_err(|error| format!("Failed to fetch Codex reset credit details: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read Codex reset credit details: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Codex reset credit details API returned {status}: {body}"
        ));
    }

    let details = serde_json::from_str::<OAuthResetCreditsResponse>(&body)
        .map_err(|error| format!("Failed to parse Codex reset credit details: {error}"))?;
    Ok(normalize_oauth_reset_credits(details.credits))
}

fn make_oauth_snapshot(
    usage: OAuthUsageResponse,
    reset_credits: Result<Vec<CodexResetCredit>, String>,
) -> Result<LimitsSnapshot, String> {
    let rate_limit = usage
        .rate_limit
        .ok_or_else(|| "Codex usage API response was missing rate_limit.".to_string())?;
    let reset_credits_available_count = usage
        .rate_limit_reset_credits
        .and_then(|credits| credits.available_count);
    let reset_credits = match reset_credits {
        Ok(credits) => Some(credits),
        Err(error) => {
            log::warn!("Codex reset credit details unavailable: {error}");
            None
        }
    };

    Ok(LimitsSnapshot {
        primary: rate_limit.primary_window.map(RpcRateLimitWindow::from),
        secondary: rate_limit.secondary_window.map(RpcRateLimitWindow::from),
        reset_credits_available_count,
        reset_credits,
        source: "oauth",
    })
}

fn fetch_cli_limits() -> Result<LimitsSnapshot, String> {
    let codex = resolve_codex_command(selected_codex_environment()).ok_or_else(|| {
        "Codex CLI not found. Set CODEX_CLI_PATH or install the codex command.".to_string()
    })?;
    let mut rpc = CodexRpcProcess::start(codex)?;
    rpc.initialize()?;
    let limits = rpc.fetch_rate_limits()?;
    rpc.shutdown();

    Ok(LimitsSnapshot {
        primary: limits.primary,
        secondary: limits.secondary,
        reset_credits_available_count: limits
            .rate_limit_reset_credits
            .as_ref()
            .and_then(|credits| credits.available_count),
        reset_credits: limits
            .rate_limit_reset_credits
            .map(|credits| normalize_rpc_reset_credits(credits.credits)),
        source: "cli-rpc",
    })
}

fn fetch_account_snapshot() -> AccountSnapshot {
    let Ok(auth) = load_codex_auth() else {
        return AccountSnapshot::default();
    };
    let (account, mut membership_level) = decode_jwt_info(&auth.access_token);
    let subscription = match fetch_subscription_info(&auth) {
        Ok(subscription) => {
            let is_expired = if let Some(ref expires_at_str) = subscription.expires_at {
                if let Ok(expires_at) = chrono::DateTime::parse_from_rfc3339(expires_at_str) {
                    Utc::now() > expires_at.with_timezone(&Utc)
                } else {
                    false
                }
            } else {
                false
            };

            let has_active = subscription.has_active_subscription.unwrap_or(true);
            if !has_active || is_expired {
                membership_level = Some("free".to_string());
            }

            subscription
        }
        Err(error) => {
            log::warn!("ChatGPT account check unavailable: {error}");
            SubscriptionInfo::default()
        }
    };

    AccountSnapshot {
        account,
        membership_level,
        subscription,
    }
}

fn make_response(limits: LimitsSnapshot, account: AccountSnapshot) -> CodexLimitsResponse {
    let (session, weekly) = normalize_windows(limits.primary, limits.secondary);

    CodexLimitsResponse {
        session: session.map(make_window),
        weekly: weekly.map(make_window),
        reset_credits_available_count: limits.reset_credits_available_count,
        reset_credits: limits.reset_credits,
        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        source: limits.source.to_string(),
        account: account.account,
        membership_level: account.membership_level,
        subscription_expires_at: account.subscription.expires_at,
        subscription_will_renew: account.subscription.will_renew,
    }
}

fn fetch_subscription_info(auth: &CodexAuth) -> Result<SubscriptionInfo, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to create ChatGPT account check client: {error}"))?;

    let timezone_offset_min = chatgpt_timezone_offset_min();
    let mut request = client
        .get(CHATGPT_ACCOUNT_CHECK_URL)
        .query(&[("timezone_offset_min", timezone_offset_min.to_string())])
        .bearer_auth(&auth.access_token)
        .header("Accept", "application/json")
        .header("Origin", "https://chatgpt.com")
        .header("Referer", "https://chatgpt.com/")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Some(account_id) = &auth.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request
        .send()
        .map_err(|error| format!("Failed to fetch ChatGPT account check API: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read ChatGPT account check response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "ChatGPT account check API returned {status}: {body}"
        ));
    }

    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("Failed to parse ChatGPT account check response: {error}"))?;
    Ok(parse_subscription_info(&value))
}

fn chatgpt_timezone_offset_min() -> i32 {
    -Local::now().offset().local_minus_utc() / 60
}

fn parse_subscription_info(value: &Value) -> SubscriptionInfo {
    let Some(account) = subscription_account_value(value) else {
        return SubscriptionInfo::default();
    };

    let expires_at = account
        .get("entitlement")
        .and_then(|entitlement| string_field(entitlement, "expires_at"));
    let will_renew = account
        .get("last_active_subscription")
        .and_then(|subscription| subscription.get("will_renew"))
        .and_then(Value::as_bool);
    let has_active_subscription = account
        .get("entitlement")
        .and_then(|entitlement| entitlement.get("has_active_subscription"))
        .and_then(Value::as_bool);

    SubscriptionInfo {
        expires_at,
        will_renew,
        has_active_subscription,
    }
}

fn subscription_account_value(value: &Value) -> Option<&Value> {
    let accounts = value.get("accounts")?;
    accounts.get("default").or_else(|| {
        accounts
            .as_object()?
            .values()
            .find(|account| account.get("entitlement").is_some())
    })
}

fn decode_jwt_info(token: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let payload_b64 = parts[1];

    if let Some(decoded_bytes) = base64url_decode(payload_b64) {
        if let Ok(decoded_str) = String::from_utf8(decoded_bytes) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&decoded_str) {
                let email = val
                    .get("https://api.openai.com/profile")
                    .and_then(|p| p.get("email"))
                    .and_then(|e| e.as_str())
                    .map(|s| s.to_string());

                let plan_type = val
                    .get("https://api.openai.com/auth")
                    .and_then(|a| a.get("chatgpt_plan_type"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());

                return (email, plan_type);
            }
        }
    }
    (None, None)
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut normalized = input.replace('-', "+").replace('_', "/");
    let rem = normalized.len() % 4;
    if rem > 0 {
        normalized.push_str(&"===="[rem..]);
    }

    let bytes = normalized.as_bytes();
    let len = bytes.len();
    if len % 4 != 0 {
        return None;
    }

    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut table = [255u8; 256];
    for (idx, &c) in alphabet.iter().enumerate() {
        table[c as usize] = idx as u8;
    }

    let mut out = Vec::new();
    let mut i = 0;
    while i < len {
        let c0 = bytes[i];
        let c1 = bytes[i + 1];
        let c2 = bytes[i + 2];
        let c3 = bytes[i + 3];

        let v0 = table[c0 as usize];
        let v1 = table[c1 as usize];
        if v0 == 255 || v1 == 255 {
            return None;
        }

        let v2 = if c2 == b'=' {
            0
        } else {
            let v = table[c2 as usize];
            if v == 255 {
                return None;
            }
            v
        };
        let v3 = if c3 == b'=' {
            0
        } else {
            let v = table[c3 as usize];
            if v == 255 {
                return None;
            }
            v
        };

        let triple = ((v0 as u32) << 18) | ((v1 as u32) << 12) | ((v2 as u32) << 6) | (v3 as u32);

        out.push(((triple >> 16) & 0xFF) as u8);
        if c2 != b'=' {
            out.push(((triple >> 8) & 0xFF) as u8);
        }
        if c3 != b'=' {
            out.push((triple & 0xFF) as u8);
        }
        i += 4;
    }
    Some(out)
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
    Some(selected_codex_environment().home.join("auth.json"))
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

fn normalize_oauth_reset_credits(credits: Vec<OAuthResetCredit>) -> Vec<CodexResetCredit> {
    sort_reset_credits(
        credits
            .into_iter()
            .filter(|credit| credit.status.eq_ignore_ascii_case("available"))
            .map(|credit| CodexResetCredit {
                id: credit.id,
                expires_at: credit.expires_at.and_then(|expires_at| {
                    chrono::DateTime::parse_from_rfc3339(&expires_at)
                        .ok()
                        .map(|date| {
                            date.with_timezone(&Utc)
                                .to_rfc3339_opts(SecondsFormat::Millis, true)
                        })
                }),
            })
            .collect(),
    )
}

fn normalize_rpc_reset_credits(credits: Vec<RpcResetCredit>) -> Vec<CodexResetCredit> {
    sort_reset_credits(
        credits
            .into_iter()
            .filter(|credit| credit.status.eq_ignore_ascii_case("available"))
            .map(|credit| CodexResetCredit {
                id: credit.id,
                expires_at: credit
                    .expires_at
                    .and_then(|timestamp| Utc.timestamp_opt(timestamp, 0).single())
                    .map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true)),
            })
            .collect(),
    )
}

fn sort_reset_credits(mut credits: Vec<CodexResetCredit>) -> Vec<CodexResetCredit> {
    credits.sort_by_key(|credit| {
        (
            credit.expires_at.is_none(),
            credit.expires_at.clone().unwrap_or_default(),
        )
    });
    credits
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

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexCommand {
    Native(PathBuf),
    WindowsCmd(PathBuf),
    Wsl { distribution: String, path: String },
}

impl CodexRpcProcess {
    fn start(codex: CodexCommand) -> Result<Self, String> {
        let display = codex_command_display(&codex);
        let mut command = codex_process_command(&codex);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!("Failed to start Codex CLI app-server at {display}: {error}")
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

fn resolve_codex_command(environment: &CodexEnvironment) -> Option<CodexCommand> {
    match &environment.runtime {
        CodexRuntime::Native => resolve_native_codex_binary()
            .map(|path| classify_native_command(path, cfg!(target_os = "windows"))),
        CodexRuntime::Wsl { distribution } => {
            let path = command_v_wsl_codex(distribution)?;
            Some(CodexCommand::Wsl {
                distribution: distribution.clone(),
                path,
            })
        }
    }
}

fn resolve_native_codex_binary() -> Option<PathBuf> {
    if let Ok(path) = env::var("CODEX_CLI_PATH") {
        let path = PathBuf::from(path.trim());
        if is_executable(&path) {
            return Some(path);
        }
    }

    if let Some(path) = env::var_os("PATH") {
        let names: &[&str] = if cfg!(target_os = "windows") {
            &["codex.exe", "codex.cmd", "codex.bat", "codex"]
        } else {
            &["codex"]
        };
        if let Some(bin) = find_in_system_path(names, &path) {
            return Some(bin);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(path) = command_v_codex() {
            return Some(path);
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        if cfg!(target_os = "windows") {
            candidates.push(home.join(".codex/bin/codex.exe"));
            candidates.push(home.join(".codex/bin/codex.cmd"));
        } else {
            candidates.push(home.join(".local/bin/codex"));
            candidates.push(home.join(".bun/bin/codex"));
            candidates.push(home.join(".npm-global/bin/codex"));
            candidates.extend(nvm_codex_candidates(&home));
        }
    }
    #[cfg(target_os = "windows")]
    {
        for directory in [
            env::var_os("PNPM_HOME").map(PathBuf::from),
            env::var_os("APPDATA").map(|path| PathBuf::from(path).join("npm")),
        ]
        .into_iter()
        .flatten()
        {
            candidates.push(directory.join("codex.exe"));
            candidates.push(directory.join("codex.cmd"));
        }
    }
    if !cfg!(target_os = "windows") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
    }

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

fn command_v_wsl_codex(distribution: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new("wsl.exe")
            .args([
                "-d",
                distribution,
                "--",
                "sh",
                "-lc",
                "exec \"$SHELL\" -lic 'command -v codex'",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if child.try_wait().ok().flatten().is_some() {
                let output = child.wait_with_output().ok()?;
                return parse_wsl_command_v_output(&String::from_utf8(output.stdout).ok()?);
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                log::warn!(
                    "Timed out while locating Codex CLI in WSL distribution {distribution}."
                );
                return None;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = distribution;
        None
    }
}

#[cfg(any(target_os = "windows", test))]
fn parse_wsl_command_v_output(output: &str) -> Option<String> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('/'))
        .map(str::to_string)
}

fn classify_native_command(path: PathBuf, windows: bool) -> CodexCommand {
    if windows
        && matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some(extension) if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        )
    {
        CodexCommand::WindowsCmd(path)
    } else {
        CodexCommand::Native(path)
    }
}

fn codex_process_command(codex: &CodexCommand) -> Command {
    match codex {
        CodexCommand::Native(path) => {
            #[cfg(target_os = "windows")]
            let mut command = Command::new(path);
            #[cfg(not(target_os = "windows"))]
            let mut command = {
                let mut command = Command::new("/usr/bin/env");
                command.arg(path);
                command
            };
            command
                .args(codex_app_server_args())
                .env("PATH", effective_path_with_codex(path));
            command
        }
        CodexCommand::WindowsCmd(path) => {
            let args = codex_app_server_args().join(" ");
            let mut command = Command::new("cmd.exe");
            command
                .args(["/D", "/S", "/C"])
                .arg(format!("\"{}\" {args}", path.display()))
                .env("PATH", effective_path_with_codex(path));
            command
        }
        CodexCommand::Wsl { distribution, path } => {
            let inner_command = std::iter::once(path.as_str())
                .chain(codex_app_server_args())
                .map(shell_quote)
                .collect::<Vec<_>>()
                .join(" ");
            let login_command = format!("exec \"$SHELL\" -lic {}", shell_quote(&inner_command));
            let mut command = Command::new("wsl.exe");
            command
                .args(["-d", distribution, "--", "sh", "-lc"])
                .arg(login_command);
            command
        }
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn codex_command_display(codex: &CodexCommand) -> String {
    match codex {
        CodexCommand::Native(path) | CodexCommand::WindowsCmd(path) => path.display().to_string(),
        CodexCommand::Wsl { distribution, path } => format!("WSL {distribution}:{path}"),
    }
}

fn effective_path_with_codex(codex: &Path) -> OsString {
    let mut parts = Vec::<PathBuf>::new();
    if let Some(parent) = codex.parent() {
        parts.push(parent.to_path_buf());
    }
    parts.extend(effective_path_parts());
    env::join_paths(dedupe_paths(parts)).unwrap_or_default()
}

fn effective_path_parts() -> Vec<PathBuf> {
    let mut parts: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();
    if !cfg!(target_os = "windows") {
        parts.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
    }
    dedupe_paths(parts)
}

#[cfg(test)]
fn path_parts(path: &str, separator: char) -> Vec<String> {
    path.split(separator).map(str::to_string).collect()
}

#[cfg(test)]
fn join_path_parts(parts: Vec<String>, separator: char) -> String {
    parts.join(&separator.to_string())
}

fn dedupe_paths(parts: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = Vec::<PathBuf>::new();
    for part in parts {
        if !part.as_os_str().is_empty() && !seen.contains(&part) {
            seen.push(part);
        }
    }
    seen
}

fn find_in_system_path(binaries: &[&str], path: &OsStr) -> Option<PathBuf> {
    env::split_paths(path)
        .flat_map(|part| binaries.iter().map(move |binary| part.join(binary)))
        .find(is_executable)
}

#[cfg(test)]
fn find_in_path_candidates_for_separator(
    binaries: &[&str],
    path: &str,
    separator: char,
) -> Option<PathBuf> {
    path.split(separator)
        .filter(|part| !part.is_empty())
        .flat_map(|part| {
            binaries
                .iter()
                .map(move |binary| PathBuf::from(part).join(binary))
        })
        .find(is_executable)
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
    fn oauth_detail_failure_preserves_usage_count_and_windows() {
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
                },
                "rate_limit_reset_credits": {
                    "available_count": 2
                }
            }"#,
        )
        .unwrap();
        let response = make_response(
            make_oauth_snapshot(usage, Err("details unavailable".to_string())).unwrap(),
            AccountSnapshot::default(),
        );

        assert_eq!(response.source, "oauth");
        assert_eq!(response.reset_credits_available_count, Some(2));
        assert_eq!(response.reset_credits, None);
        assert_eq!(response.session.unwrap().remaining_percent, 75.0);
        assert_eq!(
            response.weekly.unwrap().window_minutes,
            Some(WEEKLY_WINDOW_MINUTES)
        );
    }

    #[test]
    fn parses_filters_and_sorts_oauth_reset_credit_details() {
        let details = serde_json::from_str::<OAuthResetCreditsResponse>(
            r#"{
                "available_count": 3,
                "credits": [
                    {"id": "never", "status": "available", "expires_at": null},
                    {"id": "used", "status": "redeemed", "expires_at": "2026-08-01T00:00:00Z"},
                    {"id": "later", "status": "available", "expires_at": "2026-08-03T02:00:00+02:00"},
                    {"id": "earlier", "status": "available", "expires_at": "2026-08-01T00:00:00Z"}
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            normalize_oauth_reset_credits(details.credits),
            vec![
                CodexResetCredit {
                    id: "earlier".to_string(),
                    expires_at: Some("2026-08-01T00:00:00.000Z".to_string()),
                },
                CodexResetCredit {
                    id: "later".to_string(),
                    expires_at: Some("2026-08-03T00:00:00.000Z".to_string()),
                },
                CodexResetCredit {
                    id: "never".to_string(),
                    expires_at: None,
                },
            ]
        );
    }

    #[test]
    fn parses_cli_reset_credits_and_converts_unix_expirations() {
        let response = serde_json::from_value::<RpcRateLimitsResponse>(json!({
            "rateLimits": {
                "primary": null,
                "secondary": null,
                "rateLimitResetCredits": {
                    "availableCount": 2,
                    "credits": [
                        {"id": "never", "status": "available", "expiresAt": null},
                        {"id": "used", "status": "redeemed", "expiresAt": 1785542400},
                        {"id": "expires", "status": "available", "expiresAt": 1785542400}
                    ]
                }
            }
        }))
        .unwrap();
        let credits = response.rate_limits.rate_limit_reset_credits.unwrap();

        assert_eq!(credits.available_count, Some(2));
        assert_eq!(
            normalize_rpc_reset_credits(credits.credits),
            vec![
                CodexResetCredit {
                    id: "expires".to_string(),
                    expires_at: Some("2026-08-01T00:00:00.000Z".to_string()),
                },
                CodexResetCredit {
                    id: "never".to_string(),
                    expires_at: None,
                },
            ]
        );
    }

    #[test]
    fn parses_legacy_cli_rate_limits_without_reset_credits() {
        let response = serde_json::from_value::<RpcRateLimitsResponse>(json!({
            "rateLimits": {"primary": null, "secondary": null}
        }))
        .unwrap();

        assert!(response.rate_limits.rate_limit_reset_credits.is_none());
    }

    #[test]
    fn falls_back_to_cli_when_oauth_fails() {
        let response = fetch_codex_limits_with(
            || Err("no oauth".to_string()),
            || {
                Ok(LimitsSnapshot {
                    primary: Some(window(20.0, Some(SESSION_WINDOW_MINUTES))),
                    secondary: Some(window(40.0, Some(WEEKLY_WINDOW_MINUTES))),
                    reset_credits_available_count: None,
                    reset_credits: None,
                    source: "cli-rpc",
                })
            },
            AccountSnapshot::default,
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
            AccountSnapshot::default,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "OAuth unavailable: bad token; CLI RPC unavailable: bad rpc"
        );
    }

    #[test]
    fn parses_account_check_subscription_info() {
        let value = serde_json::json!({
            "accounts": {
                "default": {
                    "entitlement": {
                        "renews_at": "2026-06-11T07:22:29+00:00",
                        "expires_at": "2026-06-12T08:22:29+00:00",
                        "has_active_subscription": true
                    },
                    "last_active_subscription": {
                        "will_renew": false
                    }
                }
            }
        });

        assert_eq!(
            parse_subscription_info(&value),
            SubscriptionInfo {
                expires_at: Some("2026-06-12T08:22:29+00:00".to_string()),
                will_renew: Some(false),
                has_active_subscription: Some(true),
            }
        );
    }

    #[test]
    fn parses_quota_forecast_from_full_response() {
        let response = parse_codex_quota_forecast(
            r#"{
                "fetchedAt": "2026-06-25T09:00:19.499Z",
                "incidents": [{"id": "incident-1"}],
                "nextRefreshAt": "2026-06-25T09:30:19.499Z",
                "forecast": {
                    "breakdown": [{"label": "baseline", "points": 12}],
                    "daysSinceReset": 7,
                    "score": 73
                },
                "history": [{"toScore": 73}]
            }"#,
        )
        .unwrap();

        assert_eq!(
            response,
            CodexQuotaForecastResponse {
                score: 73,
                fetched_at: "2026-06-25T09:00:19.499Z".to_string(),
                next_refresh_at: "2026-06-25T09:30:19.499Z".to_string(),
            }
        );
    }

    #[test]
    fn parses_empty_subscription_info_when_account_check_fields_are_missing() {
        let value = serde_json::json!({
            "accounts": {
                "default": {
                    "entitlement": null,
                    "last_active_subscription": null
                }
            }
        });

        assert_eq!(parse_subscription_info(&value), SubscriptionInfo::default());
    }

    #[test]
    fn response_includes_subscription_info_from_account_snapshot() {
        let response = make_response(
            LimitsSnapshot {
                primary: Some(window(20.0, Some(SESSION_WINDOW_MINUTES))),
                secondary: None,
                reset_credits_available_count: Some(2),
                reset_credits: None,
                source: "oauth",
            },
            AccountSnapshot {
                account: Some("user@example.com".to_string()),
                membership_level: Some("plus".to_string()),
                subscription: SubscriptionInfo {
                    expires_at: Some("2026-06-12T08:22:29+00:00".to_string()),
                    will_renew: Some(false),
                    has_active_subscription: Some(true),
                },
            },
        );

        assert_eq!(
            response.subscription_expires_at,
            Some("2026-06-12T08:22:29+00:00".to_string())
        );
        assert_eq!(response.subscription_will_renew, Some(false));
        assert_eq!(response.reset_credits_available_count, Some(2));
    }

    #[test]
    fn effective_path_prepends_resolved_codex_directory() {
        let path = effective_path_with_codex(Path::new(
            "/Users/test/.nvm/versions/node/v24.11.0/bin/codex",
        ));

        assert!(path
            .to_string_lossy()
            .starts_with("/Users/test/.nvm/versions/node/v24.11.0/bin:"));
    }

    #[test]
    fn windows_path_lists_use_semicolon_separator() {
        assert_eq!(
            path_parts(r"C:\\Tools;D:\\npm;;", ';'),
            vec![r"C:\\Tools", r"D:\\npm", "", ""]
        );
        assert_eq!(
            join_path_parts(vec![r"C:\\Tools".to_string(), r"D:\\npm".to_string()], ';'),
            r"C:\\Tools;D:\\npm"
        );
    }

    #[test]
    fn windows_path_lookup_prefers_exe_before_cmd() {
        let root = command_v_fixture("windows-path");
        fs::create_dir_all(&root).unwrap();
        let exe = root.join("codex.exe");
        let cmd = root.join("codex.cmd");
        fs::write(&exe, "exe").unwrap();
        fs::write(&cmd, "cmd").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&cmd, fs::Permissions::from_mode(0o755)).unwrap();
        }

        assert_eq!(
            find_in_path_candidates_for_separator(
                &["codex.exe", "codex.cmd"],
                &root.to_string_lossy(),
                ';'
            ),
            Some(exe)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_cmd_wrapper_uses_cmd_exe_launcher() {
        let codex = classify_native_command(PathBuf::from(r"C:\\Users\\test\\codex.cmd"), true);
        let command = codex_process_command(&codex);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(command.get_program(), "cmd.exe");
        assert_eq!(&args[..3], &["/D", "/S", "/C"]);
        assert!(args[3].contains("codex.cmd"));
        assert!(args[3].contains("app-server"));
    }

    #[test]
    fn parses_wsl_codex_path_after_shell_noise() {
        assert_eq!(
            parse_wsl_command_v_output("startup warning\n/home/test/.npm/bin/codex\n"),
            Some("/home/test/.npm/bin/codex".to_string())
        );
    }

    #[test]
    fn wsl_cli_runs_through_the_selected_distributions_login_shell() {
        let command = codex_process_command(&CodexCommand::Wsl {
            distribution: "Ubuntu".to_string(),
            path: "/home/test/.nvm/bin/codex".to_string(),
        });
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(command.get_program(), "wsl.exe");
        assert_eq!(&args[..5], &["-d", "Ubuntu", "--", "sh", "-lc"]);
        assert!(args[5].contains("$SHELL"));
        assert!(args[5].contains("/home/test/.nvm/bin/codex"));
        assert!(args[5].contains("app-server"));
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
