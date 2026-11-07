pub(crate) mod login;
pub(crate) mod native;
mod storage;

use crate::{
    codex_auth::parse_codex_auth,
    codex_environment::{selected_codex_environment, CodexEnvironment, CodexRuntime},
    codex_limits,
    types::CodexLimitsResponse,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, OnceLock},
};
use tauri::Emitter;

static SERVICE: OnceLock<Arc<AccountService>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Identity {
    pub user_id: String,
    pub workspace_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    identity: Identity,
    email: Option<String>,
    credential_version: u64,
    credentials: Value,
    status: Option<AccountStatus>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountStatus {
    pub account_id: String,
    pub identity: Identity,
    pub credential_version: u64,
    pub data: Option<CodexLimitsResponse>,
    pub errors: HashMap<String, String>,
    pub updated_at: HashMap<String, String>,
    pub needs_login: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSummary {
    id: String,
    identity: Identity,
    email: Option<String>,
    credential_version: u64,
    current: bool,
    last_refresh: Option<String>,
    status: Option<AccountStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountList {
    accounts: Vec<AccountSummary>,
    environment: String,
    auth_context: Option<String>,
    current_identity: Option<Identity>,
    switch_error: Option<String>,
    recovery_conflict: bool,
    login_task: Option<login::LoginTask>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SwitchResult {
    pub verified: bool,
    pub restart_required: bool,
    pub auth_context: String,
}

#[derive(Default, Deserialize, Serialize)]
struct Store {
    #[serde(default)]
    accounts: Vec<Account>,
    pending: Option<Pending>,
    #[serde(default)]
    recovery_conflict: bool,
    #[serde(default)]
    removed_identities: Vec<String>,
    #[serde(default)]
    removal_revision: u64,
}

#[derive(Deserialize, Serialize)]
struct Pending {
    home: PathBuf,
    distribution: Option<String>,
    original: String,
    target: String,
}

pub(crate) struct AccountService {
    root: PathBuf,
    account_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    permits: Mutex<usize>,
    ready: Condvar,
    logins: Mutex<HashMap<String, Arc<Mutex<login::RunningLogin>>>>,
    flights: Mutex<HashMap<String, Arc<StatusFlight>>>,
}

#[derive(Default)]
struct StatusFlight {
    result: Mutex<Option<Result<AccountStatus, String>>>,
    ready: Condvar,
}

impl AccountService {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        storage::private_directory(&root)?;
        Ok(Self {
            root,
            account_locks: Mutex::new(HashMap::new()),
            permits: Mutex::new(0),
            ready: Condvar::new(),
            logins: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
        })
    }
    fn store(&self) -> Result<(std::fs::File, Store), String> {
        let guard = storage::lock(&self.root.join("accounts.lock"))?;
        let store = storage::read(&self.root.join("accounts.json"))?;
        Ok((guard, store))
    }
    fn save(&self, store: &Store) -> Result<(), String> {
        storage::save(&self.root.join("accounts.json"), store)
    }
    fn account(&self, id: &str) -> Result<Account, String> {
        self.store()?
            .1
            .accounts
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "accountRemoved".into())
    }
    fn account_lock(&self, id: &str) -> Arc<Mutex<()>> {
        self.account_locks
            .lock()
            .unwrap()
            .entry(id.to_owned())
            .or_default()
            .clone()
    }
    pub fn list(&self) -> Result<AccountList, String> {
        let environment = selected_codex_environment();
        let (snapshot, mut error) = match native::snapshot(&environment) {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(e)),
        };
        if let Some(content) = snapshot.as_ref().and_then(|s| s.content.as_deref()) {
            if let Err(e) = credential_identity(content) {
                error = Some(e);
            }
        }
        let current = snapshot
            .as_ref()
            .and_then(|s| s.content.as_deref())
            .and_then(|s| credential_identity(s).ok());
        let (_, store) = self.store()?;
        Ok(AccountList {
            accounts: store
                .accounts
                .into_iter()
                .map(|a| AccountSummary {
                    current: current.as_ref() == Some(&a.identity),
                    last_refresh: a.credentials["last_refresh"].as_str().map(str::to_owned),
                    id: a.id,
                    identity: a.identity,
                    email: a.email,
                    credential_version: a.credential_version,
                    status: a.status,
                })
                .collect(),
            environment: format!("{} ({:?})", environment.home.display(), environment.runtime),
            auth_context: snapshot.map(|s| s.context()),
            current_identity: current,
            switch_error: error,
            recovery_conflict: store.recovery_conflict,
            login_task: self.active_login(),
        })
    }
    pub fn import_current(&self) -> Result<String, String> {
        let _operation = native::AUTH_OPERATION.lock().unwrap();
        let snapshot = native::snapshot(&selected_codex_environment())?;
        let content = snapshot.content.ok_or("chatgptLoginRequired")?;
        self.upsert(&content, None)
    }
    fn upsert(&self, content: &str, expected: Option<(&str, u64)>) -> Result<String, String> {
        self.upsert_with_revision(content, expected, None)
    }

    fn upsert_with_revision(
        &self,
        content: &str,
        expected: Option<(&str, u64)>,
        removal_revision: Option<u64>,
    ) -> Result<String, String> {
        let identity = credential_identity(content)?;
        let credentials: Value = serde_json::from_str(content).map_err(|_| "codexAuthInvalid")?;
        let (_lock, mut store) = self.store()?;
        if removal_revision.is_some_and(|revision| revision != store.removal_revision) {
            return Err("accountAuthConflict".into());
        }
        store
            .removed_identities
            .retain(|key| key != &identity_key(&identity));
        if let Some((id, version)) = expected {
            let original = store
                .accounts
                .iter()
                .find(|a| a.id == id && a.credential_version == version)
                .ok_or("accountAuthConflict")?;
            if identity != original.identity {
                return Err("accountLoginIdentityMismatch".into());
            }
        }
        let id = if let Some(account) = store.accounts.iter_mut().find(|a| a.identity == identity) {
            account.credentials = credentials;
            account.email = credential_email(content);
            account.credential_version += 1;
            account.id.clone()
        } else {
            if expected.is_some() {
                return Err("accountRemoved".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            store.accounts.push(Account {
                id: id.clone(),
                identity,
                email: credential_email(content),
                credentials,
                credential_version: 1,
                status: None,
            });
            id
        };
        self.save(&store)?;
        Ok(id)
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let (_lock, mut store) = self.store()?;
        if let Some(account) = store.accounts.iter().find(|a| a.id == id) {
            store
                .removed_identities
                .push(identity_key(&account.identity));
        }
        store.removal_revision += 1;
        store.accounts.retain(|a| a.id != id);
        self.save(&store)
    }

    // Serial per account; global store/native commit locks never span HTTP.
    fn valid_account(&self, id: &str, force_refresh: bool) -> Result<Account, String> {
        self.valid_account_with(id, force_refresh, |credentials| {
            let environment = selected_codex_environment();
            if native::snapshot(&environment)
                .ok()
                .and_then(|s| s.content)
                .and_then(|s| credential_identity(&s).ok())
                == credential_identity(&credentials.to_string()).ok()
            {
                native::check_switch_protocol(&environment)?;
            }
            refresh_credentials(credentials)
        })
    }

    fn valid_account_with(
        &self,
        id: &str,
        force_refresh: bool,
        refresh: impl FnOnce(&Value) -> Result<Value, String>,
    ) -> Result<Account, String> {
        let mut account = self.account(id)?;
        let environment = selected_codex_environment();
        let snapshot = native::snapshot(&environment).ok();
        let live = snapshot.as_ref().and_then(|s| s.content.as_deref());
        if let Some(content) =
            live.filter(|s| credential_identity(s).ok().as_ref() == Some(&account.identity))
        {
            let credentials: Value =
                serde_json::from_str(content).map_err(|_| "codexAuthInvalid")?;
            if credentials != account.credentials {
                if can_adopt(&credentials, &account.credentials) {
                    let (_lock, mut store) = self.store()?;
                    let saved = current_version(&mut store, &account)?;
                    saved.credentials = credentials;
                    saved.credential_version += 1;
                    account = saved.clone();
                    self.save(&store)?;
                } else if refresh_time(&credentials).is_none()
                    || !can_adopt(&account.credentials, &credentials)
                {
                    return Err("accountAuthConflict".into());
                }
                // A newer saved login can coexist with the older Codex login.
            }
        }
        let expires = account.credentials["tokens"]["access_token"]
            .as_str()
            .and_then(jwt_claims)
            .and_then(|c| c["exp"].as_i64());
        if !force_refresh && expires.is_none_or(|e| e > Utc::now().timestamp() + 120) {
            return Ok(account);
        }
        let refreshed = refresh(&account.credentials)?;
        if credential_identity(&refreshed.to_string())? != account.identity {
            return Err("accountLoginIdentityMismatch".into());
        }
        let _operation = native::AUTH_OPERATION.lock().unwrap();
        let (_lock, mut store) = self.store()?;
        let saved = current_version(&mut store, &account)?;
        saved.credentials = refreshed;
        saved.credential_version += 1;
        let updated = saved.clone();
        // Persist the rotated bundle before reporting success or using it.
        let target =
            serde_json::to_string_pretty(&updated.credentials).map_err(|_| "codexAuthInvalid")?;
        let current = native::snapshot(&environment).ok();
        if let (Some(original), Some(current)) = (&snapshot, &current) {
            if live.is_some_and(|s| credential_identity(s).ok().as_ref() == Some(&account.identity))
            {
                if selected_codex_environment() != environment
                    || original.context() != current.context()
                {
                    self.save(&store)?;
                    return Err("accountAuthConflict".into());
                }
                store.pending = Some(pending(original, &target));
                self.save(&store)?;
                native::commit(original, &target)?;
                store.pending = None;
            }
        }
        self.save(&store)?;
        Ok(updated)
    }

    pub fn fetch_status(&self, id: &str) -> Result<AccountStatus, String> {
        let account = self.account(id)?;
        let key = format!("{}:{}", id, account.credential_version);
        let (flight, fetch) = {
            let mut flights = self.flights.lock().unwrap();
            if let Some(flight) = flights.get(&key) {
                (flight.clone(), false)
            } else {
                let flight = Arc::new(StatusFlight::default());
                flights.insert(key.clone(), flight.clone());
                (flight, true)
            }
        };
        if !fetch {
            let mut result = flight.result.lock().unwrap();
            while result.is_none() {
                result = flight.ready.wait(result).unwrap();
            }
            return result.as_ref().unwrap().clone();
        }
        let result = self.fetch_status_once(id);
        *flight.result.lock().unwrap() = Some(result.clone());
        flight.ready.notify_all();
        self.flights.lock().unwrap().remove(&key);
        result
    }

    fn fetch_status_once(&self, id: &str) -> Result<AccountStatus, String> {
        let lock = self.account_lock(id);
        let _account_guard = lock.lock().unwrap();
        let mut permits = self.permits.lock().unwrap();
        while *permits >= 3 {
            permits = self.ready.wait(permits).unwrap();
        }
        *permits += 1;
        drop(permits);
        let result = self.fetch_status_inner(id);
        *self.permits.lock().unwrap() -= 1;
        self.ready.notify_one();
        result
    }
    fn fetch_status_inner(&self, id: &str) -> Result<AccountStatus, String> {
        let original = self.account(id)?;
        let mut account = match self.valid_account(id, false) {
            Ok(a) => a,
            Err(error) => return self.save_status_error(&original, error),
        };
        let auth = parse_codex_auth(&account.credentials.to_string())?;
        let (mut data, mut errors) = codex_limits::fetch_account_parts(&auth);
        if errors.values().any(|e| e == "accountUnauthorized") {
            // First adopt a rotation written by Codex or a newer local generation.
            let latest = self.valid_account(id, false)?;
            account = if latest.credential_version != account.credential_version {
                latest
            } else {
                match self.valid_account(id, true) {
                    Ok(a) => a,
                    Err(e) => return self.save_status_error(&account, e),
                }
            };
            (data, errors) = codex_limits::fetch_account_parts(&parse_codex_auth(
                &account.credentials.to_string(),
            )?);
        }
        let mut updated_at = account
            .status
            .as_ref()
            .map(|s| s.updated_at.clone())
            .unwrap_or_default();
        if let Some(old) = account.status.as_ref().and_then(|s| s.data.as_ref()) {
            if errors.contains_key("limits") {
                data.membership_level = old.membership_level.clone();
                data.session = old.session.clone();
                data.weekly = old.weekly.clone();
                data.credits = old.credits.clone();
            }
            if errors.contains_key("subscription") {
                data.workspace_name = old.workspace_name.clone();
                data.subscription_expires_at = old.subscription_expires_at.clone();
                data.subscription_will_renew = old.subscription_will_renew;
                data.subscription_active = old.subscription_active;
            }
            if errors.contains_key("resetCredits") {
                data.reset_credits = old.reset_credits.clone();
                data.reset_credits_available_count = old.reset_credits_available_count;
            }
        }
        for part in ["limits", "subscription", "resetCredits"] {
            if !errors.contains_key(part) {
                updated_at.insert(part.into(), Utc::now().to_rfc3339());
            }
        }
        let needs_login = errors.values().any(|e| e == "accountUnauthorized");
        let status = AccountStatus {
            account_id: id.into(),
            identity: account.identity.clone(),
            credential_version: account.credential_version,
            data: Some(data),
            errors,
            updated_at,
            needs_login,
        };
        self.commit_status(&account, status)
    }
    fn save_status_error(&self, account: &Account, error: String) -> Result<AccountStatus, String> {
        let mut status = account.status.clone().unwrap_or(AccountStatus {
            account_id: account.id.clone(),
            identity: account.identity.clone(),
            credential_version: account.credential_version,
            data: None,
            errors: HashMap::new(),
            updated_at: HashMap::new(),
            needs_login: false,
        });
        status.credential_version = account.credential_version;
        status.needs_login = error == "accountLoginRequired";
        status.errors.insert("credentials".into(), error);
        self.commit_status(account, status)
    }
    fn commit_status(
        &self,
        account: &Account,
        status: AccountStatus,
    ) -> Result<AccountStatus, String> {
        let (_lock, mut store) = self.store()?;
        current_version(&mut store, account)?.status = Some(status.clone());
        self.save(&store)?;
        Ok(status)
    }
    pub fn switch(&self, id: &str, expected_context: &str) -> Result<SwitchResult, String> {
        let environment = selected_codex_environment();
        // Unit tests exercise the file protocol using isolated fixtures; the
        // application always verifies the CLI for this captured environment.
        #[cfg(not(test))]
        native::check_switch_protocol(&environment)?;
        let original = native::snapshot(&environment)?;
        if original.context() != expected_context {
            return Err("accountAuthConflict".into());
        }
        if let Some(content) = original.content.as_deref() {
            credential_identity(content)?;
        }
        let lock = self.account_lock(id);
        let target = {
            let _guard = lock.lock().unwrap();
            self.valid_account(id, false)?
        };
        native::check_workspace(&original, &target.identity.workspace_id)?;
        let _operation = native::AUTH_OPERATION.lock().unwrap();
        if selected_codex_environment() != environment {
            return Err("accountAuthConflict".into());
        }
        let (_lock, mut store) = self.store()?;
        current_version(&mut store, &target)?;
        if native::snapshot(&environment)?.context() != original.context() {
            return Err("accountAuthConflict".into());
        }
        if let Some(content) = &original.content {
            let identity = credential_identity(content)?;
            let credentials: Value =
                serde_json::from_str(content).map_err(|_| "codexAuthInvalid")?;
            if let Some(account) = store.accounts.iter_mut().find(|a| a.identity == identity) {
                if account.credentials != credentials {
                    if can_adopt(&credentials, &account.credentials) {
                        account.credentials = credentials;
                        account.credential_version += 1;
                    } else if refresh_time(&credentials).is_none()
                        || !can_adopt(&account.credentials, &credentials)
                    {
                        return Err("accountAuthConflict".into());
                    }
                }
            } else if !store.removed_identities.contains(&identity_key(&identity)) {
                store.accounts.push(Account {
                    id: uuid::Uuid::new_v4().to_string(),
                    identity,
                    email: credential_email(content),
                    credential_version: 1,
                    credentials,
                    status: None,
                });
            }
        }
        let content =
            serde_json::to_string_pretty(&target.credentials).map_err(|_| "codexAuthInvalid")?;
        store.pending = Some(pending(&original, &content));
        self.save(&store)?;
        crate::session_credits::invalidate_scopes();
        native::commit(&original, &content)?;
        let verified = native::snapshot(&environment)?;
        if verified
            .content
            .as_deref()
            .and_then(|s| credential_identity(s).ok())
            .as_ref()
            != Some(&target.identity)
        {
            return Err("accountAuthConflict".into());
        }
        store.pending = None;
        self.save(&store)?;
        Ok(SwitchResult {
            verified: true,
            restart_required: true,
            auth_context: verified.context(),
        })
    }
    pub fn recover(&self) -> Result<(), String> {
        let _operation = native::AUTH_OPERATION.lock().unwrap();
        let (_lock, mut store) = self.store()?;
        let Some(record) = &store.pending else {
            return Ok(());
        };
        let environment = CodexEnvironment {
            home: record.home.clone(),
            runtime: record
                .distribution
                .clone()
                .map(|distribution| CodexRuntime::Wsl { distribution })
                .unwrap_or(CodexRuntime::Native),
        };
        let snapshot = native::snapshot(&environment);
        let hash = snapshot.map(|s| s.credential_hash()).unwrap_or_default();
        // Recovery never replays a credential write. Both interrupted-before and
        // interrupted-after are safe terminal states; external writes win.
        store.recovery_conflict = hash != record.original && hash != record.target;
        store.pending = None;
        self.save(&store)
    }
    pub fn refresh_all(self: &Arc<Self>) {
        let Ok((_, store)) = self.store() else {
            return;
        };
        let ids: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(
            store.accounts.into_iter().map(|a| a.id).collect(),
        ));
        std::thread::scope(|scope| {
            for _ in 0..3 {
                let ids = ids.clone();
                scope.spawn(move || loop {
                    let id = ids.lock().unwrap().pop();
                    let Some(id) = id else {
                        break;
                    };
                    let _ = self.fetch_status(&id);
                });
            }
        });
    }
}

fn identity_key(identity: &Identity) -> String {
    storage::fingerprint(serde_json::to_string(identity).unwrap().as_bytes())
}

fn current_version<'a>(
    store: &'a mut Store,
    expected: &Account,
) -> Result<&'a mut Account, String> {
    store
        .accounts
        .iter_mut()
        .find(|a| a.id == expected.id && a.credential_version == expected.credential_version)
        .ok_or_else(|| "accountAuthConflict".into())
}
fn pending(snapshot: &native::Snapshot, target: &str) -> Pending {
    Pending {
        home: snapshot.environment.home.clone(),
        distribution: match &snapshot.environment.runtime {
            CodexRuntime::Native => None,
            CodexRuntime::Wsl { distribution } => Some(distribution.clone()),
        },
        original: snapshot.credential_hash(),
        target: storage::fingerprint(target.as_bytes()),
    }
}
fn can_adopt(live: &Value, saved: &Value) -> bool {
    let bundle = |v: &Value| {
        ["access_token", "refresh_token", "id_token"]
            .map(|k| v["tokens"][k].as_str().unwrap_or("").to_owned())
    };
    bundle(live) == bundle(saved)
        || refresh_time(live)
            .is_some_and(|time| refresh_time(saved).is_none_or(|previous| time > previous))
}
fn refresh_time(credentials: &Value) -> Option<chrono::DateTime<Utc>> {
    credentials["last_refresh"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc))
}
fn jwt_claims(token: &str) -> Option<Value> {
    URL_SAFE_NO_PAD
        .decode(token.split('.').nth(1)?)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}
