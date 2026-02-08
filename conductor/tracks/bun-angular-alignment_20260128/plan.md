# Implementation Plan

## Phase 1: Conductor Consolidation + Baseline Lock [checkpoint: pending]

- [x] Task: Consolidate track artifacts from all provided references (b5902fc)
  - [x] Define test intent (documentation-only changes)
  - [x] Merge prior `plan.md` + `codex-plan.md` into one execution plan
  - [x] Update `spec.md` to use repomix baselines as source of truth
  - [x] Set track status to in-progress in `conductor/tracks.md`
  - [x] Commit milestone

- [x] Task: Capture Bun baseline deltas against current repo (b5902fc)
  - [x] Define test intent (analysis-only)
  - [x] Record script/config deltas from `repomix-output-angular-bun-setup-main.zip.xml`
  - [x] Record Effect integration references from `repomix-output-effect-angular-main.zip.xml`
  - [x] Commit milestone (if files changed)

- [ ] Task: Conductor - User Manual Verification 'Phase 1'

## Phase 2: Bun Tooling Cutover [checkpoint: pending]

- [x] Task: Convert package manager metadata and lockfiles to Bun (be16879)
  - [x] Define test intent (install + lint/build smoke)
  - [x] Set `packageManager` to Bun
  - [x] Generate/commit Bun lockfile
  - [x] Remove Yarn-specific lock/config artifacts no longer needed
  - [x] Commit milestone

- [x] Task: Align npm scripts to Bun baseline semantics (be16879)
  - [x] Define test intent (script execution smoke)
  - [x] Convert Angular scripts to `bunx --bun ng`
  - [x] Convert runtime scripts to Bun equivalents (`bun --bun ...`)
  - [x] Replace Node-invoked helper scripts with Bun where possible
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 2'

## Phase 3: CI + Dev Workflow Bun Alignment [checkpoint: pending]

- [x] Task: Update GitHub Actions workflows from Yarn/Node assumptions to Bun-first (919a4ed)
  - [x] Define test intent (workflow syntax + local command parity)
  - [x] Replace Yarn install/run steps with Bun install/run
  - [x] Keep required secrets/env setup behavior intact
  - [x] Commit milestone

- [x] Task: Update repository docs and operational commands to Bun-first (919a4ed)
  - [x] Define test intent (docs consistency)
  - [x] Update root docs and workflow references from `yarn ...` to `bun run ...`
  - [x] Keep database/testing operational notes accurate
  - [x] Commit milestone

- [x] Task: Remove remaining Yarn fallback assumptions from local tooling bootstrap (4dbd486)
  - [x] Define test intent (`bun run check:tiptap-license`)
  - [x] Enforce Bun lockfile as the single source in helper validation scripts
  - [x] Align Codex environment setup bootstrap to `bun install --frozen-lockfile`
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 3'

## Phase 4: Bun Runtime + Quality Gates [checkpoint: pending]

- [x] Task: Validate Bun-based lint and build gates (85d8ad7)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Fix migration regressions uncovered by lint/build
  - [x] Commit milestone

- [x] Task: Validate Bun SSR startup path (85d8ad7)
  - [x] Define test intent (`bun run serve:ssr:evorto` smoke)
  - [x] Verify server starts and health route responds
  - [x] Commit milestone (if changes required)

- [x] Task: Apply Angular modernize transforms for latest template/class syntax (85d8ad7)
  - [x] Define test intent (`bun run lint:fix`, `bun run build`)
  - [x] Run Angular modernize migrations on `src/app`
  - [x] Verify migrated templates/components compile successfully
  - [x] Commit milestone

