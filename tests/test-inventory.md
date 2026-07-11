# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys.

Updated: 2026-07-12

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
  - docs/admin/email-outbox.doc.ts [admin, globalAdmin]
  - docs/admin/global-admin.doc.ts [admin, globalAdmin]
  - docs/admin/general-settings.doc.ts [admin]
  - docs/admin/platform-tenant-operations.doc.ts [admin, globalAdmin]
  - docs/events/event-approval.doc.ts
  - docs/events/manual-approval.doc.ts [stripe]
  - docs/events/event-management.doc.ts
  - docs/events/register.doc.ts [stripe]
  - docs/events/registration-cancellation.doc.ts
  - docs/events/registration-transfer.doc.ts
  - docs/events/unlisted-admin.doc.ts
  - docs/events/unlisted-user.doc.ts
  - docs/finance/finance-overview.doc.ts [finance]
  - docs/finance/inclusive-tax-rates.doc.ts [finance]
  - docs/finance/receipt-review-reimbursement.doc.ts [finance]
  - docs/finance/receipt-submission.doc.ts [finance]
  - docs/profile/discounts.doc.ts [finance]
  - docs/profile/user-profile.doc.ts
  - docs/roles/about-permissions.doc.ts
  - docs/roles/roles.doc.ts [admin, permissions]
  - docs/scanning/addon-fulfillment.doc.ts
  - docs/scanning/check-in.doc.ts
  - docs/template-categories/categories.doc.ts
  - docs/templates/templates.doc.ts
  - docs/users/create-account.doc.ts [@needs-auth0-management]
  - docs/users/tenant-onboarding.doc.ts [admin]

- Functional tests (`*.spec.ts` / `*.test.ts`):
  - specs/admin/email-outbox.spec.ts [admin, globalAdmin]
  - specs/admin/general-settings.spec.ts [admin]
  - specs/admin/global-admin-tenants.spec.ts [admin, globalAdmin]
  - specs/admin/platform-tenant-operations.spec.ts [admin, globalAdmin]
  - specs/admin/roles-management.spec.ts [admin, permissions]
  - specs/admin/user-role-assignment.spec.ts [admin, permissions]
  - specs/auth/storage-state-refresh.test.ts
  - specs/discounts/esn-discounts.test.ts [finance]
  - specs/events/events.test.ts
  - specs/events/free-registration.test.ts
  - specs/events/manual-approval.spec.ts [stripe]
  - specs/events/negative-registration-states.spec.ts
  - specs/events/registration-addons.test.ts
  - specs/events/registration-transfer.spec.ts
  - specs/events/unlisted-visibility.test.ts
  - specs/events/price-labels-inclusive.spec.ts [finance]
  - specs/finance/finance-overview-permissions.spec.ts [finance, permissions]
  - specs/finance/receipts-flows.spec.ts [finance]
  - specs/finance/stripe-webhook-replay.spec.ts [finance, stripe]
  - specs/finance/tax-rates/admin-import-tax-rates.spec.ts [finance]
  - specs/permissions/global-admin-route-guard.spec.ts [permissions]
  - specs/permissions/matrix.spec.ts [permissions]
  - specs/permissions/override.test.ts [permissions]
  - specs/permissions/tenant-isolation-tax-rates.spec.ts [permissions, finance]
  - specs/profile/create-account.spec.ts [@needs-auth0-management]
  - specs/profile/tenant-onboarding.spec.ts [admin]
  - specs/profile/user-profile-discounts.spec.ts [finance]
  - specs/profile/user-profile-edit.spec.ts
  - specs/profile/user-profile-events.spec.ts
  - specs/profile/user-profile-live-esncard.spec.ts [@needs-live-esncard]
  - specs/profile/user-profile-receipts.spec.ts [finance]
  - specs/resilience/core-load-recovery.spec.ts [admin, finance, resilience, templates]
  - specs/reporting/reporter-paths.test.ts
  - specs/scanning/scanner.test.ts
  - specs/screenshot/doc-screenshot.test.ts
  - specs/seed/seed-baseline.test.ts
  - specs/smoke/load-application.test.ts
  - specs/smoke/semantic-theme-colors.test.ts
  - specs/template-categories/template-categories.test.ts
  - specs/templates/paid-option-requires-tax-rate.spec.ts [finance]
  - specs/templates/registration-configuration.spec.ts
  - specs/templates/template-actions-permissions.spec.ts [permissions]
  - specs/templates/templates.test.ts

## Suite Ownership

