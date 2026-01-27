# Playwright Tests

This directory holds all runnable Playwright tests. Legacy suites remain in `e2e/tests/**` for reference only and are not executed by default.

## Structure

- `tests/docs/**` documentation journeys (`*.doc.ts`)
- `tests/specs/**` requirement/regression specs (`*.spec.ts` or `*.test.ts`)
- `tests/setup/**` setup tasks (`*.setup.ts`) when needed

## Required tags

- Non-doc tests: `@track(<track_id>)` and `@req(<requirement_id>)`
- Doc tests: `@track(<track_id>)` and `@doc(<doc_id>)`

## Specs linkage

Create a `specs/<track_id>-<slug>.md` for each Conductor track using `specs/template.md`.
