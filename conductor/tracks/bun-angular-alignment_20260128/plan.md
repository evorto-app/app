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

- [ ] Task: Draft concrete cutover map from tRPC/Express to Effect HTTP/RPC layers
  - [ ] Define test intent (design-only)
  - [ ] Identify module-by-module replacement order under `src/server/**` and `src/app/core/**`
  - [ ] Identify contract-sharing strategy for Angular RPC client helpers
  - [ ] Commit milestone

- [ ] Task: Implement first Effect boundary slice (small vertical)
  - [ ] Define test intent (targeted unit or e2e/doc where applicable)
  - [ ] Migrate one bounded server route/procedure path to Effect-first structure
  - [ ] Preserve type safety and tests
  - [ ] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 5'

## Final Gate

- [ ] Run full quality gates in Bun-first mode:
  - [ ] `bun run lint:fix`
  - [ ] `bun run lint`
  - [ ] `bun run build`
  - [ ] `bun run test`
  - [ ] `bun run e2e`
  - [ ] `bun run e2e:docs`
- [ ] Add/update Knope change file documenting migration status and scope