- Events and registrations:
  - `docs/events/**`
  - `specs/events/**`
  - the dedicated registration-transfer spec and generated guide cover the
    free private-link create/claim flow, paid offer/self-claim boundaries,
    current-price review, paid Checkout finalization, source-refund terminal
    failure and operator requeue, and paid non-Stripe cancellation/refund
    readback
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
    the persisted rows, clean up the generated row, and explain the read-only
    category experience for users without management permission
  - template permission coverage proves view-only users get neutral category
    navigation, a deliberate read-only category table, and no create, edit, or
    create-event actions
  - app category action guard coverage in `src/app/templates/categories`
  - app create/edit submit-guard coverage in
    `src/app/templates/shared/template-form`
  - app template detail reusable add-on label coverage in
    `src/app/templates/template-details`
  - app mapper and submit-guard coverage in
    `src/app/templates/template-create-event`
  - `specs/templates/registration-configuration.spec.ts` confirms every
    simple/advanced mode change, proves warning-only advanced states, requires
    the compatible advanced shape to be saved before a separate switch back to
    simple, preserves stable option IDs and hidden mappings, blocks legacy
    random graphs, and verifies that later template edits do not rewrite an
    event-owned snapshot
  - shared registration-mode label coverage in `src/shared`
- Roles and permissions:
  - `docs/roles/about-permissions.doc.ts`
  - `docs/roles/roles.doc.ts`
  - `specs/admin/user-role-assignment.spec.ts` assigns and removes a disposable
    role through the real tenant user list, reads both changes back from the
    database and a fresh UI query, and cleans up its temporary user, membership,
    role, and assignment. A second page-backed case proves users with
    `users:viewAll` but without `users:assignRoles` see read-only role chips.
  - `specs/permissions/**`
  - `specs/permissions/override.test.ts` grants a regular user the internal
    page permission and verifies the Members Hub route renders a hub-visible
    role through the real page.
  - shared permission-guard denial coverage in `src/app/core/guards`
  - app Members Hub loading, success, and error state coverage in
    `src/app/internal-pages/members-hub`
  - route-manifest and event-review queue action coverage in `src/app/admin`
  - route-manifest specs in `src/app/finance`, `src/app/global-admin`, and
    `src/app/templates`
- Tenant/global admin:
  - `docs/admin/global-admin.doc.ts`
  - `docs/admin/general-settings.doc.ts`
  - `docs/admin/platform-tenant-operations.doc.ts` documents explicit tenant
    targeting, attributed ownership, full event/template graph operations,
    refund recovery modes, and bounded registration approval, cancellation,
    check-in, deterministic result paths without camera emulation, and the
    migration block for legacy random-allocation records.
  - `specs/admin/platform-tenant-operations.spec.ts` follows the discoverable
    target-operation links, opens the refund-recovery tab, and resolves an
    attendee ticket URL through the target-scoped platform scanner route.
  - global-admin unit/source coverage pins explicit platform authority,
    application/API append-only tenant action audit records, full event graph
    writes, bounded
    registration reads, and required operator reasons
  - `helpers/testing/email-outbox-kind-source.spec.ts` keeps the typed kinds,
    operator labels, React Email producers, transactional transition splices,
    and page-backed coverage aligned
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
  - `docs/scanning/addon-fulfillment.doc.ts`
  - `docs/scanning/check-in.doc.ts`
  - `docs/events/event-management.doc.ts` (organizer overview context)
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
  - `specs/smoke/semantic-theme-colors.test.ts` verifies the rendered success
    and warning role pairs for Evorto and ESN themes in light, dark, and
    increased-contrast modes.

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
  persisted draft/pending/published lifecycle states, verify review feedback
  and reviewer audit fields on a returned draft, and clean up the generated
  event rows.
- Event registration option component coverage pins participant registration and
  waitlist action disabling while a register or waitlist mutation is pending.
- `specs/events/free-registration.test.ts` covers the seeded free-registration
  happy path, confirms the persisted registration and confirmed counter, then
  restores the touched registration rows and registration-option counters.
- `specs/events/manual-approval.spec.ts` uses the seeded free and paid scenario
  handles with a deterministic application-mode override. It proves participant
  application without capacity or payment, authorized organizer approval, free
  confirmation, one paid Checkout claim/session, Stripe-backed confirmation,
  participant refresh, sequential duplicate-action safety, interrupted payment
  setup retry, and pending-payment cancellation with capacity release. The
  shared scenario helper restores registrations, event timing, option mode and
  counters, transactions, and approval outbox rows.