fn credential_email(content: &str) -> Option<String> {
    let credentials: Value = serde_json::from_str(content).ok()?;
    let claims = jwt_claims(credentials["tokens"]["id_token"].as_str()?)?;
    claims["email"]
        .as_str()
        .or_else(|| claims["https://api.openai.com/profile"]["email"].as_str())
        .map(str::to_owned)
}
fn credential_identity(content: &str) -> Result<Identity, String> {
    let auth = parse_codex_auth(content)?;
    let value: Value = serde_json::from_str(content).map_err(|_| "codexAuthInvalid")?;
    if !auth.is_chatgpt
        || value["tokens"]["refresh_token"]
            .as_str()
            .is_none_or(str::is_empty)
        || value["tokens"]["id_token"]
            .as_str()
            .is_none_or(str::is_empty)
    {
        return Err("accountChatgptRequired".into());
    }
    Ok(Identity {
        user_id: auth.user_id.ok_or("identityUnavailable")?,
        workspace_id: auth.account_id.ok_or("identityUnavailable")?,
    })
}
fn refresh_credentials(credentials: &Value) -> Result<Value, String> {
    let refresh = credentials["tokens"]["refresh_token"]
        .as_str()
        .ok_or("accountLoginRequired")?;
    let default_client = "app_EMoamEEZ73f0CkXaXp7hrann";
    let provenance = &credentials["tokens"]["oauth_provenance"];
    let client_id = if provenance.is_null() {
        default_client
    } else {
        if provenance["issuer"]
            .as_str()
            .map(|s| s.trim_end_matches('/'))
            != Some("https://auth.openai.com")
        {
            return Err("accountLoginRequired".into());
        }
        provenance["client_id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("accountLoginRequired")?
    };
    let request = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(45)).build().map_err(|_| "accountNetworkError")?
        .post(codex_limits::account_endpoint("https://auth.openai.com/oauth/token"))
        .json(&serde_json::json!({"grant_type":"refresh_token", "refresh_token":refresh, "client_id":client_id}));
    let auth = parse_codex_auth(&credentials.to_string())?;
    let response =
        codex_limits::send_account_request(request, &auth, "tokenRefresh").map_err(|error| {
            if [
                "accountUnauthorized",
                "accountHttpError:400",
                "accountHttpError:403",
            ]
            .contains(&error.as_str())
            {
                "accountLoginRequired".into()
            } else {
                error
            }
        })?;
    let response: Value = response.json().map_err(|_| "accountResponseInvalid")?;
    let mut next = credentials.clone();
    if response["access_token"].as_str().is_none_or(str::is_empty) {
        return Err("accountResponseInvalid".into());
    }
    for key in ["access_token", "refresh_token", "id_token"] {
        if let Some(token) = response[key].as_str().filter(|s| !s.is_empty()) {
            next["tokens"][key] = token.into();
        }
    }
    next["last_refresh"] = Utc::now().to_rfc3339().into();
    Ok(next)
}

