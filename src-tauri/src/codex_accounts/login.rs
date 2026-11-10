use super::*;
use crate::codex_limits::{codex_process_command, resolve_codex_command, CodexCommand};
#[cfg(unix)]
use std::process::Command;
use std::{
    io::Read,
    process::{Child, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginTask {
    id: String,
    state: String,
    authorization_url: Option<String>,
    device_code: Option<String>,
    account_id: Option<String>,
    error: Option<String>,
}
pub(super) struct RunningLogin {
    task: LoginTask,
    child: Option<Child>,
    wsl: Option<(String, String)>,
}

impl AccountService {
    pub fn start_login(
        self: &Arc<Self>,
        device_auth: bool,
        account_id: Option<String>,
        app: tauri::AppHandle,
    ) -> Result<LoginTask, String> {
        let expected = account_id
            .as_deref()
            .map(|id| self.account(id))
            .transpose()?;
        let removal_revision = self.store()?.1.removal_revision;
        let environment = selected_codex_environment();
        let codex = resolve_codex_command(&environment).ok_or("accountCliMissing")?;
        let id = uuid::Uuid::new_v4().to_string();
        // Serialize task creation and limit retained completed tasks.
        let mut tasks = self.logins.lock().unwrap();
        if tasks
            .values()
            .any(|t| t.lock().unwrap().task.state == "running")
        {
            return Err("accountLoginInProgress".into());
        }
        tasks.retain(|_, t| t.lock().unwrap().task.state == "running");
        let (directory, linux_directory) = login_directory(&environment, &id)?;
        let mut args = vec!["login", "-c", "cli_auth_credentials_store=\"file\""];
        if device_auth {
            args.push("--device-auth");
        }
        let mut command = if let CodexCommand::Wsl { distribution, path } = &codex {
            let home = linux_directory
                .as_deref()
                .ok_or("accountWslToolsRequired")?;
            let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
            let inner = format!("cd {} && echo $$ > .login.pid && test ! -e .cancelled && unset OPENAI_API_KEY CODEX_API_KEY && export CODEX_HOME={} NO_COLOR=1 TERM=dumb && exec {} {}", quote(home), quote(home), quote(path), args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" "));
            let invocation = format!(
                "exec \"$SHELL\" -lic {}",
                quote(&format!("exec setsid sh -c {}", quote(&inner)))
            );
            let mut command = crate::background_process::command("wsl.exe");
            command.args(["-d", distribution, "--", "sh", "-lc", &invocation]);
            command
        } else {
            let mut command = codex_process_command(&codex, &directory, &args);
            command.env("CODEX_HOME", &directory);
            command
        };
        command.env("NO_COLOR", "1").env("TERM", "dumb");
        command
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY");
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let spawned = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(_) => {
                cleanup_directory(&environment, &directory, linux_directory.as_deref());
                return Err("accountLoginFailed".into());
            }
        };
        let stdout = child.stdout.take().ok_or("accountLoginFailed")?;
        let stderr = child.stderr.take().ok_or("accountLoginFailed")?;
        let task = LoginTask {
            id: id.clone(),
            state: "running".into(),
            authorization_url: None,
            device_code: None,
            account_id: None,
            error: None,
        };
        let running = Arc::new(Mutex::new(RunningLogin {
            task: task.clone(),
            child: Some(child),
            wsl: match &environment.runtime {
                CodexRuntime::Wsl { distribution } => linux_directory
                    .clone()
                    .map(|dir| (distribution.clone(), dir)),
                CodexRuntime::Native => None,
            },
        }));
        tasks.insert(id, running.clone());
        drop(tasks);
        let readers = [
            read_output(stdout, running.clone()),
            read_output(stderr, running.clone()),
        ];
        let service = self.clone();
        thread::spawn(move || {
            let timeout = 10 * 60;
            #[cfg(feature = "e2e")]
            let timeout = std::env::var("CODEX_USAGE_LOGIN_TIMEOUT_SECONDS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|s| (1..=600).contains(s))
                .unwrap_or(timeout);
            let deadline = Instant::now() + Duration::from_secs(timeout);
            loop {
                let mut state = running.lock().unwrap();
                if state.task.state != "running" {
                    break;
                }
                let status = state
                    .child
                    .as_mut()
                    .and_then(|c| c.try_wait().ok().flatten());
                if let Some(status) = status {
                    if let Some(mut child) = state.child.take() {
                        let _ = child.wait();
                    }
                    let result = if status.success() {
                        fs::read_to_string(directory.join("auth.json"))
                            .map_err(|_| "accountLoginFailed".to_string())
                            .and_then(|content| {
                                service.upsert_with_revision(
                                    &content,
                                    expected
                                        .as_ref()
                                        .map(|a| (a.id.as_str(), a.credential_version)),
                                    Some(removal_revision),
                                )
                            })
                    } else {
                        Err("accountLoginFailed".into())
                    };
                    match result {
                        Ok(id) => {
                            state.task.account_id = Some(id);
                            state.task.state = "completed".into();
                            changed(&app);
                        }
                        Err(error) => {
                            state.task.error = Some(error);
                            state.task.state = "failed".into();
                        }
                    }
                    break;
                }
                if Instant::now() >= deadline {
                    terminate(&mut state);
                    state.task.state = "timedOut".into();
                    state.task.error = Some("accountLoginTimedOut".into());
                    break;
                }
                drop(state);
                thread::sleep(Duration::from_millis(50));
            }
            // Cancellation kills and waits before the isolated credentials are removed.
            for reader in readers {
                let _ = reader.join();
            }
            cleanup_directory(&environment, &directory, linux_directory.as_deref());
        });
        Ok(task)
    }
    pub(super) fn active_login(&self) -> Option<LoginTask> {
        self.logins.lock().unwrap().values().find_map(|task| {
            let state = task.lock().unwrap();
            (state.task.state == "running").then(|| state.task.clone())
        })
    }
    pub fn get_login(&self, id: &str) -> Result<LoginTask, String> {
        self.logins
            .lock()
            .unwrap()
            .get(id)
            .map(|t| t.lock().unwrap().task.clone())
            .ok_or_else(|| "accountLoginMissing".into())
    }
    pub fn cancel_login(&self, id: &str) -> Result<(), String> {
        let tasks = self.logins.lock().unwrap();
        let task = tasks.get(id).ok_or("accountLoginMissing")?;
        let mut state = task.lock().unwrap();
        if state.task.state == "running" {
            terminate(&mut state);
            state.task.state = "cancelled".into();
        }
        Ok(())
    }
    pub fn cancel_all_logins(&self) {
        for task in self.logins.lock().unwrap().values() {
            let mut state = task.lock().unwrap();
            if state.task.state == "running" {
                terminate(&mut state);
                state.task.state = "cancelled".into();
            }
        }
    }
}

fn terminate(state: &mut RunningLogin) {
    if let Some((distribution, directory)) = &state.wsl {
        // The cancellation marker closes the race before the Linux PID is written.
        let script = "cd \"$1\" || exit 1; touch .cancelled; if test -f .login.pid; then read -r pid < .login.pid; case \"$pid\" in *[!0-9]*|\"\") exit 1;; esac; kill -KILL -- -\"$pid\" 2>/dev/null || true; fi";
        let _ = crate::background_process::command("wsl.exe")
            .args([
                "-d",
                distribution,
                "--",
                "sh",
                "-c",
                script,
                "sh",
                directory,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    if let Some(mut child) = state.child.take() {
        #[cfg(unix)]
        let _ = Command::new("/bin/kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        #[cfg(windows)]
        let _ = crate::background_process::command("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn read_output(
    mut reader: impl Read + Send + 'static,
    task: Arc<Mutex<RunningLogin>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0; 1024];
        let mut output = String::new();
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            output.push_str(&String::from_utf8_lossy(&buffer[..n]));
            if output.len() > 32_768 {
                output = output
                    .chars()
                    .rev()
                    .take(16_384)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
            }
            let (url, code) = authorization_fields(&output);
            let mut state = task.lock().unwrap();
            if url.is_some() {
                state.task.authorization_url = url;
            }
            if code.is_some() {
                state.task.device_code = code;
            }
        }
    })
}

fn authorization_fields(output: &str) -> (Option<String>, Option<String>) {
    let mut plain = String::new();
    let mut escape = false;
    let mut csi = false;
    for c in output.chars() {
        if c == '\u{1b}' {
            escape = true;
            continue;
        }
        if escape {
            csi = c == '[';
            escape = false;
            continue;
        }
        if csi {
            if ('@'..='~').contains(&c) {
                csi = false;
            }
            continue;
        }
        if !c.is_control() || c.is_whitespace() {
            plain.push(c);
        }
    }
    let url = plain
        .split_whitespace()
        .find(|word| word.starts_with("https://auth.openai.com/"))
        .map(|s| s.trim_end_matches([')', '\'', '"']).to_owned());
    let code = plain
        .split_whitespace()
        .find(|word| {
            matches!(word.len(), 9 | 10)
                && word.as_bytes()[4] == b'-'
                && word
                    .bytes()
                    .enumerate()
                    .all(|(i, c)| i == 4 || c.is_ascii_uppercase() || c.is_ascii_digit())
        })
        .map(str::to_owned);
    (url, code)
}

fn login_directory(
    environment: &CodexEnvironment,
    id: &str,
) -> Result<(PathBuf, Option<String>), String> {
    if let CodexRuntime::Wsl { distribution } = &environment.runtime {
        let output = crate::background_process::command("wsl.exe").args(["-d", distribution, "--", "sh", "-lc", "command -v setsid >/dev/null && umask 077 && mktemp -d /tmp/codex-usage-login-XXXXXXXX"]).output().map_err(|_| "accountWslToolsRequired")?;
        let linux = String::from_utf8(output.stdout)
            .map_err(|_| "accountWslToolsRequired")?
            .trim()
            .to_owned();
        if !output.status.success()
            || !linux.starts_with("/tmp/codex-usage-login-")
            || linux.contains(char::is_whitespace)
        {
            return Err("accountWslToolsRequired".into());
        }
        let directory = PathBuf::from(format!(
            r"\\wsl.localhost\{}{}",
            distribution,
            linux.replace('/', "\\")
        ));
        Ok((directory, Some(linux)))
    } else {
        let directory = std::env::temp_dir().join(format!("codex-usage-login-{id}"));
        storage::private_directory(&directory)?;
        Ok((directory, None))
    }
}
fn cleanup_directory(
    environment: &CodexEnvironment,
    directory: &std::path::Path,
    linux: Option<&str>,
) {
    if let (CodexRuntime::Wsl { distribution }, Some(linux)) = (&environment.runtime, linux) {
        let _ = crate::background_process::command("wsl.exe")
            .args(["-d", distribution, "--", "rm", "-rf", "--", linux])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let _ = fs::remove_dir_all(directory);
    }
}

#[tauri::command]
pub(crate) async fn start_codex_account_login(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
    device_auth: bool,
    account_id: Option<String>,
) -> Result<LoginTask, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.start_login(device_auth, account_id, app))
        .await
        .map_err(|_| "accountTaskFailed")?
}
#[tauri::command]
pub(crate) fn get_codex_account_login(
    service: tauri::State<'_, Arc<AccountService>>,
    task_id: String,
) -> Result<LoginTask, String> {
    service.get_login(&task_id)
}
#[tauri::command]
pub(crate) async fn cancel_codex_account_login(
    service: tauri::State<'_, Arc<AccountService>>,
    task_id: String,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.cancel_login(&task_id))
        .await
        .map_err(|_| "accountTaskFailed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exposes_authorization_fields() {
        let (url, code) = authorization_fields(
            "secret access_token=abc\n\x1b[36mhttps://auth.openai.com/codex/device\x1b[0m\n\x1b[1mABCD-1234\x1b[0m\n",
        );
        assert_eq!(url.as_deref(), Some("https://auth.openai.com/codex/device"));
        assert_eq!(code.as_deref(), Some("ABCD-1234"));
    }

    #[test]
    fn extracts_nine_digit_device_code() {
        let (url, code) = authorization_fields(
            "Open this link in your browser\n\x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\nEnter this one-time code\n\x1b[94m1234-56789\x1b[0m\n",
        );
        assert_eq!(url.as_deref(), Some("https://auth.openai.com/codex/device"));
        assert_eq!(code.as_deref(), Some("1234-56789"));
    }

    #[test]
    fn ignores_invalid_device_codes() {
        for output in [
            "1234-567",
            "1234-567890",
            "12345-6789",
            "abcd-12345",
            "access_token=1234-56789",
        ] {
            assert_eq!(authorization_fields(output), (None, None));
        }
    }
}
