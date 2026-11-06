use super::storage;
use crate::codex_environment::{CodexEnvironment, CodexRuntime};
use serde_json::Value;
use std::{fs, path::PathBuf};

// Protocol verified against openai/codex dbaead0106de82bd129a4f6f503d173ad5109f68:
// auth.lock (read/modify/write), then resolved auth.json.lock (commit).
pub(crate) static AUTH_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(super) fn check_switch_protocol(environment: &CodexEnvironment) -> Result<(), String> {
    use std::{
        process::Stdio,
        time::{Duration, Instant},
    };
    let codex =
        crate::codex_limits::resolve_codex_command(environment).ok_or("accountCliMissing")?;
    let mut command =
        crate::codex_limits::codex_process_command(&codex, &std::env::temp_dir(), &["--version"]);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "accountCliUnsupported")?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if child.try_wait().ok().flatten().is_some() {
            let output = child
                .wait_with_output()
                .map_err(|_| "accountCliUnsupported")?;
            if output.status.success()
                && String::from_utf8_lossy(&output.stdout).trim() == "codex-cli 0.167.0"
            {
                return Ok(());
            }
            return Err("accountCliUnsupported".into());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("accountCliUnsupported".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[derive(Clone)]
pub(crate) struct Snapshot {
    pub environment: CodexEnvironment,
    pub content: Option<String>,
    pub config: String,
    pub path: PathBuf,
}

impl Snapshot {
    pub fn context(&self) -> String {
        storage::fingerprint(
            serde_json::json!([
                self.environment.home,
                format!("{:?}", self.environment.runtime),
                self.path,
                self.config,
                self.content
            ])
            .to_string()
            .as_bytes(),
        )
    }
    pub fn credential_hash(&self) -> String {
        storage::fingerprint(self.content.as_deref().unwrap_or("").as_bytes())
    }
}

pub(crate) fn check_backend(environment: &CodexEnvironment) -> Result<(), String> {
    if matches!(environment.runtime, CodexRuntime::Wsl { .. }) {
        snapshot(environment).map(|_| ())
    } else {
        read_config(environment).map(|_| ())
    }
}

fn read_config(environment: &CodexEnvironment) -> Result<String, String> {
    // Managed/requirement layers cannot safely be inferred from auth.json.
    check_managed_preferences()?;
    let system = system_directory()?;
    let paths = [
        environment.home.join("config.toml"),
        system.join("config.toml"),
    ];
    for path in [
        environment.home.join("managed_config.toml"),
        environment.home.join("requirements.toml"),
        system.join("managed_config.toml"),
        system.join("requirements.toml"),
    ] {
        if path.try_exists().map_err(|_| "accountBackendUnsupported")? {
            return Err("accountBackendUnsupported".into());
        }
    }
    let mut config = String::new();
    for path in paths {
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(_) => return Err("accountBackendUnsupported".into()),
        };
        validate_config(&text)?;
        config.push_str(&format!("{}:{text}\n", path.display()));
    }
    Ok(config)
}

#[cfg(not(windows))]
fn system_directory() -> Result<PathBuf, String> {
    Ok(PathBuf::from("/etc/codex"))
}

#[cfg(windows)]
fn system_directory() -> Result<PathBuf, String> {
    use std::process::Command;
    // Match Codex's CommonApplicationData known folder. Any policy namespace is
    // conservatively rejected, including a registry RequirementsPath override.
    let script = "$ErrorActionPreference='Stop'; if (Test-Path 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\OpenAI\\Codex') { exit 1 }; [Console]::Write([Environment]::GetFolderPath('CommonApplicationData'))";
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|_| "accountBackendUnsupported")?;
    if !output.status.success() {
        return Err("accountBackendUnsupported".into());
    }
    let path = String::from_utf8(output.stdout).map_err(|_| "accountBackendUnsupported")?;
    if path.trim().is_empty() {
        return Err("accountBackendUnsupported".into());
    }
    Ok(PathBuf::from(path.trim()).join("OpenAI").join("Codex"))
}

#[cfg(not(target_os = "macos"))]
fn check_managed_preferences() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn check_managed_preferences() -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            text: *const std::ffi::c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFPreferencesAppValueIsForced(key: *const c_void, application: *const c_void) -> u8;
        fn CFRelease(value: *const c_void);
    }
    unsafe {
        let application =
            CFStringCreateWithCString(std::ptr::null(), c"com.openai.codex".as_ptr(), 0x08000100);
        if application.is_null() {
            return Err("accountBackendUnsupported".into());
        }
        let mut unsupported = false;
        for key in [c"config_toml_base64", c"requirements_toml_base64"] {
            let key = CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), 0x08000100);
            if key.is_null() {
                unsupported = true;
                continue;
            }
            unsupported |= CFPreferencesAppValueIsForced(key, application) != 0;
            CFRelease(key);
        }
        CFRelease(application);
        if unsupported {
            return Err("accountBackendUnsupported".into());
        }
    }
    Ok(())
}

pub(super) fn validate_config(text: &str) -> Result<(), String> {
    let config: toml::Value = toml::from_str(text).map_err(|_| "accountBackendUnsupported")?;
    fn check(value: &toml::Value, root: bool) -> bool {
        let Some(table) = value.as_table() else {
            return true;
        };
        table.iter().all(|(key, value)| match key.as_str() {
            "cli_auth_credentials_store" => root && value.as_str() == Some("file"),
            "forced_login_method" => root && value.as_str() == Some("chatgpt"),
            // Workspace allowlists are checked against the target separately.
            "forced_chatgpt_workspace_id" => {
                root && (value.is_str()
                    || value
                        .as_array()
                        .is_some_and(|v| v.iter().all(toml::Value::is_str)))
            }
            "profile" | "auth_mode" | "chatgpt_base_url" => false,
            _ => check(value, false),
        })
    }
    if !check(&config, true) {
        return Err("accountBackendUnsupported".into());
    }
    Ok(())
}

