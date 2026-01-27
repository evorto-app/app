# Track Spec: Playwright specs + Conductor track linking

## Overview

Set up a new Playwright testing structure that uses root `tests/` for runnable tests and root `specs/` for human-readable requirement specs mapped to Conductor tracks. Existing tests under `e2e/tests/**` (including `e2e/tests/docs/**`) remain as legacy reference and are not run by default. New doc tests live under `tests/docs/**`. Add a lint/check that enforces required tags on new tests.

## Functional Requirements

- Introduce root `tests/` for new Playwright tests and root `specs/` for requirements specs.
- Update Playwright configuration to run only tests from root `tests/`.
- Add a spec template that links to Conductor tracks, requirements, and test files.
- Add `@track(<track_id>)` and `@req(<id>)` tags to new Playwright tests.
- Add `@track(<track_id>)` and `@doc(<id>)` tags to new doc tests.
- Add a lint/check step that fails when required tags are missing in `tests/**`.

## Non-Functional Requirements

- Preserve existing test artifacts as reference; do not modify or move legacy tests.
- Keep the change understandable and low-friction for future track-based test authoring.

## Acceptance Criteria

- `playwright.config.ts` runs tests from root `tests/` only.
- A `specs/` template exists and is referenced in workflow/docs.
- New doc tests in `tests/docs/**` run via the doc test command.
- New tests include `@track(...)` + `@req(...)` tags.
- New doc tests include `@track(...)` + `@doc(...)` tags.
- Each track has a corresponding `specs/<track_id>-<slug>.md` listing test and doc test files.
- The lint/check fails when tags are missing in `tests/**`.

## Out of Scope

- Fixing or refactoring legacy tests.
- Moving or rewriting existing tests.

## Assumptions / Open Decisions

- Tag formats are `@track(...)`, `@req(...)`, `@doc(...)`.
- Doc test runner targets `tests/docs/**` for new doc tests.
