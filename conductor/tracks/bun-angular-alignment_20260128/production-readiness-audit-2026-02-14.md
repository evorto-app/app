# Production Readiness Audit — 2026-02-14

## Scope

Audit focus requested:
- Effect-first architecture
- Bun-first runtime/tooling
- Drizzle-first data layer
- Removal of stale/legacy code
- Documentation quality for complicated areas

## Validation Snapshot

- `bunx tsc -p tsconfig.app.json --noEmit` ✅
- `bunx tsc -p tsconfig.spec.json --noEmit` ✅
- `bun run lint:check` ✅ (warnings only; no errors)
- `bun run build:app` ✅ (warnings only)

## Findings (prioritized)

### P2 — Legacy server structure is still present as empty directories

- `src/server/trpc` (empty subfolders)
- `src/server/middleware` (empty)
- `src/types/express` (empty)

Impact:
- No runtime breakage, but these imply old architecture remains and create confusion for maintainers/new contributors.

Recommendation:
- Remove these empty directories and any stale references in docs/plans that still imply they are active.

### P2 — Dependency graph still includes likely stale or misplaced packages

- `auth0` appears in production dependencies, but current usage is test-only:
  - dependency declaration: `/Users/hedde/code/evorto/package.json:79`
  - usage: `/Users/hedde/code/evorto/tests/support/fixtures/base-test.ts:4`
- `playwright-core` appears as explicit dev dependency with no direct imports:
  - declaration: `/Users/hedde/code/evorto/package.json:131`
- Additional likely-unused dependency candidates surfaced by depcheck (needs manual confirmation due alias false positives):
  - `/Users/hedde/code/evorto/package.json:48`
  - `/Users/hedde/code/evorto/package.json:64`
  - `/Users/hedde/code/evorto/package.json:82`
  - `/Users/hedde/code/evorto/package.json:90`
  - `/Users/hedde/code/evorto/package.json:97`
  - `/Users/hedde/code/evorto/package.json:99`

Impact:
- Larger attack surface, slower installs, harder upgrades.

Recommendation:
- Run a controlled dependency-pruning pass with per-package verification and targeted smoke tests.

### P2 — Lint baseline still carries non-trivial modernization debt

Examples:
- Reactive Forms migration warnings:
  - `/Users/hedde/code/evorto/src/app/events/event-organize/receipt-submit-dialog.component.ts:7`
  - `/Users/hedde/code/evorto/src/app/finance/receipt-approval-detail/receipt-approval-detail.component.ts:9`
- stale `unicorn/no-null` suppressions now reported as unused:
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4133`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4150`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4198`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4311`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4328`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4381`
  - `/Users/hedde/code/evorto/src/server/effect/rpc/app-rpcs.handlers.ts:4406`

Impact:
- Tooling noise hides real regressions and slows review quality.

Recommendation:
- Execute a lint-debt cleanup phase and decide if `null` policy should be updated to fit Signal Forms reality.

### P3 — Build warnings show optimization and bundle-size pressure

- Bundle budget warning configured at 1MB while build outputs ~1.70MB:
  - `/Users/hedde/code/evorto/angular.json:80`
  - `/Users/hedde/code/evorto/angular.json:82`
- Known CJS optimization-bailout warnings (deepmerge, node-domexception, msgpackr-extract).
- Unused import warning:
  - `/Users/hedde/code/evorto/src/app/shared/components/inclusive-price-label/price-with-tax.component.ts:16`

Impact:
- Not a functional blocker, but performance/maintainability risk for production hardening.

Recommendation:
- Perform a focused bundle and dependency optimization pass.

### P3 — Test inventory documentation is stale

- Inventory header is outdated:
  - `/Users/hedde/code/evorto/tests/test-inventory.md:5`
- It lists storage-state freshness as missing while file exists:
  - claim: `/Users/hedde/code/evorto/tests/test-inventory.md:36`
  - existing test: `/Users/hedde/code/evorto/tests/specs/auth/storage-state-refresh.test.ts`

Impact:
- Misleads planning and coverage decisions.

Recommendation:
- Regenerate or manually refresh inventory docs as part of release readiness.

## Architecture Status (requested principles)

- Effect-first: Mostly achieved on server runtime and RPC handling (`src/server.ts`, `src/server/effect/rpc/**`).
- Bun-second: Achieved for runtime and scripts; Bun package-management blocker appears resolved in current workspace state.
- Drizzle-third: Achieved as active data layer (`src/db/**` + Effect RPC handlers).

## Proposed Hardening Sequence

1. Remove dead legacy directory structure and stale references.
2. Dependency pruning with lockfile refresh and focused smoke tests.
3. Lint debt cleanup (especially stale suppressions and forms strategy consistency).
4. Bundle optimization and warning reduction.
5. Documentation refresh (`tests/test-inventory.md`, runtime architecture notes).
