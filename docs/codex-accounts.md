# Codex accounts

The Accounts page keeps a separate local library of complete ChatGPT credentials. Viewing or refreshing a card does not select that account in Codex. Adding an account runs the official CLI in an empty temporary `CODEX_HOME` and saves the result without switching. Browser and device-code login can be cancelled and time out after ten minutes.

On first use, an existing local Codex sign-in is offered as **Add current Codex account**. Without a local sign-in, **Sign in with browser** starts authorization directly; **Use device code** is a secondary option. **Add another account** opens a login dialog without import options. Closing a running login leaves it active and focuses **Continue sign-in** on the Accounts page; **Cancel login** stops it. Account badges describe the saved Codex sign-in configuration, rather than asserting that running clients have loaded it.

Import saves the current file-based ChatGPT login. Re-login replaces only the same user and workspace. Accounts are identified by both `chatgpt_user_id` and `chatgpt_account_id`; email is only a display label. Remove deletes this application's record and cached status. Codex stays logged in, including when the removed account is current.

## Storage and refresh

`codex-accounts/accounts.json` lives inside the application data directory, separately from usage databases, exports, and usage-cache reset. It contains private **plaintext credentials**. Unix directories use `0700` and credential files use `0600`; Windows uses a current-user-only DACL. Tokens stay in Rust and are excluded from React responses, localStorage, and logs. Unknown native credential fields survive import, refresh, and switching.

The background schedule refreshes all saved accounts (five minutes by default), with at most three concurrent status requests. Each card retains its last successful limits, subscription, and reset-credit values independently. Failed queries show errors and stale data rather than zero quota or an inactive subscription. A subscription must match the requested workspace. `Retry-After` cooldowns also apply to manual refreshes.

Refreshes serialize per account. A newer Codex credential bundle is adopted when its generation can be established reliably. OAuth rotations are persisted before success is returned. Credential-version checks reject late results after re-login or removal. Equal or missing refresh timestamps cannot authorize overwriting a different token bundle.

Historical tokens and costs remain statistics for the selected Codex directory across accounts. They are not attributed to individual saved accounts. Session-credit requests and current sidebar/tray responses are invalidated when the login changes.

## Manual switching

Native writes are enabled only for the verified **`codex-cli 0.167.0`** authentication protocol. The lock implementation was checked against the upstream `rust-v0.167.0` release (`auth.lock`, followed by the resolved `auth.json.lock`). Other CLI versions can still be used to add accounts; extending write support requires checking their authentication backend, locking, and commit behavior first.

Only an absent `cli_auth_credentials_store` setting or the explicit `file` backend is accepted. `auto`, `keyring`, `ephemeral`, API-key authentication, ambiguous profile settings, managed configuration, and incompatible login/workspace restrictions prevent switching. macOS forced Codex preferences and Windows policy configuration also prevent native writes. The application never changes `config.toml`, model settings, reasoning effort, or MCP configuration.

Switching captures the selected environment and an opaque authentication context. Before committing, it checks that the environment, credentials, resolved symlink target, and authentication configuration have not changed. It archives the current complete credentials, saves a small pending journal, atomically replaces the native authentication file under Codex's stable locks, and verifies the stored identity. This is a recoverable sequence of writes, not a transaction spanning both files.

Startup recovery clears an interrupted journal only after examining native authentication. It never replays a credential write over an external change. A conflict is surfaced for review/retry. After a successful switch, a dialog reminds you to **restart the Codex desktop client or IDE** so it loads the new authentication. For Codex CLI, exit the current session and restart in non-daemon mode with `codex --no-daemon`. Alternatively, stop the Codex background server with `codex app-server daemon stop`, then start Codex CLI again. Select **Don't remind me again** to hide this dialog on future switches; the preference persists across application restarts, and a brief success status still confirms each switch.

For WSL, login runs in the selected distribution with an empty Linux temporary home. Native reads, locks, and atomic replacement run inside that distribution using Python 3.11+ (`tomllib`, `fcntl`); isolated login requires `setsid`. Missing tools disable the operation. Windows file locks are not used to protect Linux authentication files.

## Verification and release gate

Automated tests use synthetic tokens, isolated homes, and a localhost fixture server. The focused WDIO spec runs through the actual Tauri application:

```sh
pnpm exec wdio run ./wdio.conf.ts --spec ./e2e/codex-accounts.spec.ts
```

It covers different users sharing a workspace, independent status failures, rate-limit cooldowns, A → B → A switching with complete credentials and unchanged configuration, isolated login, mismatched re-login, cancellation/timeout process cleanup, token rotation, and a single retry after 401. Rust tests additionally cover stale writers, removal, lock contention, symlinks, permissions, and interrupted commits. The WSL helper is exercised in isolated local Unix tests; that does not establish Windows/WSL compatibility.

Real dedicated-account validation remains a release requirement and was **not performed** during implementation:

| Environment | Required manual checks | Status |
| --- | --- | --- |
| macOS | Official browser/device login, token rotation, restart identity, managed preferences | Pending |
| Windows Native | Official login, private ACLs, locked replacement, rotation, restart identity | Pending |
| Windows + WSL | Distribution selection, Linux locking/cancellation, official login, rotation, restart identity | Pending |

Record the exact CLI version and OS/distribution for each manual result. Never point the automated fixture suite at real account credentials.
