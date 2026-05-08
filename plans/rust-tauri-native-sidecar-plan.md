# Rust/Tauri Native Usage Pipeline Plan

## Goal

Make the packaged `.app` genuinely self-contained by removing the production dependency on system Node.js and the JavaScript sidecar runtime.

Target end state:

- Tauri owns usage scanning, aggregation, SQLite storage, and app data paths in Rust.
- The React UI talks to Tauri commands instead of `http://127.0.0.1:43110`.
- Production builds do not bundle `dist-sidecar/index.js` or `@ccusage/codex/dist`.
- Production startup does not resolve or spawn `node`.
- The local HTTP sidecar exists only during migration, then is removed.

## Current State

- `src-sidecar/` implements the local HTTP API in TypeScript.
- `src-tauri/src/lib.rs` starts the sidecar only in non-debug builds.
- Production launch currently spawns `node sidecar/index.js`.
- `src-tauri/tauri.conf.json` bundles JavaScript sidecar resources.
- The frontend calls:
  - `POST /api/scan`
  - `GET /api/overview?range=...`
- SQLite schema currently stores daily rollups in `daily_usage_rollups` and scan history in `scan_runs`.

## Assumptions

- The UI only needs the existing daily aggregate contract for now.
- Session-level detail is out of scope for this migration.
- The first Rust implementation should preserve the existing response shapes from `src/lib/api.ts`.
- Existing TypeScript sidecar tests are useful as behavior references, but Rust tests should become the source of truth.
- The migration should avoid changing the visual UI unless required by the API transport change.

## Non-Goals

- Do not redesign the dashboard.
- Do not add new reporting ranges.
- Do not add sync, cloud storage, or export features.
- Do not preserve the local HTTP server in the final production architecture.
- Do not build a generic usage parser abstraction unless the Rust scanner needs it more than once.

## Phase 1: Lock The Contract

Purpose: make the migration measurable before replacing implementation.

Tasks:

1. Document the API contract currently consumed by the UI:
   - `RangeKey`
   - `ScanResponse`
   - `OverviewResponse`
   - error behavior for invalid ranges
2. Add fixture-backed tests for:
   - empty database overview
   - populated 1d / 7d / 30d overview totals
   - scan import upsert behavior
   - timezone date bucketing
3. Keep the fixtures small and representative.

Verify:

- `pnpm test`
- `pnpm typecheck`

Exit criteria:

- The current TypeScript sidecar behavior is captured tightly enough to compare the Rust implementation against it.

## Phase 2: Add Rust Domain Types And SQLite Layer

Purpose: establish the native backend without touching the frontend yet.

Tasks:

1. Add Rust dependencies in `src-tauri/Cargo.toml`:
   - `serde`
   - `serde_json`
   - `rusqlite` or `sqlx` with SQLite
   - a small date/time library such as `chrono` or `time`
2. Create Rust modules under `src-tauri/src/`:
   - `types.rs`
   - `db.rs`
   - `date.rs`
   - `overview.rs`
3. Port the current SQLite schema:
   - `daily_usage_rollups`
   - `scan_runs`
4. Implement:
   - database initialization
   - daily row upsert
   - latest update lookup
   - range query
   - overview calculation

Verify:

- `swift test` is not relevant here.
- `cargo test` from `src-tauri`
- Existing frontend tests remain unchanged.

Exit criteria:

- Rust can open the app data database, calculate overview responses, and pass fixture-backed Rust unit tests.

## Phase 3: Port Usage Scanning To Rust

Purpose: remove the dependency on `@ccusage/codex` for the production data path.

Tasks:

1. Inspect the local Codex usage data shape used by `@ccusage/codex`.
2. Implement the minimum Rust scanner needed for the current dashboard:
   - resolve `CODEX_HOME` or default Codex home
   - read local usage records
   - aggregate by natural day in the selected timezone
   - compute input, cached input, output, reasoning output, total tokens, and cost
   - preserve per-model JSON in `models_json`
3. Keep parser errors scoped:
   - unreadable file: skip with structured warning only if that matches current behavior
   - malformed record: skip or fail based on observed `@ccusage/codex` behavior
