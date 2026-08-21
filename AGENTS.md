# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Tauri UI Debugging

**Use playwright-cli instead of the built-in Codex browser during debugging and testing.**
**Use `playwright-cli` for UI inspection, but always start from the real Tauri startup path.**

Recommended workflow in this repo:
- Start the app with `pnpm tauri dev`, not just `pnpm dev`. The UI depends on Tauri commands backed by the native Rust usage pipeline.
- Before starting `pnpm tauri dev`, check if the development server has already been started. If it has, please reuse it.
- If the issue looks like loading, sync, or missing data, inspect the Tauri command path and Rust logs before blaming React.
- Use `playwright-cli` against `http://localhost:5173` to inspect the rendered UI state:
  - `playwright-cli open http://localhost:5173`
  - `playwright-cli snapshot`
  - `playwright-cli console`
  - `playwright-cli network`
  - `playwright-cli click <target>`
  - `playwright-cli run-code "<playwright code>"`

Preferred `playwright-cli` usage:
- Use `snapshot` first to get stable element refs before clicking or reading state.
- Use `console` before changing code. Confirm whether the page is failing in UI state, invoke state, or startup state.
- Use `run-code` when you need exact DOM state after a delay, for example waiting a few seconds and then reading `document.body.innerText`.
- If a session is unreliable, open a fresh browser and inspect in the same command flow instead of assuming `attach` will work.

Known pitfalls to avoid:
- Do not assume `Data sync failed` or `Load failed` means the React code is broken. In this app it can mean a Tauri command, Rust scanner, app data path, or Codex log parsing failure.
- Do not run `pnpm dev` and `pnpm tauri dev` independently on the same port unless you intend to. Port `5173` conflicts will break Tauri startup and look unrelated.
- Do not rely on `playwright-cli` alone to prove a Tauri-only bug. It is useful for React/UI behavior, but it is still a browser approximation of the WebView path.
- In React dev mode, `StrictMode` re-runs effects. If startup logic lives in `useEffect`, guard against duplicate bootstrap requests and loading-state flicker.
- If data is already on screen, avoid replacing the whole view with a full-page loading card for background refreshes unless that behavior is explicitly desired.

## Git
After completing the task, if there are no issues, commit the changes to Git. Write by Conventional Commits style in English.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
