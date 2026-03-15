# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys.

Generated: 2026-03-09

## Summary

- Documentation journeys (`*.doc.ts`):
  - docs/events/event-approval.doc.ts
  - docs/events/event-management.doc.ts
  - docs/events/register.doc.ts [stripe]
  - docs/events/unlisted-admin.doc.ts
  - docs/events/unlisted-user.doc.ts
  - docs/finance/finance-overview.doc.ts [finance]
  - docs/finance/inclusive-tax-rates.doc.ts [finance]
  - docs/profile/discounts.doc.ts [finance]
  - docs/profile/user-profile.doc.ts
  - docs/roles/roles.doc.ts
  - docs/template.doc.ts
  - docs/template-categories/categories.doc.ts
  - docs/templates/templates.doc.ts
  - docs/users/create-account.doc.ts [@needs-auth0-management]

- Functional tests (`*.test.ts`):
  - specs/auth/storage-state-refresh.test.ts
  - specs/discounts/esn-discounts.test.ts [finance]
  - specs/events/events.test.ts
  - specs/events/free-registration.test.ts
  - specs/events/unlisted-visibility.test.ts
  - specs/events/price-labels-inclusive.spec.ts [finance]
  - specs/finance/receipts-flows.spec.ts [finance]
  - specs/finance/stripe-webhook-replay.spec.ts [finance, stripe]
  - specs/finance/tax-rates/admin-import-tax-rates.spec.ts [finance]
  - specs/permissions/matrix.spec.ts [permissions]
  - specs/permissions/override.test.ts [permissions]
  - specs/permissions/tenant-isolation-tax-rates.spec.ts [permissions, finance]
  - specs/reporting/reporter-paths.test.ts
  - specs/scanning/scanner.test.ts
  - specs/screenshot/doc-screenshot.test.ts
  - specs/seed/seed-baseline.test.ts
  - specs/smoke/load-application.test.ts
  - specs/template-categories/template-categories.test.ts
  - specs/templates/paid-option-requires-tax-rate.spec.ts [finance]
  - specs/templates/templates.test.ts

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
