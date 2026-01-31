# Playwright Tests (New)

This directory contains the active Playwright test suite for Evorto. All new tests and doc tests live under `tests/`.

## Scope

- Runnable tests live in `tests/**`.
- Doc tests live in `tests/docs/**` and are executed via `yarn e2e:docs`.
- Legacy tests remain in `e2e/tests/**` as reference only and are not run by default.

## Required Tags

Every new test must include a Conductor track tag and the appropriate requirement tag:

- `@track(<track_id>)` is required for all tests.
- `@req(<id>)` is required for non-doc tests under `tests/**`.
- `@doc(<id>)` is required for doc tests under `tests/docs/**`.

Example test title:

```ts
import { test } from '@playwright/test';

test('@track(playwright-specs-track-linking_20260126) @req(PW-001) shows the new layout', async ({ page }) => {
  // ...
});
```
