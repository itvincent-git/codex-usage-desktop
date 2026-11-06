use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub(super) fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "accountStorageUnavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "accountStorageUnavailable")?;
    }
    #[cfg(windows)]
    restrict_windows(path, true)?;
    Ok(())
}

#[cfg(windows)]
fn restrict_windows(path: &Path, directory: bool) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let output = Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|_| "accountStorageUnavailable")?;
    let output = String::from_utf8_lossy(&output.stdout);
    let sid = output
        .split(',')
        .nth(1)
        .map(|s| s.trim().trim_matches('"'))
        .filter(|s| s.starts_with("S-1-"))
        .ok_or("accountStorageUnavailable")?;
    // Replace the DACL, including pre-existing explicit grants. User-controlled
    // paths are passed as environment values, never interpolated into PS code.
    let script = "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.SecurityIdentifier]::new($env:CODEX_USAGE_ACL_SID); if ($env:CODEX_USAGE_ACL_DIRECTORY -eq '1') { $acl=[System.Security.AccessControl.DirectorySecurity]::new(); $inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { $acl=[System.Security.AccessControl.FileSecurity]::new(); $inherit=[System.Security.AccessControl.InheritanceFlags]::None }; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:CODEX_USAGE_ACL_PATH -AclObject $acl";
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("CODEX_USAGE_ACL_SID", sid)
        .env("CODEX_USAGE_ACL_PATH", path)
        .env(
            "CODEX_USAGE_ACL_DIRECTORY",
            if directory { "1" } else { "0" },
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "accountStorageUnavailable")?;
    if !status.success() {
        return Err("accountStorageUnavailable".into());
    }
    Ok(())
}

pub(super) fn lock(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|_| "accountLockUnavailable")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => return Err("accountLockUnavailable".into()),
        }
    }
}

pub(super) fn read<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "accountStorageInvalid".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(_) => Err("accountStorageUnavailable".into()),
    }
}

pub(super) fn save(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "accountStorageInvalid")?;
    atomic_write(path, &bytes)
}

pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("accountStorageUnavailable")?;
    let temporary = parent.join(format!(".credentials-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "accountStorageUnavailable")?;
        #[cfg(windows)]
        restrict_windows(&temporary, false)?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "accountStorageUnavailable")?;
        drop(file);
        replace(&temporary, path)?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| "accountStorageUnavailable")?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

#[cfg(not(windows))]
fn replace(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|_| "accountStorageUnavailable".into())
}

#[cfg(windows)]
fn replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err("accountStorageUnavailable".into());
    }
    Ok(())
}

pub(super) fn auth_path(home: &Path) -> Result<PathBuf, String> {
    let path = home.join("auth.json");
    // Match Codex's resolved-target sidecar; reject dangling or looping links.
    if fs::symlink_metadata(&path).is_ok() {
        fs::canonicalize(path).map_err(|_| "accountAuthConflict".into())
    } else {
        let mut parent = home;
        let mut missing = Vec::new();
        while !parent.exists() {
            missing.push(
                parent
                    .file_name()
                    .ok_or("accountStorageUnavailable")?
                    .to_owned(),
            );
            parent = parent.parent().ok_or("accountStorageUnavailable")?;
        }
        let mut resolved = fs::canonicalize(parent).map_err(|_| "accountStorageUnavailable")?;
        for part in missing.into_iter().rev() {
            resolved.push(part);
        }
        Ok(resolved.join("auth.json"))
    }
}
