# Playwright Test Inventory

Scope: Current Playwright tests and documentation journeys.

Updated: 2026-06-05

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
  - docs/admin/general-settings.doc.ts [admin]
  - docs/admin/global-admin.doc.ts [admin, globalAdmin]
  - docs/events/event-approval.doc.ts
  - docs/events/event-management.doc.ts
  - docs/events/register.doc.ts [stripe]
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

- Functional tests (`*.spec.ts` / `*.test.ts`):
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
  - specs/profile/user-profile-esncard-provider.spec.ts [@esncard-provider]
  - specs/profile/user-profile-home-tenant.spec.ts
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
  - `docs/events/unlisted-user.doc.ts` screenshots both the seeded unlisted
    event disappearing from the user event list while a second listed event card
    remains visible, and the same unlisted event opening through its direct
    detail URL with a visible registration-option card before restoring the seed
    state
  - `specs/events/**`
  - `specs/discounts/esn-discounts.test.ts`
  - app event edit, lifecycle-action, and organizer-action guard coverage in
    `src/app/events`
- Templates and categories:
  - `docs/templates/templates.doc.ts`
  - `docs/template-categories/categories.doc.ts`
    documents the category create/edit dialog states, save actions, and
    saved/renamed rows with focused screenshots plus deterministic persistence
    checks
  - `specs/templates/**`
  - template create/detail/tax-rate specs that fail explicitly when seeded
    template categories/templates or reusable attachment/question readbacks are
    missing
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
  - role docs create a deterministic tenant role, assert dependent permission
    selection with focused permission-group and saved-detail screenshots, read
    back persisted permissions, and clean up the generated row
  - `specs/admin/roles-management.spec.ts`
  - `specs/permissions/**`
  - shared permission-guard denial coverage in `src/app/core/guards`
  - route-manifest and event-review queue action coverage in `src/app/admin`
  - route-manifest specs in `src/app/finance`, `src/app/global-admin`, and
    `src/app/templates`
- Tenant/global admin:
  - `docs/admin/general-settings.doc.ts` covers the tenant general-settings
    docs flow with focused screenshots for the deferred-settings summary,
    tenant identity, brand/search-preview field group, hosted legal field group,
    and ESN-card discount toggle instead of heading-only or single-field crops.
    The doc asserts the deferred custom-domain rows, identity rows, locale/money
    controls, operations policy controls, branding/SEO fields, legal URL/text
    fields, finance receipt settings, ESNcard discount toggle, and Save action
    before taking those screenshots.
  - `docs/admin/global-admin.doc.ts` covers the global tenant-administration
    docs flow with concrete screenshot targets for tenant search/list rows,
    empty search results, the relaunch-scoped create form, rejected URL-shaped
    domain form state, read-only tenant detail review, and the edit form instead
    of highlighting page or card headings. The doc keeps one active primary
    domain, deferred custom-domain/multi-domain automation, and unavailable
    tenant-admin impersonation explicit in the generated guidance.
  - `specs/admin/admin-viewports.spec.ts`
  - `specs/admin/general-settings.spec.ts`
  - `specs/admin/global-admin-tenants.spec.ts`
