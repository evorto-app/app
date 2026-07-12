# Test Guidelines

- Playwright e2e/docs tests in `tests/**` are the active end-to-end suite.
- Runtime baseline is Docker test stack (`bun run docker:start:foreground`) with `reuseExistingServer: true`.
- Testing/runtime context lives in `tests/README.md`. Seed/reset details that tests depend on live in `helpers/README.md`.
- If UI/runtime changes are not reflected, restart containers before rerunning e2e.
- Ensure DB is reset/seeded for deterministic auth/setup flows.
- Keep test inventory and docs-related expectations current in track documentation files when reality changes.
- Transfer coverage must prove that the registration, guest quantity, every
  included/free/purchased add-on quantity, and check-in/fulfillment history move
  unchanged as one fixed bundle that the recipient cannot omit or re-quantity.
  Price it from current base prices with recipient-current discounts only,
  refund every original Stripe source exactly, and allow database-only transfer
  only for a wholly free bundle with no refund.
- Paid event/add-on tests use Stripe-shaped sources only. Do not document a
  cash/manual paid-event cancellation as supported behavior.
- Google Maps is required release evidence. Cloudflare Images removal is not a
  provider release gate.
- After every test file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited test files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing a test file, run WebStorm `get_file_problems` on that file when possible before finishing.
