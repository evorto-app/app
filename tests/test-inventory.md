# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys.

Updated: 2026-05-19

## How to Use This Inventory

Use this file as a quick orientation map before adding or trusting Playwright
coverage. `tests/README.md` remains the workflow reference for commands,
runtime variables, Docker behavior, and browser installation.

The current suite has two durable purposes:

- `tests/specs/**` proves product behavior and regression paths.
- `tests/docs/**` generates product-facing walkthrough documentation from real
  browser flows.

Browser/manual exploration is still the right discovery tool for flows that are
being stabilized. Once a flow decision is confirmed, persist the learning here
by adding or tightening a spec/doc journey instead of leaving only manual notes.

## Active Files

- Documentation journeys (`*.doc.ts`):
  - docs/admin/global-admin.doc.ts [admin, globalAdmin]
  - docs/admin/general-settings.doc.ts [admin]
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
  - docs/template-categories/categories.doc.ts
  - docs/templates/templates.doc.ts
  - docs/users/create-account.doc.ts [@needs-auth0-management]

- Functional tests (`*.test.ts`):
  - specs/auth/storage-state-refresh.test.ts
  - specs/discounts/esn-discounts.test.ts [finance]
  - specs/events/events.test.ts
  - specs/events/free-registration.test.ts
  - specs/events/unlisted-visibility.test.ts
  - specs/events/price-labels-inclusive.spec.ts [finance, fixme]
  - specs/finance/receipts-flows.spec.ts [finance]
  - specs/finance/stripe-webhook-replay.spec.ts [finance, stripe]
  - specs/finance/tax-rates/admin-import-tax-rates.spec.ts [finance]
  - specs/permissions/global-admin-route-guard.spec.ts [permissions]
  - specs/permissions/matrix.spec.ts [permissions]
  - specs/permissions/override.test.ts [permissions]
  - specs/permissions/tenant-isolation-tax-rates.spec.ts [permissions, finance]
  - specs/reporting/reporter-paths.test.ts
  - specs/scanning/scanner.test.ts
  - specs/screenshot/doc-screenshot.test.ts
  - specs/seed/seed-baseline.test.ts
  - specs/smoke/load-application.test.ts
  - specs/template-categories/template-categories.test.ts
  - specs/templates/paid-option-requires-tax-rate.spec.ts [finance, fixme]
  - specs/templates/templates.test.ts

## Suite Ownership

- Events and registrations:
  - `docs/events/**`
  - `specs/events/**`
  - `specs/discounts/esn-discounts.test.ts`
- Templates and categories:
  - `docs/templates/templates.doc.ts`
  - `docs/template-categories/categories.doc.ts`
  - `specs/templates/**`
  - `specs/template-categories/**`
- Roles and permissions:
  - `docs/roles/roles.doc.ts`
  - `specs/permissions/**`
- Tenant/global admin:
  - `docs/admin/global-admin.doc.ts`
  - `docs/admin/general-settings.doc.ts`
- Finance, receipts, tax, and Stripe:
  - `docs/finance/**`
  - `specs/finance/**`
  - `specs/permissions/tenant-isolation-tax-rates.spec.ts`
- Profile and account:
  - `docs/profile/**`
  - `docs/users/create-account.doc.ts`
- Scanning/check-in:
  - `docs/events/event-management.doc.ts`
  - `specs/scanning/scanner.test.ts`
- Runtime, reporting, screenshots, and seed health:
  - `specs/auth/storage-state-refresh.test.ts`
  - `specs/reporting/reporter-paths.test.ts`
  - `specs/screenshot/doc-screenshot.test.ts`
  - `specs/seed/seed-baseline.test.ts`
  - `specs/smoke/load-application.test.ts`

## Intentional Gaps and Gates

- `specs/events/price-labels-inclusive.spec.ts` is intentionally fixme-only
  until inclusive price-label behavior has active Browser-backed coverage.
  Event registration cards now use the shared inclusive price label component,
  so this remaining gap is page-level coverage rather than formatter/component
  wiring.
- `specs/templates/paid-option-requires-tax-rate.spec.ts` is intentionally
  fixme-only until simple-mode template tax-rate behavior has active UI
  coverage. Template detail paid-option summaries now share the inclusive price
  label component with event registration cards, and create/edit submit helpers
  now clear hidden free-registration payment fields before server submission.
- `docs/users/create-account.doc.ts` is integration-tagged with
  `@needs-auth0-management`; baseline list/discovery must not require those
  credentials.
- `specs/finance/stripe-webhook-replay.spec.ts` is file-level skipped when
  `STRIPE_WEBHOOK_SECRET` is absent, before page/database fixtures are
  requested. That skip is credential-gated, not a substitute for product
  coverage. This is separate from the Docker stack's Compose-managed Stripe
  listener, which shares its generated signing secret with the app through
  `STRIPE_WEBHOOK_SECRET_FILE`.
- `specs/permissions/override.test.ts` is active desktop coverage for the
  permission override fixture; no mobile project currently runs this spec.
- `specs/permissions/global-admin-route-guard.spec.ts` covers direct
  `/global-admin` allow/deny behavior once page-backed runtime is available.
- Page-backed local execution requires the Playwright Chromium cache installed
  by `bun run test:e2e:install`.

## Stabilization Coverage Still Needed

- Profile/account:
  - Browser-backed profile edit persistence for notification email.
  - Browser-backed profile event-card assertions for event links, registration
    status, guest quantity, payment state, and check-in state.
  - Profile ESNcard save, refresh, and remove flows with readable error states.
  - Browser-backed account-creation retry and tenant-join behavior. Server
    coverage already proves transactional creation, existing-global-user tenant
    joins, duplicate-assignment conflicts, and visible create-account error
    message mapping.
- Finance/receipts:
  - Finance route gates for transactions, receipt approvals, and reimbursement
    pages.
  - Receipt review and reimbursement behavior in generated docs.
  - Notification or email follow-up behavior once the product path exists.
- Scanning/check-in:
  - Browser-backed organizer aggregate assertions after scan check-in.
  - Browser-backed organizer aggregate assertions after guest-quantity scan
    behavior.
- Tenant/global admin:
  - Authenticated Browser review for the global-admin tenant list.
- Roles/user management:
  - Least-privilege organizer role lookup in event/template eligibility forms.
  - User-list/role-assignment coverage once the role-assignment path exists.
- Registrations:
  - Negative paths for closed windows, ineligible roles, unsupported stored
    registration modes, and waitlist edge cases.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
- Event, registration, template, finance receipt, scanner, and unlisted-event specs should fail loudly when deterministic fixture state is missing instead of silently passing through skips.
- `docs/users/create-account.doc.ts` is the only current integration-tagged Playwright path; there is no non-doc integration-only spec yet.
- Playwright `--list` discovery does not clean or write generated docs output,
  and baseline fixture imports do not require Auth0 Management credentials.
