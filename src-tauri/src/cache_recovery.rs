use std::{
    fs,
    path::{Path, PathBuf},
};

fn marker(database: &Path) -> PathBuf {
    database.with_extension("rebuild-on-start")
}

// Replacement happens before this process opens any database connections.
pub fn schedule(database: &Path) -> Result<String, String> {
    // Do not run migrations or open read/write: even a failed SQLite open can remove sidecars.
    let check =
        rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|db| {
                db.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))
            });
    let error = match check {
        Ok(result) if result == "ok" => {
            return Err("The cache is readable; no corruption recovery is needed.".into())
        }
        Ok(result) => format!("database disk image is malformed: {result}"),
        Err(error) => error.to_string(),
    };
    if !is_corruption(&error) {
        return Err(error);
    }
    fs::write(marker(database), b"")
        .map_err(|error| format!("Cannot schedule cache rebuild: {error}"))?;
    Ok(database
        .parent()
        .unwrap_or(Path::new("."))
        .join("cache-backups")
        .to_string_lossy()
        .into_owned())
}

fn is_corruption(error: &str) -> bool {
    let error = error.to_lowercase();
    [
        "database disk image is malformed",
        "database is corrupt",
        "file is not a database",
    ]
    .iter()
    .any(|message| error.contains(message))
}

pub fn apply_on_start(database: &Path) -> Result<(), String> {
    if !marker(database)
        .try_exists()
        .map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let backup = database
        .parent()
        .unwrap_or(Path::new("."))
        .join("cache-backups")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&backup).map_err(|error| error.to_string())?;
    let mut moved = Vec::new();
    let result = (|| {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let source = PathBuf::from(format!("{}{suffix}", database.display()));
            if source.try_exists().map_err(|error| error.to_string())? {
                let target = backup.join(source.file_name().ok_or("Invalid cache path")?);
                fs::rename(&source, &target).map_err(|error| {
                    format!("Cannot back up cache {}: {error}", source.display())
                })?;
                moved.push((source, target));
            }
        }
        fs::remove_file(marker(database)).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        for (source, target) in moved.into_iter().rev() {
            fs::rename(&target, &source).map_err(|error| {
                format!("Cannot restore cache from {}: {error}", target.display())
            })?;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archives_corrupt_cache_and_sidecars_only_on_next_start() {
        let root = std::env::temp_dir().join(format!("cache-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("usage.db");
        fs::write(&database, "broken database").unwrap();
        fs::write(root.join("usage.db-wal"), "wal").unwrap();
        fs::write(root.join("source.jsonl"), "source logs").unwrap();
        assert!(schedule(&database).unwrap().ends_with("cache-backups"));
        assert_eq!(fs::read_to_string(&database).unwrap(), "broken database");
        apply_on_start(&database).unwrap();
        assert!(!database.exists());
        let backup = fs::read_dir(root.join("cache-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(backup.join("usage.db")).unwrap(),
            "broken database"
        );
        assert_eq!(
            fs::read_to_string(backup.join("usage.db-wal")).unwrap(),
            "wal"
        );
        assert_eq!(
            fs::read_to_string(root.join("source.jsonl")).unwrap(),
            "source logs"
        );
        crate::db::open_database(&database).unwrap();
        assert!(schedule(&database).is_err());
        apply_on_start(&database).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_failure_leaves_original_cache_and_recovery_request_intact() {
        let root = std::env::temp_dir().join(format!("cache-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("usage.db");
        fs::write(&database, "broken database").unwrap();
        schedule(&database).unwrap();
        fs::write(root.join("cache-backups"), "not a directory").unwrap();
        assert!(apply_on_start(&database).is_err());
        assert_eq!(fs::read_to_string(&database).unwrap(), "broken database");
        assert!(marker(&database).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