pub(crate) fn initialize(root: PathBuf) -> Result<Arc<AccountService>, String> {
    let service = Arc::new(AccountService::new(root)?);
    if service.recover().is_err() {
        log::warn!("Account recovery unavailable; native authentication was preserved.");
    }
    let _ = SERVICE.set(service.clone());
    Ok(service)
}
pub(crate) fn refresh_managed_current() -> Result<(), String> {
    let Some(service) = SERVICE.get() else {
        return Ok(());
    };
    let snapshot = native::snapshot(&selected_codex_environment())?;
    let Some(identity) = snapshot
        .content
        .as_deref()
        .and_then(|s| credential_identity(s).ok())
    else {
        return Ok(());
    };
    let Ok((_, store)) = service.store() else {
        return Ok(());
    };
    let Some(account) = store.accounts.iter().find(|a| a.identity == identity) else {
        return Ok(());
    };
    let lock = service.account_lock(&account.id);
    let _guard = lock.lock().unwrap();
    service.valid_account(&account.id, false).map(|_| ())
}

pub(crate) fn refresh_current_after_unauthorized(
    original: &native::Snapshot,
) -> Result<bool, String> {
    let Some(service) = SERVICE.get() else {
        return Ok(false);
    };
    if selected_codex_environment() != original.environment {
        return Err("accountAuthConflict".into());
    }
    let current = native::snapshot(&original.environment)?;
    let identity = original
        .content
        .as_deref()
        .and_then(|s| credential_identity(s).ok());
    if identity.is_none()
        || current
            .content
            .as_deref()
            .and_then(|s| credential_identity(s).ok())
            != identity
    {
        return Err("accountAuthConflict".into());
    }
    let (_, store) = service.store()?;
    let Some(account) = store
        .accounts
        .iter()
        .find(|a| Some(&a.identity) == identity.as_ref())
    else {
        return Ok(false);
    };
    let lock = service.account_lock(&account.id);
    let _guard = lock.lock().unwrap();
    service.valid_account(&account.id, current.context() == original.context())?;
    Ok(true)
}