- Finance, receipts, tax, and Stripe:
  - `docs/finance/**`
  - `specs/finance/finance-overview-permissions.spec.ts`
  - `specs/finance/**`
  - `docs/finance/finance-overview.doc.ts` seeds its own visible transaction,
    omitted cancelled transaction, submitted receipt, and approved receipt rows
    before screenshotting the permission-scoped finance navigation card,
    visible transaction row, submitted receipt approval row, and approved
    reimbursement row.
  - `docs/finance/inclusive-tax-rates.doc.ts` screenshots seeded compatible VAT
    tax-rate rows and the full paid registration option tax-rate controls, so
    the generated guide proves selectable inclusive rates instead of route-shell
    presence or a single combobox crop.
  - finance viewport coverage checks the authenticated finance overview,
    transactions, receipt approval list/detail, and reimbursement pages at
    narrow mobile, mobile, and desktop viewports for expected seeded content,
    no application-error text, no page-level horizontal overflow, and no
    horizontally clipped visible controls outside intentional table scroll
    containers
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
    checks documentation reporter output paths, caption pairing, generated
    figure escaping, highlighted screenshot targets, visible page-content
    detection, and zero-box host screenshots without app startup.
    `bun run test:e2e:reporter-paths` is the focused local rerun; it refreshes
    `.env.dev`, sets ignored docs output paths and `NO_WEBSERVER=true`, and
    uses `--no-deps`.
  - `specs/screenshot/doc-screenshot.test.ts`
    checks the static doc-screenshot helper contract for relative image paths,
    loading-text waits, finite transition waits, stable target bounds, transient
    snackbar waits, persistent snackbar tolerance, and image-root resolution
    without app startup. `bun run test:e2e:doc-screenshot` is the focused local
    rerun; it refreshes `.env.dev`, sets ignored docs/image output paths and
    `NO_WEBSERVER=true`, and uses `--no-deps`.
  - `specs/seed/seed-baseline.test.ts` proves the seeded tenant has default
    roles, all template families, paid/free registration options, paid tax-rate
    wiring, reusable template add-ons, scenario handles, confirmed
    registrations, and checked-in scanner aggregates.
  - `specs/smoke/load-application.test.ts`
  - `specs/smoke/page-layout-helper.test.ts` exercises the shared viewport
    helper without app startup by setting synthetic mobile pages directly in
    Playwright. It proves the helper returns the stable-layout shape for clean
    pages, labels page-level overflow, covered controls, covered readable text,
    clipped controls, clipped readable text, vertically clipped fixed controls,
    and vertically clipped fixed readable text with actionable metadata, and
    ignores intentional
    horizontal-scroll containers such as tables. `bun run test:e2e:layout-helper`
    is the focused local rerun; it refreshes `.env.dev`, sets ignored docs/image
    output paths for the reporter, keeps `NO_WEBSERVER=true`, and uses
    `--no-deps`.
  - `specs/smoke/public-general-viewports.spec.ts` reuses one seeded tenant to
    check the public root redirect, events list, public event detail, hosted
    legal pages, general 403/404/500 pages, and wildcard not-found redirect at
    narrow mobile, mobile, and desktop viewports for rendered content, no
    application-error text, no horizontal overflow, no horizontally clipped
    visible controls, and no overflowing visible text or panel elements outside
    intentional horizontal scroll containers. The source guard pins the exact
    public General route list and route content assertions against
    `src/app/app.routes.ts`; `src/app/app.routes.spec.ts` also enumerates the
    anonymous public General route manifest before page-backed viewport coverage
    runs, including a failure if a new anonymous General route is added without
    coverage. `bun run test:e2e:public-general-viewports` is the focused local
    rerun for an already-running Docker app; it refreshes `.env.dev`, sets
    ignored docs/image output paths and `NO_WEBSERVER=true`, uses `--no-deps`,
    and keeps the route matrix on one worker. `/create-account` is
    intentionally excluded from this anonymous
    General sweep because it is auth-guarded account coverage.
  - `specs/admin/general-settings.spec.ts` also checks authenticated tenant
    General settings at narrow mobile, mobile, and desktop viewports for
    expected settings content, no application-error text, no horizontal
    overflow, no horizontally clipped visible controls, and no overflowing
    visible text or panel elements outside intentional horizontal scroll
    containers.
  - `support/utils/page-layout.ts` provides the shared viewport layout guard for
    these specs. It rejects application-error text, page-level horizontal
    overflow with real visible overflow, horizontally clipped visible controls
    with actionable labels, controls covered by another separate visible layer
    with covering element labels and center-point coordinates, readable text
    covered by another visible layer with covering element labels and
    center-point coordinates, vertically clipped fixed/sticky visible controls
    with edge and position labels, vertically clipped fixed/sticky readable text
    with edge and position labels, and overflowing visible text or panel
    elements outside intentional horizontal scroll containers while ignoring
    Angular Material's empty touch-target shim, document-root or ancestor
    hit-test targets, controls inside readable text, same-form-field Material
    floating labels or required markers, and allowing normal below-fold vertical
    scrolling content. Control diagnostics include common ARIA/Material
    interactive roles such as `switch`, `checkbox`, `combobox`, `menuitem`,
    `option`, `radio`, `slider`, and `spinbutton`, use accessible labels such as
    `aria-label` or `title` for icon-only buttons, include focusable `tabindex`
    custom controls, and report visible controls that still have no accessible
    label. Stabilization source
    coverage pins the exact active durable viewport spec inventory, every
    durable viewport spec to the shared 320x740 narrow mobile, 390x844 mobile,
    and 1440x900 desktop matrix, then also requires each spec to loop that
    matrix through labelled viewport steps.
    `bun run test:e2e:authenticated-viewports` is the focused authenticated
    rerun for the durable logged-in viewport pack; it keeps the tenant admin,
    global-admin, role/user-management, profile, template, event, finance,
    scanner, and members-hub viewport specs on one worker and uses ignored
    docs/image output paths for the globally initialized documentation reporter.
  - `specs/admin/admin-viewports.spec.ts` checks the authenticated tenant admin
    overview, tax-rate table, and event-review queue routes at narrow mobile,
    mobile, and desktop viewports for expected headings/content through the
    shared viewport layout guard.
  - `specs/admin/global-admin-tenants.spec.ts` also checks authenticated
    global-admin tenant list, create, detail, and edit pages at narrow mobile,
    mobile, and desktop viewports for expected headings, no application-error
    text, no horizontal overflow, no horizontally clipped visible controls, and
    no overflowing visible text or panel elements outside intentional horizontal
    scroll containers.
  - `src/app/app.routes.server.spec.ts` guards that authenticated route groups
    stay client-rendered in production SSR, so direct deep links such as
    `/admin/settings`, `/create-account`, `/global-admin/tenants`, `/profile`,
    `/templates`, `/finance`, and `/scan` return the hydrated app shell instead
    of the public server 404 shell.
  - `specs/profile/user-profile-viewports.spec.ts` checks authenticated profile
    overview, Events, Receipts, and Discounts sections at narrow mobile, mobile,
    and desktop viewports for seeded content through the shared viewport layout
    guard.
  - `specs/templates/template-viewports.spec.ts` checks authenticated template
    list, create, category management, category-prefilled create, detail, edit,
    and create-event pages at narrow mobile, mobile, and desktop viewports for
    seeded template content through the shared viewport layout guard.
  - `specs/events/event-viewports.spec.ts` checks authenticated event list,
    detail, edit, and organizer overview pages at narrow mobile, mobile, and
    desktop viewports for seeded event content through the shared viewport
    layout guard.
  - `specs/finance/finance-viewports.spec.ts` checks authenticated finance
    overview, transaction list, receipt approval list/detail, and reimbursement
    pages at narrow mobile, mobile, and desktop viewports for seeded finance
    content through the shared viewport layout guard while allowing intentional
    table scroll containers.
  - `specs/scanning/scanner-viewports.spec.ts` checks the authenticated scanner
    camera/fallback page and a seeded direct registration scan result at narrow
    mobile, mobile, and desktop viewports for expected content through the
    shared viewport layout guard.
  - `specs/internal/members-hub-viewports.spec.ts` checks the authenticated
    members hub role directory at narrow mobile, mobile, and desktop viewports
    with a seeded visible hub role and member assignment through the shared
    viewport layout guard.

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
  screenshot the review action plus rejected and published status surfaces, and
  clean up the generated event rows.
