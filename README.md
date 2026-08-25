# Codex Usage Desktop

> See where your Codex tokens, limits, and dollars go — without sending your session logs anywhere.

[![Release](https://img.shields.io/github/v/release/itvincent-git/codex-usage-desktop?label=release)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![Platforms: macOS and Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local first](https://img.shields.io/badge/local--first-privacy-green.svg)](#privacy-and-network-access)

**[Download for Windows x64](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple Silicon](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [中文说明](README_zh.md) · [日本語](README_ja.md)

> [!IMPORTANT]
> ⭐ Enjoying Codex Usage Desktop? [Star the repository on GitHub](https://github.com/itvincent-git/codex-usage-desktop) to support the project.

![Codex Usage Desktop dashboard showing token costs, trends, and account limits](docs/screen_shot.jpg)

Codex Usage Desktop turns the Codex CLI logs already on your computer into a clear usage dashboard. Check token and cost trends, see which projects and models consume the most, inspect individual sessions, and keep an eye on live account limits — all from one native desktop app.

- **Local by default:** session logs are read on your computer and never uploaded by the app.
- **No API key setup:** install, open, and scan the Codex data you already have.
- **Free and open source:** no separate app account, subscription, or hosted analytics service required.

## What you can see

|                              | Capability                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Usage at a glance**        | Token totals, estimated cost, cache hit rate, daily averages, and trends across preset or custom date ranges.             |
| **Know what drives cost**    | Breakdowns by project, model, day, month, and individual Codex session.                                                   |
| **Stay ahead of limits**     | Live 5-hour, weekly, or monthly limits, reset times, available reset credits, and quota-reset forecasting when available. |
| **Inspect session activity** | Search session titles, projects, and models, then open a session for its usage and activity details.                      |
| **Keep it close**            | Optional menu bar or system tray metrics, launch at login, English and Chinese UI, and in-app updates.                   |
| **Take your data with you**  | Export the selected dashboard range to Excel (`.xlsx`) or Markdown (`.md`).                                               |

## Install

### Windows 10/11 x64

[Download the latest Windows setup executable](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe), open it, and follow the installer. The current-user NSIS installer does not require a system-wide installation.

> [!WARNING]
> The Windows installer is not Authenticode-signed yet, so Microsoft Defender SmartScreen may show an unrecognized-app warning. Verify that the file came from this repository's GitHub release before continuing.

The app first uses sessions under `%USERPROFILE%\.codex`. If that location has no JSONL sessions, it automatically checks the default WSL distribution and uses its `$HOME/.codex` data and Codex CLI. Native and WSL sessions are not combined, which prevents duplicate usage totals.

### macOS

Choose the build for your Mac:

| Mac                                       | Download                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Silicon (M1, M2, M3, M4, and newer) | [Download the latest ARM64 DMG](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg) |
| Intel                                     | [Download the latest x64 DMG](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)     |

Open the DMG and move **Codex Usage Desktop** to Applications. You can also browse the [latest release and release notes](https://github.com/itvincent-git/codex-usage-desktop/releases/latest).

> [!NOTE]
> The app does not bypass macOS Gatekeeper. If macOS blocks the first launch, open **System Settings → Privacy & Security** and allow the app.

### Install from Terminal

The installer detects Apple Silicon or Intel, downloads the matching DMG, and copies the app to `/Applications`:

```bash
curl -fsSL https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/scripts/install.sh | sh
```

The script does not disable or bypass Gatekeeper.

## Quick start

1. Use Codex CLI normally so session logs exist under `~/.codex` (or `%USERPROFILE%\.codex` on Windows).
2. Open Codex Usage Desktop. It scans the local logs and builds a local SQLite index.
3. Choose a time range or open the Model, Project, Daily, Monthly, or Sessions views to explore your usage.

Live account limits require an authenticated local Codex CLI session. If needed, run `codex auth login`, then refresh the dashboard.

## Privacy and network access

Your Codex session content is sensitive. The app is designed to keep it on your device:

- Source files under `~/.codex` are read locally and are never uploaded, shared, or modified by the app.
- No OpenAI or LiteLLM API key needs to be entered into or stored by the app.
- Aggregated usage data is stored in a SQLite cache in the operating system's app data directory.
- Live limits are requested directly from ChatGPT using your existing local Codex authentication; the app does not send session logs with those requests.
- Network access is also used for public font files, model pricing, quota forecasts, and update checks. Pricing is cached locally, and these requests do not include your session logs or usage analytics.

## Compatibility and current limits

- Release packages support macOS on Apple Silicon and Intel, plus Windows 10/11 x64. Linux packages are not currently provided.
- On Windows, only the default WSL distribution is considered when native sessions are empty; multiple distributions are not merged.
- Usage and cost values are calculated from local Codex logs; cost figures are estimates based on the available model pricing.
- Unknown models default to zero estimated cost.
- Session details depend on the information present in each local Codex log.

## Advanced options

- `CODEX_HOME`: Codex home directory. A non-empty value takes priority and disables Windows/WSL auto-discovery.
- `CODEX_CLI_PATH`: explicit Codex CLI executable or wrapper path (`codex`, `codex.exe`, or `codex.cmd` as appropriate)
- `CODEX_USAGE_TIMEZONE`: timezone used for daily buckets, default system timezone with UTC fallback

## Development

Codex Usage Desktop is built with React 19, Vite, Tauri v2, and a native Rust usage pipeline.

Install Node.js `>= 24`, `pnpm`, Rust, and the Tauri v2 system dependencies, then start the real desktop app:

```bash
pnpm install
pnpm tauri dev
```

Run the checks:

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

Packaged builds use `pnpm tauri build`.