pub(super) fn check_workspace(snapshot: &Snapshot, account: &str) -> Result<(), String> {
    // Inspect the original documents instead of parsing the fingerprint envelope.
    let documents: Vec<String> = if matches!(snapshot.environment.runtime, CodexRuntime::Wsl { .. })
    {
        serde_json::from_str(&snapshot.config).map_err(|_| "accountBackendUnsupported")?
    } else {
        let paths = [
            snapshot.environment.home.join("config.toml"),
            system_directory()?.join("config.toml"),
        ];
        paths
            .into_iter()
            .map(|p| fs::read_to_string(p).unwrap_or_default())
            .collect()
    };
    for document in documents {
        let config: toml::Value =
            toml::from_str(&document).map_err(|_| "accountBackendUnsupported")?;
        if let Some(allowed) = config.get("forced_chatgpt_workspace_id") {
            let matches = allowed.as_str() == Some(account)
                || allowed
                    .as_array()
                    .is_some_and(|v| v.iter().any(|v| v.as_str() == Some(account)));
            if !matches {
                return Err("accountWorkspaceRestricted".into());
            }
        }
    }
    Ok(())
}

pub(crate) fn snapshot(environment: &CodexEnvironment) -> Result<Snapshot, String> {
    if let CodexRuntime::Wsl { distribution } = &environment.runtime {
        let response = wsl_request(
            environment,
            distribution,
            serde_json::json!({"operation":"read"}),
        )?;
        let config = response["config"]
            .as_str()
            .ok_or("accountBackendUnsupported")?
            .to_owned();
        for doc in
            serde_json::from_str::<Vec<String>>(&config).map_err(|_| "accountBackendUnsupported")?
        {
            validate_config(&doc)?;
        }
        return Ok(Snapshot {
            environment: environment.clone(),
            content: response["content"].as_str().map(str::to_owned),
            config,
            path: PathBuf::from(
                response["path"]
                    .as_str()
                    .ok_or("accountBackendUnsupported")?,
            ),
        });
    }
    let config = read_config(environment)?;
    let path = storage::auth_path(&environment.home)?;
    let content = match fs::read_to_string(&path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("codexAuthUnreadable".into()),
    };
    Ok(Snapshot {
        environment: environment.clone(),
        content,
        config,
        path,
    })
}

pub(super) fn commit(expected: &Snapshot, target: &str) -> Result<(), String> {
    if let CodexRuntime::Wsl { distribution } = &expected.environment.runtime {
        wsl_request(
            &expected.environment,
            distribution,
            serde_json::json!({"operation":"commit", "expected":expected.content, "config":expected.config, "path":expected.path, "target":target}),
        )?;
        return Ok(());
    }
    if !expected.environment.home.exists() {
        storage::private_directory(&expected.environment.home)?;
    }
    let _outer = storage::lock(&expected.environment.home.join("auth.lock"))?;
    let _inner = storage::lock(&expected.path.with_extension("json.lock"))?;
    if snapshot(&expected.environment)?.context() != expected.context() {
        return Err("accountAuthConflict".into());
    }
    storage::atomic_write(&expected.path, target.as_bytes())?;
    if fs::read_to_string(&expected.path).ok().as_deref() != Some(target) {
        return Err("accountAuthConflict".into());
    }
    Ok(())
}

fn wsl_request(
    environment: &CodexEnvironment,
    distribution: &str,
    mut request: Value,
) -> Result<Value, String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let home = wsl_home(environment)?;
    request["home"] = home.into();
    let mut child = Command::new("wsl.exe")
        .args([
            "-d",
            distribution,
            "--",
            "python3",
            "-c",
            include_str!("wsl_auth.py"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "accountWslToolsRequired")?;
    let bytes = serde_json::to_vec(&request).map_err(|_| "accountStorageInvalid")?;
    let mut input = child.stdin.take().ok_or("accountWslToolsRequired")?;
    // Write concurrently: credential documents can exceed a pipe buffer.
    let writer = std::thread::spawn(move || input.write_all(&bytes));
    let mut output = child.stdout.take().ok_or("accountWslToolsRequired")?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut bytes = Vec::new();
        output.read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let _ = child.wait();
            let _ = writer.join();
            let bytes = reader
                .join()
                .ok()
                .and_then(Result::ok)
                .ok_or("accountWslToolsRequired")?;
            let result: Value =
                serde_json::from_slice(&bytes).map_err(|_| "accountWslToolsRequired")?;
            if !status.success() {
                return Err(result["error"]
                    .as_str()
                    .unwrap_or("accountWslToolsRequired")
                    .into());
            }
            return Ok(result);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("accountWslToolsRequired".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub(crate) fn wsl_home(environment: &CodexEnvironment) -> Result<String, String> {
    let home = environment.home.to_string_lossy();
    home.strip_prefix(r"\\wsl$\")
        .or_else(|| home.strip_prefix(r"\\wsl.localhost\"))
        .and_then(|s| s.split_once('\\'))
        .map(|(_, s)| format!("/{}", s.replace('\\', "/")))
        .ok_or_else(|| "accountBackendUnsupported".into())
}