- Event registration option component coverage pins participant registration and
  waitlist action disabling while a register or waitlist mutation is pending.
- `specs/events/free-registration.test.ts` covers the seeded free-registration
  happy path, confirms the persisted registration and confirmed counter, then
  restores the touched registration rows and registration-option counters.
  Server unit coverage also proves free registration writes a
  `registrationConfirmed` email outbox row with the participant notification
  email.
- `specs/events/registration-addons.test.ts` adds page-backed coverage for a
  registration-time add-on and required question selected on a seeded free
  event, including required answer gating, persisted add-on purchase, persisted
  question answer, active-registration readback, and add-on availability
  decrement, then cleans up generated add-on/question data and restores touched
  registration rows and counters.
- `specs/events/registration-transfer.test.ts` adds page-backed coverage for
  the regular user's self-service unpaid transfer dialog and database readback
  to the target tenant member, polling for the transferred row after the dialog
  closes, then deleting the generated registration and restoring touched fixture
  registration statuses. The spec seeds the event into a server-future window so
  active-registration actions remain available under Docker server time.
- `specs/events/registration-transfer.test.ts` also seeds a paid confirmed
  registration with a successful registration transaction and proves the event
  page creates a tenant-scoped 24-hour transfer code/link without exposing the
  unpaid transfer dialog, then deletes the generated transfer intent plus
  registration/transaction rows and restores touched fixture status. The paid
  fixture uses an explicit `EUR` currency because the shared tenant fixture does
  not expose the persisted tenant currency field.
- `specs/events/registration-transfer.test.ts` also cancels a seeded paid
  confirmed registration through the event page and reads back the generated
  pending manual refund transaction for a manually seeded payment record. Server
  unit coverage separately proves Stripe-backed cancellation calls the Stripe
  refund API, records the refund transaction, writes a cancellation email
  outbox row, and notifies the oldest waitlisted participant when a confirmed
  cancellation opens capacity.
  `src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts`
  now separately covers the durable paid transfer primitives:
  `events.createRegistrationTransferIntent` creates or reuses a tenant-scoped
  24-hour transfer code for eligible paid registrations and rejects unpaid
  registrations, and `events.registerWithTransferCode` creates a replacement
  pending Stripe Checkout registration for an eligible code recipient while
  rejecting the original owner and duplicate active registrations. The
  transfer-code checkout coverage now includes webhook completion and source
  refund fallback coverage, satisfying the product-defined direct transfer or
  resale workflow. Public resale listing marketplaces remain outside relaunch
  scope unless a future product decision adds them.
- `specs/finance/stripe-webhook-replay.spec.ts` includes a signed webhook replay
  case for transfer-code replacement checkout completion, proving the source
  registration is cancelled, the replacement registration is confirmed, the
  transfer intent is completed, a pending manual refund fallback is recorded
  for source transactions without Stripe refund references, and capacity remains
  on the original confirmed spot instead of being double-counted.
- `specs/events/negative-registration-states.spec.ts` adds page-backed waitlist
  coverage for full first-come-first-served options with explicit required
  answer gating, persisted waitlist registration readback, and persisted
  question-answer readback. It also leaves the waitlist and asserts the
  cancelled registration plus released waitlist counter, then restores touched
  registrations, generated questions, and option counters.
- `docs/events/register.doc.ts` includes a generated unpaid transfer journey,
  including the transfer dialog and eligible target email entry. It now also
  seeds a paid confirmed registration with a successful transaction, creates a
  paid transfer link/code while naming the replacement-checkout source-refund
  path and direct-resale scope, cancels the paid registration,
  and reads back the generated pending manual refund fallback before cleanup.
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
- `specs/profile/user-profile-esncard-provider.spec.ts` is collected by
  `local-chrome-baseline`. It is the functional path for ESNcard add, refresh,
  remove, and provider-unavailable outcomes through tenant-scoped deterministic
  provider test mode. Use `bun run test:e2e:esncard-provider` to run only this
  provider path.