pub(crate) fn changed(app: &tauri::AppHandle) {
    let _ = app.emit("codex-accounts-changed", ());
}

#[tauri::command]
pub(crate) async fn list_codex_accounts(
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountList, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = service.list()?;
        if list.switch_error.is_none() {
            list.switch_error = native::check_switch_protocol(&selected_codex_environment()).err();
        }
        Ok(list)
    })
    .await
    .map_err(|_| "accountTaskFailed")?
}
#[tauri::command]
pub(crate) async fn import_current_codex_account(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<String, String> {
    let service = service.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || service.import_current())
        .await
        .map_err(|_| "accountTaskFailed")??;
    changed(&app);
    Ok(result)
}
#[tauri::command]
pub(crate) async fn fetch_codex_account_status(
    service: tauri::State<'_, Arc<AccountService>>,
    account_id: String,
) -> Result<AccountStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.fetch_status(&account_id))
        .await
        .map_err(|_| "accountTaskFailed")?
}
#[tauri::command]
pub(crate) async fn switch_codex_account(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
    account_id: String,
    expected_auth_context: String,
) -> Result<SwitchResult, String> {
    let service = service.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        service.switch(&account_id, &expected_auth_context)
    })
    .await
    .map_err(|_| "accountTaskFailed")??;
    changed(&app);
    Ok(result)
}
#[tauri::command]
pub(crate) async fn remove_codex_account(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
    account_id: String,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.remove(&account_id))
        .await
        .map_err(|_| "accountTaskFailed")??;
    changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests;

#[tauri::command]
pub(crate) async fn current_codex_auth_context() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        native::snapshot(&selected_codex_environment()).map(|s| s.context())
    })
    .await
    .map_err(|_| "accountTaskFailed")?
}
