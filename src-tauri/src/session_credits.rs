//! Optional, account-scoped balance debits. Local token accounting is independent.
use crate::{
    codex_auth::{load_codex_auth, CodexAuth},
    codex_environment::selected_codex_environment,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::{Mutex, OnceLock},
    time::Instant,
};

const ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage/thread_usage/query_v2";
const MIN_INTERVAL: i64 = 300_000;
const DAY: i64 = 86_400_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditThread {
    pub thread_id: String,
    pub modified_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditRow {
    pub thread_id: String,
    // None means an omitted row, not a server-provided unavailable status.
    pub data_status: Option<String>,
    pub balance_usage_credits: Option<String>,
    pub usage_source: Option<String>,
    pub data_as_of: Option<String>,
    pub fetched_at: String,
    pub stale: bool,
    pub is_mock: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditResult {
    pub identity: Option<String>,
    pub rows: Vec<CreditRow>,
    pub request_status: Option<String>,
    pub retry_at: Option<i64>,
}

#[derive(Default)]
struct Service {
    // Keep demo state entirely in memory, separate from every real identity.
    mock_db: Option<Connection>,
}
static SERVICE: OnceLock<Mutex<Service>> = OnceLock::new();
static SCOPES: OnceLock<Mutex<HashMap<String, (u64, bool)>>> = OnceLock::new();

pub fn set_scope(scope: String, revision: u64, active: bool) -> Result<(), String> {
    let mut scopes = SCOPES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Credits scope lock failed.")?;
    let entry = scopes.entry(scope).or_default();
    if revision >= entry.0 {
        *entry = (revision, active);
    }
    Ok(())
}

fn is_active(scope: &str, revision: u64) -> bool {
    SCOPES
        .get_or_init(Default::default)
        .lock()
        .is_ok_and(|scopes| scopes.get(scope) == Some(&(revision, true)))
}

pub fn create_tables(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_credits (
        identity TEXT NOT NULL, thread_id TEXT NOT NULL,
        balance_usage_credits TEXT, data_status TEXT, usage_source TEXT, data_as_of TEXT,
        fetched_at INTEGER NOT NULL, local_modified_at INTEGER NOT NULL,
        last_attempt_at INTEGER NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(identity, thread_id));
        CREATE TABLE IF NOT EXISTS session_credits_cooldown (
        identity TEXT PRIMARY KEY, status TEXT NOT NULL, retry_at INTEGER NOT NULL);",
    )
    .map_err(|error| error.to_string())
}

pub fn identity() -> Result<String, String> {
    current_identity().map(|(identity, _)| identity)
}

fn current_identity() -> Result<(String, Option<CodexAuth>), String> {
    #[cfg(debug_assertions)]
    if demo_enabled() {
        return Ok(("session-credits-demo".into(), None));
    }
    let auth = load_codex_auth().map_err(|_| "chatgptLoginRequired")?;
    if !auth.is_chatgpt {
        return Err("chatgptLoginRequired".into());
    }
    let (Some(account), Some(user)) = (&auth.account_id, &auth.user_id) else {
        return Err("identityUnavailable".into());
    };
    let environment = selected_codex_environment();
    let identity = json!([
        environment.home,
        format!("{:?}", environment.runtime),
        account,
        user
    ])
    .to_string();
    Ok((identity, Some(auth)))
}

#[cfg(debug_assertions)]
fn demo_enabled() -> bool {
    std::env::var("CODEX_USAGE_DEBUG_SESSION_CREDITS").is_ok_and(|value| value == "demo")
}

fn validate_threads(threads: Vec<CreditThread>) -> Result<Vec<CreditThread>, String> {
    if threads.len() > 1_000 {
        return Err("Expected at most 1,000 thread IDs.".into());
    }
    let mut unique = BTreeMap::<String, i64>::new();
    for thread in threads {
        let id = uuid::Uuid::parse_str(&thread.thread_id)
            .map_err(|_| "Invalid thread UUID.")?
            .to_string();
        unique
            .entry(id)
            .and_modify(|mtime| *mtime = (*mtime).max(thread.modified_at_ms))
            .or_insert(thread.modified_at_ms);
    }
    Ok(unique
        .into_iter()
        .map(|(thread_id, modified_at_ms)| CreditThread {
            thread_id,
            modified_at_ms,
        })
        .collect())
}

struct Cached {
    row: CreditRow,
    fetched_at: i64,
    modified_at: i64,
    last_attempt: i64,
}

fn read_cached(
    db: &Connection,
    identity: &str,
    thread: &CreditThread,
    now: i64,
    is_mock: bool,
) -> Result<Option<Cached>, String> {
    db.query_row("SELECT balance_usage_credits, data_status, usage_source, data_as_of, fetched_at, local_modified_at, last_attempt_at, stale FROM session_credits WHERE identity=? AND thread_id=?",
        params![identity, thread.thread_id], |row| {
            let fetched_at: i64 = row.get(4)?;
            Ok(Cached { row: CreditRow {
                thread_id: thread.thread_id.clone(), balance_usage_credits: row.get(0)?, data_status: row.get(1)?,
                usage_source: row.get(2)?, data_as_of: row.get(3)?, fetched_at: timestamp(fetched_at),
                stale: row.get::<_, bool>(7)?, is_mock,
            }, fetched_at, modified_at: row.get(5)?, last_attempt: row.get(6)? })
        }).optional().map_err(|error| error.to_string()).map(|cached| cached.map(|mut cached| {
            cached.row.stale |= !fresh(&cached, thread, now);
            cached
        }))
}

fn fresh(cached: &Cached, thread: &CreditThread, now: i64) -> bool {
    let complete = cached.row.data_status.as_deref() == Some("available")
        && cached.row.balance_usage_credits.is_some();
    let ttl = if complete && now - thread.modified_at_ms > DAY {
        DAY
    } else {
        MIN_INTERVAL
    };
    cached.modified_at == thread.modified_at_ms
        && now - cached.fetched_at < ttl
        && !cached.row.stale
}

fn timestamp(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339()
}

fn write_row(
    db: &Connection,
    identity: &str,
    thread: &CreditThread,
    row: &CreditRow,
    now: i64,
) -> Result<(), String> {
    db.execute("INSERT INTO session_credits (identity,thread_id,balance_usage_credits,data_status,usage_source,data_as_of,fetched_at,local_modified_at,last_attempt_at,stale)
        VALUES (?,?,?,?,?,?,?,?,?,0) ON CONFLICT(identity,thread_id) DO UPDATE SET balance_usage_credits=excluded.balance_usage_credits,
        data_status=excluded.data_status,usage_source=excluded.usage_source,data_as_of=excluded.data_as_of,fetched_at=excluded.fetched_at,
        local_modified_at=excluded.local_modified_at,last_attempt_at=excluded.last_attempt_at,stale=0",
        params![identity, thread.thread_id, row.balance_usage_credits, row.data_status, row.usage_source, row.data_as_of, now, thread.modified_at_ms, now])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn empty_row(id: &str, now: i64, is_mock: bool) -> CreditRow {
    CreditRow {
        thread_id: id.into(),
        data_status: None,
        balance_usage_credits: None,
        usage_source: None,
        data_as_of: None,
        fetched_at: timestamp(now),
        stale: false,
        is_mock,
    }
}

pub fn fetch(
    database: &Path,
    threads: Vec<CreditThread>,
    force: bool,
    cache_only: bool,
    scope: &str,
    revision: u64,
) -> Result<CreditResult, String> {
    let started_at = Utc::now().timestamp_millis();
    let threads = validate_threads(threads)?;
    if threads.is_empty() || !is_active(scope, revision) {
        return Ok(CreditResult::default());
    }
    let (identity, _) = match current_identity() {
        Ok(identity) => identity,
        Err(status) => {
            return Ok(CreditResult {
                request_status: Some(status),
                ..Default::default()
            })
        }
    };
    // Serialize remote work. Overlapping calls re-read the cache after obtaining this lock.
    let mut service = SERVICE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Credits service lock failed.")?;
    if current_identity()?.0 != identity || !is_active(scope, revision) {
        return Ok(CreditResult::default());
    }
    #[cfg(debug_assertions)]
    let is_mock = demo_enabled();
    #[cfg(not(debug_assertions))]
    let is_mock = false;
    let disk;
    let db = if is_mock {
        if service.mock_db.is_none() {
            let db = Connection::open_in_memory().map_err(|error| error.to_string())?;
            create_tables(&db)?;
            service.mock_db = Some(db);
        }
        service.mock_db.as_ref().unwrap()
    } else {
        disk = crate::db::open_database(database)?;
        &disk
    };
    let now = Utc::now().timestamp_millis();
    let mut result = CreditResult {
        identity: Some(identity.clone()),
        ..Default::default()
    };
    let cooldown: Option<(String, i64)> = db
        .query_row(
            "SELECT status,retry_at FROM session_credits_cooldown WHERE identity=?",
            [&identity],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let blocked = cooldown
        .as_ref()
        .is_some_and(|(status, until)| *until > now || (status == "forbidden" && !force));
    if blocked {
        let (status, until) = cooldown.unwrap();
        result.request_status = Some(status);
        result.retry_at = Some(until);
    }
    let mut pending = Vec::new();
    for thread in &threads {
        let cached = read_cached(db, &identity, thread, now, is_mock)?;
        let needs_query = cached.as_ref().is_none_or(|cached| {
            (force || (!fresh(cached, thread, now) && now - cached.last_attempt >= MIN_INTERVAL))
                && cached.last_attempt < started_at
        });
        if needs_query && !blocked && !cache_only {
            pending.push(thread.clone());
        }
    }
    let cache_hits = threads.len() - pending.len();
    for batch in pending.chunks(100) {
        if !is_active(scope, revision) {
            break;
        }
        if current_identity()?.0 != identity {
            return Ok(CreditResult::default());
        }
        let started = Instant::now();
        let ids = batch
            .iter()
            .map(|thread| thread.thread_id.as_str())
            .collect::<Vec<_>>();
        let response = request_with_reauth(&identity, &ids);
        // Never publish or store a response under a different account.
        if current_identity()?.0 != identity {
            return Ok(CreditResult::default());
        }
        let now = Utc::now().timestamp_millis();
        log::info!(
            "Session credits: batch={}, cache_hits={}, status={}, elapsed_ms={}",
            ids.len(),
            cache_hits,
            response
                .as_ref()
                .map_or_else(|error| error.http_status.unwrap_or(0), |_| 200),
            started.elapsed().as_millis()
        );
        match response {
            Ok(rows) => {
                db.execute(
                    "DELETE FROM session_credits_cooldown WHERE identity=?",
                    [&identity],
                )
                .map_err(|error| error.to_string())?;
                for thread in batch {
                    let row = rows
                        .iter()
                        .find(|row| row.thread_id == thread.thread_id)
                        .cloned()
                        .unwrap_or_else(|| empty_row(&thread.thread_id, now, is_mock));
                    write_row(db, &identity, thread, &row, now)?;
                }
            }
            Err(error) => {
                let retry_at = now.saturating_add(error.retry_ms.max(MIN_INTERVAL));
                db.execute(
                    "INSERT OR REPLACE INTO session_credits_cooldown VALUES (?,?,?)",
                    params![identity, error.status, retry_at],
                )
                .map_err(|error| error.to_string())?;
                for thread in batch {
                    if read_cached(db, &identity, thread, now, is_mock)?.is_none() {
                        write_row(
                            db,
                            &identity,
                            thread,
                            &empty_row(&thread.thread_id, now, is_mock),
                            now,
                        )?;
                    }
                    db.execute("UPDATE session_credits SET last_attempt_at=?,stale=1 WHERE identity=? AND thread_id=?", params![now, identity, thread.thread_id]).map_err(|error| error.to_string())?;
                }
                result.request_status = Some(error.status.into());
                result.retry_at = Some(retry_at);
                break;
            }
        }
    }
    if current_identity()?.0 != identity || !is_active(scope, revision) {
        return Ok(CreditResult::default());
    }
    for thread in &threads {
        if let Some(cached) = read_cached(
            db,
            &identity,
            thread,
            Utc::now().timestamp_millis(),
            is_mock,
        )? {
            result.rows.push(cached.row);
        }
    }
    Ok(result)
}

#[derive(Debug)]
struct RequestError {
    status: &'static str,
    http_status: Option<u16>,
    retry_ms: i64,
}
impl RequestError {
    fn invalid() -> Self {
        Self {
            status: "invalidResponse",
            http_status: Some(200),
            retry_ms: MIN_INTERVAL,
        }
    }
}

fn request_with_reauth(identity: &str, ids: &[&str]) -> Result<Vec<CreditRow>, RequestError> {
    for attempt in 0..2 {
        let (current, auth) = current_identity().map_err(|_| RequestError {
            status: "chatgptLoginRequired",
            http_status: None,
            retry_ms: MIN_INTERVAL,
        })?;
        if current != identity {
            return Err(RequestError {
                status: "identityChanged",
                http_status: None,
                retry_ms: MIN_INTERVAL,
            });
        }
        let response = request(auth.as_ref(), ids);
        if attempt == 0
            && response
                .as_ref()
                .is_err_and(|error| error.http_status == Some(401))
        {
            continue;
        }
        return response;
    }
    unreachable!()
}

fn request(auth: Option<&CodexAuth>, ids: &[&str]) -> Result<Vec<CreditRow>, RequestError> {
    #[cfg(debug_assertions)]
    if demo_enabled() {
        return parse_response(&demo_response(ids), ids, true);
    }
    let auth = auth.ok_or_else(RequestError::invalid)?;
    let endpoint = ENDPOINT.to_string();
    #[cfg(feature = "e2e")]
    let endpoint = std::env::var("CODEX_USAGE_SESSION_CREDITS_URL")
        .ok()
        .filter(|url| url.starts_with("http://127.0.0.1:"))
        .map(|base| {
            format!(
                "{}/backend-api/wham/usage/thread_usage/query_v2",
                base.trim_end_matches('/')
            )
        })
        .unwrap_or(endpoint);
    http_request(auth, ids, &endpoint, std::time::Duration::from_secs(30))
}

fn http_request(
    auth: &CodexAuth,
    ids: &[&str],
    endpoint: &str,
    timeout: std::time::Duration,
) -> Result<Vec<CreditRow>, RequestError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| RequestError {
            status: "networkError",
            http_status: None,
            retry_ms: MIN_INTERVAL,
        })?;
    let body = json!({"threads": ids.iter().map(|id| json!({"thread_id": id, "created_at": null, "descendant_thread_ids": []})).collect::<Vec<_>>()});
    let response = client
        .post(endpoint)
        .bearer_auth(&auth.access_token)
        .header(
            "ChatGPT-Account-Id",
            auth.account_id.as_deref().unwrap_or_default(),
        )
        .header("User-Agent", "codex-usage-desktop")
        .json(&body)
        .send()
        .map_err(|_| RequestError {
            status: "networkError",
            http_status: None,
            retry_ms: MIN_INTERVAL,
        })?;
    let status = response.status().as_u16();
    if status != 200 {
        let retry_ms = response
            .headers()
            .get("Retry-After")
            .and_then(|value| value.to_str().ok())
            .map(|value| retry_after(value, Utc::now().timestamp_millis()))
            .unwrap_or(MIN_INTERVAL);
        return Err(RequestError {
            status: match status {
                401 => "chatgptLoginRequired",
                403 => "forbidden",
                404 => "endpointUnavailable",
                429 => "rateLimited",
                _ => "serviceUnavailable",
            },
            http_status: Some(status),
            retry_ms,
        });
    }
    let body = response.text().map_err(|_| RequestError::invalid())?;
    parse_response(&body, ids, false)
}

fn retry_after(value: &str, now: i64) -> i64 {
    value
        .parse::<i64>()
        .ok()
        .and_then(|seconds| seconds.checked_mul(1000))
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(value)
                .ok()
                .map(|date| date.timestamp_millis().saturating_sub(now))
        })
        .unwrap_or(MIN_INTERVAL)
        .max(0)
}