- `specs/finance/stripe-webhook-replay.spec.ts` is file-level skipped when
  `STRIPE_WEBHOOK_SECRET` is absent, before page/database fixtures are
  requested. That skip is credential-gated, not a substitute for product
  coverage. This is separate from the Docker stack's Compose-managed Stripe
  listener, which shares its generated signing secret with the app through
  `STRIPE_WEBHOOK_SECRET_FILE`. The suite also pins checkout completion
  mapping when the webhook event arrives before the payment-intent reference is
  persisted locally, using the stored `stripeCheckoutSessionId` as the fallback.
- `specs/permissions/override.test.ts` is active desktop coverage for the
  permission override fixture; no mobile project currently runs this spec.
- `specs/permissions/global-admin-route-guard.spec.ts` covers direct
  `/global-admin/tenants`, `/global-admin/tenants/create`,
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
- `helpers/testing/generated-documentation-source.spec.ts` keeps tenant general-settings
  docs aligned with implemented brand-asset uploads and hosted legal routes,
  keeps global-admin generated docs focused on implemented relaunch tenant
  operations while still rejecting unrelated unlisted-admin docs, and keeps
  profile/account docs aligned with implemented
  notification-email semantics, global reimbursement details, event-card
  routing/check-in copy, profile event-page link targets, submitted receipt
  visibility, account-creation retry errors, existing-global-user tenant joins,
  and template role-picker hard-failure guards before duplicate-hiding docs are
  emitted. It also requires the current 16 documentation source files to attach
  at least 120 characters of explanatory markdown, pins the current per-flow
  screenshot counts with a manifest that must include every image-backed docs
  file so docs cannot quietly drop image-backed states, requires UI docs to use
  the shared `takeScreenshot` helper imported from the documentation reporter
  barrel with a meaningful literal caption, requires screenshot captions to stay
  unique across generated docs so one caption cannot describe unrelated states,
  rejects fixed `waitForTimeout` sleeps in generated docs so screenshots stay
  tied to concrete UI state,
  keeps the helper's runtime caption parameter required with the same minimum
  caption length, verifies generated
  screenshots include the highlighted focus target and visible non-highlight
  page content before attachment, rejects generic page-root screenshot targets
  such as `body`, `html`, or `app-root`, covers the weak-caption,
  missing-highlight, and blank highlighted-image runtime failures in
  reporter-path tests,
  rejects uncaptioned image attachments and orphan image-caption attachments
  before generated markdown is written, rejects raw `page.screenshot` calls,
  rejects aliased/helper-internal screenshot imports and local screenshot
  wrappers, self-tests those bypass examples, and keeps
  `tests/docs/roles/about-permissions.doc.ts` as the only text-only
  permission-reference exception. Reporter-path coverage verifies those captions
  become generated `{% figure %}` blocks and escapes caption attributes so
  quotes or ampersands in descriptive captions cannot break the generated docs.
- `helpers/testing/authorization-source.spec.ts` keeps server permission checks
  routed through the shared evaluator path and keeps role lookup contracts free
  of permission-bearing admin role fields.
- `helpers/testing/permission-matrix-source.spec.ts` keeps finance
  route-denial cases aligned with the guarded finance route manifest, including
  transaction list, receipt approval list/detail, and reimbursement routes.
- `helpers/testing/user-list-source.spec.ts` keeps the tenant user list aligned
  with the read-only relaunch surface by guarding review-only columns, the
  visible role-assignment deferral copy, and generated roles documentation.

## Stabilization Coverage Watchlist

The entries below are the areas to keep aligned as stabilization continues.
Most are now covered by deterministic specs, generated docs, or source guards;
the first in-app Browser manual review queue pass has now covered the local
Docker app, and the deterministic ESNcard provider test-mode path covers
provider outcomes without live identifiers.

