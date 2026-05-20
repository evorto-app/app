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
  - specs/admin/general-settings.spec.ts [admin]
  - specs/admin/global-admin-tenants.spec.ts [admin, globalAdmin]
  - specs/admin/roles-management.spec.ts [admin, permissions]
  - specs/auth/storage-state-refresh.test.ts
  - specs/discounts/esn-discounts.test.ts [finance]
  - specs/events/events.test.ts
  - specs/events/free-registration.test.ts
  - specs/events/negative-registration-states.spec.ts
  - specs/events/registration-addons.test.ts
  - specs/events/registration-transfer.test.ts
  - specs/events/unlisted-visibility.test.ts
  - specs/finance/finance-overview-permissions.spec.ts [finance, permissions]
  - specs/events/price-labels-inclusive.spec.ts [finance]
  - specs/finance/receipts-flows.spec.ts [finance]
  - specs/finance/stripe-webhook-replay.spec.ts [finance, stripe]
  - specs/finance/tax-rates/admin-import-tax-rates.spec.ts [finance]
  - specs/permissions/global-admin-route-guard.spec.ts [permissions]
  - specs/permissions/matrix.spec.ts [permissions]
  - specs/permissions/override.test.ts [permissions]
  - specs/permissions/tenant-isolation-tax-rates.spec.ts [permissions, finance]
  - specs/profile/create-account.spec.ts [@needs-auth0-management]
  - specs/profile/user-profile-discounts.spec.ts [finance]
  - specs/profile/user-profile-edit.spec.ts
  - specs/profile/user-profile-events.spec.ts
  - specs/profile/user-profile-receipts.spec.ts [finance]
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
  - `specs/admin/roles-management.spec.ts`
  - `specs/permissions/**`
  - shared permission-guard denial coverage in `src/app/core/guards`
  - route-manifest and event-review queue action coverage in `src/app/admin`
  - route-manifest specs in `src/app/finance`, `src/app/global-admin`, and
    `src/app/templates`
- Tenant/global admin:
  - `docs/admin/global-admin.doc.ts`
  - `docs/admin/general-settings.doc.ts`
  - `specs/admin/general-settings.spec.ts`
  - `specs/admin/global-admin-tenants.spec.ts`
- Finance, receipts, tax, and Stripe:
  - `docs/finance/**`
  - `specs/finance/finance-overview-permissions.spec.ts`
  - `specs/finance/**`
  - `specs/permissions/tenant-isolation-tax-rates.spec.ts`
- Profile and account:
  - `docs/profile/**`
  - `docs/users/create-account.doc.ts`
  - `specs/profile/create-account.spec.ts`
  - `specs/profile/user-profile-discounts.spec.ts`
  - `specs/profile/user-profile-edit.spec.ts`
  - `specs/profile/user-profile-events.spec.ts`
  - `specs/profile/user-profile-receipts.spec.ts`
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
- Event registration option component coverage pins participant registration and
  waitlist action disabling while a register or waitlist mutation is pending.
- `specs/events/registration-addons.test.ts` adds page-backed coverage for a
  registration-time add-on selected on a seeded free event, persisted as a
  registration add-on purchase, shown after registration, and deducted from
  add-on availability.
- `specs/events/registration-transfer.test.ts` adds page-backed coverage for
  the regular user's self-service unpaid transfer dialog and database readback
  to the target tenant member.
- `docs/events/register.doc.ts` includes a generated unpaid transfer journey,
  including the transfer dialog, eligible target email entry, and the explicit
  paid-transfer/resale deferral.
- Active-registration component coverage pins participant cancellation and
  self-service transfer action disabling while either write is pending or the
  transfer is unavailable.