#[derive(Deserialize)]
struct Response {
    data_as_of: Option<String>,
    threads: Vec<ResponseRow>,
}
#[derive(Deserialize)]
struct ResponseRow {
    thread_id: String,
    data_status: String,
    usage_source: String,
    balance_usage_credits: Option<String>,
    groups: Vec<Value>,
}

fn parse_response(body: &str, ids: &[&str], is_mock: bool) -> Result<Vec<CreditRow>, RequestError> {
    let response: Response = serde_json::from_str(body).map_err(|_| RequestError::invalid())?;
    if response
        .data_as_of
        .as_ref()
        .is_some_and(|date| chrono::DateTime::parse_from_rfc3339(date).is_err())
    {
        return Err(RequestError::invalid());
    }
    let mut seen = HashSet::new();
    let now = Utc::now().timestamp_millis();
    response
        .threads
        .into_iter()
        .map(|row| {
            if !ids.contains(&row.thread_id.as_str())
                || !seen.insert(row.thread_id.clone())
                || !["available", "partial", "unavailable"].contains(&row.data_status.as_str())
                || row
                    .balance_usage_credits
                    .as_ref()
                    .is_some_and(|value| !valid_decimal(value))
                || row.groups.iter().any(|group| {
                    !group.is_object()
                        || group.get("balance_usage_credits").is_some_and(|value| {
                            !value.is_null()
                                && value.as_str().is_none_or(|value| !valid_decimal(value))
                        })
                })
            {
                return Err(RequestError::invalid());
            }
            Ok(CreditRow {
                thread_id: row.thread_id,
                data_status: Some(row.data_status),
                balance_usage_credits: row.balance_usage_credits,
                usage_source: Some(row.usage_source),
                data_as_of: response.data_as_of.clone(),
                fetched_at: timestamp(now),
                stale: false,
                is_mock,
            })
        })
        .collect()
}

