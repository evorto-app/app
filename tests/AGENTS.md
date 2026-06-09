# Test Guidelines

- Playwright e2e/docs tests in `tests/**` are the active end-to-end suite.
- Runtime baseline is Docker test stack (`bun run docker:start:foreground`) with `reuseExistingServer: true`.
- Testing/runtime context lives in `tests/README.md`. Seed/reset details that tests depend on live in `helpers/README.md`.
- If UI/runtime changes are not reflected, restart containers before rerunning e2e.
- Ensure DB is reset/seeded for deterministic auth/setup flows.
- Keep test inventory and docs-related expectations current in track documentation files when reality changes.
- After every test file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited test files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing a test file, run WebStorm `get_file_problems` on that file when possible before finishing.