- `specs/templates/paid-option-requires-tax-rate.spec.ts` has active
  simple-mode UI coverage for the paid-registration tax-rate requirement and a
  seeded inclusive tax-rate save path. The old future bulk/no-compatible-rate
  fixme declarations were removed; current no-compatible-rate select feedback
  is pinned in local component coverage until a broader page flow exists.
  Template detail paid-option summaries now share the inclusive price label
  component with event
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
- `specs/profile/create-account.spec.ts` is collected by
  `local-chrome-integration` and skips inside the test body without Auth0
  Management credentials. It is the functional integration path for creating a
  new Auth0-backed tenant account, verifying profile arrival, tenant assignment,
  default role assignment, and cleanup.
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
- Page-backed local execution uses bundled Playwright Chromium by default, which
  requires the cache installed by `bun run test:e2e:install`. Exploratory local
  runs can opt into system Chrome with `E2E_BROWSER_CHANNEL=chrome`;
  runtime-preflight reports that lower-network option when bundled Chromium is
  missing but system Chrome is available.
- `helpers/testing/playwright-skip-inventory.spec.ts` keeps all Playwright
  `test.skip` and `test.fixme` usage allowlisted with a local reason for each
  entry, so new fixture-state gaps do not become silent placeholders.
  It also rejects fixed `.waitForTimeout(...)` waits in specs and generated
  docs, keeping those flows tied to concrete UI state.
- `helpers/testing/generated-docs-source.spec.ts` keeps tenant general-settings
  docs aligned with implemented brand-asset uploads and hosted legal routes,
  and keeps global-admin docs aligned with the one-domain/no-impersonation
  relaunch scope. It also keeps profile/account docs aligned with implemented
  notification-email semantics, global reimbursement details, event-card
  routing/check-in copy, submitted receipt visibility, account-creation retry
  errors, and existing-global-user tenant joins.
- `helpers/testing/authorization-source.spec.ts` keeps server permission checks
  routed through the shared evaluator path and keeps role lookup contracts free
  of permission-bearing admin role fields.
- `helpers/testing/permission-matrix-source.spec.ts` keeps finance
  route-denial cases aligned with the guarded finance route manifest, including
  transaction list, receipt approval list/detail, and reimbursement routes.
- `helpers/testing/user-list-source.spec.ts` keeps the tenant user list aligned
  with the read-only relaunch surface by guarding review-only columns, the
  visible role-assignment deferral copy, and generated roles documentation.

## Stabilization Coverage Still Needed

- Profile/account:
  - Browser-backed profile edit persistence after saving notification email and
    optional global reimbursement details. Generated docs already exercise the
    notification-email edit/restore path, `specs/profile/user-profile-edit.spec.ts`
    now functionally covers notification email plus IBAN/PayPal persistence with
    database readback and cleanup, and app helper coverage proves payload
    trimming and blank-value normalization before persistence.
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
    Organizer overview app coverage also proves checked-in rows and in-flight
    writes disable participant cancellation and organizer-assisted transfer.
  - Browser-backed ESNcard live add, refresh, and remove provider outcomes with
    readable error states.
    Generated discounts docs now include a helper-backed baseline note for
    readable ESNcard statuses, pending save/refresh/remove labels, shared
    in-flight write guards, trimmed save payloads, and provider-unavailable
    retry copy. The page-backed discounts doc asserts the seeded verified
    ESNcard identifier/status, refresh/remove action visibility, and
    invalid-card-number save guard. The profile discounts spec functionally
    covers the same seeded direct-link discount-card journey. App and server
    coverage already prove upsert payload normalization, readable mutation
    errors, readable status labels, save/refresh/remove action states, global
    per-user card reads/upserts, refresh persistence, provider-outage upsert
    rejection before inserting or updating the stored card, and scoped removal.
    Local app coverage also proves that save, refresh, and remove actions share
    an in-flight guard so profile discount-card writes do not overlap. App
    coverage also proves the
    `#discounts` profile fragment waits for tenant ESNcard provider availability
    before selecting the section. Generated-doc source coverage keeps the
    discounts guide tied to the local ESNcard helper functions and provider
    outage retry semantics.
  - Browser-backed account-creation retry and tenant-join behavior. Server
    coverage already proves transactional creation, existing-global-user tenant
    joins, duplicate-assignment conflicts, and visible create-account error
    message mapping. App helper coverage proves Auth0-data prefill,
    email-verification gating, payload normalization, error-message mapping, and
    the invalid/submitting/mutation-pending submit guard now shared by the
    visible submit button and handler.
    `specs/profile/create-account.spec.ts` adds credential-gated functional
    coverage for a generated Auth0 user creating a current-tenant account,
    landing on profile, persisted notification email/name fields, tenant
    assignment, default role assignment, and DB cleanup.
    Shared RPC schema coverage proves account-creation and profile-update
    notification email format validation, matching the create-account/profile
    edit form validators.
    The baseline create-account doc now uses the account helper contract to
    record verified-email gating,
    Auth0-data prefill, notification-email terminology, payload trimming,
    retryable errors, and duplicate-submit guards without requiring Auth0
    Management credentials.
    The integration-tagged create-account doc also asserts the editable email
    field is labeled "Notification email" when Auth0 Management credentials are
    available.
    Root route-manifest coverage keeps `/create-account` reachable to
    authenticated users without a tenant assignment while protected feature
    routes keep assigned-account and auth guards.
  - Manual Browser-backed submitted-receipt visibility review after a real
    receipt submission once local runtime is available. Generated profile docs
    now seed a deterministic submitted receipt and assert the profile
    receipt-card filename, submitted status, event title, and amount. Local
    app/server coverage already proves readable submitted-receipt status labels,
    amount formatting, and `finance.receipts.my` profile-card row normalization.
    `specs/profile/user-profile-receipts.spec.ts` adds functional coverage for
    the same profile receipt-card state with database readback and cleanup.