- [x] Task: Restore Bun unit-test runner type alignment (0bbb795)
  - [x] Define test intent (`bun run test`, `bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add missing Jasmine type definitions required by current spec files
  - [x] Align `registration-start-offset` pipe signature/spec with strict typing + lint rules
  - [x] Validation note: `bun run e2e --project=setup` still blocked by Neon DB connectivity in current shell environment

- [x] Task: Stabilize Playwright setup path for Bun + Neon local + SSR RPC bridge (f66c383)
  - [x] Define test intent (`bun run docker:start`, `playwright --project=setup`, targeted local-chrome smoke)
  - [x] Disable websocket-only Neon paths for local proxy usage in app/test database clients
  - [x] Remove transaction-only seed registration writes that trigger Neon websocket fallback in local Bun runs
  - [x] Align runtime test defaults to deterministic local ports (`4200`/`55432`) to avoid callback drift
  - [x] Resolve Effect RPC SSR transport URL by using absolute server-side `/rpc` origin from `BASE_URL`
  - [x] Validation result: setup project passes (`7/7`) with Bun + Docker local stack
  - [x] Validation note: local-chrome currently stops at `tests/specs/discounts/esn-discounts.test.ts` waiting for `Pay now` checkout link

- [x] Task: Stabilize Stripe checkout registration path for discounts under Bun local-chrome (875b56d)
  - [x] Define test intent (`bun run lint`, `bun run build`, targeted local-chrome discounts test)
  - [x] Remove Bun-incompatible transaction wrapping in `registerForEvent` and keep explicit rollback behavior
  - [x] Remove temporary diagnostics and keep concise server-side error logging
  - [x] Scope discounts e2e Pay button selection to the intended registration option and increase checkout-link wait budget
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 4'

## Phase 5: Effect Migration Foundation (Next Step Within Track) [checkpoint: pending]

- [x] Task: Draft concrete cutover map from tRPC/Express to Effect HTTP/RPC layers (b4ebff0)
  - [x] Define test intent (design-only)
  - [x] Identify module-by-module replacement order under `src/server/**` and `src/app/core/**`
  - [x] Identify contract-sharing strategy for Angular RPC client helpers
  - [x] Commit milestone

- [x] Task: Implement first Effect boundary slice (small vertical) (1343542)
  - [x] Define test intent (targeted lint/build + runtime parity)
  - [x] Migrate one bounded server route/procedure path to Effect-first structure
  - [x] Preserve type safety and tests
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 5'

## Phase 6: Effect RPC Protocol + Angular Client Bridge [checkpoint: pending]

- [x] Task: Stand up shared Effect RPC contracts and `/rpc` server endpoint for config bootstrap (c11b0b0)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`, SSR health smoke)
  - [x] Add shared RPC contract module under `src/shared/**`
  - [x] Add Effect RPC handler layer and mount `/rpc` endpoint in server runtime
  - [x] Keep existing `/trpc` path running for non-migrated domains
  - [x] Commit milestone
  - [x] Validation note: SSR health smoke attempted; blocked by local Neon prerequisites (`NEON_PROJECT_ID`) and DB connectivity in current environment

- [x] Task: Migrate Angular config bootstrap to Effect RPC client/helpers (8434092)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add Angular Effect RPC client wiring in `app.config.ts`
  - [x] Replace `config.public` bootstrap call path from tRPC to Effect RPC
  - [x] Preserve runtime behavior and strict typing
  - [x] Commit milestone

- [x] Task: Extend config bootstrap migration with Effect RPC permissions/auth procedures (394d769)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add shared RPC contracts for `config.permissions` and `config.isAuthenticated`
  - [x] Bridge middleware-derived auth/permission context into `/rpc` handler path
  - [x] Migrate `ConfigService` permissions bootstrap from tRPC to Effect RPC
  - [x] Capture integration constraints and next-step guidance in track docs
  - [x] Commit milestone

- [x] Task: Migrate guard-level auth checks from tRPC to Effect RPC (2c64751)
  - [x] Define test intent (`bun run lint`, `bun run build`)
  - [x] Replace `config.isAuthenticated` guard calls in `auth.guard.ts`
  - [x] Replace `config.isAuthenticated` guard calls in `user-account.guard.ts`
  - [x] Keep unrelated user profile lookups on tRPC until matching RPC procedures are migrated
  - [x] Commit milestone

- [x] Task: Migrate `config.isAuthenticated`/`config.permissions` queryOptions callsites to Effect RPC helpers (e6f9b85)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Update `Auth` service config queryOptions calls to Effect RPC helpers
  - [x] Update navigation and event registration components config auth queryOptions calls
  - [x] Keep non-config tRPC queries/mutations in place for phased migration
  - [x] Commit milestone

- [x] Task: Migrate `config.tenant` read/invalidation paths to Effect RPC bridge (9c97fe0)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`, SSR health smoke)
  - [x] Extend shared config RPC contracts and `/rpc` header bridge with tenant context
  - [x] Move `ConfigService` tenant bootstrap/queryOptions from tRPC to Effect RPC
  - [x] Update admin tenant settings invalidation to use Effect RPC path keys
  - [x] Commit milestone
  - [x] Validation note: SSR health smoke currently blocked in local shell when OIDC env values (`CLIENT_ID` etc.) are not exported

- [x] Task: Decommission unused tRPC `config` router surface after Effect RPC cutover (e8ac353)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Remove `config` namespace from tRPC app router composition
  - [x] Delete obsolete `src/server/trpc/core/config.router.ts`
  - [x] Commit milestone

- [x] Task: Migrate `icons` domain from tRPC to Effect RPC vertical slice (b386bc0)
  - [x] Define test intent (`CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted templates e2e + docs e2e)
  - [x] Add shared Effect RPC contracts and server handlers for `icons.search` + `icons.add`
  - [x] Migrate Angular icon selector callsites from `injectTRPC()` to Effect RPC client/helpers
  - [x] Decommission `icons` namespace from tRPC app router composition
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 6'

## Final Gate

- [x] Run full quality gates in Bun-first mode (54c27f8)
  - [x] `CI=true bun run lint:fix`
  - [x] `CI=true bun run lint`
  - [x] `CI=true bun run build`
  - [x] `CI=true bun run test`
  - [x] `CI=true bun run e2e`
  - [x] `CI=true bun run e2e:docs`
- [x] Add/update Knope change file documenting migration status and scope (54c27f8)

## Validation Snapshot (2026-02-07)

- `bun run lint:fix` passes with existing repo warnings only.
- `bun run lint` passes with existing repo warnings only.
- `bun run build` passes.
- `bun run test` passes after restoring Jasmine type package and strict pipe signature alignment.
- `bunx --bun playwright test --project=setup` passes (`7/7`) with Docker + `NO_WEBSERVER=true`.
- `CI=true bun run lint` passes (warnings only).
- `CI=true bun run build` passes.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && NO_WEBSERVER=true CI=true bunx --bun playwright test tests/specs/discounts/esn-discounts.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after checkout-path stabilization.
- Local-chrome discounts flow now validates Stripe checkout-link creation (`Pay now`) reliably in repeated runs.
- `CI=true bun run e2e` passes: `65 passed`, `6 skipped` (Playwright summary).
- `CI=true bun run e2e:docs` passes: `23 passed` (Playwright summary).
- `tests/specs/templates/templates.test.ts` passes end-to-end with unique title generation and Bun-safe template create/update server path.
- `tests/docs/profile/discounts.doc.ts` and `tests/docs/events/event-approval.doc.ts` pass under docs project with deterministic navigation/seeding.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after icons Effect RPC migration (`11 passed`).
- `CI=true bun run e2e:docs` re-run passes after icons Effect RPC migration (`23 passed`).

## Session Handoff

- Detailed continuation context for this checkpoint is captured in:
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-07.md`
