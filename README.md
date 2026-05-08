# Codex Usage Desktop

A local-first desktop dashboard for Codex usage.

It uses Tauri to host a React UI, scans local Codex session logs in Rust, stores daily usage rollups in SQLite, and visualizes token and cost trends across the last 1 / 2 / 7 / 14 / 30 days.

## Features

- Scans local Codex usage on first launch
- Caches daily usage rollups in a local SQLite database
- Shows total tokens, total cost, daily averages, cache hit rate, and cost per million tokens
- Supports 1d / 2d / 7d / 14d / 30d time windows
- Lets you rescan local logs and refresh the dashboard
- Exports the selected time window to Excel or Markdown

## Architecture

- `src/`: React 19 + Vite frontend
- `src-tauri/`: Tauri v2 host and native Rust usage pipeline
- `codex-usage-desktop.db`: runtime-generated local SQLite cache in the app data directory

The frontend calls Tauri commands:

- `scan_usage`
- `fetch_overview`
- `export_usage`

## Requirements

- Node.js `>= 24`
- `pnpm`
- Rust toolchain
- System dependencies required by Tauri v2

## Install

```bash
pnpm install
```

## Development

Use the real app startup path for development:

```bash
pnpm dev:app
```

This starts the desktop app through Tauri and launches the Vite frontend at `http://localhost:5173`.

Running `pnpm dev` alone only starts the browser frontend. It is useful for UI-only work, but real scan data is served by Tauri commands.

## Build

```bash
pnpm build
pnpm tauri build
```

The packaged app is self-contained for the usage pipeline and does not spawn a Node.js sidecar.

## Test

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

## Environment Variables

- `CODEX_HOME`: Codex home directory, default `~/.codex`
- `CODEX_USAGE_TIMEZONE`: timezone for day bucketing, default system timezone with UTC fallback

## Current Limits

- The current UI shows daily aggregated usage, not session-level detail.
- Pricing is calculated from the Rust app's bundled model pricing table; unknown models default to zero cost.