- Finance/receipts:
  - Keep finance route-denial cases and route-manifest specs aligned as
    transaction, receipt approval, and reimbursement routes change.
    Local source coverage now fails if the finance permission matrix drifts
    away from the guarded child routes, including the receipt approval detail
    route.
    Generated-doc source coverage keeps the finance overview guide aligned with
    permission-scoped child navigation, so receipt approval access does not imply
    transaction-list access.
    Transaction-list component coverage now pins that manual transaction
    creation is not advertised without an implemented guarded route/workflow.
    `specs/finance/finance-overview-permissions.spec.ts` now functionally pins
    that the finance overview navigation exposes only the child links matching
    the current user's finance permissions.
  - Keep receipt review and reimbursement docs aligned with the manual
    notification and manual money-movement scope. Local component coverage,
    generated-doc source coverage, finance docs, and receipt flow specs now pin
    that the reimbursement queue records an Evorto transaction only, that money
    movement remains manual through the selected payout method, that
    reimbursement actions require a selected receipt plus the chosen payout
    detail, that selected totals sum the selected rows only, that
    approval/rejection actions stay disabled while the form is invalid, receipt
    details are loading, or the review mutation is pending, that server review
    rejects refunded receipts, missing rejection reasons, and invalid receipt
    dates before writing updates, that
    reimbursement recording stays disabled while the refund mutation is pending,
    that receipt preview rendering only trusts HTTP(S) or app-relative preview
    URLs, and that finance receipt contact details prefer the submitter's
    notification email with login email fallback. Server handler coverage also
    pins that reimbursement recording rejects a selected receipt set with mixed
    submitters before a transaction can be recorded, rejects missing or changed
    payout details, and rejects the transaction when approved receipt
    preconditions change before the reimbursement update.
    `specs/finance/receipts-flows.spec.ts` now follows the exact seeded receipt
    through approval and reimbursement by id/file name and reads the final
    receipt row back so the UI path cannot pass against an unrelated queued
    receipt.
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
  - Manual Browser-backed organizer aggregate review once local runtime is
    available. The page-backed scanner spec now confirms buyer-plus-guest
    check-in, later remaining-guest arrival after the buyer was already checked
    in, persisted scanner counters, and the organizer overview checked-in
    aggregate using explicit registrations created against the seeded past event
    instead of generated filler registration state. Local app coverage also
    proves organizer overview stat aggregation reads the same `checkedInSpots`
    counter updated by scanner check-in mutations, and scanned-registration
    component coverage pins
    check-in button labels plus selected spot-count copy. Event-management docs
    now call out that guest-quantity check-in increments the organizer
    checked-in count by the attendee plus selected guests.
    Generated-doc source coverage keeps the event-management docs aligned with
    the dedicated scanner flow, scanner warning states, guest-quantity count
    updates, organizer cancellation scope, and paid-transfer/refund deferrals.
  - Keep scanned-registration action guards aligned with the write/refetch
    lifecycle. Local app coverage now pins that the check-in action is disabled
    when scan state disallows it, no spots are selected, the write is pending,
    or the local success state is already recorded. It also pins guest-count
    input clamping before the check-in mutation payload is built, and server
    handler coverage rejects negative guest counts and counts above the
    remaining guest quantity before writes can run. The page-backed scanner spec
    also asserts that the visible check-in action stays disabled after the local
    success state is recorded for both buyer-plus-guest and later-guest-arrival
    flows.
