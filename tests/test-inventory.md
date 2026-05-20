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
  - specs/events/negative-registration-states.spec.ts
  - specs/events/unlisted-visibility.test.ts
  - specs/events/price-labels-inclusive.spec.ts [finance]
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
  - specs/templates/paid-option-requires-tax-rate.spec.ts [finance]
  - specs/templates/templates.test.ts

## Suite Ownership

- Events and registrations:
  - `docs/events/**`
  - `specs/events/**`
  - `specs/discounts/esn-discounts.test.ts`
  - app event edit, lifecycle-action, and organizer-action guard coverage in
    `src/app/events`
- Templates and categories:
  - `docs/templates/templates.doc.ts`
  - `docs/template-categories/categories.doc.ts`
  - `specs/templates/**`
  - `specs/template-categories/**`
  - template-category create/edit page-backed coverage with explicit database
    readbacks for created and edited rows
  - template-category docs create and edit a deterministic category, read back
    the persisted rows, and clean up the generated row
  - app category action guard coverage in `src/app/templates/categories`
  - app create/edit submit-guard coverage in
    `src/app/templates/shared/template-form`
  - app template detail reusable add-on label coverage in
    `src/app/templates/template-details`
  - app mapper and submit-guard coverage in
    `src/app/templates/template-create-event`
  - shared registration-mode label coverage in `src/shared`
- Roles and permissions:
  - `docs/roles/about-permissions.doc.ts`
  - `docs/roles/roles.doc.ts`
  - `specs/permissions/**`
  - shared permission-guard denial coverage in `src/app/core/guards`
  - route-manifest and event-review queue action coverage in `src/app/admin`
  - route-manifest specs in `src/app/finance`, `src/app/global-admin`, and
    `src/app/templates`
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
  - app profile edit, event-card, receipt-card, and ESNcard action coverage in
    `src/app/profile`
- Scanning/check-in:
  - `docs/events/event-management.doc.ts`
  - `specs/scanning/scanner.test.ts`
- Runtime, reporting, screenshots, and seed health:
  - `specs/auth/storage-state-refresh.test.ts`
  - `specs/reporting/reporter-paths.test.ts`
  - `specs/screenshot/doc-screenshot.test.ts`
  - `specs/seed/seed-baseline.test.ts` proves the seeded tenant has default
    roles, all template families, paid/free registration options, paid tax-rate
    wiring, reusable template add-ons, scenario handles, confirmed
    registrations, and checked-in scanner aggregates.
  - `specs/smoke/load-application.test.ts`

## Intentional Gaps and Gates

- `specs/events/price-labels-inclusive.spec.ts` has active page-level coverage
  for paid inclusive tax labels, free options without tax labels, zero percent
  "Tax free" display, fallback tax labels when rate details are missing,
  discounted ESNcard prices retaining tax labels, and paid template detail
  summaries sharing the same inclusive price component.
- Event detail component coverage pins review and submit-for-review action
  guards for permission, status, and mutation-pending states so the page and
  handlers share the same lifecycle write boundaries.
- Event approval docs create a deterministic approval-flow event, assert the
  persisted pending/rejected/approved lifecycle states and rejection feedback,
  and clean up the generated event rows.
- Event registration option component coverage pins participant registration and
  waitlist action disabling while a register or waitlist mutation is pending.
- Active-registration component coverage pins participant cancellation and
  self-service transfer action disabling while either write is pending or the
  transfer is unavailable.
- `specs/templates/paid-option-requires-tax-rate.spec.ts` has active
  simple-mode UI coverage for the paid-registration tax-rate requirement and a
  seeded inclusive tax-rate save path. Remaining fixme entries are limited to
  future bulk/no-compatible-rate UI behavior. Template detail paid-option
  summaries now share the inclusive price label component with event
  registration cards, and create/edit submit helpers keep missing paid tax-rate
  selection visible to server validation while clearing hidden free-registration
  payment fields before submission. Server coverage proves the tax-rate select
  source is scoped to current-tenant active inclusive rates.
- The admin tax-rate import dialog has local unit coverage for the shared import
  action guard, keeping empty selections and pending imports from submitting
  duplicate tenant tax-rate writes.
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
  `/global-admin`, `/global-admin/tenants/create`,
  `/global-admin/tenants/:tenantId`, and
  `/global-admin/tenants/:tenantId/edit` allow/deny behavior once page-backed
  runtime is available.
- Page-backed local execution requires the Playwright Chromium cache installed
  by `bun run test:e2e:install`.
- `helpers/testing/playwright-skip-inventory.spec.ts` keeps all Playwright
  `test.skip` and `test.fixme` usage allowlisted with a local reason for each
  entry, so new fixture-state gaps do not become silent placeholders.

## Stabilization Coverage Still Needed

