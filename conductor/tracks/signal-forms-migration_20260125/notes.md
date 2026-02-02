# Notes: Signal Forms Migration (Track Support)

## Test Architecture Observations (2026-01-30)

- `e2e/setup/database.setup.ts` resets the DB once per Playwright run and seeds a baseline tenant (`localhost`) plus base users, then writes `.e2e-runtime.json` for cookie-based tenant selection.
- `e2e/fixtures/parallel-test.ts` seeds a dedicated tenant per test using `seedTenant` with `domain: e2e-${runId}` where `runId` is derived from a deterministic per-test `falsoSeed` value.
- When Playwright retries a failing test (`CI=true` enables retries), the deterministic domain is re-used, causing `tenants_domain_unique` violations in `helpers/create-tenant.ts`.
- This shows up as doc test failures (duplicate domain) even after a clean DB reset.

## Retry Isolation Follow-up (2026-01-30)

- `e2e/fixtures/base-test.ts` now includes `testInfo.retry` in the `falsoSeed` scope so random IDs differ per retry, avoiding `tenants_pkey` collisions.
- `e2e/fixtures/parallel-test.ts` derives the runId with a retry suffix to keep tenant domains unique across retries.

## Manual Verification (2026-01-31)

- Phase 1 manual verification completed by user confirmation.

## Manual Verification (2026-02-02)

- Phase 2 manual verification completed and approved by user confirmation.
- Verified areas: role dependency behavior (readonly + auto-check), role selector
  filtering for already selected roles, and create-event time synchronization for
  end/open/close fields when untouched.

## Manual Verification (2026-02-02, Phase 3)

- Phase 3 manual verification completed and approved by user confirmation.
- Verified and fixed during manual pass:
  - role autocomplete excludes selected role ids,
  - create-event registration option role selection restored,
  - create-event default start set to one week ahead,
  - initialization loop in create-event form resolved.
