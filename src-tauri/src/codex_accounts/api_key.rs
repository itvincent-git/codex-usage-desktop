use super::{native, storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use toml_edit::{value, DocumentMut};

pub(super) const DEFAULT_URL: &str = "https://api.openai.com/v1";

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct ConfigBackup {
    pub original: String,
    pub applied: String,
}

pub(super) fn credentials(name: &str, key: &str, base_url: &str) -> Result<Value, String> {
    let name = name.trim();
    let key = key.trim();
    if name.is_empty() || key.is_empty() || key.chars().any(char::is_whitespace) {
        return Err("accountApiKeyInvalid".into());
    }
    let base_url = normalize_url(base_url)?;
    Ok(json!({"auth_mode":"apikey", "OPENAI_API_KEY":key,
        "_codex_usage":{"name":name,"base_url":base_url}}))
}

fn normalize_url(input: &str) -> Result<String, String> {
    let input = input.trim();
    let url = reqwest::Url::parse(if input.is_empty() { DEFAULT_URL } else { input })
        .map_err(|_| "accountBaseUrlInvalid")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("accountBaseUrlInvalid".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

pub(super) fn is_api_key(credentials: &Value) -> bool {
    credentials["OPENAI_API_KEY"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty())
}

pub(super) fn base_url(credentials: &Value) -> Option<&str> {
    is_api_key(credentials).then(|| {
        credentials["_codex_usage"]["base_url"]
            .as_str()
            .unwrap_or(DEFAULT_URL)
    })
}

pub(super) fn identity(credentials: &Value) -> Option<super::Identity> {
    let base_url = base_url(credentials)?;
    Some(super::Identity {
        user_id: format!(
            "api-key:{}",
            storage::fingerprint(credentials["OPENAI_API_KEY"].as_str()?.trim().as_bytes())
        ),
        workspace_id: base_url.to_owned(),
    })
}

// Read the actual endpoint, including changes made outside this application.
pub(super) fn snapshot_content(snapshot: &native::Snapshot) -> Result<Option<String>, String> {
    let Some(content) = &snapshot.content else {
        return Ok(None);
    };
    let mut credentials: Value = serde_json::from_str(content).map_err(|_| "codexAuthInvalid")?;
    if is_api_key(&credentials) {
        let documents = native::config_documents(snapshot)?;
        let configs = documents
            .iter()
            .map(|doc| toml::from_str::<toml::Value>(doc).map_err(|_| "accountBackendUnsupported"))
            .collect::<Result<Vec<_>, _>>()?;
        let field = |key| {
            configs
                .iter()
                .find_map(|config| config.get(key).and_then(toml::Value::as_str))
        };
        if field("model_provider").is_some_and(|s| s != "openai") {
            return Err("accountBackendUnsupported".into());
        }
        let url = field("openai_base_url").unwrap_or(DEFAULT_URL);
        credentials["_codex_usage"]["base_url"] = normalize_url(url)?.into();
    }
    Ok(Some(credentials.to_string()))
}

pub(super) fn config_key(snapshot: &native::Snapshot) -> String {
    format!(
        "{}:{:?}",
        snapshot.environment.home.display(),
        snapshot.environment.runtime
    )
}

pub(super) fn switch_config(
    snapshot: &native::Snapshot,
    credentials: &Value,
    backup: Option<&ConfigBackup>,
) -> Result<(String, Option<ConfigBackup>), String> {
    let mut document = snapshot
        .user_config
        .parse::<DocumentMut>()
        .map_err(|_| "accountBackendUnsupported")?;
    let fields = ["model_provider", "openai_base_url"];
    if let Some(backup) = backup {
        let applied = backup
            .applied
            .parse::<DocumentMut>()
            .map_err(|_| "accountStorageInvalid")?;
        if fields.iter().any(|key| {
            document.get(key).map(ToString::to_string) != applied.get(key).map(ToString::to_string)
        }) {
            return Err("accountAuthConflict".into());
        }
    }
    if let Some(url) = base_url(credentials) {
        document["model_provider"] = value("openai");
        document["openai_base_url"] = value(url);
        let applied = document.to_string();
        Ok((
            applied.clone(),
            Some(ConfigBackup {
                original: backup
                    .map(|b| b.original.clone())
                    .unwrap_or_else(|| snapshot.user_config.clone()),
                applied,
            }),
        ))
    } else if let Some(backup) = backup {
        let original = backup
            .original
            .parse::<DocumentMut>()
            .map_err(|_| "accountStorageInvalid")?;
        for key in fields {
            if let Some(item) = original.get(key) {
                document[key] = item.clone();
            } else {
                document.remove(key);
            }
        }
        Ok((document.to_string(), None))
    } else {
        Ok((snapshot.user_config.clone(), None))
    }
}
