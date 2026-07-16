use crate::scanner::default_codex_home;
use serde::Deserialize;
use std::{
    collections::HashMap,
    fs,
    io::{self, ErrorKind},
    path::Path,
};

const SESSION_INDEX_FILE: &str = "session_index.jsonl";
const THREAD_ID_LENGTH: usize = 36;

#[derive(Deserialize)]
struct SessionIndexEntry {
    id: String,
    thread_name: String,
}

pub fn load_thread_names() -> HashMap<String, String> {
    match read_thread_names(&default_codex_home()) {
        Ok(names) => names,
        Err(error) => {
            log::warn!("Failed to read Codex session index: {error}");
            HashMap::new()
        }
    }
}

fn read_thread_names(codex_home: &Path) -> io::Result<HashMap<String, String>> {
    let path = codex_home.join(SESSION_INDEX_FILE);
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error),
    };

    let mut names = HashMap::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(trimmed) else {
            continue;
        };
        let name = entry.thread_name.trim();
        if !name.is_empty() {
            names.insert(entry.id, name.to_string());
        }
    }
    Ok(names)
}

pub fn thread_name_for_path(path: &str, names: &HashMap<String, String>) -> Option<String> {
    rollout_thread_id(Path::new(path)).and_then(|id| names.get(id).cloned())
}

pub fn resolve_thread_name(
    path: &str,
    fallback: Option<String>,
    names: &HashMap<String, String>,
) -> Option<String> {
    thread_name_for_path(path, names).or(fallback)
}

fn rollout_thread_id(path: &Path) -> Option<&str> {
    let stem = path.file_stem()?.to_str()?;
    let id = stem.get(stem.len().checked_sub(THREAD_ID_LENGTH)?..)?;
    let bytes = id.as_bytes();
    let valid = bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    });
    valid.then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const THREAD_ID: &str = "01977e3d-d9f6-72b7-93cf-f3f2f83c382c";

    #[test]
    fn latest_valid_name_wins_and_invalid_entries_are_ignored() {
        let codex_home = tempfile_dir();
        fs::write(
            codex_home.join(SESSION_INDEX_FILE),
            concat!(
                "not-json\n",
                "{\"id\":\"01977e3d-d9f6-72b7-93cf-f3f2f83c382c\",\"thread_name\":\"First name\"}\n",
                "{\"id\":\"01977e3d-d9f6-72b7-93cf-f3f2f83c382c\",\"thread_name\":\"   \"}\n",
                "\n",
                "{\"id\":\"01977e3d-d9f6-72b7-93cf-f3f2f83c382c\",\"thread_name\":\"Latest name\"}\n"
            ),
        )
        .unwrap();

        let names = read_thread_names(&codex_home).unwrap();

        assert_eq!(
            names.get(THREAD_ID).map(String::as_str),
            Some("Latest name")
        );
        fs::remove_dir_all(codex_home).unwrap();
    }

    #[test]
    fn matches_uuid_from_standard_rollout_filename() {
        let names = HashMap::from([(THREAD_ID.to_string(), "Session title".to_string())]);
        let path = format!("/tmp/rollout-2026-06-11T00-00-00-{THREAD_ID}.jsonl");

        assert_eq!(
            thread_name_for_path(&path, &names).as_deref(),
            Some("Session title")
        );
        assert_eq!(thread_name_for_path("/tmp/session.jsonl", &names), None);
    }

    #[test]
    fn official_name_overrides_fallback_and_missing_name_preserves_it() {
        let names = HashMap::from([(THREAD_ID.to_string(), "Official title".to_string())]);
        let path = format!("/tmp/rollout-2026-06-11T00-00-00-{THREAD_ID}.jsonl");

        assert_eq!(
            resolve_thread_name(&path, Some("Prompt title".to_string()), &names).as_deref(),
            Some("Official title")
        );
        assert_eq!(
            resolve_thread_name(
                "/tmp/session.jsonl",
                Some("Prompt title".to_string()),
                &names,
            )
            .as_deref(),
            Some("Prompt title")
        );
    }

    #[test]
    fn missing_index_returns_empty_names() {
        let codex_home = tempfile_dir();

        assert!(read_thread_names(&codex_home).unwrap().is_empty());
        fs::remove_dir_all(codex_home).unwrap();
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "codex-usage-session-index-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
