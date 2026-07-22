#[cfg(any(target_os = "windows", test))]
use std::path::Path;
use std::{env, path::PathBuf, sync::OnceLock};
#[cfg(target_os = "windows")]
use std::{
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
#[cfg(any(target_os = "windows", test))]
use walkdir::WalkDir;

#[cfg(target_os = "windows")]
const WSL_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexRuntime {
    Native,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Wsl {
        distribution: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexEnvironment {
    pub home: PathBuf,
    pub runtime: CodexRuntime,
}

static SELECTED_ENVIRONMENT: OnceLock<CodexEnvironment> = OnceLock::new();

pub fn selected_codex_environment() -> &'static CodexEnvironment {
    SELECTED_ENVIRONMENT.get_or_init(resolve_codex_environment)
}

fn resolve_codex_environment() -> CodexEnvironment {
    if let Some(home) = env::var("CODEX_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return CodexEnvironment {
            home: PathBuf::from(home),
            runtime: CodexRuntime::Native,
        };
    }

    let native_home = dirs::home_dir()
        .map(|home| home.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"));

    #[cfg(target_os = "windows")]
    {
        let has_native_sessions = has_jsonl_sessions(&native_home);
        let wsl_environment = (!has_native_sessions)
            .then(probe_default_wsl_environment)
            .flatten();
        if !has_native_sessions && wsl_environment.is_none() {
            log::warn!(
                "No native Codex sessions were found and the default WSL environment was unavailable."
            );
        }
        select_windows_environment(None, native_home, has_native_sessions, wsl_environment)
    }

    #[cfg(not(target_os = "windows"))]
    CodexEnvironment {
        home: native_home,
        runtime: CodexRuntime::Native,
    }
}

#[cfg(any(target_os = "windows", test))]
pub fn has_jsonl_sessions(codex_home: &Path) -> bool {
    let sessions = codex_home.join("sessions");
    sessions.is_dir()
        && WalkDir::new(sessions)
            .into_iter()
            .filter_map(Result::ok)
            .any(|entry| {
                entry.file_type().is_file()
                    && entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            })
}

#[cfg(target_os = "windows")]
fn probe_default_wsl_environment() -> Option<CodexEnvironment> {
    let mut child = Command::new("wsl.exe")
        .args([
            "sh",
            "-lc",
            "printf '%s\\n%s\\n' \"$WSL_DISTRO_NAME\" \"$HOME\"",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + WSL_PROBE_TIMEOUT;
    loop {
        if child.try_wait().ok().flatten().is_some() {
            let output = child.wait_with_output().ok()?;
            if !output.status.success() {
                return None;
            }
            let output = String::from_utf8(output.stdout).ok()?;
            return parse_wsl_probe_output(&output);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            log::warn!("Timed out while querying the default WSL Codex environment.");
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(any(target_os = "windows", test))]
fn parse_wsl_probe_output(output: &str) -> Option<CodexEnvironment> {
    let mut lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let distribution = lines.next()?.trim_matches('\u{feff}');
    let home = lines.next()?;
    if distribution.is_empty() || !home.starts_with('/') {
        return None;
    }

    Some(CodexEnvironment {
        home: wsl_unc_codex_home(distribution, home),
        runtime: CodexRuntime::Wsl {
            distribution: distribution.to_string(),
        },
    })
}

#[cfg(any(target_os = "windows", test))]
fn wsl_unc_codex_home(distribution: &str, home: &str) -> PathBuf {
    let relative_home = home.trim_matches('/').replace('/', "\\");
    PathBuf::from(format!(r"\\wsl$\{}\{}\.codex", distribution, relative_home))
}

#[cfg(any(target_os = "windows", test))]
fn select_windows_environment(
    explicit_home: Option<PathBuf>,
    native_home: PathBuf,
    native_has_sessions: bool,
    wsl_environment: Option<CodexEnvironment>,
) -> CodexEnvironment {
    if let Some(home) = explicit_home {
        return CodexEnvironment {
            home,
            runtime: CodexRuntime::Native,
        };
    }
    if native_has_sessions {
        return CodexEnvironment {
            home: native_home,
            runtime: CodexRuntime::Native,
        };
    }
    wsl_environment.unwrap_or(CodexEnvironment {
        home: native_home,
        runtime: CodexRuntime::Native,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::SystemTime};

    #[test]
    fn parses_default_wsl_environment_as_unc_path() {
        let environment = parse_wsl_probe_output("Ubuntu-24.04\r\n/home/vincent\r\n").unwrap();

        assert_eq!(
            environment,
            CodexEnvironment {
                home: PathBuf::from(r"\\wsl$\Ubuntu-24.04\home\vincent\.codex"),
                runtime: CodexRuntime::Wsl {
                    distribution: "Ubuntu-24.04".to_string(),
                },
            }
        );
    }

    #[test]
    fn rejects_incomplete_wsl_probe_output() {
        assert!(parse_wsl_probe_output("Ubuntu\n").is_none());
        assert!(parse_wsl_probe_output("Ubuntu\nC:\\Users\\test\n").is_none());
    }

    #[test]
    fn detects_nested_jsonl_sessions() {
        let root = tempfile_dir();
        assert!(!has_jsonl_sessions(&root));
        fs::create_dir_all(root.join("sessions/2026/07/22")).unwrap();
        fs::write(root.join("sessions/2026/07/22/session.jsonl"), "{}\n").unwrap();
        assert!(has_jsonl_sessions(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explicit_home_disables_windows_auto_discovery() {
        let wsl = parse_wsl_probe_output("Ubuntu\n/home/test\n").unwrap();
        let selected = select_windows_environment(
            Some(PathBuf::from(r"D:\custom-codex")),
            PathBuf::from(r"C:\Users\test\.codex"),
            true,
            Some(wsl),
        );

        assert_eq!(selected.home, PathBuf::from(r"D:\custom-codex"));
        assert_eq!(selected.runtime, CodexRuntime::Native);
    }

    #[test]
    fn native_sessions_win_and_missing_wsl_falls_back_safely() {
        let native = PathBuf::from(r"C:\Users\test\.codex");
        let wsl = parse_wsl_probe_output("Ubuntu\n/home/test\n").unwrap();

        assert_eq!(
            select_windows_environment(None, native.clone(), true, Some(wsl)).home,
            native
        );
        assert_eq!(
            select_windows_environment(None, native.clone(), false, None),
            CodexEnvironment {
                home: native,
                runtime: CodexRuntime::Native,
            }
        );
    }

    fn tempfile_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "codex-usage-environment-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