- Tenant/global admin:
  - Authenticated Browser review for the global-admin tenant list and
    tenant-create/edit flows. The global-admin tenant Playwright spec now
    functionally covers tenant list filtering, no-match state, operational row
    fields, connected Stripe-account support lookup, tenant detail review,
    create/edit form relaunch-scope copy, disabled empty create submit, and
    enabled seeded edit submit. Local server/app coverage already proves the
    list, tenant detail, tenant create, and tenant edit surfaces return, render,
    and persist operational tenant state for support review, and local app
    coverage proves readable load-failure messages and account labels. Tenant
    form coverage also proves create/edit payload shaping, mutation-pending
    submit disabling, and the visible relaunch tenant-scope notice before
    page-backed runtime is available. Global-admin handler coverage pins
    one-primary-domain normalization, duplicate-domain rejection before tenant
    creation mutates data, and same-domain edit allowance. Tenant detail
    coverage also pins that the external tenant-domain link only renders for
    single-host tenant domains.
  - Keep tenant settings docs and payload tests aligned when new editable
    tenant settings move out of the deferred-settings summary. Current local
    coverage proves the general-settings page can persist editable
    URLs/SEO/legal-text/ESNcard fields with database readback, the form trims
    optional editable values before sending the RPC payload, includes supported
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
    lookup-only role results; template and event-edit autocomplete coverage now
    fail loudly when seeded roles are missing.
  - Keep app action icons on the Font Awesome component path. Local source
    coverage now fails if app templates or components reintroduce direct
    Material icon elements, `MatIconModule`, or new Material icon-package
    imports outside the existing root bootstrap registry exception, preserving
    the shared premium/brand icon package path.
  - Keep server authorization checks on `includesPermission` or
    `RpcAccess.ensurePermission`; local source coverage now fails if RPC/HTTP
    handlers reintroduce raw permission-array includes checks.
  - Keep template-to-event mapper coverage aligned with the event form as richer
    reusable template data is added. Local app coverage now proves event
    defaults, source registration option ids, registration-window offsets, and
    private organizer planning tips at the template-to-event boundary. Source
    registration option ids now also drive server-side reusable add-on copying
    into event-scoped read-model records.
  - Keep simple-mode template docs honest that the relaunch form has exactly
    one organizer registration block and one participant registration block.
    Local form coverage and generated-doc source coverage pin that fixed shape
    while docs and specs cover the current extension points: reusable add-ons,
    registration questions, option descriptions, role eligibility, discounts,
    and organizer planning tips.
    `specs/templates/templates.test.ts` now functionally creates a template
    with planning tips, a reusable add-on, and a registration question, then
    reads the persisted template, add-on attachment/quantity, and required
    question state from the database.
  - Template detail component coverage pins reusable add-on purchase timing and
    registration-option labels. Server handler coverage pins the current add-on
    read model, simple-template service coverage pins optional add-on write
    payload shaping/validation, and template form utility coverage pins add-on
    submit normalization plus read-model-to-edit-form mapping. Event lifecycle,
    schema, registration-card, event-detail component, active-registration
    readback, organizer-overview readback, profile-event summary coverage, and
    the page-backed registration-addons spec pin copied event add-on storage,
    registration-time purchase payloads, event-card add-on selection, fulfilled
    add-on visibility after registration, and add-on availability deduction.
    Create-event component coverage pins the visible notice that template
    add-ons copy to registration-time purchase surfaces while standalone
    before-event and during-event sales remain out of scope.
  - Template registration-option component coverage pins paid tax-rate select
    feedback for loading, empty compatible-rate, failed, and available states.
  - Template question coverage pins simple template form preservation,
    template-scoped question storage/read models, and RPC schema shape.
  - Event question coverage pins event-scoped question storage, event creation
    copying from source template registration options, event detail read-model
    schema shape, registration/waitlist answer payload shape, answer storage,
    required-answer guards, and server-side answer validation.
  - Seed baseline coverage pins free and paid reusable template add-ons attached
    to participant template options and reusable template questions attached to
    participant/organizer template options, so those template-detail surfaces
    have deterministic data once Browser/runtime review is available.
  - Keep shared registration-mode labels aligned whenever stored modes are
    implemented or retired. Local shared coverage now keeps event/template
    authoring controls and template detail summaries away from raw storage ids.
  - Local shared coverage pins admin-facing permission labels and descriptions,
    including the labels used for role-form dependency copy and the generated
    permission reference. Generated-doc source coverage keeps the role guide
    linked to that permission reference and keeps the reference aligned with
    tenant-scoped roles, wildcard permissions, dependent permissions, and
    separate global-admin semantics.
  - Keep role create/edit submit guards aligned with the write lifecycle. Local
    app coverage now pins that invalid, submitting, and mutation-pending role
    forms stay disabled, and the component submit path shares the same guard.
    `specs/admin/roles-management.spec.ts` functionally covers the current
    tenant-admin role create/edit flow, dependent permission persistence,
    hub-display flags, role details, DB readback, and the read-only tenant user
    review page.
  - User-list/role-assignment coverage once the role-assignment path exists.
    Source coverage now pins the current read-only UI shape and generated roles
    docs while server coverage proves the current read-only user list pages
    tenant users before joining role rows and applies search before pagination,
    so multi-role users do not collapse page size.