- `specs/events/registration-addons.test.ts` adds page-backed coverage for a
  registration-time add-on and required question selected on a seeded free
  event, including required answer gating, persisted add-on purchase, persisted
  question answer, active-registration readback, and add-on availability
  decrement, then cleans up generated add-on/question data and restores touched
  registration rows and counters. Two isolated post-registration cases cover a
  free keyboard purchase through the authenticated page RPC at a mobile
  viewport with Axe and overflow checks, plus the explicit before/during
  sales-window denials. The paid case calls the production
  `purchaseRegistrationAddon` service under the exact fixture owner/tenant and
  Database/Stripe layers; a fail-closed Stripe client pins the connected-account
  Checkout POST, idempotency key, completion GET, and expanded charge GET. It
  proves canonical stock reservation, pending reload without entitlement,
  cancellation/transfer locks, production-finalizer settlement, real fee
  snapshot persistence, and order/transaction/purchase/immutable-lot/stock
  readback with exact cleanup. Handler/RPC unit and source coverage separately
  pins authenticated current-user and tenant forwarding into that service.
- `specs/events/registration-transfer.spec.ts` creates a free confirmed
  registration, persists a private bearer-link offer using hashed credentials,
  claims it as a second authenticated tenant user, and reads back the cancelled
  source, confirmed recipient, stable capacity, completed transfer, and queued
  notification before cleaning up its generated rows. It also proves that a
  Stripe-paid source can create a private offer while the source cannot claim
  it, that the intended recipient sees the current paid price before Checkout,
  that the shared Checkout completion path confirms the recipient, cancels the
  source, and persists one source-refund obligation, that a terminal Stripe
  refund failure remains attached to the completed transfer until an operator
  requeues its next idempotency generation, and that cancelling a paid
  non-Stripe registration creates exactly one pending manual refund and
  releases confirmed capacity.
- `specs/events/negative-registration-states.spec.ts` adds page-backed waitlist
  coverage for full first-come-first-served options with explicit required
  answer gating, persisted waitlist registration readback, and persisted
  question-answer readback. It also leaves the waitlist and asserts the
  cancelled registration plus released waitlist counter, then restores touched
  registrations, generated questions, and option counters.
- `docs/events/registration-transfer.doc.ts` generates the dedicated private
  transfer-link guide, including bearer-credential handling, recipient review,
  persisted ownership transition, and page-backed paid-transfer states for
  pending Checkout, successful ownership transfer with refund processing,
  terminal source-refund failure, and safe operator requeue.
- `docs/events/manual-approval.doc.ts` documents the complete participant and
  organizer journey for free and paid applications. It begins from Events
  navigation, explains that applications neither reserve nor charge, reads back
  registration/capacity/outbox state, completes a real Stripe test Checkout,
  shows the fresh, retry, and session-ready organizer states, and documents
  participant refresh, cancellation, tenant scope, and the current lack of a
  separate rejection action.
- Active-registration component coverage pins participant cancellation and
  self-service transfer action disabling while either write is pending or the
  transfer is unavailable.
- `specs/templates/paid-option-requires-tax-rate.spec.ts` has active
  simple-mode UI coverage for the paid-registration tax-rate requirement and a
  seeded inclusive tax-rate save path. Future bulk/no-compatible-rate UI
  behavior remains uncovered without a hidden fixme placeholder. Template detail paid-option
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
- `specs/profile/create-account.spec.ts` is collected by
  `local-chrome-integration` and fails its explicit precondition without Auth0
  Management credentials. It is the functional integration path for creating a
  new Auth0-backed tenant account, verifying profile arrival, tenant assignment,
  default role assignment, and cleanup.
- `specs/profile/user-profile-live-esncard.spec.ts` is collected by
  the dedicated `local-chrome-live-esncard` project and fails its explicit
  precondition without `E2E_LIVE_ESN_CARD_IDENTIFIER`. It is the functional
  integration path for live external ESNcard add, refresh, and remove provider
  outcomes. Use
  `E2E_LIVE_ESN_CARD_IDENTIFIER=... bun run test:e2e:live-esncard` to run only
  this provider path locally when a valid live identifier is available. The
  protected release-certification environment must supply an approved
  non-production identity; the Release workflow cannot continue when the
  credential is absent or the live path fails. The release command disables
  traces and value-bearing assertions so the identifier is not copied into
  artifacts.