- Profile/account:
  - Browser-backed profile edit persistence after saving notification email and
    optional global reimbursement details. Generated docs already exercise the
    notification-email edit/restore path with database readback,
    `specs/profile/user-profile-edit.spec.ts` now functionally covers
    notification email plus IBAN/PayPal persistence with explicit database
    readback and cleanup, and app helper coverage proves payload trimming and
    blank-value normalization before persistence.
  - Manual Browser-backed profile event-card review once local runtime is
    available. Generated profile docs now seed confirmed, pending-checkout,
    waitlisted, and checked-in registrations with free add-ons where applicable,
    then assert event link, registration status, guest quantity, purchased add-on
    summary, payment state, checkout continuation, waitlist routing,
    ticket-routing copy, checked-in copy, and that checked-in cards do not show
    ticket availability copy. `specs/profile/user-profile-events.spec.ts`
    reuses the same seeded card states as functional Playwright coverage.
    App/server coverage already proves event-detail action copy,
    guest/status/payment labels, profile event add-on summaries,
    implemented-action notes, waitlist event-page routing, and the
    payment-continuation next-step copy. It also proves profile payment
    continuation links render only for pending Stripe Checkout HTTPS URLs, and
    checked-in profile event cards no longer advertise cancellation or transfer
    actions.
    The generated profile docs and functional profile-event spec now pin each
    seeded confirmed, pending-checkout, waitlisted, and checked-in card to its
    expected event-page link so the recovery route cannot silently drift while
    Browser runtime review is unavailable.
    Organizer overview app coverage also proves checked-in rows and in-flight
    writes disable participant cancellation and organizer-assisted transfer.
  - Browser-backed ESNcard add, refresh, and remove flows with readable error
    states.
    App and server coverage already prove upsert payload normalization,
    readable mutation errors, readable status labels, save/refresh/remove action states, global
    per-user card reads/upserts, refresh persistence, and scoped removal.
    Local app coverage also proves that save, refresh, and remove actions share
    an in-flight guard so profile discount-card writes do not overlap.
    App coverage also proves the `#discounts` profile fragment waits for
    tenant ESNcard provider availability before selecting the section.
  - Browser-backed account-creation retry and tenant-join behavior. Server
    coverage already proves transactional creation, existing-global-user tenant
    joins, duplicate-assignment conflicts, and visible create-account error
    message mapping. App helper coverage proves Auth0-data prefill,
    email-verification gating, payload normalization, error-message mapping, and
    the invalid/submitting/mutation-pending submit guard now shared by the
    visible submit button and handler.
    Shared RPC schema coverage proves account-creation and profile-update
    notification email format validation, matching the create-account/profile
    edit form validators.
    The integration-tagged create-account doc also asserts the editable email
    field is labeled "Notification email" when Auth0 Management credentials are
    available.
    Root route-manifest coverage keeps `/create-account` reachable to
    authenticated users without a tenant assignment while protected feature
    routes keep assigned-account and auth guards.
  - Manual Browser-backed submitted-receipt visibility review after a real
    receipt submission once local runtime is available. Generated profile docs
    now seed a deterministic submitted receipt and assert the profile
    receipt-card filename, submitted status, event title, amount, and persisted
    database row. Local app/server coverage already proves readable
    submitted-receipt status labels, amount formatting, and
    `finance.receipts.my` profile-card row normalization.
    `specs/profile/user-profile-receipts.spec.ts` adds functional coverage for
    the same profile receipt-card state with explicit database readback and
    cleanup.
- Finance/receipts:
  - Keep finance route-denial cases and route-manifest specs aligned as
    transaction, receipt approval, and reimbursement routes change.
  - Keep receipt review and reimbursement docs aligned with the manual
    notification and manual money-movement scope. Local component coverage,
    finance docs, and receipt flow specs now pin that the reimbursement queue
    records an Evorto transaction only, that money movement remains manual
    through the selected payout method, that reimbursement actions require a
    selected receipt plus the chosen payout detail, that selected totals sum the
    selected rows only, that approval/rejection actions stay disabled while the
    form is invalid, receipt details are loading, or the review mutation is
    pending, that reimbursement recording stays disabled while the refund
    mutation is pending, and that finance receipt contact details prefer the
    submitter's notification email with login email fallback.
    `docs/finance/receipt-review-reimbursement.doc.ts` now follows the exact
    seeded receipt through approval and reimbursement by id/file name, reads the
    approved/refunded state back, and restores the seeded receipt plus generated
    reimbursement transaction after the documentation journey.
  - Keep event-organizer receipt submission action coverage aligned with the
    two-step upload-plus-submit flow. Local app coverage now pins that Add
    receipt remains disabled while the event has not loaded yet, while the
    original upload is pending, and while the submit mutation is pending.
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
    check-in mutations, and scanned-registration component coverage pins
    check-in button labels plus selected spot-count copy. Event-management docs
    now execute the generated guest-quantity check-in, assert the persisted
    registration and counter updates, restore the seeded counter, and call out
    that guest-quantity check-in increments the organizer checked-in count by
    the attendee plus selected guests.
  - Keep scanned-registration action guards aligned with the write/refetch
    lifecycle. Local app coverage now pins that the check-in action is disabled
    when scan state disallows it, no spots are selected, the write is pending,
    or the local success state is already recorded. It also pins guest-count
    input clamping before the check-in mutation payload is built.
