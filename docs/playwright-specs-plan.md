# Playwright Specs + Track Linking Plan

Status: planning only. No project changes have been made yet.

## Goals
- Follow Playwright agent layout: root `tests/` for runnable Playwright tests and root `specs/` for human-readable spec files.
- Track requirements coverage by linking Playwright tests to Conductor tracks.
- Also link doc tests to the Conductor tracks they belong to.
- Keep the plan explicit so it is easy to resume later.

## Target structure (Option A)
- `tests/` (new root directory)
  - all Playwright tests (formerly in `e2e/tests/**`)
  - shared fixtures, helpers, and page objects
  - any Playwright test utilities currently under `e2e/**`
- `specs/` (new root directory)
  - markdown specs that map to Conductor tracks
  - each spec links to the Conductor track and lists test files covering its requirements
- `e2e/` (legacy)
  - should be emptied or left only for non-test assets if truly needed (decide during migration)

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
- e2e/tests/docs/<path-to-doc-test>.doc.ts

## Notes
- <anything special about setup, fixtures, or data>
```

## Plan steps

### 1) Confirm conventions and scope
- Confirm the final tag format (examples: `@track(001-foo_20250125)` and `@req(payments-01)`).
- Decide what requirement IDs look like (track spec section IDs, explicit IDs in track spec, or free-form slugs).
- Decide where Playwright shared helpers live after migration (likely `tests/_support` or `tests/fixtures`).
- Decide if doc tests remain under `e2e/tests/docs/**` or also move under `tests/docs/**`.
- Decide whether to keep `e2e/` as a legacy directory or remove it after migration.

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
- Move Playwright tests from `e2e/tests/**` to `tests/**`.
- Move fixtures/helpers to `tests/**` (or a dedicated subfolder).
- Update all import paths in moved files.
- Update any snapshots or output directories if Playwright derives them from file paths.
- Decide the fate of `e2e/` (empty it, remove it, or keep only non-test assets).

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
- Final tag formats for tracks, requirements, and docs.
- Whether doc tests move to `tests/docs/**` or remain in `e2e/tests/docs/**`.
- Whether to keep or remove `e2e/` after migration.

