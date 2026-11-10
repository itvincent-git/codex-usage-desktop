use std::{
    ffi::OsString,
    mem::{size_of, zeroed},
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
    Security::{
        Authorization::{
            SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE,
            SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
        },
        GetTokenInformation, TokenUser, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        SECURITY_MAX_SID_SIZE, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::{
        Com::CoTaskMemFree,
        Registry::{
            RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY,
        },
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
    UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath},
};

pub(super) fn system_directory() -> Result<PathBuf, String> {
    // Reject any policy namespace, including a RequirementsPath override.
    check_policy_key(HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\OpenAI\Codex")?;
    Ok(program_data_directory()?.join("OpenAI").join("Codex"))
}

fn check_policy_key(root: HKEY, path: &str) -> Result<(), String> {
    let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let mut key = null_mut();
    // SAFETY: root is a registry handle and path is a live, terminated UTF-16 string.
    let status =
        unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, KEY_READ | KEY_WOW64_64KEY, &mut key) };
    if status == ERROR_SUCCESS {
        unsafe { RegCloseKey(key) };
    }
    // Missing is supported; an existing or unreadable policy fails closed.
    if status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err("accountBackendUnsupported".into())
    }
}

fn program_data_directory() -> Result<PathBuf, String> {
    let mut path = null_mut();
    // SAFETY: the API initializes path, which is freed on both success and failure.
    unsafe {
        let status = SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, null_mut(), &mut path);
        let result = if status < 0 || path.is_null() || *path == 0 {
            Err("accountBackendUnsupported".into())
        } else {
            let mut length = 0;
            while *path.add(length) != 0 {
                length += 1;
            }
            Ok(PathBuf::from(OsString::from_wide(
                std::slice::from_raw_parts(path, length),
            )))
        };
        CoTaskMemFree(path.cast());
        result
    }
}

pub(super) fn restrict_permissions(path: &Path, directory: bool) -> Result<(), String> {
    // TokenUser contains one TOKEN_USER followed by a SID. Keep the buffer aligned
    // and alive until all APIs using its SID have returned.
    #[repr(C)]
    struct UserBuffer {
        user: TOKEN_USER,
        sid: [u8; SECURITY_MAX_SID_SIZE as usize],
    }
    // SAFETY: zero is a valid initial representation for the output buffer.
    let mut user: UserBuffer = unsafe { zeroed() };
    let mut token = null_mut();
    let mut length = 0;
    // SAFETY: all output pointers refer to live buffers of the supplied sizes.
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("accountStorageUnavailable".into());
        }
        let read = GetTokenInformation(
            token,
            TokenUser,
            (&mut user as *mut UserBuffer).cast(),
            size_of::<UserBuffer>() as u32,
            &mut length,
        );
        CloseHandle(token);
        if read == 0 {
            return Err("accountStorageUnavailable".into());
        }
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_ALL_ACCESS,
            grfAccessMode: SET_ACCESS,
            grfInheritance: if directory {
                (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE) as u32
            } else {
                0
            },
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: user.user.User.Sid.cast(),
            },
        };
        let mut acl = null_mut();
        // Start with an empty ACL to remove pre-existing explicit grants as well.
        if SetEntriesInAclW(1, &entry, null(), &mut acl) != ERROR_SUCCESS {
            return Err("accountStorageUnavailable".into());
        }
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let status = SetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            user.user.User.Sid,
            null_mut(),
            acl,
            null(),
        );
        LocalFree(acl.cast());
        if status != ERROR_SUCCESS {
            return Err("accountStorageUnavailable".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Registry::{
        RegCreateKeyExW, RegDeleteKeyW, HKEY_CURRENT_USER, KEY_ALL_ACCESS, REG_OPTION_VOLATILE,
    };

    #[test]
    fn program_data_uses_an_absolute_known_folder() {
        let directory = program_data_directory().unwrap();
        assert!(directory.is_absolute());
        assert!(directory.is_dir());
    }

    #[test]
    fn policy_check_allows_missing_keys_and_rejects_existing_or_invalid_keys() {
        let path = format!("Software\\CodexUsageTest-{}", uuid::Uuid::new_v4());
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        assert!(check_policy_key(HKEY_CURRENT_USER, &path).is_ok());
        let mut key = null_mut();
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                wide.as_ptr(),
                0,
                null(),
                REG_OPTION_VOLATILE,
                KEY_ALL_ACCESS | KEY_WOW64_64KEY,
                null(),
                &mut key,
                null_mut(),
            )
        };
        assert_eq!(status, ERROR_SUCCESS);
        let existing = check_policy_key(HKEY_CURRENT_USER, &path);
        unsafe {
            RegCloseKey(key);
            assert_eq!(
                RegDeleteKeyW(HKEY_CURRENT_USER, wide.as_ptr()),
                ERROR_SUCCESS
            );
        }
        assert_eq!(existing.unwrap_err(), "accountBackendUnsupported");
        assert!(check_policy_key(null_mut(), &path).is_err());
    }

    #[test]
    fn permissions_fail_for_a_missing_file() {
        let path = std::env::temp_dir().join(format!("missing-{}", uuid::Uuid::new_v4()));
        assert_eq!(
            restrict_permissions(&path, false).unwrap_err(),
            "accountStorageUnavailable"
        );
    }
}