- `specs/finance/stripe-webhook-replay.spec.ts` fails its `beforeAll`
  precondition when `STRIPE_WEBHOOK_SECRET` is absent. That credential gate is
  not a substitute for product coverage. This is separate from the Docker stack's Compose-managed Stripe
  listener, which shares its generated signing secret with the app through
  `STRIPE_WEBHOOK_SECRET_FILE`.
- `specs/permissions/override.test.ts` is active desktop coverage for the
  permission override fixture; no mobile project currently runs this spec.
- `specs/permissions/global-admin-route-guard.spec.ts` covers direct
  `/global-admin/audit`, `/global-admin/tenants`, `/global-admin/tenants/create`,
  `/global-admin/tenants/:tenantId`, and
  `/global-admin/tenants/:tenantId/edit`, plus target-scoped event, template,
  scanner, user, role, tax-rate, and finance route allow/deny behavior once
  page-backed runtime is available.
- Page-backed local execution requires the Playwright Chromium cache installed
  by `bun run test:e2e:install`.
- `helpers/testing/playwright-skip-inventory.spec.ts` requires the Playwright
  `test.skip` and `test.fixme` inventory to remain empty, so credential or
  fixture preconditions fail explicitly instead of becoming silent
  placeholders.

## Stabilization Coverage Watchlist

The entries below are the areas to keep aligned as stabilization continues.
Most are now covered by deterministic specs, generated docs, or source guards.
This inventory is not the release-blocker ledger; use
`APPLICATION_COMPLIANCE_AUDIT.md` for the complete production-readiness state.
The external verification gates here are the in-app Browser manual review queue
and the release-gated live ESNcard provider credential path.

- Profile/account:
  - Docker-backed system-Chrome profile edit persistence now passes against the
    rebuilt app. Generated docs exercise the notification-email plus IBAN/PayPal
    edit/restore path with database readback,
    `specs/profile/user-profile-edit.spec.ts` functionally covers notification
    email plus IBAN/PayPal persistence with explicit database readback and
    cleanup, and app helper coverage proves payload trimming, blank-value
    normalization, and visible profile-cache refresh after save.
  - Docker-backed system-Chrome profile event-card review now passes against the
    rebuilt app. Generated profile docs seed confirmed, pending-checkout,
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
    The generated profile docs and matching profile-event spec now read back the
    persisted confirmed registration, add-on purchase, pending checkout
    transaction, waitlist registration, and checked-in registration rows behind
    those seeded profile cards.
    The generated profile docs and functional profile-event spec now pin each
    seeded confirmed, pending-checkout, waitlisted, and checked-in card to its
    expected event-page link so the recovery route cannot silently drift. They
    also assert that only the
    pending-checkout card exposes the profile-level **Continue payment** action,
    and read back the pending registration plus checked-in add-on purchase rows
    behind those visible cards.
    Organizer overview app coverage also proves checked-in rows and in-flight
    writes disable participant cancellation and organizer-assisted transfer.
  - Live external ESNcard add, refresh, and remove provider outcomes with
    readable error states are now represented by
    `specs/profile/user-profile-live-esncard.spec.ts`, an external-provider-tagged
    Playwright path with a fail-closed
    `E2E_LIVE_ESN_CARD_IDENTIFIER` credential preflight. It stays out of
    deterministic baseline CI, while the Release workflow calls the protected,
    fail-closed ESNcard certification workflow and also runs the existing
    provider-error UI coverage. The dedicated live-provider project needs no
    ESNcard API key or unrelated Auth0 Management/Cloudflare provider
    credentials.
    Generated discounts docs now include a helper-backed baseline note for
    readable ESNcard statuses, pending save/refresh/remove labels, shared
    in-flight write guards, trimmed save payloads, and provider-unavailable
    retry copy. The page-backed discounts doc asserts direct `#discounts`
    routing, the seeded verified ESNcard identifier/status, database readback,
    refresh/remove action visibility, the invalid-card-number save guard, and
    that invalid input leaves the seeded row unchanged. The profile discounts
    spec functionally covers the same seeded direct-link discount-card journey
    with database readback. App and server
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
  - Tenant onboarding, account-creation retry, and cross-tenant join behavior.
    Server and schema coverage proves policy/question normalization, verified
    identity, profile and answer validation, exact completion rules, immutable
    version/answer constraints, requirements-changed rejection, and tenant-bound
    acceptance/answer foreign keys. The request-context integration enforces
    current completion before protected tenant RPCs receive a user context. App
    helper coverage proves Auth0-data prefill, existing-profile/current-answer
    prefill, email-verification gating, payload normalization, error-message
    mapping, privacy acceptance, and the invalid/submitting/mutation-pending
    submit guard shared by the visible submit button and handler.
    `specs/profile/create-account.spec.ts` adds credential-gated functional
    coverage for a generated Auth0 user creating a current-tenant account,
    landing on profile, persisted notification email/name fields, tenant
    assignment, default role assignment, and DB cleanup.
    The matching integration-tagged create-account doc now reads back the
    persisted global user, tenant assignment, default role assignment, and
    cleans up the generated database rows when Auth0 Management credentials are
    available.
    `specs/profile/tenant-onboarding.spec.ts` deterministically covers an
    existing user joining a second tenant only after accepting the exact policy
    and answering short-text and selection questions. It reads back membership,
    acceptance, answers, and unchanged home tenant, then proves the explicit
    profile action changes the home tenant. Its admin path publishes a new
    policy/question set, proves the publishing administrator is immediately
    returned to setup, and reads back reacceptance.
    `docs/users/tenant-onboarding.doc.ts` generates the matching page-backed
    administrator guide with screenshots, immutable-version warnings, required
    question configuration, forced reacceptance, persisted-record checks, and
    home-tenant guidance. `docs/users/create-account.doc.ts` retains the
    credential-gated first-login guide and now includes current privacy-policy
    acceptance and first-home-tenant persistence.
    Shared RPC schema coverage proves account-creation and profile-update
    notification email format validation, matching the create-account/profile
    edit form validators.
    The integration-tagged create-account doc also asserts the editable email
    field is labeled "Notification email" when Auth0 Management credentials are
    available.
    Root route-manifest coverage keeps `/create-account` reachable to
    authenticated users without a tenant assignment while protected feature
    routes keep assigned-account and auth guards.
    A Docker-backed docs pass also keeps the create-account baseline note and
    credential-gated integration path executable under the local runtime; the
    live Auth0 path still requires Auth0 Management credentials to satisfy its
    fail-fast precondition.
  - Submitted-receipt visibility after receipt submission. Manual Browser
    review remains useful after signing in to the in-app Browser, but
    the Docker-backed Playwright profile pass now verifies the deterministic
    profile receipt flow through both generated docs and the functional spec:
    filename, submitted status, event title, amount, persisted database row, and
    cleanup. Local app/server coverage already proves readable
    submitted-receipt status labels, amount formatting, and
    `finance.receipts.my` profile-card row normalization.
