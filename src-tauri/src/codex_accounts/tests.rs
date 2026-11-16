use super::*;
use serde_json::json;

static ENVIRONMENT_TEST: Mutex<()> = Mutex::new(());

struct Fixture {
    root: PathBuf,
    service: AccountService,
    environment: CodexEnvironment,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("codex-accounts-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("codex")).unwrap();
        let service = AccountService::new(root.join("private")).unwrap();
        let environment = CodexEnvironment {
            home: root.join("codex"),
            runtime: CodexRuntime::Native,
        };
        Self {
            root,
            service,
            environment,
        }
    }
    fn live(&self, value: &Value) {
        fs::write(self.environment.home.join("auth.json"), value.to_string()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn credentials(user: &str, workspace: &str, generation: u32) -> Value {
    let claims = json!({"email":format!("{user}@example.test"), "exp":4102444800_i64, "https://api.openai.com/auth":{"chatgpt_user_id":user,"chatgpt_account_id":workspace}});
    let token = format!(
        "e30.{}.signature",
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    json!({"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"access_token":token,"id_token":token,"refresh_token":format!("private-refresh-{user}-{generation}"),"account_id":workspace,"future_token_field":{"preserve":true}},"last_refresh":format!("2026-11-06T00:00:{generation:02}Z"),"unknown_native_field":[1,2,3]})
}

#[test]
fn identities_include_user_and_workspace_and_relogin_preserves_full_document() {
    let f = Fixture::new();
    let a = f
        .service
        .upsert(&credentials("a", "shared", 1).to_string(), None)
        .unwrap();
    let b = f
        .service
        .upsert(&credentials("b", "shared", 1).to_string(), None)
        .unwrap();
    let c = f
        .service
        .upsert(&credentials("a", "other", 1).to_string(), None)
        .unwrap();
    assert_ne!(a, b);
    assert_ne!(a, c);
    let next = credentials("a", "shared", 2);
    assert_eq!(
        f.service.upsert(&next.to_string(), Some((&a, 1))).unwrap(),
        a
    );
    let account = f.service.account(&a).unwrap();
    assert_eq!(account.credentials, next);
    assert_eq!(account.credential_version, 2);
    assert_eq!(f.service.store().unwrap().1.accounts.len(), 3);
    assert_eq!(
        f.service
            .upsert(&credentials("b", "shared", 2).to_string(), Some((&a, 2)))
            .unwrap_err(),
        "accountLoginIdentityMismatch"
    );
    assert_eq!(f.service.account(&a).unwrap().credentials, next);
}

#[test]
fn deletion_and_relogin_invalidate_late_writers() {
    let f = Fixture::new();
    let doc = credentials("a", "a", 1);
    let id = f.service.upsert(&doc.to_string(), None).unwrap();
    let original = f.service.account(&id).unwrap();
    let removal_revision = f.service.store().unwrap().1.removal_revision;
    f.service
        .upsert(&credentials("a", "a", 2).to_string(), Some((&id, 1)))
        .unwrap();
    assert_eq!(
        f.service
            .save_status_error(&original, "late error".into())
            .err()
            .as_deref(),
        Some("accountAuthConflict")
    );
    f.service.remove(&id).unwrap();
    assert!(f.service.upsert(&doc.to_string(), Some((&id, 2))).is_err());
    assert!(f
        .service
        .save_status_error(&original, "late error".into())
        .is_err());
    assert!(f.service.store().unwrap().1.accounts.is_empty());
    assert!(f
        .service
        .upsert_with_revision(&doc.to_string(), None, Some(removal_revision))
        .is_err());
}

#[test]
fn native_commit_detects_external_changes_and_preserves_configuration() {
    let f = Fixture::new();
    let config = "# preserve byte for byte\nmodel = 'gpt-test'\nmodel_reasoning_effort = 'high'\n[mcp_servers.example]\ncommand = 'example'\n";
    fs::write(f.environment.home.join("config.toml"), config).unwrap();
    f.live(&credentials("a", "a", 1));
    let original = native::snapshot(&f.environment).unwrap();
    let external = credentials("a", "a", 2);
    f.live(&external);
    assert_eq!(
        native::commit(&original, &credentials("b", "b", 1).to_string()).unwrap_err(),
        "accountAuthConflict"
    );
    assert_eq!(
        serde_json::from_str::<Value>(
            &fs::read_to_string(f.environment.home.join("auth.json")).unwrap()
        )
        .unwrap(),
        external
    );
    assert_eq!(
        fs::read_to_string(f.environment.home.join("config.toml")).unwrap(),
        config
    );
    let current = native::snapshot(&f.environment).unwrap();
    fs::write(
        f.environment.home.join("config.toml"),
        "cli_auth_credentials_store='auto'\n",
    )
    .unwrap();
    assert!(native::commit(&current, "{}").is_err());
}

#[test]
fn unsupported_backends_and_restrictions_fail_closed() {
    for config in [
        "cli_auth_credentials_store='auto'",
        "cli_auth_credentials_store='keyring'",
        "cli_auth_credentials_store='ephemeral'",
        "forced_login_method='invalid'",
        "[profiles.work]\ncli_auth_credentials_store='file'",
        "profile='work'",
        "this is not toml",
    ] {
        assert!(native::validate_config(config).is_err(), "{config}");
    }
    native::validate_config("cli_auth_credentials_store='file'\nforced_login_method='chatgpt'\n")
        .unwrap();
    let f = Fixture::new();
    fs::write(
        f.environment.home.join("config.toml"),
        "forced_chatgpt_workspace_id=['allowed']",
    )
    .unwrap();
    let snapshot = native::snapshot(&f.environment).unwrap();
    native::check_workspace(&snapshot, "allowed").unwrap();
    assert!(native::check_workspace(&snapshot, "other").is_err());
    assert_eq!(
        credential_identity(r#"{"OPENAI_API_KEY":"private-key"}"#)
            .unwrap()
            .workspace_id,
        api_key::DEFAULT_URL
    );
}

#[test]
fn switch_roundtrip_keeps_complete_credentials_and_model_config() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    let a = credentials("a", "shared", 1);
    let b = credentials("b", "shared", 1);
    f.live(&a);
    let config =
        "model='unchanged'\nmodel_reasoning_effort='xhigh'\n[mcp_servers.keep]\ncommand='keep'\n";
    fs::write(f.environment.home.join("config.toml"), config).unwrap();
    let a_id = f.service.import_current().unwrap();
    let b_id = f.service.upsert(&b.to_string(), None).unwrap();
    let context = native::snapshot(&f.environment).unwrap().context();
    assert!(f.service.switch(&b_id, &context).unwrap().restart_required);
    assert_eq!(
        serde_json::from_str::<Value>(
            &fs::read_to_string(f.environment.home.join("auth.json")).unwrap()
        )
        .unwrap(),
        b
    );
    assert_eq!(
        f.service.switch(&a_id, &context).err().as_deref(),
        Some("accountAuthConflict")
    );
    let context = native::snapshot(&f.environment).unwrap().context();
    f.service.switch(&a_id, &context).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(
            &fs::read_to_string(f.environment.home.join("auth.json")).unwrap()
        )
        .unwrap(),
        a
    );
    assert_eq!(
        fs::read_to_string(f.environment.home.join("config.toml")).unwrap(),
        config
    );
    let list = serde_json::to_string(&f.service.list().unwrap()).unwrap();
    assert!(!list.contains("private-refresh"));
    assert!(!list.contains("access_token"));
    assert!(!list.contains("unknown_native_field"));
    f.service.remove(&a_id).unwrap();
    assert_eq!(
        fs::read_to_string(f.environment.home.join("auth.json")).unwrap(),
        serde_json::to_string_pretty(&a).unwrap()
    );
    // A later switch must not automatically import the explicitly removed login.
    let context = native::snapshot(&f.environment).unwrap().context();
    f.service.switch(&b_id, &context).unwrap();
    assert_eq!(f.service.store().unwrap().1.accounts.len(), 1);
    assert!(f.service.account(&a_id).is_err());
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[cfg(unix)]
#[test]
fn distribution_helper_preserves_external_writes_and_matches_native_lock_files() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    fn invoke(request: Value) -> (bool, Value) {
        let mut child = Command::new("python3")
            .args(["-c", include_str!("wsl_auth.py")])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(request.to_string().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            !output.stdout.is_empty(),
            "helper could not run: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        (
            output.status.success(),
            serde_json::from_slice(&output.stdout).unwrap(),
        )
    }
    let f = Fixture::new();
    f.live(&credentials("a", "a", 1));
    let (ok, snapshot) = invoke(json!({"operation":"read", "home":f.environment.home}));
    assert!(ok);
    let target = credentials("b", "b", 1).to_string();
    let request = json!({"operation":"commit","home":f.environment.home,"expected":snapshot["content"],"path":snapshot["path"],"config":snapshot["config"],"configPath":snapshot["configPath"],"target":target});
    let external = credentials("external", "external", 2).to_string();
    fs::write(f.environment.home.join("auth.json"), &external).unwrap();
    let (ok, error) = invoke(request);
    assert!(!ok);
    assert_eq!(error["error"], "accountAuthConflict");
    assert_eq!(
        fs::read_to_string(f.environment.home.join("auth.json")).unwrap(),
        external
    );
    let (_, snapshot) = invoke(json!({"operation":"read", "home":f.environment.home}));
    let target_config =
        "model_provider='openai'\nopenai_base_url='https://gateway.example.test/v1'\n";
    let (ok, _) = invoke(
        json!({"operation":"commit","home":f.environment.home,"expected":snapshot["content"],"path":snapshot["path"],"config":snapshot["config"],"configPath":snapshot["configPath"],"target":target,"targetConfig":target_config}),
    );
    assert!(ok);
    assert_eq!(
        fs::read_to_string(f.environment.home.join("auth.json")).unwrap(),
        target
    );
    assert_eq!(
        fs::read_to_string(f.environment.home.join("config.toml")).unwrap(),
        target_config
    );
    assert!(f.environment.home.join("config.toml.lock").exists());
    assert!(f.environment.home.join("auth.lock").exists());
    assert!(f.environment.home.join("auth.json.lock").exists());
}

#[test]
fn recovery_never_replays_over_an_external_write() {
    for outcome in ["original", "target", "external"] {
        let f = Fixture::new();
        f.live(&credentials("a", "a", 1));
        let original = native::snapshot(&f.environment).unwrap();
        let target = credentials("b", "b", 1).to_string();
        {
            let (_lock, mut store) = f.service.store().unwrap();
            store.pending = Some(pending(&original, &target));
            f.service.save(&store).unwrap();
        }
        match outcome {
            "target" => fs::write(f.environment.home.join("auth.json"), &target).unwrap(),
            "external" => f.live(&credentials("external", "external", 3)),
            _ => {}
        }
        let before = fs::read(f.environment.home.join("auth.json")).unwrap();
        f.service.recover().unwrap();
        assert_eq!(
            fs::read(f.environment.home.join("auth.json")).unwrap(),
            before
        );
        let (_, store) = f.service.store().unwrap();
        assert!(store.pending.is_none());
        assert_eq!(store.recovery_conflict, outcome == "external");
    }
}

#[test]
fn equal_or_missing_refresh_times_cannot_authorize_overwriting_a_rotated_bundle() {
    let a = credentials("a", "a", 1);
    let newer = credentials("a", "a", 2);
    assert!(can_adopt(&newer, &a));
    assert!(!can_adopt(&a, &newer));
    let mut ambiguous = newer.clone();
    ambiguous["last_refresh"] = a["last_refresh"].clone();
    assert!(!can_adopt(&ambiguous, &a));
    ambiguous["tokens"] = a["tokens"].clone();
    ambiguous["new_field"] = true.into();
    assert!(can_adopt(&ambiguous, &a));
}

#[test]
fn readded_current_account_keeps_newer_saved_credentials() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    let old = credentials("a", "a", 1);
    f.live(&old);
    let removed = f.service.import_current().unwrap();
    f.service.remove(&removed).unwrap();
    let newer = credentials("a", "a", 2);
    let id = f.service.upsert(&newer.to_string(), None).unwrap();
    let result = f
        .service
        .valid_account_with(&id, false, |_| panic!("New login is still valid"));
    // Restore the global environment before assertions, including on failure.
    crate::codex_environment::select_codex_home(Some(previous.home));
    assert_eq!(result.unwrap().credentials, newer);
    assert_eq!(f.service.account(&id).unwrap().credentials, newer);
    assert_eq!(
        fs::read_to_string(f.environment.home.join("auth.json")).unwrap(),
        old.to_string()
    );
}

#[test]
fn ambiguous_current_credentials_still_conflict() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    for timestamp in [Some("2026-11-06T00:00:01Z"), None, Some("invalid")] {
        let f = Fixture::new();
        crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
        let mut live = credentials("a", "a", 2);
        live["last_refresh"] = timestamp.into();
        f.live(&live);
        let id = f
            .service
            .upsert(&credentials("a", "a", 1).to_string(), None)
            .unwrap();
        let result = f.service.valid_account_with(&id, false, |_| {
            panic!("Ambiguous credentials must be rejected")
        });
        crate::codex_environment::select_codex_home(Some(previous.home.clone()));
        assert_eq!(result.err().as_deref(), Some("accountAuthConflict"));
    }
}

#[test]
fn refresh_persists_the_rotated_bundle_and_rejects_late_responses() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    let live = credentials("live", "live", 1);
    f.live(&live);
    let initial = credentials("saved", "shared", 1);
    let id = f.service.upsert(&initial.to_string(), None).unwrap();
    let rotated = credentials("saved", "shared", 2);
    let updated = f
        .service
        .valid_account_with(&id, true, |_| Ok(rotated.clone()))
        .unwrap();
    assert_eq!(updated.credentials, rotated);
    assert_eq!(f.service.account(&id).unwrap().credentials, rotated);
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(f.environment.home.join("auth.json")).unwrap())
            .unwrap(),
        live
    );
    let relogin = credentials("saved", "shared", 4);
    let result = f.service.valid_account_with(&id, true, |_| {
        f.service
            .upsert(
                &relogin.to_string(),
                Some((&id, updated.credential_version)),
            )
            .unwrap();
        Ok(credentials("saved", "shared", 3))
    });
    assert_eq!(result.err().as_deref(), Some("accountAuthConflict"));
    assert_eq!(f.service.account(&id).unwrap().credentials, relogin);
    let result = f.service.valid_account_with(&id, true, |_| {
        f.service.remove(&id).unwrap();
        Ok(credentials("saved", "shared", 5))
    });
    assert!(result.is_err());
    assert!(f.service.account(&id).is_err());
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[test]
fn current_account_adopts_codex_rotation_and_refresh_never_overwrites_external_auth() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    f.live(&credentials("a", "a", 1));
    let id = f.service.import_current().unwrap();
    let codex_rotation = credentials("a", "a", 2);
    f.live(&codex_rotation);
    let account = f
        .service
        .valid_account_with(&id, false, |_| panic!("Codex already refreshed the token"))
        .unwrap();
    assert_eq!(account.credentials, codex_rotation);
    let external = credentials("other", "other", 4);
    let result = f.service.valid_account_with(&id, true, |_| {
        f.live(&external);
        Ok(credentials("a", "a", 3))
    });
    assert!(result.is_err());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(f.environment.home.join("auth.json")).unwrap())
            .unwrap(),
        external
    );
    assert_eq!(
        f.service.account(&id).unwrap().credentials,
        credentials("a", "a", 3)
    );
    // A directory selection made during HTTP must also protect the old home.
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    let original = credentials("a", "a", 1);
    f.live(&original);
    let id = f.service.import_current().unwrap();
    let other_home = f.root.join("other-home");
    fs::create_dir(&other_home).unwrap();
    assert!(f
        .service
        .valid_account_with(&id, true, |_| {
            crate::codex_environment::select_codex_home(Some(other_home));
            Ok(credentials("a", "a", 2))
        })
        .is_err());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(f.environment.home.join("auth.json")).unwrap())
            .unwrap(),
        original
    );
    assert_eq!(
        f.service.account(&id).unwrap().credentials,
        credentials("a", "a", 2)
    );
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[test]
fn auth_sidecar_locks_block_commit_until_released() {
    let f = Fixture::new();
    f.live(&credentials("a", "a", 1));
    let snapshot = native::snapshot(&f.environment).unwrap();
    let outer = storage::lock(&f.environment.home.join("auth.lock")).unwrap();
    let (started, received) = std::sync::mpsc::channel();
    let (done, result) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        done.send(native::commit(
            &snapshot,
            &credentials("b", "b", 1).to_string(),
        ))
        .unwrap();
    });
    received.recv().unwrap();
    assert!(result
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_err());
    drop(outer);
    result
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap()
        .unwrap();
    worker.join().unwrap();
}

