# Session balance credits

The display setting is off by default. Enabling it only queries expanded, loaded
session cards, including the cards currently shown in an agent group. It does not
change token estimates, daily totals, agent totals, exports, or the menu bar.

Each amount is a **session lifetime balance debit**, even when the session appears
on several dates. It may include promotional credits, refunds, and adjustments.
Missing or unavailable amounts are not zero. Parent/child ownership is not inferred.

The contract follows `codex-cli/codex-rs/backend-client/src/client/task_usage.rs`:
`POST /backend-api/wham/usage/thread_usage/query_v2`, with up to 100 independent
threads per HTTP request and no descendant IDs in this version. Amounts stay exact
decimal strings in Rust, SQLite, and TypeScript; the tooltip retains the raw value.

Only ChatGPT credentials with both account and user identities can query this API.
SQLite entries are isolated by Codex environment, account, user, and thread UUID.
Credentials never enter the frontend or the cache. Identity is checked before and
after requests, on foreground/page activation, and on existing background refresh
events. External credential edits are detected at these events, without a new poller.

Complete active-session entries expire after five minutes; sessions inactive for
more than 24 hours use a 24-hour TTL. Partial, unavailable, and omitted rows use five
minutes. Local activity invalidates entries with a five-minute minimum automatic
retry interval. Manual refresh bypasses data TTLs but respects request cooldowns.
Failures retain previous successful values with a cached-data label. A 403 blocks
automatic requests until manual retry after cooldown or an identity change. A 401
re-reads credentials and retries once. No OAuth refresh flow is added.

Queries are serial and re-check the cache after waiting, deduplicating overlapping
requests. Scope revisions stop queued batches when the display is disabled or its
range becomes inactive; already-sent HTTP requests may finish. Reset cache clears
both debit entries and cooldowns. Disabling the display retains them.

For a debug build with no sign-in or credits balance required:

```sh
CODEX_USAGE_DEBUG_SESSION_CREDITS=demo rtk pnpm tauri dev
```

The demo returns interface-shaped JSON through the real parser. It includes exact
zero, null, partial, negative, tiny/scientific amounts and omitted rows. Values are
stable by UUID, explicitly labeled simulated, and cached only in separate memory.
The activation branch is excluded from release builds.

Focused native acceptance uses a temporary Codex home, temporary app database, and
local HTTP fixture. Endpoint/data-directory overrides are only compiled with `e2e`:

```sh
rtk pnpm exec wdio run ./wdio.conf.ts --spec ./e2e/session-credits.spec.ts
```