- Finance/receipts:
  - Keep finance route-denial cases and route-manifest specs aligned as
    transaction, receipt approval, and reimbursement routes change.
  - Keep receipt review and reimbursement docs aligned with the manual
    notification and manual money-movement scope. Local component coverage,
    finance docs, and receipt flow specs now pin that the reimbursement queue
    records an Evorto transaction only, that money movement remains manual
    through the selected payout method, that reimbursement actions require a
    selected receipt plus the chosen payout detail, that selected totals sum the
    selected rows only, that receipt submission snapshots its currency, that
    approval/profile displays use that recorded value, and that reimbursement
    groups and ledger transactions cannot mix or replace recorded currencies,
    that approval/rejection actions stay disabled while the
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
    original upload is pending, and while the submit mutation is pending. The
    receipt submit dialog now has focused local coverage for required and
    supported files, tenant-allowed countries, invalid amount/date inputs,
    attachment-name fallback, and cents normalization before submit.
    `docs/finance/receipt-submission.doc.ts` starts from visible **Events**
    navigation, opens the exact seeded event and organizer receipt section,
    demonstrates missing-file and deposit/alcohol-over-total recovery, uploads
    a PDF, and reads back the tenant/event/submitter-bound upload plus every
    persisted amount. It then proves the organizer card, personal profile card,
    absence of a submission email, and the denial/read-isolation boundary for
    a regular member of the same tenant. The shared
    `support/utils/receipt-submission.ts` navigation and dialog flow also backs
    the functional submission spec so the guide and regression path cannot
    silently diverge. The readback accepts any configured HTTP(S) S3-compatible
    endpoint while requiring the exact tenant/event/user-bound bucket-key
    suffix. Database rows are deleted in-test, while volume-less MinIO test
    objects are discarded with the Compose container instead of risking a
    cleanup request against a developer-configured or remote R2 endpoint.
  - Keep paid-registration webhook counter coverage aligned with buyer-plus-guest
    spot counts. Local shared coverage pins the capacity count helper used by
    webhook completion/expiry updates; Stripe replay specs remain
    credential-gated.
  - Notification or email follow-up behavior once the product path exists.
