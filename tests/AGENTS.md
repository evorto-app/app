# Test Guidelines

- Playwright e2e/docs tests in `tests/**` are the active end-to-end suite.
- Runtime baseline is Docker test stack (`bun run docker:start:foreground`) with `reuseExistingServer: true`.
- If UI/runtime changes are not reflected, restart containers before rerunning e2e.
- Ensure DB is reset/seeded for deterministic auth/setup flows.
- Keep test inventory and docs-related expectations current in track documentation files when reality changes.
- After editing a test file, run `bun run lint:fix` first and then run WebStorm `get_file_problems` on that file when possible before finishing.