- Profile/account:
  - Docker-backed system-Chrome profile edit persistence now passes against the
    rebuilt app. Generated docs exercise the notification-email plus IBAN/PayPal
    edit/restore path with database readback,
    `specs/profile/user-profile-edit.spec.ts` functionally covers notification
    email plus IBAN/PayPal persistence with explicit database readback and
    cleanup, and app helper coverage proves payload trimming, blank-value
    normalization, and visible profile-cache refresh after save.
  - `specs/profile/user-profile-home-tenant.spec.ts` mutates the regular user's
    home tenant to a different valid tenant, opens the authenticated profile
    page, asserts the visible home-tenant warning, and restores the original user
    row afterward.
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
    Generated profile screenshots now focus the concrete profile summary,
    multi-state event registration section, and seeded receipt card targets for
    profile data, registration history, and reimbursement evidence instead of
    broad profile-page captures for those states. The profile events screenshot
    highlights the registrations section plus confirmed, pending-checkout,
    waitlisted, and checked-in cards so the generated image shows the states
    asserted by the surrounding docs text.
    Organizer overview app coverage also proves checked-in rows and in-flight
    writes disable participant cancellation and organizer-assisted transfer.
  - ESNcard add, refresh, remove, and provider-unavailable outcomes with
    readable error states are now represented by
    `specs/profile/user-profile-esncard-provider.spec.ts`, a baseline
    Playwright path backed by tenant-scoped deterministic provider test mode.
    Generated discounts docs now include a helper-backed baseline note for
    readable ESNcard statuses, pending save/refresh/remove labels, shared
    in-flight write guards, trimmed save payloads, and provider-unavailable
    retry copy. The page-backed discounts doc asserts direct `#discounts`
    routing, the seeded verified ESNcard identifier/status, database readback,
    refresh/remove action visibility, and a focused screenshot of the seeded
    verified card row instead of the section heading. It also covers the
    deterministic provider-unavailable retry error with a focused discount-form
    screenshot and unchanged seeded row assertion, the invalid-card-number save
    guard with a focused discount-form validation screenshot, and that invalid
    input leaves the seeded row unchanged. Those error-state screenshots include
    the surrounding discount form and saved-card context rather than the error
    text alone. The profile discounts spec functionally covers the same seeded
    direct-link discount-card journey with database readback. App and server
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
  - Account-creation retry and tenant-join behavior. Server coverage already
    proves transactional creation, existing-global-user tenant joins,
    duplicate-assignment conflicts, and visible create-account error message
    mapping. App helper coverage proves Auth0-data prefill, email-verification
    gating, payload normalization, error-message mapping, and the
    invalid/submitting/mutation-pending submit guard now shared by the visible
    submit button and handler.
    `specs/profile/create-account.spec.ts` adds credential-gated functional
    coverage for a generated Auth0 user creating a current-tenant account,
    landing on profile, persisted notification email/name fields, tenant
    assignment, default role assignment, and DB cleanup.
    The matching integration-tagged create-account doc now reads back the
    persisted global user, tenant assignment, default role assignment, and
    screenshots the post-create profile summary with notification-email and
    edit-action evidence before cleaning up the generated database rows when
    Auth0 Management credentials are available.
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
    A Docker-backed docs pass also keeps the create-account baseline note and
    credential-gated integration path executable under the local runtime; the
    live Auth0 path still requires Auth0 Management credentials to avoid
    skipping.
  - Submitted-receipt visibility after receipt submission. Manual Browser
    review remains useful once the in-app Browser connection is reliable, but
    the Docker-backed Playwright profile pass now verifies the deterministic
    profile receipt flow through both generated docs and the functional spec:
    filename, submitted status, event title, amount, persisted database row, and
    cleanup. Local app/server coverage already proves readable
    submitted-receipt status labels, amount formatting, and
    `finance.receipts.my` profile-card row normalization.
- Finance/receipts:
  - Keep finance route-denial cases and route-manifest specs aligned as
    transaction, receipt approval, and reimbursement routes change.
    Local source coverage now fails if the finance permission matrix drifts
    away from the guarded child routes, including the receipt approval detail
    route.
    Generated-doc source coverage keeps the finance overview guide aligned with
    permission-scoped child navigation, so receipt approval access does not imply
    transaction-list access. The same guide now seeds deterministic receipt
    approval/reimbursement rows and asserts their filenames before taking queue
    screenshots, so those images do not rely on ambient fixture receipts.
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
    `docs/finance/receipt-review-reimbursement.doc.ts` now follows the exact
    seeded receipt through approval and reimbursement by id/file name, reads the
    approved/refunded state back, screenshots the exact approval queue receipt
    group, review decision card, reimbursement group, and post-recording
    reimbursement state, and restores the seeded receipt plus generated
    reimbursement transaction after the documentation journey.
    `specs/finance/receipts-flows.spec.ts` now follows the exact seeded receipt
    through approval and reimbursement by id/file name and reads the final
    receipt row back so the UI path cannot pass against an unrelated queued
    receipt.
  - Keep event-organizer receipt submission action coverage aligned with the
    two-step upload-plus-submit flow. Local app coverage now pins that Add
    receipt remains disabled while the event has not loaded yet, while the
    original upload is pending, and while the submit mutation is pending. The
    receipt submit dialog now has focused local coverage for required and
    supported files, tenant-allowed countries, invalid amount/date inputs,
    attachment-name fallback, and cents normalization before submit.
  - Keep paid-registration webhook counter coverage aligned with buyer-plus-guest
    spot counts. Local shared coverage pins the capacity count helper used by
    webhook completion/expiry updates; Stripe replay specs remain
    credential-gated.
  - Notification or email follow-up behavior once the product path exists.