4. Add fixture tests for representative Codex log records.

Verify:

- `cargo test` from `src-tauri`
- Compare Rust scanner output against `@ccusage/codex daily --json` on a small fixture dataset.

Exit criteria:

- Rust scan output matches the existing sidecar contract for the dashboard fields.

## Phase 4: Add Tauri Commands

Purpose: expose the native backend to the UI without the local HTTP server.

Tasks:

1. Add app state for the database connection or database path.
2. Register commands:
   - `scan_usage`
   - `fetch_overview`
3. Return serialized payloads matching `src/lib/api.ts`.
4. Use Tauri app data directory for the SQLite database path.
5. Keep command names simple and stable.

Verify:

- `cargo test` from `src-tauri`
- `pnpm typecheck`
- `pnpm tauri dev`

Exit criteria:

- The native backend can serve scan and overview data through Tauri commands in development.

## Phase 5: Switch The Frontend Transport

Purpose: stop depending on `127.0.0.1:43110`.

Tasks:

1. Replace `fetch` calls in `src/lib/api.ts` with `invoke` from `@tauri-apps/api/core`.
2. Keep the exported TypeScript functions unchanged:
   - `scanUsage()`
   - `fetchOverview(range)`
3. Remove `VITE_API_BASE_URL` from the runtime path if it is no longer used.
4. Update UI error messages only if the error shape changes.

Verify:

- `pnpm typecheck`
- `pnpm test`
- `pnpm tauri dev`
- Use `playwright-cli` against `http://localhost:5173` after launching through `pnpm tauri dev`.

Exit criteria:

- The UI renders and rescans through Tauri commands without the sidecar API running.

## Phase 6: Remove Production Sidecar Startup And Bundle Resources

Purpose: make the packaged app self-contained.

Tasks:

1. Remove `start_sidecar`, `SidecarProcess`, and `resolve_node_binary` from `src-tauri/src/lib.rs`.
2. Remove sidecar resources from `src-tauri/tauri.conf.json`:
   - `../dist-sidecar/index.js`
   - `../node_modules/@ccusage/codex/dist/`
3. Remove local HTTP connect-src entries that are no longer required.
4. Remove `build:sidecar` from the production build path.
5. Keep development scripts only if they still serve a useful migration/debug purpose.

Verify:

- `pnpm build`
- `pnpm tauri build`
- Inspect the `.app` bundle and confirm no bundled JavaScript sidecar or `ccusage-codex` dist is present.

Exit criteria:

- The packaged app launches without system Node.js and can scan local usage.

## Phase 7: Cleanup And Documentation

Purpose: remove obsolete code after native behavior is verified.

Tasks:

1. Delete `src-sidecar/` once Rust tests cover the behavior.
2. Remove Node-only dependencies that are no longer needed:
   - `@ccusage/codex`
   - `tsup`
   - `tsx` if not used elsewhere
   - `concurrently` if dev startup no longer needs it
3. Update documentation:
   - `README.md`
   - `README_zh.md`
   - `AGENTS.md` Tauri debugging guidance
4. Update package scripts to reflect the new native path.

Verify:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `cargo test` from `src-tauri`
- `pnpm tauri build`

Exit criteria:

- The repo no longer contains an active JavaScript sidecar implementation.
- Docs describe the Rust/Tauri native architecture accurately.

## Risks

- `@ccusage/codex` may contain pricing, model alias, or log parsing rules that are easy to miss.
- Codex local log formats may change over time.
- Timezone bucketing can regress subtly if Rust and JavaScript date behavior differ.
- Tauri command errors may need a stable frontend error normalization layer.
- Keeping both implementations during migration can create drift if contract tests are weak.

## Recommended First PR

Start with Phase 1 only.

Reason:

- It is small.
- It does not risk packaging or runtime behavior.
- It creates the test surface needed to judge the Rust migration.

Success criteria for the first PR:

- Existing behavior is documented in tests.
- No production code path changes.
- `pnpm test` and `pnpm typecheck` pass.
