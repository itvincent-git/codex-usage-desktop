# Codex Usage Desktop

A local-first desktop dashboard for Codex usage.

It uses Tauri to host a React UI, calls `ccusage-codex daily --json` through a local sidecar API, stores daily usage rollups in SQLite, and visualizes token and cost trends across the last 1 / 2 / 7 / 14 / 30 days.

## Features

- Scans local Codex usage on first launch
- Caches daily usage rollups in a local SQLite database
- Shows total tokens, total cost, daily averages, cache hit rate, and cost per million tokens
- Supports 1d / 2d / 7d / 14d / 30d time windows
- Lets you rescan local logs and refresh the dashboard

## Architecture

- `src/`: React 19 + Vite frontend
- `src-sidecar/`: local HTTP sidecar, listening on `127.0.0.1:43110` by default
- `src-tauri/`: Tauri v2 host
- `codex-usage-desktop.db`: runtime-generated local SQLite cache

The sidecar currently exposes:

- `GET /api/health`
- `POST /api/scan`
- `GET /api/overview?range=7d`

## Requirements

- Node.js `>= 24`
- `pnpm`
- Rust toolchain
- System dependencies required by Tauri v2

The project already depends on `@ccusage/codex`, and the sidecar calls `node_modules/.bin/ccusage-codex` directly from the repo.

## Install

```bash
pnpm install
```

## Development

Use the real app startup path for development:

```bash
pnpm dev:app
```

This starts the desktop app through Tauri and, in development mode, launches:

- Vite frontend: `http://localhost:5173`
- Local sidecar: `http://127.0.0.1:43110`

If you want to debug each part separately:

```bash
pnpm dev
pnpm dev:sidecar
```

Or start only the frontend + sidecar without opening a Tauri window:

```bash
pnpm dev:tauri
```

Notes:

- Running `pnpm dev` alone only starts the frontend and will not provide real data.
- The UI depends on the sidecar API. If the sidecar is not running, the app will fall into a load failure state.

## Build

```bash
pnpm build
```

This produces:

- Frontend static assets
- Sidecar build output under `dist-sidecar/`

The current repo mainly covers the development workflow. If you want production packaging, you still need to make sure the Tauri bundle flow includes the sidecar artifacts and runtime orchestration.

## Test

```bash
pnpm test
pnpm typecheck
```

Run the real sidecar API integration test:

```bash
pnpm test:api
```

`test:api` sets `RUN_REAL_API_TESTS=1` and executes the real HTTP API integration test.

## Sidecar Debugging

Health check:

```bash
curl http://127.0.0.1:43110/api/health
```

Trigger a scan:

```bash
curl -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:43110/api/scan
```

Fetch the 7-day overview:

```bash
curl 'http://127.0.0.1:43110/api/overview?range=7d'
```

## Environment Variables

- `VITE_API_BASE_URL`: frontend API base URL, default `http://127.0.0.1:43110`
- `CODEX_USAGE_DESKTOP_PORT`: sidecar port, default `43110`
- `CODEX_USAGE_DESKTOP_DB_PATH`: SQLite file path, default `./codex-usage-desktop.db`

## Current Limits

- The current UI shows daily aggregated usage, not session-level detail.
- The first scan depends on local Codex usage data being readable by `ccusage-codex`.
- Tauri development mode is wired up to the sidecar, but the production packaging flow still needs more work.