- Scanning/check-in:
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
    updates, organizer cancellation scope, and direct-organizer versus
    transfer-code paid transfer boundaries.
    Event-management generated screenshots now focus concrete event-list,
    template-choice, event-detail header, registration option, and event-edit
    role-picker surfaces instead of page or section headings.
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
    a temporary tenant create with database readback and cleanup, plus seeded
    edit save with database readback and fixture restoration. It also checks
    the authenticated global-admin tenant list, create, detail, and edit pages
    at narrow mobile, mobile, and desktop viewports for expected headings, no
    application-error text, no horizontal overflow, and no horizontally clipped
    visible controls. Rebuilt-Docker Browser evidence also verified direct
    authenticated SSR deep links for admin, create-account, global-admin,
    profile, templates, finance, and scan routes at 390x844 with no horizontal
    overflow or clipped visible controls. `docs/admin/global-admin.doc.ts` now
    documents the implemented tenant-administration surface, while unrelated
    unlisted-admin product docs remain absent. Local
    server/app coverage already proves the list,
    tenant detail, tenant create, and tenant edit surfaces return, render, and
    persist operational tenant state for support review, and local app
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
    review/publishing policy, Stripe account-management policy,
    URLs/SEO/legal-text/receipt-country/ESNcard fields with database readback,
    the form trims optional editable values before sending the RPC payload,
    includes supported currency/locale/timezone selections and tenant
    operations-policy fields in the update payload, and normalizes blank
    optional values before the RPC call. Server
    admin-handler coverage also pins that currency/locale/timezone changes are
    rejected once tenant event or transaction data exists. Tenant schema,
    admin-handler, and
    route coverage pin supported relaunch currency/locale/timezone values,
    hosted legal text fields, operations-policy defaults, public legal page
    routes, and tenant logo/favicon upload storage paths while normalizing
    legacy context payloads.
    General-settings identity coverage also pins read-only tenant name, primary
    domain, and Stripe account support lookup labels.
    General-settings component coverage also pins that invalid, submitting, and
    mutation-pending saves stay disabled so slow settings writes cannot
    double-submit, and that brand-asset uploads stay disabled while any upload
    is active or mutation-pending. The page-backed general-settings spec now
    fails explicitly if the tenant row is missing after save before checking the
    persisted editable values.
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
    The page-backed roles-management spec now fails explicitly if role create or
    edit database readbacks are missing before checking permissions and edited
    metadata.
  - Keep app action icons on the Font Awesome component path. Local source
    coverage now fails if app templates or components reintroduce direct
    Material icon elements, `MatIconModule`, or new Material icon-package
    imports outside the existing root bootstrap registry exception, preserving
    the shared public Font Awesome package path. The same source guard rejects
    unlabeled `mat-icon-button` controls, so icon-only Material actions must
    expose an accessible `aria-label`, `aria-labelledby`, or `title`.
    CI cache coverage also keeps the E2E matrix behind a `warm-ci-caches` job
    so Bun package, dependency-tree, Docker Bun cache-mount, and Playwright
    browser cache misses are warmed once before Playwright shards run. The same
    guard pins Docker Buildx setup, the dependency-only warm build target, and
    separate BuildKit cache scopes for the dependency, `db-setup`, and `evorto`
    images; CI also explicitly enables Docker BuildKit before Compose builds.
    The Dockerfile writes the public Font Awesome npm user config before
    container installs, locks the shared BuildKit Bun cache mount, and derives
    build plus production dependency stages from the cache-warmed dependency
    stage with an offline production install.
    `.github/actions/setup-bun-dependency-caches/action.yml` centralizes the
    GitHub Actions Bun setup, public Font Awesome registry override, private
    Font Awesome dependency guard, and Bun package/dependency-tree cache
    restores for workflows that install dependencies; the Neon cleanup workflow
    is pinned as install-free.
    Source coverage now fails if a new GitHub workflow adds `bun install`
    without the same public Font Awesome registry override and Bun cache
    protections, or if a workflow runs a Docker Compose build without the CI
    build-cache override.
    E2E matrix jobs and Copilot setup also fail on a missing warmed
    dependency-tree cache instead of running their own registry installs,
    keeping Font Awesome package downloads limited to the serial cache warmer.
    The serial warmer now also uses a restored primary-key or restore-key Bun
    package cache for an offline dependency-tree rebuild before opening the
    registry install path, so package-cache hits do not spend Font Awesome
    bandwidth just because the `node_modules` cache missed.
    The Bun package cache and dependency-tree cache are keyed by the same
    package, lockfile, Bun config, and patch inputs, so registry-scope changes
    cannot reuse a stale package cache.
    The E2E matrix is also capped at one active suite so Docker/BuildKit cache
    misses cannot fan out across the functional/docs jobs.
    CI dependency-install retries also preserve `~/.bun/install/cache` instead
    of clearing it before retrying, reducing repeated public Font Awesome
    downloads after transient install failures. The install steps also print
    package-cache and dependency-tree cache-hit values before the skip decision,
    so CI logs make Font Awesome bandwidth regressions traceable to cache misses
    or unexpected install paths. The Codex setup environment no longer copies a
    main-checkout `.npmrc`, no longer requires `FONT_AWESOME_TOKEN`, writes the
    same temporary public Font Awesome npm user config before `bun install`, and
    installs through `~/.bun/install/cache`.
    `helpers/testing/install-ci-dependencies.sh` now owns the shared GitHub
    Actions cache/offline install decision: the serial E2E cache warmer may use
    registry fallback in `warm` mode, while E2E workers and Copilot setup run
    `offline-required` mode and fail before spending Font Awesome bandwidth when
    warmed caches are unavailable.
    Local design-token coverage now also fails if app UI files introduce
    hardcoded hex/rgb/hsl color literals or arbitrary color utilities instead
    of Material/Tailwind semantic color tokens, and it fails on app UI
    letter-spacing utilities/declarations or viewport-scaled text/font-size
    rules so typography stays stable across viewport coverage. The same source
    guard rejects no-wrap, truncate, and line-clamp utilities in app UI files so
    mobile labels wrap instead of clipping, and rejects full viewport-width
    sizing so app layouts do not reintroduce narrow-mobile horizontal overflow.
    The same app-source guard rejects direct `console.*` or `debugger` usage
    instead of scoped browser loggers, and keeps app card surfaces on semantic
    Material/Tailwind containers instead of reintroducing Angular Material card
    shells. It also rejects decorative gradient/orb backgrounds, CSS gradient
    declarations, and large decorative blur utilities so app surfaces stay on
    Material/Tailwind tokens instead of drifting into non-Material decoration.
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
    `specs/templates/templates.test.ts` and `docs/templates/templates.doc.ts`
    now functionally create a template with planning tips, a reusable add-on,
    and a registration question, screenshot the saved template detail page, then
    read the persisted template, add-on attachment/quantity, and required
    question state from the database. The create-form docs screenshot targets
    the template general form containing the title, category, and organizer
    planning tips controls instead of the first wrapper `div`; the saved-detail
    docs screenshot targets the template detail section containing those
    persisted planning tips, reusable add-on, and registration-question labels
    instead of a heading-only crop.
  - Template detail component coverage pins reusable add-on purchase timing and
    registration-option labels. Server handler coverage pins the current add-on
    read model, simple-template service coverage pins optional add-on write
    payload shaping/validation, and template form utility coverage pins add-on
    submit normalization plus read-model-to-edit-form mapping. Event lifecycle,
    schema, registration-card, event-detail component, active-registration
    readback, organizer-overview readback, profile-event summary coverage, and
    the page-backed registration-addons spec pin copied event add-on storage,
    registration-time purchase payloads, event-card add-on selection, fulfilled
    add-on visibility after registration, required-question answer gating,
    persisted question answers, and add-on availability deduction.
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
    required-answer guards, waitlist question-answer persistence, and
    server-side answer validation.
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
    tenant-scoped roles, wildcard permissions, dependent permissions, separate
    global-admin semantics, and the saved role detail screenshot after role
    creation.
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
    tenant users before joining tenant-scoped role rows and applies search
    before pagination, so multi-role users do not collapse page size.
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
  - Server unit coverage now pins registration lifecycle email outbox records
    for free confirmation, cancellation, transfer, and waitlist spot-available
    notifications. Paid checkout confirmation is wired through the Stripe
    webhook path and remains covered by the webhook replay flow when the
    credential-gated Stripe webhook suite is enabled.
  - Docker-backed system-Chrome execution now passes for
    `specs/events/negative-registration-states.spec.ts`,
    `specs/events/registration-transfer.test.ts`, and
    `docs/events/register.doc.ts` when run after
    `APP_HOST_PORT=4200 bun run docker:start`.

