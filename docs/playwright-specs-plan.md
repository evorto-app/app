# Playwright Specs + Track Linking Plan

Status: in progress. Root `tests/` + `specs/` scaffolding is in place; `e2e/` remains legacy reference.

## Goals

- Follow Playwright agent layout: root `tests/` for runnable Playwright tests and root `specs/` for human-readable spec files.
- Track requirements coverage by linking Playwright tests to Conductor tracks.
- Also link doc tests to the Conductor tracks they belong to.
- Keep the plan explicit so it is easy to resume later.

## Target structure (Option A)

- `tests/` (new root directory)
  - all new Playwright tests (legacy tests remain in `e2e/tests/**`)
  - shared fixtures, helpers, and page objects
  - any Playwright test utilities currently under `e2e/**`
- `specs/` (new root directory)
  - markdown specs that map to Conductor tracks
  - each spec links to the Conductor track and lists test files covering its requirements
- `e2e/` (legacy)
  - keep existing tests as reference; not run by default
  - keep shared helpers/reporters until migrated

## Conductor linkage conventions (proposed)

- Each Conductor track: `conductor/tracks/<track_id>/spec.md`
- Each Playwright spec: `specs/<track_id>-<slug>.md`
- Each Playwright test file: add tags in `test.describe` or `test` titles:
  - `@track(<track_id>)`
  - `@req(<requirement_id_or_slug>)`
- Each doc test file: add tags in the same style:
  - `@track(<track_id>)`
  - `@doc(<doc_id_or_slug>)`

## Spec file template (draft)

```
# <Spec Title>

Conductor Track: conductor/tracks/<track_id>/spec.md

## Requirements covered
- <req-id-or-slug>: <short requirement summary>
- <req-id-or-slug>: <short requirement summary>

## Tests implementing this spec
- tests/<path-to-test-file>.spec.ts
- tests/<path-to-test-file>.test.ts

## Doc tests implementing this spec
- tests/docs/<path-to-doc-test>.doc.ts

## Notes
- <anything special about setup, fixtures, or data>
```

## Plan steps

### 1) Confirm conventions and scope

- Confirm the final tag format (examples: `@track(001-foo_20250125)` and `@req(payments-01)`).
- Decide what requirement IDs look like (track spec section IDs, explicit IDs in track spec, or free-form slugs).
- Decide where Playwright shared helpers live after migration (likely `tests/_support` or `tests/fixtures`).
- Doc tests for new work live under `tests/docs/**`.
- Keep `e2e/` as a legacy directory; do not move existing tests in this track.

### 2) Inventory current layout and references

- List current test locations under `e2e/tests/**`.
- Identify any fixtures/helpers under `e2e/**`.
- Check `playwright.config.ts` for `testDir`, `outputDir`, snapshot locations, and any path assumptions.
- Check scripts or CI config that reference `e2e/**` paths (e.g., `package.json`, `angular.json`, CI workflows).
- Check doc tests location and how `yarn e2e:docs` discovers them.

### 3) Configuration updates (planned)

- Update `playwright.config.ts`:
  - `testDir` -> `./tests`
  - verify `outputDir`, `snapshotPathTemplate`, and any `expect` snapshots that assume `e2e/`
- Update scripts or builders that reference old paths (if any).
- Confirm that doc test runner still finds doc tests after the chosen location is set.

### 4) File moves (planned)

- Do not move legacy tests in this track; keep `e2e/tests/**` as reference.
- New tests and helpers belong under `tests/**` going forward.
- Revisit any migrations of fixtures/helpers as a separate track when ready.

### 5) Introduce `specs/` workflow (planned)

- Create `specs/` directory.
- Add a spec template (like the one above).
- Add guidance in README or workflow notes about creating a spec file per Conductor track.
- Ensure each spec links to:
  - Conductor track spec
  - Playwright test files
  - Doc test files

### 6) Link tests and doc tests to tracks (planned)

- Add `@track(...)` tags to Playwright tests.
- Add `@req(...)` tags for each requirement where possible.
- Add `@track(...)` + `@doc(...)` tags to doc tests.
- Ensure test titles remain readable while containing tags.

### 7) Verification and safety

- Run a targeted Playwright test to confirm the new `testDir` works.
- Run full `yarn e2e` to validate the full suite.
- Run `yarn e2e:docs` to ensure doc tests still work.
- If failures occur, rollback:
  - revert file moves and config changes
  - restore old paths

## Open decisions (need user confirmation before implementation)

- None for this track; revisit any migration of legacy tests in a future track.
