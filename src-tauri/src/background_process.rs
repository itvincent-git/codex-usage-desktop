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
        let executable = std::env::current_exe().unwrap();
        let args = [
            "--exact",
            "background_process::tests::background_child_has_no_console",
            "--nocapture",
        ];
        let mut native = command(&executable);
        native.args(args);
        let mut cmd = command("cmd.exe");
        cmd.arg("/C").arg(&executable).args(args);
        let mut powershell = command("powershell.exe");
        powershell.args([
            "-NoProfile", "-NonInteractive", "-Command",
            "& $env:CODEX_USAGE_CONSOLE_TEST_EXE --exact background_process::tests::background_child_has_no_console --nocapture; exit $LASTEXITCODE",
        ]);
        for mut child in [native, cmd, powershell] {
            let output = child
                .env(CHILD, "1")
                .env("CODEX_USAGE_CONSOLE_TEST_EXE", &executable)
                .output()
                .unwrap();
            assert!(output.status.success(), "{child:?}: {output:?}");
            assert!(String::from_utf8_lossy(&output.stdout).contains("background child verified"));
        }
    }
}
