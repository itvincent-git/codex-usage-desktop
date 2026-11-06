use crate::codex_environment::selected_codex_environment;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use std::fs;

#[derive(Clone)]
pub(crate) struct CodexAuth {
    pub access_token: String,
    pub account_id: Option<String>,
    pub user_id: Option<String>,
    pub is_chatgpt: bool,
    pub credential_fingerprint: String,
}

impl std::fmt::Debug for CodexAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CodexAuth").field("account_id", &self.account_id).field("user_id", &self.user_id).finish_non_exhaustive()
    }
}

pub(crate) fn load_codex_auth() -> Result<CodexAuth, String> {
    let environment = selected_codex_environment();
    crate::codex_accounts::native::check_backend(&environment)?;
    let path = environment.home.join("auth.json");
    let content = read_auth_file(&path)?;
    parse_codex_auth(&content)
}

fn read_auth_file(path: &std::path::Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "chatgptLoginRequired".to_string(),
        _ => "codexAuthUnreadable".to_string(),
    })
}

pub(crate) fn parse_codex_auth(content: &str) -> Result<CodexAuth, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|_| "codexAuthInvalid".to_string())?;
    if let Some(api_key) = string_field(&value, "OPENAI_API_KEY") {
        return Ok(CodexAuth {
            access_token: api_key,
            account_id: None,
            user_id: None,
            is_chatgpt: false,
            credential_fingerprint: credential_fingerprint(content),
        });
    }
    let tokens = value
        .get("tokens")
        .ok_or("Codex auth.json contains no tokens.")?;
    let access_token = string_field(tokens, "access_token")
        .or_else(|| string_field(tokens, "accessToken"))
        .ok_or("Codex auth.json contains no access token.")?;
    // Claims identify the local credentials; the remote endpoint still authenticates the token.
    let claims = string_field(tokens, "id_token")
        .or_else(|| string_field(tokens, "idToken"))
        .and_then(|token| token.split('.').nth(1).map(str::to_owned))
        .and_then(|payload| URL_SAFE_NO_PAD.decode(payload).ok())
        .and_then(|payload| serde_json::from_slice::<Value>(&payload).ok());
    let auth_claims = claims
        .as_ref()
        .and_then(|claims| claims.get("https://api.openai.com/auth"));
    Ok(CodexAuth {
        access_token,
        credential_fingerprint: credential_fingerprint(content),
        account_id: string_field(tokens, "account_id")
            .or_else(|| string_field(tokens, "accountId"))
            .or_else(|| auth_claims.and_then(|claims| string_field(claims, "chatgpt_account_id"))),
        user_id: auth_claims.and_then(|claims| string_field(claims, "chatgpt_user_id")),
        is_chatgpt: value
            .get("auth_mode")
            .and_then(Value::as_str)
            .is_none_or(|mode| mode == "chatgpt"),
    })
}

fn credential_fingerprint(content: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn distinguishes_missing_unreadable_and_invalid_auth_without_exposing_contents() {
        let root = std::env::temp_dir().join(format!("auth-errors-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(read_auth_file(&root.join("missing")).unwrap_err(), "chatgptLoginRequired");
        assert_eq!(read_auth_file(&root).unwrap_err(), "codexAuthUnreadable");
        assert_eq!(parse_codex_auth("private invalid content").unwrap_err(), "codexAuthInvalid");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn chatgpt_identity_uses_both_account_and_user_claims() {
        let payload = URL_SAFE_NO_PAD.encode(
            json!({"https://api.openai.com/auth": {
                "chatgpt_account_id": "account", "chatgpt_user_id": "user"
            }})
            .to_string(),
        );
        let auth = parse_codex_auth(
            &json!({"auth_mode":"chatgpt","tokens":{
                "access_token":"secret", "id_token":format!("e30.{payload}.signature")
            }})
            .to_string(),
        )
        .unwrap();
        assert!(auth.is_chatgpt);
        assert_eq!(auth.account_id.as_deref(), Some("account"));
        assert_eq!(auth.user_id.as_deref(), Some("user"));
        let key = parse_codex_auth(r#"{"OPENAI_API_KEY":"key","auth_mode":"apikey"}"#).unwrap();
        assert!(!key.is_chatgpt);
        assert!(key.user_id.is_none());
    }
}
