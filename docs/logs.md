# Codex Usage Desktop - Diagnostic Log Debugging and the Production "Waiting for logs..." Fix

This document describes how to debug the `Codex Usage Desktop` diagnostic logging system and how the issue where the Diagnostics Log page kept showing "Waiting for logs..." after packaging and running the app as a DMG/App was resolved.

---

## 1. Debugging logs in production and packaged apps

When a Tauri application is packaged as a production Release build, the default developer tools (right-click to inspect elements) are disabled. Use the following three methods to inspect the running app or investigate errors:

### Method 1: Run the packaged `.app` directly from a terminal (recommended 🌟)
The packaged Release app is available in the project directory. Launch it directly from a terminal to see Rust output, errors, and plugin logs from the app backend in real time:
```bash
# Launch the packaged Release app directly from a terminal
./src-tauri/target/release/bundle/macos/Codex\ Usage\ Desktop.app/Contents/MacOS/Codex\ Usage\ Desktop
```
*(After rebuilding the package, this command runs the latest packaged Release version. Any runtime errors or Rust panics appear directly in the current terminal.)*

### Method 2: Follow persistent local logs on macOS (recommended 🌟)
The Tauri logging plugin automatically writes logs to the standard macOS log location:
`~/Library/Logs/com.ccusage.codex.desktop/Codex Usage Desktop.log`

Run the following command in a terminal to **follow the app's backend log output in real time**, even when the app was launched by double-clicking it after installation from a DMG:
```bash
# Follow the app's backend log output in real time
tail -f ~/Library/Logs/com.ccusage.codex.desktop/Codex\ Usage\ Desktop.log
```
Alternatively, open the log directory in Finder to inspect saved logs:
```bash
open ~/Library/Logs/com.ccusage.codex.desktop/
```

### Method 3: Open the frontend developer tools (DevTools)
The configuration has been updated to enable DevTools in Release builds. In the running packaged app, **right-click** any blank area and select **"Inspect Element"**, or press **`Cmd + Option + I`**, to open the browser developer console and inspect frontend errors and log output.

---

## 2. Diagnosing the empty "Waiting for logs..." page in production

### 2.1 Symptoms
In `pnpm tauri dev` (development mode), clicking the "Logs" tab displays backend log output normally. However, after packaging and running the production DMG, the Logs page permanently shows **"Waiting for logs..."**, with no incoming log stream.

### 2.2 Root cause analysis

#### Cause 1: Tauri v2 capability restrictions
Tauri v2 introduced a strict security sandbox based on capabilities. For the frontend to invoke the logging plugin through IPC, access must be explicitly granted in the `permissions` array in `src-tauri/capabilities/default.json`. Without `"log:default"`, the security sandbox blocks IPC communication between the frontend and the logging plugin in the packaged production app.

#### Cause 2: Protocol mismatch between the frontend and backend logging plugins
*   **Frontend** used a stable release: `"@tauri-apps/plugin-log": "^2.8.0"`
*   **Backend** used an older version: `tauri-plugin-log = "2.0.0-rc"` (Release Candidate)
*   Tauri v2 underwent several changes to internal IPC command names between the RC and stable releases. As a result, the subscription request initiated by the frontend's `attachLogger` did not match the event names inside the backend Rust crate in the packaged app. This protocol mismatch prevented the frontend from receiving logs.

#### Cause 3: React component lifecycle and log capture timing
*   In the old code, `<LogPanel />` was conditionally rendered:
    `{!isLoading && view === "logs" ? <LogPanel /> : null}`
*   At app startup, while `isLoading` was true, `<LogPanel />` was not mounted, so `attachLogger` was never called.
*   Startup operations such as initialization, scanning, and configuration loading produce most of the logs. Once startup finishes, the production app becomes quiet, with no new backend operations.
*   When the user manually switched to the "Logs" tab, `<LogPanel />` finally mounted and called `attachLogger`, but the backend produced no new logs afterward. Because `tauri-plugin-log` cannot replay historical logs, the panel remained empty.
*   *(Note: In development mode, frequent Vite HMR requests, WebSocket connections, and repeated rendering in React Strict Mode generate ongoing activity logs, masking this lifecycle design issue.)*

---

## 3. Final solution and changes

### 3.1 Grant capability permissions and enable DevTools
*   **Modified file**: [`default.json`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src-tauri/capabilities/default.json)
    Added `"log:default"` to the `permissions` array to allow secure communication between the frontend and the logging plugin.
*   **Modified file**: [`Cargo.toml`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src-tauri/Cargo.toml)
    *   Upgraded `tauri-plugin-log` to the stable version `"2.0.0"` to align the frontend and backend IPC protocols;
    *   Enabled the `"devtools"` feature in `tauri` to support debugging in production packages.

### 3.2 Improve the `<LogPanel />` mounting strategy (capture logs from startup)
*   **Modified file**: [`App.tsx`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src/App.tsx)
    Replaced conditional mounting and unmounting of `<LogPanel />` with style-based visibility control using Tailwind CSS `block` / `hidden`:
    ```typescript
    <div className={!isLoading && view === "logs" ? "block" : "hidden"}>
      <LogPanel />
    </div>
    ```
    This mounts the component at the start of the app lifecycle, captures and accumulates startup logs in the background, and displays them immediately when the user switches to the Logs page.

### 3.3 Add a unit test mock to eliminate test side effects
*   **Modified file**: [`App.test.tsx`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src/App.test.tsx)
    With `<LogPanel />` now mounted by default at startup, `attachLogger` also initializes in Vitest / JSDOM tests. Because those environments lack the Tauri runtime, initialization threw a transform exception when Tauri internal variables could not be found.
    A mock for `@tauri-apps/plugin-log` was added at the top of the test file to eliminate this side effect:
    ```typescript
    vi.mock("@tauri-apps/plugin-log", () => ({
      attachLogger: vi.fn(() => Promise.resolve(() => {})),
      LogLevel: {
        Trace: 0,
        Debug: 1,
        Info: 2,
        Warn: 3,
        Error: 4,
      },
    }));
    ```
    This ensured that all 11 local unit tests **passed (green state)**.
