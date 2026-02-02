# Implementation Plan

## Phase 1: Scaffold new structure and guidance [checkpoint: 1acfaab]

- [x] Task: Create root `tests/` and `specs/` scaffolding (9ae8961) ac3b01e
  - [x] Add `tests/` with a short README describing scope and tag requirements
  - [x] Add `specs/` with a spec template file for track-based requirements
- [x] Task: Document layout and conventions (c798f35) 711fcb4
  - [x] Update existing docs or workflow references to point to `tests/` and `specs/`
  - [x] Note that `e2e/tests/**` is legacy reference and not run by default
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) 1acfaab

## Phase 2: Playwright configuration [checkpoint: d52f165]

- [x] Task: Update Playwright config to new layout 68594b5
  - [x] Set `testDir` to `./tests`
  - [x] Ensure doc-test project (or equivalent) targets `tests/docs/**`
  - [x] Ensure legacy `e2e/tests/**` is excluded from default runs
  - [x] Update any scripts/builders referencing old paths
- [x] Task: Add a minimal doc-test template in `tests/docs/**` 312dcbc
  - [x] Provide a tagged, skipped example to confirm discovery without breaking CI
- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md) d52f165

## Phase 3: Tag lint/check enforcement [checkpoint: 8123e7f]

- [x] Task: Implement tag lint/check for `tests/**` a20341f
  - [x] Add custom ESLint rule that checks Playwright tests for required tags
  - [x] Ensure it fails when `@track(...)` is missing
  - [x] Ensure `@req(...)` is required for non-doc tests
  - [x] Ensure `@doc(...)` is required for doc tests under `tests/docs/**`
- [x] Task: Wire tag check into lint workflow a20341f
  - [x] Ensure lint patterns include `tests/**/*.ts`
  - [x] Ensure `yarn lint` runs the tag check through ESLint
- [x] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md) 8123e7f

## Phase 4: Verification and wrap-up

- [~] Task: Verification run
  - [ ] Run `yarn lint`
  - [ ] Run `yarn build`
  - [ ] Run `yarn e2e`
  - [ ] Run `yarn e2e:docs`
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
