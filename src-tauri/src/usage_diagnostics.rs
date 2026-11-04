use crate::{codex_environment, db, scanner};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDiagnostics {
    codex_home: String,
    cache_path: String,
    runtime: String,
    status: &'static str,
    files_found: usize,
    cached_days: usize,
    error: Option<String>,
}

pub fn inspect(database_path: &Path) -> UsageDiagnostics {
    let environment = codex_environment::selected_codex_environment();
    inspect_environment(environment, database_path)
}

fn inspect_environment(
    environment: codex_environment::CodexEnvironment,
    database_path: &Path,
) -> UsageDiagnostics {
    let mut result = UsageDiagnostics {
        codex_home: environment.home.to_string_lossy().into_owned(),
        cache_path: database_path.to_string_lossy().into_owned(),
        runtime: match environment.runtime {
            codex_environment::CodexRuntime::Native => "native".to_string(),
            codex_environment::CodexRuntime::Wsl { distribution } => {
                format!("WSL · {distribution}")
            }
        },
        status: "ready",
        files_found: 0,
        cached_days: 0,
        error: None,
    };
    match scanner::count_session_files(&environment.home) {
        Ok(count) => {
            result.files_found = count;
            if count == 0 {
                result.status = "noSessions";
            }
        }
        Err(error) => {
            result.status = if fs::metadata(&environment.home)
                .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            {
                "missingDirectory"
            } else {
                "unreadableDirectory"
            };
            result.error = Some(error);
        }
    }
    match db::open_database(database_path).and_then(|db| db::query_all_daily_rows(&db)) {
        Ok(rows) => {
            result.cached_days = rows.len();
            if result.status == "ready" && rows.is_empty() {
                result.status = "noUsage";
            }
        }
        Err(error) => {
            result.status = "databaseError";
            result.error = Some(format!("Cannot read usage cache: {error}"));
        }
    }
    result
}

pub fn load_selection(path: &Path) {
    match fs::read(path) {
        Ok(content) => match serde_json::from_slice::<PathBuf>(&content) {
            Ok(home) => codex_environment::select_codex_home(Some(home)),
            Err(error) => log::warn!("Cannot read saved Codex directory: {error}"),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!("Cannot read saved Codex directory: {error}"),
    }
}

// Serialize environment changes with scans so a scan never mixes two directories.
pub fn configure(path: &Path, home: Option<PathBuf>) -> Result<(), String> {
    let _guard = scanner::SCAN_MUTEX
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(home) = &home {
        scanner::count_session_files(home)?;
        if !home.join("sessions").is_dir() && !home.join("archived_sessions").is_dir() {
            return Err(
                "Choose a Codex directory containing sessions or archived_sessions.".to_string(),
            );
        }
        fs::write(
            path,
            serde_json::to_vec(home).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Cannot save Codex directory: {error}"))?;
    } else {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot reset Codex directory: {error}")),
        }
    }
    codex_environment::select_codex_home(home);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnoses_missing_empty_and_unreadable_session_directories() {
        let root = std::env::temp_dir().join(format!("codex-diagnostics-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let home = root.join("codex");
        let database = root.join("usage.sqlite");
        let inspect = || {
            inspect_environment(
                codex_environment::CodexEnvironment {
                    home: home.clone(),
                    runtime: codex_environment::CodexRuntime::Native,
                },
                &database,
            )
        };
        assert_eq!(inspect().status, "missingDirectory");
        fs::create_dir_all(home.join("sessions")).unwrap();
        assert_eq!(inspect().status, "noSessions");
        fs::write(home.join("sessions/empty.jsonl"), "{}\n").unwrap();
        let diagnostics = inspect();
        assert_eq!(diagnostics.status, "noUsage");
        assert_eq!(diagnostics.files_found, 1);
        fs::rename(home.join("sessions"), home.join("backup")).unwrap();
        fs::write(home.join("sessions"), "not a directory").unwrap();
        assert_eq!(inspect().status, "unreadableDirectory");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_an_unrelated_directory_without_replacing_the_saved_selection() {
        let root = std::env::temp_dir().join(format!("codex-selection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let selection = root.join("codex-home.json");
        fs::write(&selection, "previous selection").unwrap();
        assert!(configure(&selection, Some(root.clone()))
            .unwrap_err()
            .contains("containing sessions"));
        assert_eq!(fs::read_to_string(selection).unwrap(), "previous selection");
        fs::remove_dir_all(root).unwrap();
    }
}
