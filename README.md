# Codex Usage Desktop

![ScreenShot](docs/screen_shot.jpg)
[![Release](https://img.shields.io/github/v/release/itvincent-git/codex-usage-desktop?label=release)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24c8db.svg)](https://tauri.app/)
[![Local first](https://img.shields.io/badge/local--first-privacy-green.svg)](#privacy)

> See where your Codex tokens and dollars go — locally.

A local-first macOS dashboard for OpenAI Codex CLI usage.
No cloud account. No API key. No log upload. Reads your local ~/.codex logs.

[Download the latest release](https://github.com/itvincent-git/codex-usage-desktop/releases/latest) · [中文 README](README_zh.md)

## Why this exists

Codex usage can grow quickly, but tracking it shouldn't cost you your privacy or credentials security. 

Unlike traditional analytics platforms that require cloud logins and API key uploads, **Codex Usage Desktop** is built with a local-first philosophy.

### 📊 Local-First vs. Cloud SaaS Analytics

| Feature | Codex Usage Desktop (Local-First) | Traditional Cloud SaaS |
| :--- | :--- | :--- |
| **Data Privacy** | 🟢 **100% Local**. Your logs never leave your machine. | 🔴 Uploads logs to third-party cloud servers. |
| **Credentials Security** | 🟢 **Zero API Keys required**. No keys are stored. | 🔴 Requires uploading master API keys/tokens. |
| **Costs** | 🟢 **Free & Open Source**. No subscription. | 🔴 Pay-per-seat subscription models. |
| **Performance** | 🟢 **Blazing fast SQLite**. Local TUI/JSONL log indexing. | 🔴 Subject to network latency and API rate limits. |

---

## Features

- Local-first scanning of Codex CLI session logs.
- Dashboard windows from 1 day to 90 days.
- Monthly usage totals for longer-term review.
- Token, cache, cost, model, and project breakdowns.
- Excel (`.xlsx`) and Markdown (`.md`) exports.
- Local SQLite cache reset and rebuild when usage data needs to be refreshed from scratch.

## Download And Install

Download the latest macOS build from [GitHub Releases](https://github.com/itvincent-git/codex-usage-desktop/releases/latest).

Current release builds:

- macOS Apple Silicon
- macOS Intel

Windows and Linux builds are planned, but the current release workflow only publishes macOS desktop packages.

## How It Works

1. Open the desktop app.
2. On first launch, the app reads your local Codex session logs from `~/.codex` and builds a local usage cache.
3. Use the Dashboard view to see total tokens, estimated cost, daily averages, cache hit rate, cost per million tokens, daily trends, model usage, and project usage.
4. Switch the dashboard window between 1d / 2d / 7d / 14d / 30d / 60d / 90d.
5. Open the Monthly view to see natural-month usage totals.
6. Click `Rescan local logs` after new Codex sessions to refresh the dashboard.
7. Use `Export` to save the selected dashboard window as Excel (`.xlsx`) or Markdown (`.md`).
8. Use Settings -> `Reset cache` if the local cache needs to be cleared and rebuilt from your Codex logs.

## Privacy & Security

> [!IMPORTANT]
> **Zero Cloud Telemetry & Credentials Security Guarantee**
> * **No API Keys Stored**: The app **does not require or store** your OpenAI/LiteLLM API keys. It parses local logs that already contain token counts.
> * **Logs Stay Local**: Source session files in `~/.codex` are read strictly on your device and are never uploaded, shared, or modified.
> * **Local-first SQLite Cache**: Summarized metrics are stored in a local SQLite cache in your system's app data directory.
> * **Minimal Network Activity**: Pricing data is cached locally. If missing, the app fetches public pricing lists from LiteLLM over HTTPS, without sending any user credentials or usage metrics.

## Advanced Options

- `CODEX_HOME`: Codex home directory, default `~/.codex`
- `CODEX_USAGE_TIMEZONE`: timezone for day bucketing, default system timezone with UTC fallback

## Current Limits

- The app shows daily and monthly aggregate usage, not session-level detail.
- Unknown models default to zero cost.
- Release packages are currently macOS-only.

## Roadmap

- Windows and Linux release packages.
- More detailed usage drilldowns.
- More export and reporting options.

## Development

The app is built with React 19, Vite, Tauri v2, and a native Rust usage pipeline.

Install Node.js `>= 24`, `pnpm`, Rust, and Tauri v2 system dependencies, then run:

```bash
pnpm install
pnpm dev:app
```

Useful checks:

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

Packaged builds use:

```bash
pnpm build
pnpm tauri build
```
