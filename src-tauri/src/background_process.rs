use std::{ffi::OsStr, process::Command};

/// Background probes and CLI tasks must not open a Windows console.
pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn background_child_has_no_console() {
        const CHILD: &str = "CODEX_USAGE_CONSOLE_TEST_CHILD";
        if std::env::var_os(CHILD).is_some() {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetConsoleWindow() -> *mut std::ffi::c_void;
            }
            assert!(unsafe { GetConsoleWindow().is_null() });
            println!("background child verified");
            return;
        }
        let output = command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "background_process::tests::background_child_has_no_console",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("background child verified"));
    }
}
