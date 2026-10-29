# Local Preflight Checks Before GitHub Actions

Before triggering a release through GitHub Actions, run and pass these two checks locally:

1. `pnpm test`: Run tests, including translation completeness and release script checks.
2. `pnpm typecheck`: Check TypeScript types in frontend and E2E code.