#[cfg(windows)]
#[test]
fn windows_credentials_replace_existing_grants_and_stay_private_after_overwrite() {
    fn powershell(path: &std::path::Path, script: &str) {
        // PowerShell is only an independent ACL oracle, never an application backend.
        let output = crate::background_process::command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("CODEX_USAGE_TEST_ACL_PATH", path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Windows ACL check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let f = Fixture::new();
    let directory = f.root.join("accounts [private] O'Neil 用户");
    fs::create_dir_all(&directory).unwrap();
    let target = directory.join("credentials.json");
    fs::write(&target, "old credentials").unwrap();
    // Seed explicit grants as well as inherited permissions. Restricting storage
    // must remove both without relying on PowerShell's security module.
    powershell(
        &directory,
        r#"$ErrorActionPreference='Stop'
        $everyone=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($everyone,'FullControl','Allow')
        $acl=[System.IO.Directory]::GetAccessControl($env:CODEX_USAGE_TEST_ACL_PATH)
        $acl.AddAccessRule($rule)
        [System.IO.Directory]::SetAccessControl($env:CODEX_USAGE_TEST_ACL_PATH,$acl)
        $file=[System.IO.Path]::Combine($env:CODEX_USAGE_TEST_ACL_PATH,'credentials.json')
        $acl=[System.IO.File]::GetAccessControl($file)
        $acl.AddAccessRule($rule)
        [System.IO.File]::SetAccessControl($file,$acl)"#,
    );
    storage::private_directory(&directory).unwrap();
    storage::atomic_write(&target, b"first credentials").unwrap();
    storage::atomic_write(&target, b"rotated credentials").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"rotated credentials");
    powershell(
        &directory,
        r#"$ErrorActionPreference='Stop'
        $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $file=[System.IO.Path]::Combine($env:CODEX_USAGE_TEST_ACL_PATH,'credentials.json')
        $acls=@([System.IO.Directory]::GetAccessControl($env:CODEX_USAGE_TEST_ACL_PATH),[System.IO.File]::GetAccessControl($file))
        foreach ($acl in $acls) {
            if (!$acl.AreAccessRulesProtected) { throw 'ACL inheritance is enabled' }
            if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid) { throw 'Unexpected owner' }
            $rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])
            if ($rules.Count -ne 1) { throw 'Unexpected access rules' }
            $rule=$rules[0]
            if ($rule.IdentityReference -ne $sid -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected access grant' }
        }
        $directoryRule=$acls[0].GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])[0]
        if ($directoryRule.InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit') { throw 'Directory grant does not propagate to children' }
        $fileRule=$acls[1].GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])[0]
        if ($fileRule.InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]::None) { throw 'Unexpected file inheritance flags' }
        if ([System.IO.Directory]::GetFiles($env:CODEX_USAGE_TEST_ACL_PATH).Length -ne 1) { throw 'Temporary credentials were left behind' }"#,
    );
}

