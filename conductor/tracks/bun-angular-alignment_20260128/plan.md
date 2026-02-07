# Implementation Plan

## Phase 1: Conductor Consolidation + Baseline Lock [checkpoint: pending]

- [ ] Task: Consolidate track artifacts from all provided references
  - [ ] Define test intent (documentation-only changes)
  - [ ] Merge prior `plan.md` + `codex-plan.md` into one execution plan
  - [ ] Update `spec.md` to use repomix baselines as source of truth
  - [ ] Set track status to in-progress in `conductor/tracks.md`
  - [ ] Commit milestone

- [ ] Task: Capture Bun baseline deltas against current repo
  - [ ] Define test intent (analysis-only)
  - [ ] Record script/config deltas from `repomix-output-angular-bun-setup-main.zip.xml`
  - [ ] Record Effect integration references from `repomix-output-effect-angular-main.zip.xml`
  - [ ] Commit milestone (if files changed)

- [ ] Task: Conductor - User Manual Verification 'Phase 1'

## Phase 2: Bun Tooling Cutover [checkpoint: pending]

- [ ] Task: Convert package manager metadata and lockfiles to Bun
  - [ ] Define test intent (install + lint/build smoke)
  - [ ] Set `packageManager` to Bun
  - [ ] Generate/commit Bun lockfile
  - [ ] Remove Yarn-specific lock/config artifacts no longer needed
  - [ ] Commit milestone

- [ ] Task: Align npm scripts to Bun baseline semantics
  - [ ] Define test intent (script execution smoke)
  - [ ] Convert Angular scripts to `bunx --bun ng`
  - [ ] Convert runtime scripts to Bun equivalents (`bun --bun ...`)
  - [ ] Replace Node-invoked helper scripts with Bun where possible
  - [ ] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 2'

## Phase 3: CI + Dev Workflow Bun Alignment [checkpoint: pending]

- [ ] Task: Update GitHub Actions workflows from Yarn/Node assumptions to Bun-first
  - [ ] Define test intent (workflow syntax + local command parity)
  - [ ] Replace Yarn install/run steps with Bun install/run
  - [ ] Keep required secrets/env setup behavior intact
  - [ ] Commit milestone

- [ ] Task: Update repository docs and operational commands to Bun-first
  - [ ] Define test intent (docs consistency)
  - [ ] Update root docs and workflow references from `yarn ...` to `bun run ...`
  - [ ] Keep database/testing operational notes accurate
  - [ ] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 3'

## Phase 4: Bun Runtime + Quality Gates [checkpoint: pending]

- [ ] Task: Validate Bun-based lint and build gates
  - [ ] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [ ] Fix migration regressions uncovered by lint/build
  - [ ] Commit milestone

- [ ] Task: Validate Bun SSR startup path
  - [ ] Define test intent (`bun run serve:ssr:evorto` smoke)
  - [ ] Verify server starts and health route responds
  - [ ] Commit milestone (if changes required)

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
