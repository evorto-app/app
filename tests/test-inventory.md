# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys.

Updated: 2026-05-20

## How to Use This Inventory

Use this file as a quick orientation map before adding or trusting Playwright
coverage. `tests/README.md` remains the workflow reference for commands,
runtime variables, Docker behavior, and browser installation.

The current suite has two durable purposes:

- `tests/specs/**` proves product behavior and regression paths.
- `tests/docs/**` generates product-facing walkthrough documentation from real
  browser flows.

Real test titles should stay readable and should not carry placeholder
`@track(...)`, `@req(...)`, or `@doc(...)` metadata. Keep semantic tags such as
`@finance`, `@admin`, `@permissions`, and `@stripe` when they affect filtering
or inventory.

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
  - docs/finance/receipt-review-reimbursement.doc.ts [finance]
  - docs/profile/discounts.doc.ts [finance]
  - docs/profile/user-profile.doc.ts
  - docs/roles/about-permissions.doc.ts
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
  - `docs/roles/about-permissions.doc.ts`
  - `docs/roles/roles.doc.ts`
  - `specs/permissions/**`
  - route-manifest specs in `src/app/admin`, `src/app/finance`,
    `src/app/global-admin`, and `src/app/templates`
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
  and component coverage proves paid, free, zero-tax, and fallback label
  rendering, so this remaining gap is page-level coverage rather than
  formatter/component wiring.
- `specs/templates/paid-option-requires-tax-rate.spec.ts` is intentionally
  fixme-only until simple-mode template tax-rate behavior has active UI
  coverage. Template detail paid-option summaries now share the inclusive price
  label component with event registration cards, and create/edit submit helpers
  now keep missing paid tax-rate selection visible to server validation while
  clearing hidden free-registration payment fields before submission. Server
  coverage proves the tax-rate select source is scoped to current-tenant active
  inclusive rates. Generated template docs assert that enabling payment reveals
  both price and tax-rate controls before capturing the simple-mode payment
  fields.
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
- `helpers/testing/playwright-skip-inventory.spec.ts` keeps all Playwright
  `test.skip` and `test.fixme` usage allowlisted so new fixture-state gaps do
  not become silent placeholders.

## Stabilization Coverage Still Needed

- Profile/account:
  - Keep profile edit persistence documentation aligned with the notification
    email behavior.
  - Browser-backed profile event-card assertions for event links, registration
    status, guest quantity, payment state, and check-in state.
    App coverage already proves event-detail action copy, guest/status/payment
    labels, deferred-action notes, and the payment-continuation next-step copy.
  - Profile ESNcard save, refresh, and remove flows with readable error states.
    App and server coverage already prove upsert payload normalization,
    readable mutation errors, global per-user card reads/upserts, refresh
    persistence, and scoped removal.
    App coverage also proves the `#discounts` profile fragment waits for
    tenant ESNcard provider availability before selecting the section.
  - Browser-backed account-creation retry and tenant-join behavior. Server
    coverage already proves transactional creation, existing-global-user tenant
    joins, duplicate-assignment conflicts, and visible create-account error
    message mapping. App helper coverage proves Auth0-data prefill,
    email-verification gating, payload normalization, and error-message mapping.
    Shared RPC schema coverage proves account-creation and profile-update
    notification email format validation, matching the create-account/profile
    edit form validators.
    The integration-tagged create-account doc also asserts the editable email
    field is labeled "Notification email" when Auth0 Management credentials are
    available.
    Root route-manifest coverage keeps `/create-account` reachable to
    authenticated users without a tenant assignment while protected feature
    routes keep assigned-account and auth guards.
- Finance/receipts:
  - Keep finance route-denial cases and route-manifest specs aligned as
    transaction, receipt approval, and reimbursement routes change.
  - Keep receipt review and reimbursement docs aligned with the manual
    notification and manual money-movement scope. Local component coverage,
    finance docs, and receipt flow specs now pin that the reimbursement queue
    records an Evorto transaction only and that money movement remains manual
    through the selected payout method.
  - Keep paid-registration webhook counter coverage aligned with buyer-plus-guest
    spot counts. Local shared coverage pins the capacity count helper used by
    webhook completion/expiry updates; Stripe replay specs remain
    credential-gated.
  - Notification or email follow-up behavior once the product path exists.
- Scanning/check-in:
  - Browser-backed organizer aggregate assertions after scan check-in.
  - Browser-backed organizer aggregate assertions after guest-quantity scan
    behavior. Local app coverage already proves organizer overview stat
    aggregation reads the same `checkedInSpots` counter updated by scanner
    check-in mutations. Event-management docs now call out that guest-quantity
    check-in increments the organizer checked-in count by the attendee plus
    selected guests.
- Tenant/global admin:
  - Authenticated Browser review for the global-admin tenant list.
    Local server/app coverage already proves the list returns and renders
    non-sensitive operational tenant state for support review, and local app
    coverage proves the read-only tenant list can be filtered by operational
    fields with readable load-failure messages.
  - Keep tenant settings docs and payload tests aligned when new editable
    tenant settings move out of the deferred-settings summary. Current local
    coverage proves the general-settings form trims optional editable
    URLs/SEO/ESNcard fields and normalizes blank optional values before the RPC
    call.
- Roles/user management:
  - Browser-backed least-privilege organizer review for event/template role
    selectors. Server coverage already proves lookup permissions and
    lookup-only role results; template autocomplete coverage now fails loudly
    when seeded roles are missing.
  - User-list/role-assignment coverage once the role-assignment path exists.
    Server coverage already proves the current read-only user list pages tenant
    users before joining role rows and applies search before pagination, so
    multi-role users do not collapse page size.
- Registrations:
  - Browser-backed negative registration states for closed windows,
    role-ineligible direct links, and waitlist affordances. Server/app unit
    coverage already proves closed-window rejection, role eligibility,
    unsupported stored registration-mode rejection, unsupported-mode no-waitlist
    card behavior, and waitlist edge cases.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
- Event, registration, template, finance receipt, scanner, and unlisted-event specs should fail loudly when deterministic fixture state is missing instead of silently passing through skips.
- Playwright skip/fixme usage is locally audited; add new entries only when
  the gap is intentionally credential-gated or an honest Browser-backed
  stabilization placeholder.
- Playwright list/discovery output is intentionally readable: real spec/doc
  titles no longer include placeholder `@track`, `@req`, or `@doc` metadata.
- `docs/users/create-account.doc.ts` is the only current integration-tagged Playwright path; there is no non-doc integration-only spec yet.
- Playwright `--list` discovery does not clean or write generated docs output,
  and baseline fixture imports do not require Auth0 Management credentials.