- Tenant/global admin:
  - Authenticated Browser review for the global-admin tenant list and
    tenant-create/edit flows. The global-admin tenant Playwright spec now
    functionally covers tenant list filtering, no-match state, operational row
    fields, connected Stripe-account support lookup, tenant detail review,
    create/edit form relaunch-scope copy, disabled empty create submit, and
    enabled seeded edit submit. Generated global-admin docs now read the seeded
    localhost tenant row before asserting list/detail/search/edit fields, so the
    guide is tied to persisted tenant state. It also pins list -> create -> list,
    list -> detail -> edit, edit cancel, and external tenant-domain link targets
    so page navigation cannot silently drift while authenticated Browser runtime
    review is blocked. Local server/app coverage already proves the list,
    tenant detail, tenant create, and tenant edit surfaces return, render, and
    persist operational tenant state for support review, and local app coverage
    proves the tenant list can be filtered by operational fields, including
    connected Stripe account ids, with readable load-failure messages and
    account labels. Tenant form coverage also proves create/edit payload
    shaping, mutation-pending submit disabling, and the visible relaunch
    tenant-scope notice before page-backed runtime is available.
  - Keep tenant settings docs and payload tests aligned when new editable
    tenant settings move out of the deferred-settings summary. Current local
    coverage proves the general-settings form trims optional editable
    URLs/SEO/legal-text/ESNcard fields, includes supported
    currency/locale/timezone selections in the update payload, and normalizes
    blank optional values before the RPC call. Tenant schema, admin-handler, and
    route coverage pin supported relaunch currency/locale/timezone values,
    hosted legal text fields, public legal page routes, and tenant logo/favicon
    upload storage paths while normalizing legacy context payloads.
    General-settings identity coverage also pins read-only tenant name, primary
    domain, and Stripe account support lookup labels.
    General-settings component coverage also pins that invalid, submitting, and
    mutation-pending saves stay disabled so slow settings writes cannot
    double-submit, and that brand-asset uploads stay disabled while any upload
    is active or mutation-pending.
- Roles/user management:
  - Browser-backed least-privilege organizer review for event/template role
    selectors. Server coverage already proves lookup permissions and
    lookup-only role results; template autocomplete coverage now fails loudly
    when seeded roles are missing.
  - Keep app action icons on the Font Awesome component path. Local source
    coverage now fails if app templates or components reintroduce direct
    Material icon elements or `MatIconModule`, preserving the shared
    premium/brand icon package path.
  - Keep template-to-event mapper coverage aligned with the event form as richer
    reusable template data is added. Local app coverage now proves event
    defaults, source registration option ids, registration-window offsets, and
    private organizer planning tips at the template-to-event boundary. It also
    pins that reusable add-ons do not enter event form data until event-side
    add-on fulfillment exists.
  - Template detail component coverage pins reusable add-on purchase timing and
    registration-option labels. Server handler coverage pins the current
    add-on read model while event-side add-on fulfillment remains out of scope.
    Create-event component coverage pins the visible add-on boundary notice when
    a template has reusable add-ons.
  - Seed baseline coverage pins free and paid reusable template add-ons attached
    to participant template options so the template detail add-on surface has
    deterministic data once Browser/runtime review is available.
  - Keep shared registration-mode labels aligned whenever stored modes are
    implemented or retired. Local shared coverage now keeps event/template
    authoring controls and template detail summaries away from raw storage ids.
  - Local shared coverage pins admin-facing permission labels and descriptions,
    including the labels used for role-form dependency copy and the generated
    permission reference.
  - Keep role create/edit submit guards aligned with the write lifecycle. Local
    app coverage now pins that invalid, submitting, and mutation-pending role
    forms stay disabled, and the component submit path shares the same guard.
  - User-list/role-assignment coverage once the role-assignment path exists.
    Server coverage already proves the current read-only user list pages tenant
    users before joining role rows and applies search before pagination, so
    multi-role users do not collapse page size.
- Registrations:
  - `specs/events/negative-registration-states.spec.ts` adds active
    page-backed coverage for closed registration windows, role-ineligible direct
    links, and waitlist affordances. Server/app unit coverage already proves
    closed-window rejection, role eligibility, unsupported stored
    registration-mode rejection, unsupported-mode no-waitlist card behavior,
    waitlist joining, and leave-waitlist cancellation.
  - Browser-backed execution of those assertions still depends on local runtime
    availability and the matching Playwright Chromium cache.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
- Event, registration, template, finance receipt, scanner, and unlisted-event specs should fail loudly when deterministic fixture state is missing instead of silently passing through skips.
- Playwright skip/fixme usage is locally audited; add new entries only when
  the gap is intentionally credential-gated or an honest Browser-backed
  stabilization placeholder, and record the reason in
  `helpers/testing/playwright-skip-inventory.spec.ts`.
- Playwright list/discovery output is intentionally readable:
  `helpers/testing/playwright-skip-inventory.spec.ts` guards that real spec/doc
  titles no longer include placeholder `@track`, `@req`, or `@doc` metadata.
- `docs/users/create-account.doc.ts` is the only current integration-tagged Playwright path; there is no non-doc integration-only spec yet.
- Playwright `--list` discovery does not clean or write generated docs output,
  and baseline fixture imports do not require Auth0 Management credentials.
