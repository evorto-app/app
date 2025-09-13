# E2E Test Inventory

Scope: Current Playwright tests and documentation journeys; identifies gaps vs. Evorto Living E2E Baseline spec.

Generated: 2025-09-13

## Summary
- Documentation journeys (`*.doc.ts`):
  - events/event-management.doc.ts
  - events/unlisted-admin.doc.ts
  - events/unlisted-user.doc.ts
  - finance/finance-overview.doc.ts [finance]
  - profile/discounts.doc.ts [finance]
  - profile/user-profile.doc.ts
  - roles/roles.doc.ts
  - template-categories/categories.doc.ts
  - templates/templates.doc.ts
  - users/create-account.doc.ts [@needs-auth0]

- Functional tests (`*.test.ts`):
  - discounts/esn-discounts.test.ts [finance]
  - events/events.test.ts
  - smoke/load-application.test.ts
  - template-categories/template-categories.test.ts
  - templates/templates.test.ts

## Gaps vs. Baseline Plan
- Scanning regression test: MISSING → add `e2e/tests/scanning/scanner.test.ts` (T018)
- Free registration regression test: MISSING → add `e2e/tests/events/free-registration.test.ts` (T021)
- Unlisted visibility functional test: MISSING → add `e2e/tests/events/unlisted-visibility.test.ts` (T020)
- Reporter env override tests: MISSING → add `e2e/tests/reporter/reporter-paths.test.ts` (T015) and front-matter normalization test (T017)
- Seed log/map and runtime file: MISSING → implement wrapper and runtime output (T006/T007)
- Storage state freshness tests: MISSING → add `e2e/tests/auth/storage-state-refresh.test.ts` (T009)

## Tagging Candidates
- Finance-related flows (exclude from baseline runs):
  - finance/finance-overview.doc.ts → tag `@finance` (T002)
  - discounts/esn-discounts.test.ts → tag `@finance` (T002)
  - profile/discounts.doc.ts → tag `@finance` (T002)
  - events/register.doc.ts → wrap paid path and tag (T003)

## Notes
- Current fixtures in `e2e/fixtures/parallel-test.ts` already seed tenant, categories, templates, events, and registrations per test run.
- Base fixture enhancement to read `.e2e-runtime.json` enables cookie injection for tests not using parallel fixtures (T008).

