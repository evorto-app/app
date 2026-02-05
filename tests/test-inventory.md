# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys; identifies gaps vs. Evorto Living E2E Baseline spec.

Generated: 2025-09-13

## Summary

- Documentation journeys (`*.doc.ts`):
  - docs/events/event-management.doc.ts
  - docs/events/unlisted-admin.doc.ts
  - docs/events/unlisted-user.doc.ts
  - docs/finance/finance-overview.doc.ts [finance]
  - docs/profile/discounts.doc.ts [finance]
  - docs/profile/user-profile.doc.ts
  - docs/roles/roles.doc.ts
  - docs/template-categories/categories.doc.ts
  - docs/templates/templates.doc.ts
  - docs/users/create-account.doc.ts [@needs-auth0]

- Functional tests (`*.test.ts`):
  - discounts/esn-discounts.test.ts [finance]
  - events/events.test.ts
  - smoke/load-application.test.ts
  - template-categories/template-categories.test.ts
  - templates/templates.test.ts

## Gaps vs. Baseline Plan

- Scanning regression test: MISSING → add `tests/scanning/scanner.test.ts` (T018)
- Free registration regression test: MISSING → add `tests/events/free-registration.test.ts` (T021)
- Unlisted visibility functional test: MISSING → add `tests/events/unlisted-visibility.test.ts` (T020)
- Reporter env override tests: MISSING → add `tests/reporter/reporter-paths.test.ts` (T015) and front-matter normalization test (T017)
- Seed log/map and runtime file: MISSING → implement wrapper and runtime output (T006/T007)
- Storage state freshness tests: MISSING → add `tests/auth/storage-state-refresh.test.ts` (T009)

## Tagging Candidates

- Finance-related flows (exclude from baseline runs):
  - docs/finance/finance-overview.doc.ts → tag `@finance` (T002)
  - discounts/esn-discounts.test.ts → tag `@finance` (T002)
  - docs/profile/discounts.doc.ts → tag `@finance` (T002)
  - docs/events/register.doc.ts → wrap paid path and tag (T003)

## Planned: Inclusive Tax Rates (TAX-RATES)

Source: `conductor/tracks/tax-rates_20260128/spec.md`

Proposed files (Playwright):

- finance/tax-rates/admin-import-tax-rates.spec.ts
- templates/paid-option-requires-tax-rate.spec.ts
- events/price-labels-inclusive.spec.ts
- finance/checkout-uses-tax-rate-id.spec.ts
- finance/fallback-unavailable-rate.spec.ts
- discounts/discount-reduces-inclusive-price.spec.ts
- permissions/admin-manage-taxes-permission.spec.ts
- permissions/tenant-isolation-tax-rates.spec.ts
- finance/zero-percent-inclusive-rate.spec.ts
- finance/audit-logging-import-and-unavailability.spec.ts

Notes:

- Each spec seeds isolated tenants; relies on helpers in `/helpers/*`.
- Where Stripe test credentials are absent, assert constructed payloads at the server boundary instead of confirming with provider.

## Notes

- Current fixtures in `tests/fixtures/parallel-test.ts` already seed tenant, categories, templates, events, and registrations per test run.
- Base fixture enhancement to read `.e2e-runtime.json` enables cookie injection for tests not using parallel fixtures (T008).
