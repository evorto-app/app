# Playwright Tests

This directory contains the active Playwright suite.

## Structure

- Functional/e2e tests: `tests/specs/**`
- Documentation tests: `tests/docs/**`
- Setup/auth/database bootstrapping lives in `tests/setup/**`
- Shared fixtures/utilities/reporters live in `tests/support/fixtures/**`, `tests/support/utils/**`, `tests/support/reporters/**`

## Required Tags

All tests in `tests/**/*.ts` are linted with a custom ESLint rule:

- `@track(<track_id>)` is required for every test title
- `@req(<id>)` is required for non-doc tests
- `@doc(<id>)` is required for doc tests under `tests/docs/**`

## Commands

```bash
bun run e2e
bun run e2e:docs
bun run lint
```