## Current Notes

- `tests/support/fixtures/parallel-test.ts` seeds isolated `test` profile tenants per test.
- `tests/setup/database.setup.ts` seeds a shared `docs` profile tenant and persists `.e2e-runtime.json`.
- `tests/setup/mcp-browser.seed.ts` is a no-dependency Playwright-test MCP planner seed for the dedicated `mcp-browser-planner` project. It uses the plain Playwright test API to open `/legal/terms`, so MCP Browser planning can initialize against a public General page without running the database/auth setup projects. `bun run test:e2e:mcp-browser-planner` is the focused local rerun for an already-running app; it refreshes `.env.dev`, sets `NO_WEBSERVER=true`, uses `--no-deps`, and keeps the public planner seed on one worker. The current Browser planner setup path has verified that project/seed pair, resized the seeded Terms page to 320x740, and captured a mobile screenshot with readable legal-page content plus fitting Events/Login bottom navigation.
- `tests/setup/mcp-browser-authenticated.seed.ts` is the authenticated MCP
  Browser planner seed for the dedicated `mcp-browser-authenticated-planner`
  project. It depends on the normal `setup` project, then opens
  `/admin/settings`, `/global-admin/tenants`, and `/profile` with the admin,
  global-admin, and regular-user storage states. Use
  `bun run test:e2e:mcp-browser-authenticated-planner` when Browser planning
  needs logged-in starting points without running the full authenticated
  viewport pack.
