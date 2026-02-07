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

- [ ] Task: Conductor - User Manual Verification 'Phase 6'

## Final Gate

- [ ] Run full quality gates in Bun-first mode:
  - [ ] `bun run lint:fix`
  - [ ] `bun run lint`
  - [ ] `bun run build`
  - [ ] `bun run test`
  - [ ] `bun run e2e`
  - [ ] `bun run e2e:docs`
- [ ] Add/update Knope change file documenting migration status and scope