fn valid_decimal(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let unsigned = value.strip_prefix(['-', '+']).unwrap_or(value);
    let (mantissa, exponent) = unsigned.split_once(['e', 'E']).unwrap_or((unsigned, "0"));
    let mut dots = 0;
    mantissa.chars().any(|c| c.is_ascii_digit())
        && mantissa.chars().all(|c| {
            if c == '.' {
                dots += 1;
                dots <= 1
            } else {
                c.is_ascii_digit()
            }
        })
        && exponent.parse::<i32>().is_ok()
}

#[cfg(debug_assertions)]
fn demo_response(ids: &[&str]) -> String {
    let values = [
        Some("12.34"),
        Some("0E-10"),
        None,
        Some("3.14159"),
        Some("-2.5"),
        Some("1e-20"),
        Some("9.876543210123456789"),
    ];
    json!({"data_as_of": Utc::now().to_rfc3339(), "threads": ids.iter().filter_map(|id| {
        let index = uuid::Uuid::parse_str(id).unwrap().as_u128() as usize % 8;
        (index < 7).then(|| json!({"thread_id": id, "data_status": if index == 3 { "partial" } else { "available" },
            "usage_source": "credits", "balance_usage_credits": values.get(index).copied().flatten(), "groups": []}))
    }).collect::<Vec<_>>()}).to_string()
}

// Reset waits for any short HTTP request to finish before deleting its cache writes.
pub fn reset(database: &Path) -> Result<(), String> {
    if let Ok(mut scopes) = SCOPES.get_or_init(Default::default).lock() {
        for (_, active) in scopes.values_mut() {
            *active = false;
        }
    }
    let mut service = SERVICE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Credits service lock failed.")?;
    service.mock_db = None;
    let db = crate::db::open_database(database)?;
    crate::db::reset_usage_state(&db)
}

#[cfg(test)]
mod tests;
