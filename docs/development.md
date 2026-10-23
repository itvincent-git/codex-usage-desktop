# Development debugging

## Simulate the credits balance

Set `CODEX_USAGE_DEBUG_CREDITS` when starting the native Tauri app to preview different credits balance states in the dashboard. This override is available only in Rust builds with debug assertions enabled, such as `pnpm tauri dev`; release builds ignore it.

From the repository root, run one of these commands in a POSIX shell (such as zsh or bash):

```bash
# Positive balance, including decimal precision
CODEX_USAGE_DEBUG_CREDITS=1250.500001 pnpm tauri dev

# No credits remaining
CODEX_USAGE_DEBUG_CREDITS=0 pnpm tauri dev

# Unlimited credits
CODEX_USAGE_DEBUG_CREDITS=unlimited pnpm tauri dev

# Credits information unavailable
CODEX_USAGE_DEBUG_CREDITS=unavailable pnpm tauri dev
```

After limits load successfully, check **Credits balance** in the dashboard. It should show the supplied number, **Unlimited**, or **Unavailable**, together with a **Simulated data** badge when the interface language is English.

The override runs in the Rust backend after a successful limits fetch. Keep your normal local Codex authentication available; this setting does not bypass authentication or simulate a successful fetch. Running `pnpm dev` alone starts only Vite and does not exercise this native override.

### Accepted values

| Value | Result |
| --- | --- |
| Any finite, non-negative number | Uses the trimmed input as the balance; `hasCredits` is true only when the number is greater than zero. |
| `unlimited` | Sets unlimited credits with no numeric balance. |
| `unavailable` | Removes credits information from the response. |

Surrounding whitespace is trimmed. The keywords are case-sensitive. Invalid values, such as negative numbers, `NaN`, `inf`, an empty string, or arbitrary text, are ignored with a warning in the application logs, leaving the fetched credits data unchanged.

Only the credits balance data is overridden and marked with `creditsIsMock`. Session and weekly limits, reset credits, and the actual account balance are unchanged.

### Return to real credits data

Stop the app and restart it without the variable:

```bash
pnpm tauri dev
```

The inline assignments above apply only to their individual commands. If you previously exported the variable in your shell, remove it before restarting:

```bash
unset CODEX_USAGE_DEBUG_CREDITS
pnpm tauri dev
```

### Implementation references

* [`src-tauri/src/codex_limits.rs`](../src-tauri/src/codex_limits.rs): `fetch_codex_limits`, `apply_debug_credits`, and the `debug_credits_cover_balances_unlimited_and_unavailable` regression test.
* [`src/components/dashboard-hero-card.tsx`](../src/components/dashboard-hero-card.tsx): credits balance and simulated-data badge rendering.
