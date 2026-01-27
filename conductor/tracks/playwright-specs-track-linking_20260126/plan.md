# Implementation Plan

## Phase 1: Scaffold new structure and guidance

- [x] Task: Create root `tests/` and `specs/` scaffolding (9ae8961)
  - [x] Add `tests/` with a short README describing scope and tag requirements
  - [x] Add `specs/` with a spec template file for track-based requirements
- [x] Task: Document layout and conventions (c798f35)
  - [x] Update existing docs or workflow references to point to `tests/` and `specs/`
  - [x] Note that `e2e/tests/**` is legacy reference and not run by default
- [~] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Playwright configuration

- [ ] Task: Update Playwright config to new layout
  - [ ] Set `testDir` to `./tests`
  - [ ] Ensure doc-test project (or equivalent) targets `tests/docs/**`
  - [ ] Ensure legacy `e2e/tests/**` is excluded from default runs
  - [ ] Update any scripts/builders referencing old paths
- [ ] Task: Add a minimal doc-test template in `tests/docs/**`
  - [ ] Provide a tagged, skipped example to confirm discovery without breaking CI
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Tag lint/check enforcement

- [ ] Task: Implement tag lint/check for `tests/**`
  - [ ] Add a script (Node/TS) that scans Playwright tests for required tags
  - [ ] Ensure it fails when `@track(...)` is missing
  - [ ] Ensure `@req(...)` is required for non-doc tests
  - [ ] Ensure `@doc(...)` is required for doc tests under `tests/docs/**`
- [ ] Task: Wire tag check into lint workflow
  - [ ] Add a script entry in `package.json`
  - [ ] Ensure `yarn lint` (or equivalent) runs the tag check
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Verification and wrap-up

- [ ] Task: Verification run
  - [ ] Run `yarn lint`
  - [ ] Run `yarn build`
  - [ ] Run `yarn e2e`
  - [ ] Run `yarn e2e:docs`
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