- Scanning/check-in:
  - The scanner result now has page-backed add-on fulfillment coverage. The
    functional scanner spec seeds included and optional quantities, proves
    one-unit redemption and immediate latest-redemption undo, prevents redeemed
    quantities from being cancelled, previews the optional-purchased-first
    cancellation allocation, rejects fractional quantities, forces included-only
    cancellation to a no-refund outcome, and exercises explicit with-refund and
    without-refund optional-purchase choices. It reads back distinct redemption
    and reversal events, exact source allocations/counters, refund allocations,
    and restored inventory, and verifies the free optional-purchase path reports
    that no monetary refund is required. Least-privilege coverage keeps
    redeem/undo available while explaining and hiding cancellation until its
    separate capability is granted. `docs/scanning/addon-fulfillment.doc.ts`
    follows the same
    deterministic result URL, captures the overview, undo, cancellation dialog,
    and completed counters, and leaves real-device camera review as an explicit
    manual step instead of treating synthetic camera input as proof.
  - Docker-backed system-Chrome organizer aggregate review now passes for the
    scanner spec and generated event-management docs. The page-backed scanner
    spec confirms buyer-plus-guest
    check-in, later remaining-guest arrival after the buyer was already checked
    in, persisted scanner counters, and the organizer overview checked-in
    aggregate using explicit registrations created against the seeded past event
    instead of generated filler registration state. Local app coverage also
    proves organizer overview stat aggregation reads the same `checkedInSpots`
    counter updated by scanner check-in mutations, and scanned-registration
    component coverage pins
    check-in button labels plus selected spot-count copy. Event-management docs
    now execute the generated guest-quantity check-in, assert the persisted
    registration and counter updates, restore the seeded counter, and call out
    that guest-quantity check-in increments the organizer checked-in count by
    the attendee plus selected guests.
    Generated-doc source coverage keeps the event-management docs aligned with
    the dedicated scanner flow, scanner warning states, guest-quantity count
    updates, organizer cancellation scope, and paid-transfer/refund deferrals.
    Generated event-management docs also seed a confirmed registration with
    guests, capture the scanned-registration page, assert the organizer
    checked-in aggregate after scanner writes, and restore the seeded counter,
    so docs assert guest progress and the buyer-plus-guests check-in action
    instead of only describing it in Markdown.
    Organizer overview read-model and app coverage now also pin that
    organizer-assisted transfer is unavailable before opening the dialog when a
    confirmed registration is checked in, paid, or tied to a past event.
  - Keep scanned-registration action guards aligned with the write/refetch
    lifecycle. Local app coverage now pins that the check-in action is disabled
    when scan state disallows it, no spots are selected, the write is pending,
    or the local success state is already recorded. It also pins guest-count
    input clamping before the check-in mutation payload is built, and server
    handler coverage rejects negative guest counts and counts above the
    remaining guest quantity before writes can run. The page-backed scanner spec
    also asserts that the visible check-in action stays disabled after the local
    success state is recorded for both buyer-plus-guest and later-guest-arrival
    flows, and both page-backed scanner paths now assert the organizer overview
    checked-in aggregate after scanner writes.