- Registrations:
  - `specs/events/negative-registration-states.spec.ts` adds active
    page-backed coverage for closed registration windows, role-ineligible direct
    links, waitlist affordances, and the no-waitlist UI for full stored
    unsupported registration modes. Server/app unit coverage already proves
    closed-window rejection, role eligibility, unsupported stored
    registration-mode rejection,
    waitlist joining, and leave-waitlist cancellation.
  - `docs/events/register.doc.ts` now includes generated documentation
    journeys for closed registration windows, full participant options with a
    waitlist action, role-ineligible direct links, and unpaid registration
    transfer scope, in addition to free and paid registration walkthroughs.
    Generated-doc source coverage keeps that unavailable-state and transfer
    scope documentation aligned with the relaunch behavior.
  - Browser-backed execution of those assertions still depends on local runtime
    availability and either the matching Playwright Chromium cache or
    `E2E_BROWSER_CHANNEL=chrome` on a host with system Chrome installed.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- `specs/seed/seed-baseline.test.ts` fails explicitly when the core scenario
  handles point at missing event or registration-option rows.
- `docs/events/register.doc.ts` fails explicitly when the regular-user fixture
  or seeded paid registration option required by the walkthrough is missing.
- Profile event-card docs/spec seeding fails explicitly when the source
  scenario registration options for confirmed or checked-in cards are missing.
- Finance receipt flow specs fail explicitly when the tenant fixture is missing
  and verify the exact seeded approval/reimbursement receipt instead of the
  first visible finance queue row.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
- Event, registration, template, finance receipt, scanner, and unlisted-event specs should fail loudly when deterministic fixture state is missing instead of silently passing through skips.
  Free registration and registration add-on specs now assert the seeded
  `freeOpen` event option exists in the current tenant before mutating counters
  or add-on records.
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
