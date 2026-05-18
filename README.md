# Codex Usage Desktop

A local-first desktop dashboard for understanding your Codex CLI usage and estimated cost.

Use it if you run Codex CLI on your machine and want a simple way to review recent token usage, cost trends, model usage, and project usage without uploading your local logs.

## Features

- Local-first scanning of Codex CLI session logs.
- Daily dashboard windows from 1 day to 90 days.
- Monthly usage totals for longer-term review.
- Token, cache, cost, model, and project breakdowns.
- Excel and Markdown exports for the selected dashboard window.
- Local cache reset and rebuild when usage data needs to be refreshed from scratch.

## How To Use

1. Open the desktop app.
2. On first launch, the app reads your local Codex session logs from `~/.codex` and builds a local usage cache.
3. Use the Dashboard view to see total tokens, estimated cost, daily averages, cache hit rate, cost per million tokens, daily trends, model usage, and project usage.
4. Switch the dashboard window between 1d / 2d / 7d / 14d / 30d / 60d / 90d.
5. Open the Monthly view to see natural-month usage totals.
6. Click `Rescan local logs` after new Codex sessions to refresh the dashboard.
7. Use `Export` to save the selected dashboard window as Excel (`.xlsx`) or Markdown (`.md`).
8. Use Settings -> `Reset cache` if the local cache needs to be cleared and rebuilt from your Codex logs.

## Data And Privacy

- Source Codex logs are read locally and are not deleted by scan or reset actions.
- Usage summaries are stored in a local SQLite cache in the app data directory.
- Pricing data is cached locally. If the pricing cache is missing, the app tries to fetch Codex model pricing from LiteLLM; if that fails, it uses the bundled pricing table.
- Cost values are estimates based on the pricing data available to the app.

## Advanced Options

- `CODEX_HOME`: Codex home directory, default `~/.codex`
- `CODEX_USAGE_TIMEZONE`: timezone for day bucketing, default system timezone with UTC fallback

## Current Limits

- The app shows daily and monthly aggregate usage, not session-level detail.
- Unknown models default to zero cost.

## For Developers

The app is built with React 19, Vite, Tauri v2, and a native Rust usage pipeline. To work on it locally, install Node.js `>= 24`, `pnpm`, Rust, and Tauri v2 system dependencies; then run `pnpm install` and `pnpm dev:app`. Useful checks are `pnpm test`, `pnpm typecheck`, and `cd src-tauri && cargo test`; packaged builds use `pnpm build` and `pnpm tauri build`.
