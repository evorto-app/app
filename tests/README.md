# Playwright Tests

This directory contains the active Playwright suite.

## Structure

- Functional/e2e tests: `tests/**`
- Documentation tests: `tests/docs/**`
- Setup/auth/database bootstrapping lives in `tests/setup/**`
- Shared fixtures/utilities/reporter live in `tests/fixtures/**`, `tests/utils/**`, `tests/reporters/**`

## Required Tags

All tests in `tests/**/*.ts` are linted with a custom ESLint rule:

- `@track(<track_id>)` is required for every test title
- `@req(<id>)` is required for non-doc tests
- `@doc(<id>)` is required for doc tests under `tests/docs/**`

## Commands

```bash
yarn e2e
yarn e2e:docs
yarn lint
```