- Tenant/global admin:
  - Authenticated Browser review for the global-admin tenant list and
    tenant-create/edit flows. The global-admin tenant Playwright spec now
    functionally covers tenant list filtering, no-match state, operational row
    fields, connected Stripe-account support lookup, tenant detail review,
    create/edit form relaunch-scope copy, disabled empty create submit, and
    a temporary tenant create with initial privacy-policy and database readback,
    required create/edit reasons, atomic application-audit readback, and cleanup,
    plus seeded edit save with database readback and fixture restoration. Generated
    global-admin docs now read the seeded localhost tenant row before asserting
    list/detail/search/edit fields, create a temporary tenant with database
    readback and cleanup, then save a tenant-name edit, read it back from the
    database, then reviews the discoverable platform audit log and cleans up the
    generated records, so the guide is tied to persisted tenant state. It also
    pins list -> create -> created detail, list -> detail -> edit, edit cancel,
    edit save, audit navigation, and external tenant-domain link targets so
    page navigation cannot silently drift while authenticated Browser runtime
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
    coverage proves the general-settings page can persist editable
    URLs/SEO/legal-text/receipt-country/ESNcard fields with database readback,
    the form trims optional editable values before sending the RPC payload,
    includes supported currency/locale/timezone selections in the update
    payload, and normalizes blank optional values before the RPC call. Server
    admin-handler coverage also pins that currency changes are rejected once
    template, event, receipt, or transaction data exists and that timezone
    changes are rejected once tenant event or transaction data exists. The
    global-admin handler applies the same fail-closed currency rule to audited
    platform edits instead of silently reinterpreting stored minor units. Tenant
    schema, admin-handler, and
    route coverage pin supported relaunch currency/locale/timezone values,
    hosted legal text fields, public legal page routes, and tenant logo/favicon
    upload storage paths while normalizing legacy context payloads.
    General-settings identity coverage also pins read-only tenant name, primary
    domain, and Stripe account support lookup labels.
    General-settings component coverage also pins that invalid, submitting, and
    mutation-pending saves stay disabled so slow settings writes cannot
    double-submit, and that brand-asset uploads stay disabled while any upload
    is active or mutation-pending.
  - Tenant operations settings now have page-backed persistence and generated
    documentation coverage for reply-to name/email, connected Stripe account
    id, and the tenant-wide active-registration limit. Both journeys use a
    unique seeded tenant, assert the stored tenant row, reload the page for UI
    readback, and restore the original settings in cleanup. The generated guide
    explains the fixed notification From address, the external Stripe-account
    verification responsibility, the meaning of a zero registration limit,
    tenant boundaries, and save recovery behavior.
  - Global Email Outbox coverage now seeds uniquely identified queued,
    scheduled-retry, active-sending, exhausted, and sent rows on a disposable
    tenant and deletes those rows in cleanup. Functional and generated-doc
    journeys navigate through the guarded global-admin shell, assert global
    status summaries, tenant/recipient/attempt/error details, Refresh readback,
    and the fixed server-side list scope: queued/sending/failed rows are shown
    while sent rows remain summary-only. Permission coverage allows platform
    admins and denies ordinary signed-in users on the direct outbox route. The
    beginner guide distinguishes automatic queued retry, a time-limited sending
    claim, automatic abandoned-claim recovery, and exhausted failures, and is
    explicit that interactive tenant/status filtering and manual requeueing are
    not current UI features.
  - Trusted tenant URL coverage derives one secure HTTPS public origin from the
    normalized primary domain and rejects credentials, non-default ports,
    paths, fragments, alternate hosts, and absolute URL overrides. Production
    notification and Stripe return links ignore request origins and global app
    origins; local development may use only an explicit loopback runtime
    origin. Platform tenant create/edit, database readback, application/API
    append-only audit snapshots, tenant detail links, and generated docs cover
    the normalized domain. Tenant administrators see the primary domain
    read-only and cannot mutate it through tenant settings.
- Roles/user management:
  - Docker-backed system-Chrome least-privilege organizer coverage exercises
    event/template role selectors through the organizer fixture. Server
    coverage proves lookup permissions and lookup-only role results;
    template/event autocomplete specs fail loudly when seeded roles are
    missing, and generated template/event-management docs document duplicate
    hiding from real browser flows.
    `specs/seed/seed-baseline.test.ts` also pins default organizer roles to
    `templates:create`, `templates:view`, and `events:create`, matching the
    organizer fixture's template/event authoring contract.
  - Keep app action icons on the Font Awesome component path. Local source
    coverage now fails if app templates or components reintroduce direct
    Material icon elements or `MatIconModule`, preserving the shared
    premium/brand icon package path.
  - Keep template-to-event mapper coverage aligned with the event form as richer
    reusable template data is added. Local app coverage now proves event
    defaults, source registration option ids, registration-window offsets, and
    private organizer planning tips at the template-to-event boundary. The
    server snapshots template mode, questions, reusable add-ons, and every
    included/optional option mapping into event-owned rows; later template edits
    leave that snapshot unchanged.
  - Template detail component coverage pins reusable add-on purchase timing and
    registration-option labels. Server handler coverage pins event-owned add-on
    snapshots and organizer fulfillment. Create-event component coverage pins
    the visible copy notice when a template has reusable add-ons.
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
  - Existing-user role assignment has page-backed functional and generated-doc
    coverage for assign, persisted readback, removal, empty readback, permission
    context, the read-only role-chip surface, and safe cleanup. Server coverage
    also proves the user list pages tenant users before joining role rows and
    applies search before pagination, so multi-role users do not collapse page
    size.