- Docker-backed authenticated checks currently need an Auth0-registered app
  origin. Use `APP_HOST_PORT=4200 bun run docker:start` on this machine unless
  the generated worktree port has been added to the Auth0 callback URLs.
  Authentication setup recognizes Auth0 `Callback URL mismatch.` errors and
  reports the current `BASE_URL` and `APP_HOST_PORT` before the normal username
  field wait can become a misleading timeout.
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
  `tests/specs/permissions/global-admin-route-guard.spec.ts` passed together
  against a rebuilt Docker runtime with system Chrome using existing storage
  states and `--no-deps`, covering the global-admin tenant list/create/detail/
  edit workflow and allow/deny route guards. The full dependency run is still
  subject to live Auth0 login availability; on the slow network it timed out in
  authentication setup before app assertions ran.
- `tests/specs/finance/stripe-webhook-replay.spec.ts --grep "checkout webhook resolves registration by checkout session" --no-deps` passed against a
  rebuilt Docker runtime with system Chrome after adding the checkout-session
  fallback for local Stripe completion events that arrive before the
  payment-intent reference is persisted on the transaction.
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
  documenting the transaction list, and seed submitted/approved receipt rows
  before documenting receipt approval and reimbursement queues, so the generated
  guide proves cancelled transactions stay omitted and finance queue screenshots
  show deterministic rows.
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
- Local workflow entrypoints stay visible in `package.json` for app build/dev,
  unit tests, Playwright e2e/docs and focused viewport/layout/MCP reruns, Docker
  start/resume/webServer/stop, database commands, Neon Local branch cleanup,
  dependency updates, Stripe/Sentry ops, theme generation, and receipt-image
  cleanup.
  `helpers/testing/runtime-preflight.spec.ts` guards that command surface so
  core workflows do not drift into hidden helper-only paths.
- The same runtime-preflight source coverage keeps the configured Bun version
  aligned across `package.json`, Docker, Compose-managed Bun services, and
  GitHub workflows.
- Runtime-preflight coverage also guards the non-secret runtime target summary
  printed by `dev:check` and `docker:check`, including `BASE_URL`, the local
  database host/port/database name without credentials, the generated Compose
  project, app host port, Neon Local host port, and Neon Local metadata
  directory. It now also guards the missing-secret recovery hint: when a Codex
  worktree lacks required runtime variables and the sibling main checkout has an
  untracked `.env`, preflight prints the exact `.env` copy command while
  keeping generated `.env.dev` worktree-local.
- `bun run dev:status` is the combined non-mutating local runtime status path.
  It refreshes `.env.dev`, runs the development preflight, runs the Docker
  preflight, and still runs the Neon Local cleanup dry-run before returning a
  combined failed-check summary.
- `helpers/testing/remove-stale-compose-containers.spec.ts` guards generated
  Compose cleanup target detection for unhealthy Compose JSON health, unhealthy
  Docker `ps` status text fallback, stale created/dead states, healthy running
  exclusions, and duplicate target de-duplication.
- E2E CI Docker startup, teardown, and final Neon pruning live in
  `helpers/testing/ci-start-docker-stack.sh`,
  `helpers/testing/ci-stop-docker-stack.sh`, and
  `helpers/testing/ci-prune-neon-local-branches.sh`; runtime-preflight and
  stabilization-source guards keep the workflow wired to those helpers while
  checking the bounded Docker preflight, bounded Compose image pre-pull,
  bounded Compose shutdown, per-container force removal, teardown-owned metadata
  branch pruning, and two-hour active-test TTL pruning behavior. Runtime
  preflight reuses the same
  stale/unhealthy Compose container parser and target predicate as
  `bun run docker:clean-stale`, so diagnostics and cleanup cannot drift on
  which generated containers are considered cleanup targets.
  The cleanup helper also supports
  `NEON_LOCAL_FORCE_DELETE_BRANCH_IDS=<branch-id>` for the exact confirmed
  inactive branch reported by the cleanup summary, while still refusing
  protected branches and leaving the default CI path TTL-conservative. Local
  branch audits can use the non-mutating `bun run neon:cleanup:dry-run`;
  confirmed local cleanup can use `bun run neon:cleanup`, keeping the
  dotenv/runtime cascade behind a short Neon-specific package script.
  The current PR #62 head `e07b2fd15` has completed CodeQL, Copilot, Git Town,
  CodeRabbit, and the serial E2E cache warmer successfully; E2E run
  `26999937086` still had `functional-1` in Docker startup and `functional-2`
  plus `docs` queued at the refresh. A live repo-local Neon cleanup at that
  checkpoint reported one protected branch, no active test branches, no stale
  branch deletions, and a two-hour active-test TTL, so only protected `main`
  remained visible outside active worker ownership.
- `docs/users/create-account.doc.ts` and
  `specs/profile/create-account.spec.ts` are the current Auth0
  Management-gated integration paths. The doc covers the generated walkthrough;
  the spec is the matching functional account-creation integration coverage.
  Use `bun run test:e2e:create-account` to run only those two
  `@needs-auth0-management` paths when the required credentials are available.
- Playwright `--list` discovery does not clean or write generated docs output,
  and baseline fixture imports do not require Auth0 Management credentials.
  Local package scripts that run `playwright test` are source-guarded to write
  generated docs into ignored `test-results/docs` paths, while only
  `test:e2e:docs:publish` may target the sibling `evorto-pages` checkout.