#[cfg(unix)]
#[test]
fn follows_auth_symlinks_and_uses_private_files() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let f = Fixture::new();
    let target = f.root.join("external-auth.json");
    fs::write(&target, credentials("a", "a", 1).to_string()).unwrap();
    symlink(&target, f.environment.home.join("auth.json")).unwrap();
    let original = native::snapshot(&f.environment).unwrap();
    assert_eq!(original.path, fs::canonicalize(&target).unwrap());
    let next = credentials("b", "b", 2).to_string();
    native::commit(&original, &next).unwrap();
    assert!(fs::symlink_metadata(f.environment.home.join("auth.json"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read_to_string(&target).unwrap(), next);
    assert!(target.with_extension("json.lock").exists());
    assert!(f.environment.home.join("auth.lock").exists());
    let id = f
        .service
        .upsert(&credentials("a", "a", 1).to_string(), None)
        .unwrap();
    assert!(!id.is_empty());
    assert_eq!(
        fs::metadata(&f.service.root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(f.service.root.join("accounts.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(target).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn api_keys_validate_normalize_and_never_expose_secrets_in_summaries() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    for (name, key, url, error) in [
        ("", "secret", "", "accountApiKeyInvalid"),
        ("Name", "  ", "", "accountApiKeyInvalid"),
        ("Name", "has spaces", "", "accountApiKeyInvalid"),
        ("Name", "secret", "file:///tmp/key", "accountBaseUrlInvalid"),
        (
            "Name",
            "secret",
            "https://user:password@example.test/v1",
            "accountBaseUrlInvalid",
        ),
        (
            "Name",
            "secret",
            "https://example.test/v1?key=secret",
            "accountBaseUrlInvalid",
        ),
    ] {
        assert_eq!(f.service.add_api_key(name, key, url).unwrap_err(), error);
    }
    let id = f
        .service
        .add_api_key("Official", " private-api-key ", "")
        .unwrap();
    let other = f
        .service
        .add_api_key(
            "Gateway",
            "private-api-key",
            "https://gateway.example.test/v1/",
        )
        .unwrap();
    assert_ne!(id, other);
    assert_eq!(
        f.service
            .add_api_key(
                "Renamed",
                "private-api-key",
                "https://gateway.example.test/v1"
            )
            .unwrap(),
        other
    );
    assert_eq!(f.service.account(&other).unwrap().credential_version, 2);
    assert!(f
        .service
        .fetch_status(&id)
        .err()
        .is_some_and(|e| e == "accountApiKeyQuotaUnsupported"));
    let list = serde_json::to_string(&f.service.list().unwrap()).unwrap();
    assert!(!list.contains("private-api-key"));
    assert!(list.contains("apikey"));
    assert!(list.contains("Renamed"));
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[test]
fn switches_chatgpt_and_api_endpoints_preserving_unrelated_configuration() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    let original_auth = credentials("a", "shared", 1);
    f.live(&original_auth);
    let config_path = f.environment.home.join("config.toml");
    let original_config = "# keep comment\nmodel='unchanged'\nmodel_reasoning_effort='xhigh'\n[mcp_servers.keep]\ncommand='keep'\n";
    fs::write(&config_path, original_config).unwrap();
    let chatgpt = f.service.import_current().unwrap();
    let official = f
        .service
        .add_api_key("Official", "private-official-key", "")
        .unwrap();
    let gateway = f
        .service
        .add_api_key("Gateway", "private-gateway-key", "http://localhost:1234/v1")
        .unwrap();
    for (id, url) in [
        (&gateway, "http://localhost:1234/v1"),
        (&official, api_key::DEFAULT_URL),
    ] {
        let context = native::snapshot(&f.environment).unwrap().context();
        f.service.switch(id, &context).unwrap();
        let config: toml::Value =
            toml::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(config["openai_base_url"].as_str(), Some(url));
        assert_eq!(config["model_provider"].as_str(), Some("openai"));
        let list = f.service.list().unwrap();
        assert_eq!(list.accounts.iter().find(|a| a.current).unwrap().id, *id);
        assert_eq!(list.switch_error, None);
    }
    let context = native::snapshot(&f.environment).unwrap().context();
    f.service.switch(&chatgpt, &context).unwrap();
    assert_eq!(fs::read_to_string(&config_path).unwrap(), original_config);
    let restored: Value =
        serde_json::from_str(&fs::read_to_string(f.environment.home.join("auth.json")).unwrap())
            .unwrap();
    assert_eq!(restored, original_auth);
    // External endpoint edits must not be overwritten when restoring a backup.
    let context = native::snapshot(&f.environment).unwrap().context();
    f.service.switch(&gateway, &context).unwrap();
    let changed = fs::read_to_string(&config_path).unwrap().replace(
        "http://localhost:1234/v1",
        "https://external.example.test/v1",
    );
    fs::write(&config_path, &changed).unwrap();
    let context = native::snapshot(&f.environment).unwrap().context();
    assert_eq!(
        f.service.switch(&chatgpt, &context).err().as_deref(),
        Some("accountAuthConflict")
    );
    assert_eq!(fs::read_to_string(&config_path).unwrap(), changed);
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[test]
fn api_switch_respects_forced_login_and_workspace_restrictions() {
    let f = Fixture::new();
    let path = f.environment.home.join("config.toml");
    for config in [
        "forced_login_method='chatgpt'",
        "forced_chatgpt_workspace_id='workspace'",
    ] {
        fs::write(&path, config).unwrap();
        let snapshot = native::snapshot(&f.environment).unwrap();
        assert!(native::check_login(&snapshot, true).is_err());
        assert!(native::check_login(&snapshot, false).is_ok());
    }
    fs::write(&path, "forced_login_method='api'").unwrap();
    let snapshot = native::snapshot(&f.environment).unwrap();
    assert!(native::check_login(&snapshot, true).is_ok());
    assert!(native::check_login(&snapshot, false).is_err());
}

#[test]
fn api_config_restores_provider_fields_and_keeps_intervening_edits() {
    let f = Fixture::new();
    let path = f.environment.home.join("config.toml");
    let original = "# original\nmodel_provider = 'openai' # provider\nopenai_base_url = 'https://old.example.test/v1' # url\nmodel = 'before'\n[mcp_servers.keep]\ncommand = 'keep'\n";
    fs::write(&path, original).unwrap();
    let snapshot = native::snapshot(&f.environment).unwrap();
    let key =
        api_key::credentials("Gateway", "private-key", "https://gateway.example.test/v1").unwrap();
    let (applied, backup) = api_key::switch_config(&snapshot, &key, None).unwrap();
    fs::write(
        &path,
        applied.replace("model = 'before'", "model = 'after'"),
    )
    .unwrap();
    let snapshot = native::snapshot(&f.environment).unwrap();
    let (restored, backup) =
        api_key::switch_config(&snapshot, &credentials("a", "a", 1), backup.as_ref()).unwrap();
    assert!(backup.is_none());
    assert_eq!(
        restored,
        original.replace("model = 'before'", "model = 'after'")
    );
}

#[test]
fn api_import_reads_native_endpoint_without_metadata() {
    let _environment_guard = ENVIRONMENT_TEST.lock().unwrap();
    let previous = selected_codex_environment();
    let f = Fixture::new();
    crate::codex_environment::select_codex_home(Some(f.environment.home.clone()));
    f.live(&json!({"auth_mode":"apikey","OPENAI_API_KEY":"private-imported-key"}));
    fs::write(
        f.environment.home.join("config.toml"),
        "openai_base_url='https://gateway.example.test/v1/'",
    )
    .unwrap();
    let id = f.service.import_current().unwrap();
    let list = f.service.list().unwrap();
    let account = list.accounts.iter().find(|a| a.id == id).unwrap();
    assert!(account.current);
    assert_eq!(
        account.base_url.as_deref(),
        Some("https://gateway.example.test/v1")
    );
    assert_eq!(account.auth_mode, "apikey");
    assert!(!serde_json::to_string(&list)
        .unwrap()
        .contains("private-imported-key"));
    crate::codex_environment::select_codex_home(Some(previous.home));
}

#[test]
fn api_recovery_checks_both_files_and_restores_backup_after_completed_commit() {
    for outcome in ["before", "auth_only", "both"] {
        let f = Fixture::new();
        f.live(&credentials("a", "a", 1));
        let snapshot = native::snapshot(&f.environment).unwrap();
        let target =
            api_key::credentials("Gateway", "private-key", "https://gateway.example.test/v1")
                .unwrap();
        let (config, backup) = api_key::switch_config(&snapshot, &target, None).unwrap();
        let mut journal = pending(&snapshot, &target.to_string());
        let key = api_key::config_key(&snapshot);
        journal.config_key = Some(key.clone());
        journal.original_config = Some(storage::fingerprint(snapshot.user_config.as_bytes()));
        journal.target_config = Some(storage::fingerprint(config.as_bytes()));
        journal.next_backup = backup;
        {
            let (_lock, mut store) = f.service.store().unwrap();
            store.pending = Some(journal);
            f.service.save(&store).unwrap();
        }
        if outcome != "before" {
            f.live(&target);
        }
        if outcome == "both" {
            fs::write(&snapshot.config_path, &config).unwrap();
        }
        let auth_before = fs::read(&snapshot.path).unwrap();
        f.service.recover().unwrap();
        let (_, store) = f.service.store().unwrap();
        assert_eq!(store.recovery_conflict, outcome == "auth_only");
        assert_eq!(store.config_backups.contains_key(&key), outcome == "both");
        assert_eq!(fs::read(&snapshot.path).unwrap(), auth_before);
    }
}

#[test]
fn api_endpoint_uses_user_configuration_before_system_configuration() {
    let f = Fixture::new();
    let mut snapshot = native::snapshot(&f.environment).unwrap();
    // The WSL snapshot carries the same ordered user/system config documents.
    snapshot.environment.runtime = CodexRuntime::Wsl {
        distribution: "fixture".into(),
    };
    snapshot.content =
        Some(json!({"auth_mode":"apikey","OPENAI_API_KEY":"private-key"}).to_string());
    let system = "openai_base_url='https://system.example.test/v1'";
    for (user, expected) in [
        ("", "https://system.example.test/v1"),
        (
            "openai_base_url='https://user.example.test/v1'",
            "https://user.example.test/v1",
        ),
    ] {
        snapshot.config = json!([user, system]).to_string();
        let content = api_key::snapshot_content(&snapshot).unwrap().unwrap();
        assert_eq!(
            credential_identity(&content).unwrap().workspace_id,
            expected
        );
    }
}