- Registrations:
  - `docs/events/registration-cancellation.doc.ts` covers ordinary paid
    participant cancellation, organizer cancellation, guest-capacity release,
    manual-refund recording, cancellation and waitlist emails, deadline denial,
    and confirmation safety; it also documents permission/tenant boundaries and
    retry/idempotency guidance without claiming a new denial test.
  - `specs/events/manual-approval.spec.ts` and
    `docs/events/manual-approval.doc.ts` now cover application creation, free
    approval, paid approval and Checkout completion, exactly-one payment/email
    readback, participant refresh, payment-setup recovery, and cancellation.
    Keep these paths aligned with the durable payment-claim invariant and the
    organizer fresh/retry/session-ready states.
  - `specs/events/negative-registration-states.spec.ts` adds active
    page-backed coverage for closed registration windows, role-ineligible direct
    links, and waitlist affordances. Server/app unit coverage already proves
    closed-window rejection, role eligibility, unsupported stored
    registration-mode rejection, unsupported-mode no-waitlist card behavior,
    waitlist joining, and leave-waitlist cancellation.
  - `docs/events/register.doc.ts` now includes generated documentation
    journeys for closed registration windows, full participant options with a
    waitlist action, and role-ineligible direct links, in addition to free and
    paid registration walkthroughs. Its **Buy add-ons after registration**
    journey starts from the ordinary event list, documents before/during sales
    windows, immediate free fulfillment, the durable paid pending state and
    same Checkout link after reload, and settled entitlement readback. The
    dedicated
    `docs/events/registration-transfer.doc.ts` owns transfer guidance.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- Docker-backed authenticated checks currently need an Auth0-registered app
  origin. Use `APP_HOST_PORT=4200 bun run docker:start` on this machine unless
  the generated worktree port has been added to the Auth0 callback URLs.
- Scenario handles from `seeded.scenario.events.*` are the preferred way to address seeded entities.
- `tests/specs/scanning/scanner.test.ts`,
  `tests/specs/profile/user-profile-discounts.spec.ts`, and
  `tests/specs/events/price-labels-inclusive.spec.ts` passed together against a
  fresh Docker runtime with system Chrome, covering scanner writes plus
  organizer checked-in aggregates, stable seeded ESNcard display, invalid
  discount-card input blocking, and inclusive price-label behavior.
- `tests/specs/discounts/esn-discounts.test.ts` and
  `tests/specs/profile/user-profile-discounts.spec.ts` passed together against
  a rebuilt Docker runtime with system Chrome after the Stripe CLI sidecar
  update, covering seeded profile discount-card state plus the paid registration
  ESN discount label, price component, and payment button.
- `tests/specs/admin/global-admin-tenants.spec.ts` and
  `tests/specs/permissions/global-admin-route-guard.spec.ts` cover the
  global-admin tenant list/create/detail/edit workflow and allow/deny route
  guards as part of the complete application baseline.
- `src/app/core/app-query-client.spec.ts` proves separate Angular application
  injectors cannot share cached permissions or data.
- `src/app/events/events.routes.spec.ts` proves organizer and edit routes
  register their functional guards directly instead of returning guard
  functions from lazy wrappers.
- `specs/seed/seed-baseline.test.ts` fails explicitly when the core scenario
  handles point at missing event or registration-option rows.
- `docs/events/register.doc.ts` fails explicitly when the regular-user fixture
  or seeded paid registration option required by the walkthrough is missing.
- Profile event-card docs/spec seeding fails explicitly when the source
  scenario registration options for confirmed or checked-in cards are missing.
- Finance receipt flow specs fail explicitly when the tenant fixture is missing
  and verify the exact seeded approval/reimbursement receipt instead of the
  first visible finance queue row.
- Finance overview docs seed visible and cancelled transaction rows before
  documenting the transaction list, so the generated guide proves cancelled
  transactions stay omitted from that surface.
- Finance-tagged specs remain the main candidates for selective CI filtering when needed.
- Event, registration, template, finance receipt, scanner, and unlisted-event specs should fail loudly when deterministic fixture state is missing instead of silently passing through skips.
- Playwright skip/fixme inventory must remain empty. Credential-dependent
  projects fail their selected-run preflight when credentials are unavailable;
  they are not represented as skipped tests.
- Playwright list/discovery output is intentionally readable:
  `helpers/testing/playwright-skip-inventory.spec.ts` guards that real spec/doc
  titles no longer include placeholder `@track`, `@req`, or `@doc` metadata.
- Integration-tagged Playwright paths now include both generated docs and
  non-doc specs: `docs/users/create-account.doc.ts`,
  `specs/profile/create-account.spec.ts`, and
  `specs/profile/user-profile-live-esncard.spec.ts`.
- Playwright `--list` discovery does not clean or write generated docs output,
  and baseline fixture imports do not require Auth0 Management credentials.
