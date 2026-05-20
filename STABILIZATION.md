# Stabilization Review

This document tracks a pragmatic stabilization pass before deeper agent-driven
development. It is not a requirements matrix. Keep findings concrete, scoped,
and useful for small cleanup batches.

## Review Status

| Area                                            | Status              | Confidence | Notes                                                                                                                                                 |
| ----------------------------------------------- | ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events                                          | First pass complete | partial    | Code, tests, docs, and an unauthenticated Browser walkthrough reviewed.                                                                               |
| Registrations                                   | First pass complete | partial    | Free/paid registration paths reviewed; several server-side precondition gaps need follow-up.                                                          |
| Templates                                       | First pass complete | partial    | Simple-mode template flow reviewed; permission and model-depth gaps need follow-up.                                                                   |
| Roles and permissions                           | First pass complete | partial    | Core permission model reviewed; route/RPC semantics and role management gaps need follow-up.                                                          |
| Finance/receipts                                | Fixes applied       | partial    | Payments, transactions, receipt review/reimbursement, and docs reviewed; high-risk gaps remain.                                                       |
| Scanning/check-in                               | First pass complete | partial    | QR display and persisted check-in mutation exist; timing, camera, and Browser-backed aggregate follow-ups remain.                                     |
| Profile/account flows                           | Fixes applied       | partial    | Profile, account creation, discount cards, receipts, and auth guards reviewed; account creation guards, transactionality, and ESNcard scope improved. |
| Tenant/global admin                             | Fixes applied       | partial    | Tenant resolution, tenant settings, and global-admin list/detail surface reviewed; global-admin route and permission context fixes applied.           |
| Generated documentation and Playwright coverage | First pass complete | partial    | Docs/spec inventory is discoverable again, but several docs/specs are stale or misleading.                                                            |
| Local runtime/developer workflow                | First pass complete | partial    | Scripts, env loading, Docker/Playwright setup, and unit-test ownership reviewed.                                                                      |

## Product Decision Draft

These are proposed answers to the open questions in this review. Treat them as
the current working direction until a product decision overrides them.

### Events

- **Rejected event resubmission:** allow resubmission without requiring a
  material edit, but reconsider the separate rejected state.
  - Option A: allow unchanged resubmission.
  - Option B: require an acknowledgement/revision note before resubmission.
  - Option C: require the event to return to draft and save a material or
    non-material edit before resubmission.
  - Decision: Option A for the immediate answer. Product direction: consider
    removing `REJECTED` as a durable event state in favor of returning the event
    to draft with reviewer comments/feedback, because a separate rejected ->
    resubmitted loop is harder to explain.
- **Pending-event admin edits:** reviewers should approve, reject, or return to
  draft; they should not directly edit material pending-event fields.
  - Option A: `events:review` can approve/reject only.
  - Option B: `events:review` can also edit pending events.
  - Option C: add a separate `events:editPending` capability.
  - Decision: Option A for `events:review`. Reviewers should not edit pending
    events through review permission alone. Users with a separate edit-all
    permission can make direct event changes when that capability is granted.
- **Organizer-only/private operational events:** allow private operational
  events without any registration option.
  - Option A: require at least one participant registration option.
  - Option B: allow organizer-only events with organizer/helper options.
  - Option C: allow private operational events without any registration option.
  - Decision: Option C. Optionless events can act as tenant-visible event
    notifications in the general overview. Later they may support an external
    signup link without forcing an internal registration option.

### Registrations

- **Full registration options:** expose a separate lightweight waitlist action
  when a participant option is full.
  - Option A: join the waitlist automatically.
  - Option B: show a distinct "Join waitlist" action.
  - Option C: fail as full until waitlists are implemented.
  - Decision: Option B. Users should intentionally join the lightweight
    waitlist.
- **Organizer signup affordance:** organizer/helper signup should have distinct
  copy and affordance, even though it uses the same registration-option model.
  - Option A: use the same user-facing register button.
  - Option B: use separate organizer/helper signup copy and grouping.
  - Option C: move organizer signup into an organizer-only management surface.
  - Decision: Option B. Progressive disclosure can keep the model unified while
    avoiding participant-ticket wording for helpers.
- **Guest quantities, transfer/resale, cancellation scope:** guest quantities,
  participant/admin cancellation, and transfer/resale are relaunch scope.
  - Option A: relaunch with all three.
  - Option B: relaunch with guest quantities plus participant/admin
    cancellation, defer transfer/resale.
  - Option C: defer all three and remove claims/docs until implemented.
  - Decision: Option A. All three are required for the production replacement.
- **Role-ineligible direct links:** show the event with an explicit ineligible
  state in the registration-options area and no registration action.
  - Option A: hide the event entirely.
  - Option B: show the event but omit all options.
  - Option C: show an explicit ineligible state.
  - Decision: Option C. The ineligible state should replace the registration
    options area instead of silently hiding the whole event.

### Templates

- **Relaunch template scope:** keep simple mode as the primary authoring UI, but
  include the reusable fields needed for production replacement.
  - Option A: simple mode only.
  - Option B: simple mode plus discounts, add-ons, questions, and organizer
    notes/checklists where practical.
  - Option C: full advanced registration-option editor before relaunch.
  - Decision: Option B. It fits progressive disclosure and prevents templates
    from losing core organizational memory.
- **Unsupported registration modes:** `random` and `application` must not remain
  selectable without working fulfillment semantics.
  - Option A: keep selectable as stored-only configuration.
  - Option B: show disabled/draft-only with explanatory admin copy.
  - Option C: hide from normal template creation/editing.
  - Decision: add implementation work for these registration modes to the launch
    blockers if they remain part of the relaunch UI. Stored-only modes create
    misleading expectations and unsafe generated docs.
- **Template view permission:** require `templates:view`, and resolve permission
  dependencies before server handlers enforce access.
  - Option A: require only `templates:view`.
  - Option B: let `events:create` imply template view only in the client.
  - Option C: server-side resolved permissions include dependencies, with
    `events:create` implying `templates:view` when configured.
  - Decision: Option C. Server and client should share the same dependency
    semantics.
- **Template category management:** keep category management separate from
  template create/edit.
  - Option A: same capability as template editing.
  - Option B: separate `templates:manageCategories`.
  - Option C: tenant-admin-only setting.
  - Decision: Option B. Categories affect discovery and taxonomy, not just a
    single template.

### Roles and Permissions

- **Organizer role reads:** provide a least-privilege tenant role lookup for
  event/template eligibility editing, returning only id, name, and default/hub
  metadata needed by the UI.
  - Option A: reuse admin role APIs.
  - Option B: expose minimal role lookup to organizers with event/template
    creation rights.
  - Option C: expose only default roles.
  - Decision: Option B. Organizers need role reads to choose role-based
    eligibility for event/template registration options. This lookup must not
    expose permission arrays or role-management fields.
- **Permission dependency resolution:** resolved permissions should include
  dependencies before server handlers enforce access.
  - Option A: dependencies only in the client.
  - Option B: dependencies expanded in a shared evaluator used by client and
    server.
  - Option C: store expanded permissions on user/role assignment.
  - Decision: Option B. It preserves source-of-truth role definitions while
    keeping authorization consistent.
- **Admin overview visibility:** visible to users with any capability that
  exposes at least one admin child, but each child remains guarded by its own
  capability.
  - Option A: require a broad `admin:*` or admin overview permission.
  - Option B: show overview for any visible child capability.
  - Option C: hide overview and link only directly to each child.
  - Decision: Option B. This should be the general admin navigation pattern:
    show parent surfaces when any child is visible, and keep each child guarded
    by its own capability.
- **Role assignment relaunch scope:** role assignment for relaunch is covered by
  the production migration from current magic strings to tenant roles.
  - Option A: implement assignment UI/RPC for relaunch.
  - Option B: defer and remove user-list assignment affordances/docs.
  - Option C: keep seed/helper-only role changes.
  - Decision: migration will create roles with equivalent permissions and assign
    the correct users. For relaunch use cases, assume users start with correct
    roles; product UI for role assignment is not the blocker.
- **Hub role visibility field:** use one canonical field and migrate/remove the
  other.
  - Option A: keep `showInHub`.
  - Option B: keep `displayInHub`.
  - Option C: replace both with a clearer field name.
  - Decision: Option B if it already drives reads; migrate form/write paths
    to it and remove or deprecate `showInHub`.

### Finance and Receipts

- **Paid-registration counters:** keep stored counters for now and update them
  transactionally from webhook completion/expiry.
  - Option A: update `confirmedSpots`/`reservedSpots` in webhook handling.
  - Option B: derive counters entirely from registration rows.
  - Option C: store counters only as cache rebuilt by jobs.
  - Decision: Option A. Stored counters are the important registration-capacity
    invariant; deriving counts from registration rows adds database cost that is
    not worth the convenience.
- **`paymentStatus`:** remove or deprecate it in favor of registration status
  plus transactions unless a concrete UI/API need remains.
  - Option A: maintain `paymentStatus` everywhere.
  - Option B: remove/deprecate `paymentStatus`.
  - Option C: keep only as derived/read model.
  - Decision: Option B, after a migration/test pass confirms no active
    behavior depends on it.
- **Transaction-list capability:** add/use an explicit
  `finance:viewTransactions` capability.
  - Option A: `finance:viewTransactions`.
  - Option B: `finance:manageReceipts`.
  - Option C: broad finance overview permission.
  - Decision: Option A. Transaction visibility is more sensitive than receipt
    review and should be named directly; receipt approvers do not necessarily
    need access to all transactions.
- **Receipt uploads:** issue upload sessions from an authorized receipt-submit
  preflight tied to event/user context.
  - Option A: upload only after submit authorization succeeds.
  - Option B: preflight returns an upload/session token, then submit consumes it.
  - Option C: keep authenticated-only uploads and clean orphans later.
  - Decision: Option B. It supports normal file-pick flows without creating
    unbounded authenticated object writes.
- **Receipt reimbursement:** relaunch as manual ledger action with honest copy;
  payout-provider integration can come later.
  - Option A: manual ledger reimbursement.
  - Option B: integrate payout provider before relaunch.
  - Option C: remove reimbursement recording until payouts exist.
  - Decision: Option A, renamed away from "refund" unless money is actually
    moved.
- **Receipt timing:** allow pre-event spending, but gate final receipt
  submission/review by event policy.
  - Option A: only after event end.
  - Option B: allow pre-event spending/submission.
  - Option C: tenant/event-configurable.
  - Decision: Option B for practical organizer purchases, with clear event
    association and no fake reimbursement guarantee.

### Scanning and Check-In

- **Who can check in:** allow confirmed organizer/helper registrations and users
  with `events:organizeAll`.
  - Option A: confirmed organizers/helpers only.
  - Option B: `events:organizeAll` only.
  - Option C: dedicated `events:checkIn` plus organizer/helper eligibility.
  - Decision: Option A plus `events:organizeAll`. A dedicated check-in
    capability is not part of the relaunch requirement unless the organizer role
    model proves too broad.
- **Scan timing:** allow scanning within a configurable window before event
  start, with organizer override later if needed.
  - Option A: only after event start.
  - Option B: within a fixed/configurable pre-start window.
  - Option C: only after manual organizer override.
  - Decision: Option B. Use a pre-start scanning window for entrance logistics,
    and design it so the window can become tenant-configurable.
- **Duplicate scans:** make duplicate scans idempotent success with a visible
  "already checked in" warning.
  - Option A: idempotent success.
  - Option B: warning-only, no mutation.
  - Option C: blocked hard error.
  - Decision: Option A. It is safest for busy entrances while preserving
    audit visibility.
- **QR generation authorization:** require a confirmed registration owner or
  organizer/check-in authorization to render the QR image.
  - Option A: unguessable id is enough.
  - Option B: require owner or organizer/check-in authorization.
  - Option C: signed expiring QR URLs.
  - Decision: Option B. QR images are generated only for confirmed registrations
    visible to the current authenticated tenant user. Ticket links can still
    appear in email later, but image generation must not be an unauthenticated
    registration-id oracle.
- **Scanner URL validation:** accept the ticket URL as the routing source, then
  enforce authorization against the resolved registration/event.
  - Option A: current tenant domain only.
  - Option B: any known domain for the registration tenant.
  - Option C: any URL with the expected path.
  - Decision: the scanner must support QR links opened through native phone
    cameras, so the domain embedded in the ticket URL should be treated as the
    routing source. Safety comes from resolving the registration/event and
    checking that the scanning user is authorized to check in attendees for that
    event.
- **Guest quantity check-in:** relaunch check-in must account for guest quantity
  in counters and UI.
  - Option A: one scan checks in buyer plus all guests.
  - Option B: scanner chooses how many guest spots to check in.
  - Option C: defer guest quantities entirely.
  - Decision: Option B. The scanner should choose how many guest spots to check
    in so partial guest arrival is supported.

### Profile and Account Flows

- **Existing global user joining tenant:** allow adding the current authenticated
  global user to a tenant automatically when they complete tenant account
  creation, unless tenant policy requires invite approval.
  - Option A: automatic join on Auth0 login/account creation.
  - Option B: invite/admin approval only.
  - Option C: tenant-configurable.
  - Decision: Option A. Accounts currently travel seamlessly across tenants.
- **Home tenant model:** store a home tenant per global user and warn when the
  current tenant differs.
  - Option A: no home tenant.
  - Option B: one home tenant with warning.
  - Option C: multiple favorites/defaults.
  - Decision: Option B. This matches the root product context: users have a home
    tenant and should be warned when browsing another tenant.
- **Communication email:** treat it as a user-managed notification email that
  may differ from Auth0 login email.
  - Option A: always Auth0 email.
  - Option B: separate notification email.
  - Option C: tenant-specific notification email.
  - Decision: Option B. Also investigate whether users can change their login
    email where the auth method allows it; social-login email may not be
    directly editable.
- **Payout details scope:** keep payout details global per person.
  - Option A: global per person.
  - Option B: tenant-specific.
  - Option C: per receipt/reimbursement request.
  - Decision: Option A. People should not need different reimbursement targets
    per tenant. Follow-up needed: define when payout fields are shown/required
    in the profile UI.
- **ESNcard scope:** store ESNcard records globally per user.
  - Option A: global per user.
  - Option B: tenant-specific.
  - Option C: globally unique by card identifier.
  - Decision: Option A. One natural person can only have one ESNcard. ESNcard UI
    should be enabled when the user is connected to any tenant that has ESNcard
    support enabled.
- **Profile event actions:** relaunch profile should expose payment
  continuation, ticket QR, participant cancellation, waitlist status/action, and
  transfer/resale only for implemented flows.
  - Option A: show all intended actions.
  - Option B: show only implemented stateful actions and remove deferred copy.
  - Option C: keep informational cards only.
  - Decision: Option B. Profile is a primary recovery surface for user event
    actions.

### Tenant and Global Admin

- **Global admin identity:** model global admins as platform principals separate
  from tenant roles, with optional tenant-user assignment only when they need to
  act inside a tenant as a tenant user.
  - Option A: independent platform principals.
  - Option B: tenant users with special metadata.
  - Option C: tenant users plus separate platform-role table.
  - Decision: Option A. Global admins are platform-level principals independent
    from tenant roles. Current implementation may identify them as normal Auth0
    accounts with specific Auth0 metadata.
- **Global admin before tenant assignment:** yes, global admins can administer
  tenant records before being assigned to the current tenant.
  - Option A: require tenant assignment.
  - Option B: allow platform-level administration without tenant assignment.
  - Option C: require temporary impersonation assignment.
  - Decision: Option B. Current-tenant membership should not gate platform
    administration. When a global admin opens a tenant domain, the request still
    resolves to and is related to that current tenant context.
- **Tenant domains:** support one domain per tenant for relaunch; keep
  multi-domain/custom-domain automation as later work.
  - Option A: one domain only.
  - Option B: multiple domains with verification/ownership records.
  - Option C: defer custom domains.
  - Decision: Option A for relaunch. Current domain setup is manual; a more
    automated process would be useful later but is not relaunch scope.
- **Branding/legal relaunch scope:** branding basics and legal links/text are
  production blockers; advanced onboarding can wait.
  - Option A: minimal name/logo/theme only.
  - Option B: domain, logo/favicon/theme, legal/imprint/privacy/terms
    links/text, locale/timezone/currency.
  - Option C: full tenant onboarding portal.
  - Decision: Option B.
- **Currency/locale/timezone editability:** allow edits before dependent data
  exists; restrict or require migration plan after payment/event data exists.
  - Option A: always editable.
  - Option B: locked after dependent data exists.
  - Option C: editable with explicit migration/audit workflow.
  - Decision: Option B for relaunch. These settings are locked once dependent
    event/payment data exists.
- **Global admin capabilities:** global admin should create tenants, edit
  domains/settings, and support tenant admin views through explicit
  impersonation/audit, not silent access.
  - Option A: list tenants only.
  - Option B: create/edit tenants and domains/settings.
  - Option C: include audited impersonation/support mode.
  - Decision: Option B for relaunch administration; Option C when support
    workflows are needed.

### Generated Documentation and Playwright Coverage

- **Generated docs location:** default local output to this repository's ignored
  `test-results/docs`; publish to the sibling docs app only through an explicit
  docs-publish flow.
  - Option A: check generated docs into this repo.
  - Option B: check/publish to sibling documentation app.
  - Option C: CI artifacts only.
  - Decision: local Option A output path for safety, with explicit publish to a
    docs app when desired.
- **Product-facing docs:** docs for core workflows are product-facing and must
  be accurate before relaunch; internal examples should be clearly tagged or
  moved out of product docs.
  - Option A: all generated docs are product-facing.
  - Option B: split product docs from internal/testing examples.
  - Option C: generated docs are internal evidence only.
  - Decision: Option A. Generated docs are product-facing and should not mix in
    internal/testing examples.
- **List/discovery reporter side effects:** list/discovery commands should not
  run reporters that clean or write docs output.
  - Option A: current behavior acceptable.
  - Option B: list/discovery avoids reporter output.
  - Option C: docs generation is only a separate explicit command.
  - Decision: Option C. Docs generation should be a separate explicit command.
- **Placeholder `@req` ids and test tags:** retire placeholder requirement tags
  and remove the requirement for `@req`/tracking-style tags if they do not
  provide useful product or verification value.
  - Option A: keep placeholder `@req` ids.
  - Option B: convert to `test.fixme`.
  - Option C: delete until behavior exists.
  - Decision: Option C. The current `@req` and related tracking tags are not
    needed as a mandatory system.
- **Minimum durable Playwright relaunch coverage:** require deterministic
  happy-path and key negative-path coverage for registration, finance, scanning,
  roles, tenant admin, and profile/account flows.
  - Option A: happy paths only.
  - Option B: happy paths plus critical permission/tenant/payment negative
    paths.
  - Option C: broad matrix coverage.
  - Decision: Option B, with enough extended critical-path coverage to be
    confident about shipping. Avoid a broad matrix, but cover the paths that
    would make relaunch unsafe if broken.

### Local Runtime and Developer Workflow

- **Docs output default:** default local docs output to ignored
  `test-results/docs`; require explicit publish command for `evorto-pages`.
  - Option A: direct sibling checkout output by default.
  - Option B: local ignored output by default plus explicit publish.
  - Option C: CI artifact only.
  - Decision: Option B. Local docs output defaults to ignored repository-local
    paths, with an explicit publish command for `evorto-pages`.
- **Docker start reset behavior:** split destructive reset/start from
  non-destructive start/restart.
  - Option A: `docker:start` keeps resetting data.
  - Option B: `docker:start` is non-destructive; add `docker:reset`.
  - Option C: keep current behavior but rename it to make reset explicit.
  - Decision: Option A. `docker:start` may reset local data because the intended
    workflow is to seed enough data to get going from zero.
- **Finance docs in CI baseline:** keep finance docs excluded only until finance
  docs are rewritten to current behavior, with a visible follow-up.
  - Option A: keep excluded indefinitely.
  - Option B: fail loudly now.
  - Option C: temporary exclusion with tracked cleanup.
  - Decision: Option C.
- **Playwright browser channel:** use bundled Playwright Chromium for CI and
  default local runs; allow opt-in system Chrome for exploratory local
  debugging.
  - Option A: bundled Chromium only.
  - Option B: prefer system Chrome locally.
  - Option C: bundled by default, opt-in system channel.
  - Decision: Option C.

## Evidence Checked

- Root guidance: `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `QUALITY.md`
- Module guidance: `src/app/AGENTS.md`, `src/app/events/AGENTS.md`, `src/server/AGENTS.md`, `src/server/effect/AGENTS.md`, `src/db/AGENTS.md`, `tests/AGENTS.md`
- Runtime/test guidance: `tests/README.md`, `helpers/README.md`
- Events and registrations app code: `src/app/events/**`
- Events RPC contracts and handlers: `src/shared/rpc-contracts/app-rpcs/events.*`, `src/server/effect/rpc/handlers/events/**`
- Event and registration schema: `src/db/schema/event-instances.ts`, `src/db/schema/event-registration-options.ts`, `src/db/schema/event-registrations.ts`
- Playwright specs/docs: `tests/specs/events/**`, `tests/docs/events/**`
- Browser walkthrough: anonymous `/events` list and event detail at local `http://localhost:4200`
- Templates app code: `src/app/templates/**`
- Templates RPC contracts and handlers: `src/shared/rpc-contracts/app-rpcs/templates.*`, `src/server/effect/rpc/handlers/templates**`
- Template schema: `src/db/schema/event-templates.ts`, `src/db/schema/template-registration-options.ts`, `src/db/schema/template-registration-option-discounts.ts`, `src/db/schema/template-event-addons.ts`
- Template Playwright specs/docs: `tests/specs/templates/**`, `tests/docs/templates/templates.doc.ts`
- Browser walkthrough: organizer `/templates` list and template detail at local `http://localhost:4200`
- Roles and permissions code: `src/shared/permissions/**`, `src/app/admin/**`, `src/app/core/permissions.service.ts`, `src/app/core/guards/permission.guard.ts`, `src/app/shared/directives/*permission*`
- Role/user RPC contracts and handlers: `src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts`, `src/shared/rpc-contracts/app-rpcs/users.rpcs.ts`, `src/server/effect/rpc/handlers/admin.handlers.ts`, `src/server/effect/rpc/handlers/users.handlers.ts`
- Role schema and seed data: `src/db/schema/roles.ts`, `src/db/schema/users.ts`, `helpers/add-roles.ts`, `helpers/user-data.ts`
- Permission Playwright specs/docs: `tests/specs/permissions/**`, `tests/docs/roles/roles.doc.ts`, `tests/support/permissions/matrix.ts`
- Browser walkthrough: organizer direct `/admin` and `/admin/roles` routes at local `http://localhost:4200`
- Finance app code: `src/app/finance/**`, receipt submission in `src/app/events/event-organize/**`, profile receipt display in `src/app/profile/user-profile/**`
- Finance RPC contracts and handlers: `src/shared/rpc-contracts/app-rpcs/finance.*`, `src/server/effect/rpc/handlers/finance/**`
- Payment/webhook paths: `src/server/effect/rpc/handlers/events/event-registration.service.ts`, `src/server/http/stripe-webhook.web-handler.ts`
- Finance schema and seed data: `src/db/schema/finance-receipts.ts`, `src/db/schema/transactions.ts`, `src/db/schema/tenant-stripe-tax-rates.ts`, `helpers/add-finance-receipts.ts`, `helpers/add-tax-rates.ts`
- Finance Playwright specs/docs: `tests/specs/finance/**`, `tests/docs/finance/**`, event registration payment docs in `tests/docs/events/register.doc.ts`
- Browser walkthrough: unauthenticated direct `/finance` route redirects to Auth0 login at local `http://localhost:4200`
- Scanning app code: `src/app/scanning/**`, QR display in `src/app/events/event-active-registration/**`, check-in counts in `src/app/events/event-organize/**`
- Scanning RPC, HTTP, and schema paths: `events.registrationScanned` in `src/shared/rpc-contracts/app-rpcs/events.*`, `src/server/effect/rpc/handlers/events/events-registration.handlers.ts`, `src/server/http/qr-code.web-handler.ts`, `src/db/schema/event-registrations.ts`, `src/db/schema/event-registration-options.ts`
- Scanning seed/test/docs coverage: `helpers/add-registrations.ts`, `tests/specs/scanning/scanner.test.ts`, QR mentions in `tests/docs/events/register.doc.ts`, `tests/test-inventory.md`
- Browser walkthrough: unauthenticated direct `/scan` route renders Auth0 login at local `http://localhost:4200`
- Profile/account app code: `src/app/profile/**`, `src/app/core/create-account/**`, `src/app/core/guards/auth.guard.ts`, `src/app/core/guards/user-account.guard.ts`, `src/app/core/navigation/**`
- Profile/account RPC, auth, and schema paths: `src/shared/rpc-contracts/app-rpcs/users.*`, `src/shared/rpc-contracts/app-rpcs/discounts.*`, `src/server/effect/rpc/handlers/users.handlers.ts`, `src/server/effect/rpc/handlers/discounts.handlers.ts`, `src/server/auth/auth-session.ts`, `src/server/context/**`, `src/db/schema/users.ts`, `src/db/schema/user-discount-cards.ts`
- Profile/account docs and specs: `tests/docs/profile/**`, `tests/docs/users/create-account.doc.ts`, `tests/specs/discounts/esn-discounts.test.ts`, `tests/specs/auth/storage-state-refresh.test.ts`, `src/server/effect/rpc/handlers/users.handlers.spec.ts`
- Browser walkthrough: unauthenticated direct `/profile` redirects to Auth0 login; unauthenticated direct `/create-account` renders the create-account page with an email-verification error at local `http://localhost:4200`
- Tenant/global admin app code: `src/app/global-admin/**`, `src/app/admin/general-settings/**`, `src/app/admin/admin.routes.ts`, `src/app/core/config.service.ts`, `src/app/core/effect-rpc-angular-client.ts`, `src/app/core/navigation/**`
- Tenant/global admin RPC, context, and schema paths: `src/shared/rpc-contracts/app-rpcs/global-admin.rpcs.ts`, `src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts`, `src/server/effect/rpc/handlers/global-admin.handlers.ts`, `src/server/effect/rpc/handlers/admin.handlers.ts`, `src/server/context/**`, `src/server/effect/rpc/app-rpcs.request-handler.ts`, `src/db/schema/tenants.ts`, `src/types/custom/tenant.ts`, `src/shared/tenant-config.ts`
- Tenant/global admin seed/test/docs coverage: `helpers/seed-tenant.ts`, `helpers/create-tenant.ts`, `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts`, `tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts`, `tests/specs/auth/storage-state-refresh.test.ts`, `tests/docs/finance/inclusive-tax-rates.doc.ts`, `tests/test-inventory.md`
- Runtime walkthrough: unknown host `no-such-tenant.invalid` returned 404; anonymous `/global-admin` redirected to Auth0. Stored auth states were stale, so authenticated global-admin UI behavior was not reverified in this pass.
- Generated docs and Playwright configuration: `playwright.config.ts`, `tests/README.md`, `tests/AGENTS.md`, `tests/test-inventory.md`, `package.json`
- Documentation reporter and screenshot helpers: `tests/support/reporters/documentation-reporter.ts`, `tests/support/reporters/documentation-reporter/**`, `tests/support/utils/doc-screenshot.ts`
- Generated documentation specs: `tests/docs/**`
- Playwright specs with stabilization-relevant gaps: `tests/specs/events/**`, `tests/specs/templates/**`, `tests/specs/finance/**`, `tests/specs/scanning/scanner.test.ts`, `tests/specs/permissions/**`, `tests/specs/reporting/reporter-paths.test.ts`, `tests/specs/screenshot/doc-screenshot.test.ts`
- Lightweight Playwright checks: `bun run test:e2e -- --list`, `bun run test:e2e:docs -- --list`, `bun run test:e2e -- tests/specs/reporting/reporter-paths.test.ts --no-deps`, `bun run test:e2e -- tests/specs/screenshot/doc-screenshot.test.ts --no-deps`
- Local runtime/developer workflow: `README.md`, `AGENTS.md`, `tests/README.md`, `helpers/README.md`, `src/server/config/AGENTS.md`, `package.json`, `docker-compose.yml`, `Dockerfile`, `helpers/testing/runtime-environment.ts`, `angular.json`, `tsconfig.spec.json`, `.github/workflows/e2e-baseline.yml`, `.github/workflows/copilot-setup-steps.yml`
- Local workflow checks: `bun run env:runtime`, `bun --version`, `node --version`, `bunx playwright --version`, `docker compose version`, `node_modules/.bin/dotenv -c dev -- docker compose config --quiet`, `bun run build:app`, `bun run test:unit -- --watch=false`, `bun run test:unit:server`, `DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images bun run test:e2e -- --list`, `DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images bun run test:e2e:docs -- --list`

## Events

### Current Behavior

- Anonymous users can browse approved listed events when registration options overlap tenant default roles.
- Event details are available for approved events and show description plus registration options.
- Draft/rejected events are editable by creator or `events:editAll`; pending/approved events are locked by server-side `findOneForEdit` and `events.update` checks.
- Submit/review lifecycle supports `DRAFT`, `PENDING_REVIEW`, `APPROVED`, and `REJECTED`.
- Listing visibility is separate from status through the `unlisted` flag; admins with the right permission can see/toggle it.
- Unlisted event controls explain that direct links keep working for eligible people.
- Event list filtering defaults to all statuses only for users with `events:seeDrafts`; other users only request approved events.
- Event create/update handlers reject invalid start/end dates, event end times that are not after start times, and registration windows that close before they open.
- Event find/update RPC contracts use the shared `EventLocation` schema instead of accepting arbitrary location payloads.
- Event creation copies template option discounts by submitted source template option id instead of matching option titles, but only after validating copied ESNcard discounts against the target event option price and current tenant ESNcard provider state.

### Intended Behavior From Product Context

- Event lifecycle is draft -> pending review -> published, with publishing as the approval act.
- Material event fields should be locked after submission for review.
- Listing is separate from publishing; published events may be listed or unlisted.
- Anonymous visibility should match default-role eligibility and should not show events the same user would lose after signing in.
- User-facing features must be discoverable through the UI, not hidden URLs.

### Issues and Risks

- **Addressed in stabilization pass:** event creation/update now reject end-before-start and close-before-open registration windows server-side.
- **Addressed in stabilization pass:** event find/update RPC location fields now validate against the shared `EventLocation` schema.
- **Addressed in stabilization pass:** event creation now copies template option discounts by source option identity, so duplicate option titles do not miscopy discounts.
- **Addressed in stabilization pass:** event creation now revalidates copied template ESNcard discounts before inserting the event. Copied discounts do not persist for event options changed to free, fail when ESNcard discounts are no longer enabled for the tenant, and fail when the template discount exceeds the event option price.
- **Addressed in stabilization pass:** event edit saves now share one tested
  submit-disabled guard between the Save Changes button and handler, so
  invalid, submitting, and mutation-pending update writes cannot double-submit
  on slow networks.
- **Addressed in stabilization pass:** `event-management.doc.ts` no longer describes attendee export, attendee messaging, manual check-in controls, event settings tabs, event tags, featured images, notification settings, integrations, or event deletion as existing event-management UI.
- **Addressed in stabilization pass:** unlisted-event dialog and event detail status copy now explain that unlisted events are hidden from lists while eligible direct links still work.
- **Acceptable for now:** event edit locks are duplicated in guard, details `canEdit`, `findOneForEdit`, and `events.update`. Duplication is not ideal, but server-side checks are the source of truth.

### Product Questions Answered Above

- Should rejected events be resubmitted without requiring any edit, or should the app require creators to acknowledge/change something first?
- Should admins with `events:review` be able to edit pending events, or only approve/reject them?
- Should event creation require at least one participant registration option, or can organizer-only/private operational events exist?

## Registrations

### Current Behavior

- Registration options are attached to events and contain role eligibility, price, payment flag, capacity counters, registration windows, and organizer/participant distinction.
- UI hides register actions from anonymous users and offers a login link back to the event.
- UI disables registration before open time and after close time based on client time.
- Free registration creates a confirmed registration and increments `confirmedSpots`.
- Paid registration creates a pending registration, reserves the buyer plus guest spots, creates a Stripe Checkout session for the selected quantity, and shows a payment continuation link.
- Registration writes enforce approved event status, tenant scope, open/close windows, role eligibility, one active registration per user/event, participant-only guest quantities, and capacity before creating a registration.
- Capacity reservation/confirmation uses a database transaction with a conditional counter update for the buyer plus guest spots.
- Full participant registration options expose a distinct waitlist action when registration is open; organizer/helper options only show the full state.
- Successful paid registration is confirmed through Stripe/webhook-side effects; the active registration UI only shows QR code for confirmed registrations.
- Users with confirmed organizer registrations, `events:organizeAll`, or `finance:manageReceipts` can open the organize view.
- Unsupported `random` and `application` registration options can still be read from stored data, but registration attempts against them fail closed until their fulfillment semantics exist.

### Intended Behavior From Product Context

- Registration requires an account.
- Registration options are mutually exclusive per event.
- A user cannot be both organizer/helper and participant for the same event.
- Registration options define role-based eligibility.
- Registration should respect capacity, registration windows, free/paid state, Stripe lifecycle, pending cleanup, waitlists, cancellation, transfer/resale, and guest quantities.
- Users should receive confirmation and QR code only after successful registration; for paid events, after successful payment.

### Issues and Risks

- **Addressed in stabilization pass:** `EventRegistrationService.registerForEvent` enforces event approval status before registration.
- **Addressed in stabilization pass:** server-side registration validates open/close windows instead of relying only on the UI.
- **Addressed in stabilization pass:** server-side registration verifies selected option role eligibility against the current user's tenant roles.
- **Addressed in stabilization pass:** registration capacity reservation/confirmation is inside a transaction with a conditional counter update.
- **Addressed in stabilization pass:** existing-registration preflight and transactional duplicate checks include `tenantId`.
- **Addressed in stabilization pass:** registration option lookup validates the related event tenant before proceeding.
- **Addressed in stabilization pass:** event registration supports guest quantities for participant options. The registration contract stores `guestCount`, the UI lets participants choose guests up to remaining capacity, free registration confirms all selected spots, and paid registration reserves/prices the selected quantity through Stripe checkout.
- **Addressed in stabilization pass:** full participant options no longer present the normal registration action and instead expose a distinct waitlist action backed by a `WAITLIST` registration and `waitlistSpots` counter update. Waitlisted participants can leave the waitlist before the event starts, which decrements `waitlistSpots` transactionally.
- **Addressed in stabilization pass:** registration submission now rejects stored `random` and `application` options server-side instead of silently handling them as first-come-first-served.
- **Addressed in stabilization pass:** event registration option cards now label participant options separately from organizer/helper options and use distinct organizer/helper signup action copy while preserving the shared registration-option model.
- **Addressed in stabilization pass:** participant registration and waitlist
  actions now share one mutation-pending guard between the buttons and handlers,
  so slow registration or waitlist writes cannot be triggered twice from the
  registration option card.
- **Addressed in stabilization pass:** role-ineligible direct event links keep the event visible but show an explicit registration-unavailable state instead of silently rendering an empty registration section.
- **Addressed in stabilization pass:** participant self-cancellation now covers pending and confirmed registrations before event start, rolls back reserved/confirmed counters including selected guest spots, blocks checked-in cancellations, and keeps refund copy honest for paid registrations.
- **Addressed in stabilization pass:** organizer/admin cancellation is available from the organizer overview for confirmed participant registrations, requires event-organizer access or `events:organizeAll`, blocks checked-in cancellations, and rolls back confirmed counters without promising automatic refunds.
- **Addressed in stabilization pass:** active registration cards now expose unpaid self-service transfer for confirmed, not checked-in registrations before event start, and keep transfer/resale unavailability explicit for pending and waitlisted registrations.
- **Addressed in stabilization pass:** `events.findTransferTargets` and `events.transferEventRegistration` provide a conservative organizer-assisted transfer flow for confirmed, not checked-in, unpaid registrations between existing tenant users. The organizer overview opens an eligible-member lookup, and the target lookup and mutation require event-organizer access, fail closed when the target user is outside the tenant, role-ineligible for the registration option, or already has an active registration, and reject paid registrations until refund/resale money movement is implemented.
- **Addressed in stabilization pass:** organizer overview participant actions now
  use one shared checked-in/in-flight guard for cancellation and
  organizer-assisted transfer buttons and handlers, so checked-in rows and
  duplicate in-flight writes cannot be triggered from the page.
- **Addressed in stabilization pass:** `events.transferMyRegistration` lets participants transfer their own confirmed unpaid registration to an existing eligible tenant user by email without exposing a tenant-member search surface.
- **Addressed in stabilization pass:** active registration cancellation and
  self-service transfer now share tested action guards between the buttons and
  handlers, so cancellation and transfer writes cannot overlap or double-submit
  locally on slow networks.
- **Should fix before relaunch:** participant-facing paid transfer/resale money movement, resale-specific workflows, and automatic refund flows are not implemented in the reviewed event registration path.
- **Addressed in stabilization pass:** active registration status now uses the shared persisted registration status literal union instead of raw `Schema.String`.
- **Acceptable for now:** paid registration rollback is careful about cleaning up a failed checkout session creation path; deeper Stripe lifecycle review belongs in the finance pass.

### Test and Documentation Quality

- `tests/specs/events/free-registration.test.ts` covers the free registration
  happy path using seeded scenario handles, then restores the touched
  registration rows and registration-option counters after the page-backed
  assertions.
- `tests/specs/events/registration-transfer.test.ts` covers the page-backed
  participant self-service unpaid transfer flow by opening the event page,
  submitting the transfer dialog with an eligible target member email, and
  explicitly reading back the transferred registration row.
- `tests/specs/events/registration-transfer.test.ts` also seeds a paid
  confirmed registration with a successful registration transaction and proves
  the event page keeps self-service transfer disabled with the paid
  transfer/resale deferral copy while restoring fixture registration state after
  the generated row assertions.
- `tests/specs/events/negative-registration-states.spec.ts` covers the
  participant-facing waitlist affordance for a full first-come-first-served
  option and explicitly reads back the created waitlist registration.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers registration-card state for full options, distinct waitlist availability, remaining-capacity guest selection helpers, participant registration/write action disabling, and too-early/too-late registration windows without requiring a page-backed browser.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers that stored `random` and `application` participant options do not expose a waitlist affordance even when full.
- `src/server/effect/rpc/handlers/events/event-registration.service.spec.ts` covers server-side rejection for duplicate active registration, unpublished events, closed registration windows, role-ineligible users, cross-tenant options, full options, unsupported registration modes, same-event second registrations across options, transactional duplicate races, transactional capacity races, participant waitlist joining, and participant guest quantities.
- `src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts` covers participant self-cancellation for pending, confirmed, and waitlisted registrations, buyer-plus-guest spot rollback, checked-in rejection paths, organizer-assisted transfer target lookup, and unpaid registration transfer guardrails including target tenant membership, role eligibility, duplicate active registration, and paid-transfer rejection.
- `src/app/events/event-organize/event-organize.spec.ts` covers organizer overview stat aggregation and transfer-dialog participant identity copy. The organizer overview UI now exposes the unpaid transfer action next to cancellation for not-yet-checked-in participant registrations, and the organizer overview RPC returns purchased add-ons with each participant row.
- `src/app/events/event-organize/event-organize.spec.ts` covers the shared
  organizer participant action guard that disables cancellation and
  organizer-assisted transfer for checked-in rows or in-flight writes.
- `src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts` covers organizer/admin cancellation for confirmed registrations and denial without event-organizer access.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers server-side rejection of end-before-start events and close-before-open registration windows for event create/update.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers template discount copying by stable source option id when template options share the same title, plus pre-insert rejection when copied ESNcard discounts are disabled or exceed the target event option price.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers acceptance and rejection for the shared event location schema now used by Events RPC contracts.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers the active registration status literal union, purchased add-ons on active registration and organizer rows, and rejects unknown statuses.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers the tax-rate label fields returned with event registration options for paid event cards.
- `src/app/events/event-details/event-details.component.spec.ts` covers event
  review and submit-for-review action guards for permission, status, and
  mutation-pending states, keeping the event lifecycle actions safe on slow
  networks and duplicate local triggers.
- `src/app/events/event-edit/event-edit.spec.ts` covers event edit submit
  guards for invalid, submitting, and mutation-pending states.
- `src/app/events/event-active-registration/event-active-registration.component.spec.ts` covers participant cancellation copy for single-spot, guest, and waitlisted registrations; unpaid self-service transfer copy; cancellation/transfer action disabling; target-email normalization; and transfer/resale-unavailable notes for pending, waitlisted, and blocked confirmed active registrations.
- `tests/docs/events/event-approval.doc.ts` now creates a deterministic
  approval-flow event, reads back draft submission, rejection feedback,
  resubmission, and approval states from the database, and cleans up generated
  event rows after the documentation journey.
- `tests/docs/events/event-management.doc.ts` now documents only the current event details, registration, review/listing, edit, organizer overview, participant grouping/cancellation, and receipt surfaces.
- `tests/docs/events/unlisted-admin.doc.ts` covers the updated direct-link explanation in the listing dialog and on unlisted event details.
- `tests/docs/events/register.doc.ts` covers free and paid registration as generated documentation and Stripe-backed evidence, including guest quantity selection, the participant versus organizer/helper option wording, participant self-cancellation copy, the unpaid self-service transfer dialog, and the paid registration transfer-unavailable boundary.
- `tests/docs/events/register.doc.ts` now documents registration-time add-on
  selection, required registration-question answers, active-registration
  readback, and persisted answer storage during the free registration
  walkthrough.
- `tests/specs/events/registration-addons.test.ts` covers the page-backed
  free registration add-on and required-question flow, including quantity
  selection, required answer gating, persisted add-on purchase, persisted
  question answer, active-registration readback, availability decrement, and
  cleanup of generated add-on/question rows plus touched registration state.
- `tests/docs/events/register.doc.ts` documents the role-ineligible direct-link state even though page-backed Browser coverage still depends on local runtime availability.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers the participant versus organizer/helper registration option copy.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers discounted buyer-price plus full-price guest totals for paid registration actions.
- `src/server/price/format-inclusive-tax-label.spec.ts` covers the shared inclusive-tax label formatter.
- `src/app/shared/components/inclusive-price-label/price-with-tax.component.spec.ts` covers paid, free, zero-tax, and fallback rendering for the shared price/tax label used by event registration cards and template detail summaries.
- **Addressed in stabilization pass:** event registration option cards now render paid prices through the shared inclusive tax label component using tax-rate details from `events.findOne`.
- `tests/specs/events/price-labels-inclusive.spec.ts` now has active page-level assertions for paid inclusive tax labels, free options without tax labels, zero-percent tax-free labels, fallback tax labels, ESNcard discounted prices retaining tax labels, and paid template detail summaries sharing the same price component.

### Product Questions Answered Above

- Should full options join a waitlist automatically, expose a separate waitlist action, or fail until a later waitlist feature lands?
- Are organizer registrations meant to use the same user-facing register button, or should organizer signup have a separate affordance/copy?
- What is the minimum relaunch scope for guest quantities, transfer/resale, and participant/admin cancellation?
- Should role-ineligible direct links hide the event entirely, show the event with no options, or show an explicit ineligible state?

## Templates

### Current Behavior

- Template routes are under authenticated `/templates`; anonymous Browser access redirects to Auth0.
- Authenticated organizers can browse template categories, open a template detail page, and start event creation from a template.
- The visible template model is simple mode: one organizer registration block and one participant registration block.
- Template detail pages show description, optional location, organizer planning tips, registration option role chips, price/tax label when paid, ESNcard discounted price when configured, capacity, mode, and registration open/close offsets.
- Template creation preselects default organizer roles and default user roles, then saves a template plus two template registration options.
- Creating an event from a template copies template details into the event form and converts registration offsets into concrete open/close timestamps relative to the event start.
- Category create/update handlers enforce `templates:manageCategories`.

### Intended Behavior From Product Context

- Templates preserve organizational memory for repeated events.
- Templates should include reusable event information, participant and organizer signup defaults, registration options, prices, discounts, capacity defaults, role eligibility, registration windows/offsets, registration questions, and organizer notes/checklists where practical.
- Event instances are editable copies of templates, and some duplication is acceptable to keep instances stable.
- Template workflows should be discoverable through the UI.

### Issues and Risks

- **Addressed in this stabilization pass:** `templates.createSimpleTemplate`, `templates.updateSimpleTemplate`, `templates.findOne`, and `templates.groupedByCategory` enforce `templates:create`, `templates:editAll`, or `templates:view` through the shared permission evaluator. Direct RPC calls no longer rely on UI link hiding.
- **Addressed in this stabilization pass:** template write routes now have route-level permission guards for direct `/templates/create`, `/templates/:id/edit`, and `/templates/:id/create-event` access.
- **Addressed in this stabilization pass:** template create/update validates `categoryId` and registration `roleIds` against the current tenant before persisting. Invalid references now fail with typed bad-request errors instead of relying on database constraints or unconstrained role-id arrays.
- **Addressed in this stabilization pass:** template registration offsets now fail with a typed bad request when a registration would open after it closes. Because offsets are "hours before event", `openRegistrationOffset` must be greater than or equal to `closeRegistrationOffset` for a normal window.
- **Addressed in this stabilization pass:** template create/update and find-one RPC location fields now use the shared `EventLocation` schema instead of `Schema.Any`, matching the event boundary behavior.
- **Accepted relaunch boundary:** simple-mode create/update writes exactly two
  registration options: one organizer block and one participant block. Richer
  reusable event knowledge is captured through editable option copy, role
  eligibility, ESNcard discounts, reusable add-ons, reusable registration
  questions, and organizer planning tips until a later full registration-option
  builder exists.
- **Addressed in stabilization pass:** template detail now returns and displays
  existing reusable template add-ons from the current schema, including pricing,
  purchase timing, quantity limits, and registration-option attachments.
  Template add-ons now copy into event-scoped read-model records when a template
  creates an event. Registration-time add-on purchase is wired into the event
  registration checkout path; standalone before-event and during-event add-on
  sales remain future work.
- **Addressed in this stabilization pass:** the template RPC/service boundary
  now accepts optional reusable add-on input for simple template writes, validates
  add-on tax rates and quantity/window invariants, and replaces stored template
  add-ons only when callers explicitly send add-on data.
- **Addressed in this stabilization pass:** simple-mode template create/edit now
  exposes reusable add-on editing, including free/paid state, inclusive tax-rate
  selection, registration-option attachment, included/available quantities,
  max-per-user quantity, and purchase timing. Event creation copies reusable
  add-ons into event-scoped add-ons attached to the matching copied
  registration options.
- **Addressed in this stabilization pass:** create-event-from-template now
  shows an explicit add-on boundary notice when the source template has
  reusable add-ons. Event detail shows copied add-ons so organizers can verify
  the template data that moved with the event; registration cards now offer
  registration-time add-on purchase for matching copied add-ons.
- **Addressed in stabilization pass:** reset-from-zero seed data now includes
  both free and paid reusable template add-ons attached to participant template
  registration options, so Browser review can inspect the add-on detail surface
  once the local runtime is available.
- **Addressed in stabilization pass:** simple-mode template create/edit now exposes optional ESNcard discounted prices when the tenant ESNcard provider is enabled, persists them in `templateRegistrationOptionDiscounts`, returns them through `templates.findOne`, and shows them on template detail.
- **Addressed in stabilization pass:** simple-mode template create/edit now
  exposes reusable registration questions attached to the participant or
  organizer registration option, persists them in template-scoped question
  storage, returns them through `templates.findOne`, and shows them on template
  detail. Event registration and waitlist writes now collect and persist
  submitted answers for copied event questions.
- **Addressed in stabilization pass:** simple-mode template registration
  options now preserve editable option names plus public and registered-user
  rich-text descriptions. Those fields are shown on template detail and already
  flow into event creation through the existing template-to-event mapping.
- **Addressed in stabilization pass:** simple-mode template create/edit now exposes the existing `planningTips` field as private organizer planning tips, persists trimmed notes through the template RPC/service, and shows them on the template detail page.
- **Addressed in this stabilization pass:** registration mode now only offers first-come-first-served in event/template authoring controls. The contracts still accept existing stored `random`/`application` values, but new/edit UI no longer presents unsupported fulfillment modes.
- **Addressed in stabilization pass:** event and template authoring controls now
  render readable registration-mode labels instead of raw stored ids such as
  `fcfs`, while the simple-mode UI still only offers first-come-first-served.
- **Addressed in this stabilization pass:** template create/edit components use scoped `consola/browser` loggers instead of direct `console.*` calls.
- **Addressed in stabilization pass:** template detail paid-option summaries now use the shared inclusive tax label component, matching the event registration card display and preserving the same fallback label when tax-rate details are unavailable.
- **Addressed in stabilization pass:** template create/edit submit normalization clears hidden payment fields for free registrations, so toggling a paid option back to free no longer submits a stale `stripeTaxRateId` that the server correctly rejects.
- **Addressed in stabilization pass:** creating an event from a template now
  shares one tested submit-disabled guard between the template button and submit
  handler, so invalid, submitting, and mutation-pending states cannot trigger
  duplicate event creation on slow networks.
- **Addressed in stabilization pass:** template create/edit writes now share the
  same submit-disabled helper between buttons and handlers, so invalid,
  submitting, and mutation-pending create/update states cannot duplicate
  template writes on slow networks.
- **Addressed in stabilization pass:** template category create/edit actions now
  share one tested write-pending guard, so category buttons and handlers cannot
  open overlapping dialogs or writes while a category create/update is already
  pending.
- **Acceptable for now:** the template detail page is a useful read-only summary and the "Create event" action is discoverable from the detail surface.

### Test and Documentation Quality

- `tests/specs/templates/templates.test.ts` covers create, view,
  empty-category add flow, role autocomplete duplicate hiding, and a reusable
  add-on/question create path with database readback for persisted planning
  tips, add-on attachment/quantity, and required registration question state.
- `tests/docs/template-categories/categories.doc.ts` documents template
  category create/edit with deterministic category names, database readbacks for
  created and edited rows, and cleanup of the generated category.
- Template page-backed specs fail explicitly when required seeded template
  categories or templates are missing before create/detail/tax-rate flows use
  them.
- `tests/docs/templates/templates.doc.ts` documents simple-mode template creation, organizer planning tips, role defaults, payment field visibility, optional ESNcard discounted price fields, reusable add-on editing, reusable registration-question editing, and role-picker behavior. It asserts that enabling payment reveals both the price and tax-rate controls before taking the payment-field screenshot, then asserts that adding a reusable add-on reveals the add-on name, attachment, and purchase-timing controls, and that adding a registration question reveals the question, target, and required-answer controls. It now saves a reusable template and reads back the persisted planning tips, add-on attachment/quantity, and required question state before cleanup. Its role-picker docs fail explicitly when seeded autocomplete roles are missing or nameless before asserting selected roles disappear from the autocomplete.
- `tests/specs/templates/paid-option-requires-tax-rate.spec.ts` now has active simple-mode UI coverage for the paid tax-rate requirement and a seeded inclusive tax-rate save path. The previous future bulk/no-compatible-rate fixme declarations were removed; current no-compatible-rate select feedback is pinned in local component coverage until a broader page flow exists.
- `tests/specs/seed/seed-baseline.test.ts` now treats seeded reusable template
  add-ons and registration questions as part of the reset-from-zero contract
  for template detail review.
- `src/app/templates/shared/template-form/template-registration-option-form.utilities.spec.ts` covers paid template tax-rate and ESNcard discount preservation, paid missing-tax-rate pass-through for server validation, and free-registration payment-field cleanup before create/edit submission.
- `src/app/templates/shared/template-form/template-addon-form.utilities.spec.ts`
  covers add-on submit normalization for free/paid state, trimmed copy, and
  mapping persisted add-on attachments back into the simple add-on edit form.
- `src/app/templates/shared/template-form/template-registration-option-form.component.spec.ts`
  covers the paid tax-rate select feedback for loading, empty compatible-rate,
  failed, and available states so tenants without configured inclusive rates do
  not see an empty select menu.
- `src/app/templates/template-create-event/template-create-event.mapper.spec.ts`
  covers the template-to-event form mapping, including copied registration
  option source ids for server-side template discount copying, relative
  registration-window offsets, and the boundary that organizer planning tips
  stay private to the template surface while source option ids allow the server
  to copy reusable add-ons into event-scoped records.
- `src/app/templates/template-create-event/template-create-event.component.spec.ts`
  pins the create-event-from-template submit guard for invalid, submitting, and
  mutation-pending states, plus the visible notice that reusable add-ons are
  copied to registration-time event purchase surfaces while standalone
  before-event and during-event sales remain out of scope.
- `src/app/templates/shared/template-form/template-form.utilities.spec.ts` pins
  the shared template create/edit write guard for invalid, submitting, and
  mutation-pending states.
- `src/app/templates/shared/template-form/template-form.utilities.spec.ts` pins
  the simple-mode registration shape as exactly one organizer block and one
  participant block, with repeatable reusable add-ons and questions as the
  supported extension points.
- `src/app/templates/categories/category-list/category-list.component.spec.ts`
  pins the category create/edit action guard while create or update writes are
  pending.
- `tests/specs/template-categories/template-categories.test.ts` functionally
  covers template-category create/edit with explicit seeded-category
  preconditions and database readbacks for the created/edited category rows.
- `src/shared/registration-modes.spec.ts` covers the readable labels used by
  event/template authoring controls and template detail summaries for every
  persisted registration-mode literal.
- `src/server/effect/rpc/handlers/tax-rates.handlers.spec.ts` covers `taxRates.listActive` permission behavior and the current-tenant active/inclusive filter used to populate compatible template tax-rate selects.
- `src/server/utils/validate-tax-rate.spec.ts` covers the shared server rule that paid options require a tenant-owned active inclusive tax rate and free options cannot carry stale tax-rate ids.
- `src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts` covers paid template registrations without tax rates, free template registrations with stale tax-rate ids, and invalid ESNcard discounted prices failing through the server-side validation path.
- `src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts`
  also covers simple reusable add-on insert shaping, registration-option
  attachment, hidden payment-field cleanup, purchase-window validation, and
  paid add-on tax-rate validation.
- `src/db/schema/template-event-addons.spec.ts` and the event lifecycle handler
  coverage pin reusable add-on source storage, template-to-event add-on copying,
  template registration-question source storage, and copied event registration
  question storage.
- `src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts`,
  `src/server/effect/rpc/handlers/templates.handlers.spec.ts`,
  `src/server/effect/rpc/handlers/templates/templates-rpcs.schema.spec.ts`, and
  `src/app/templates/shared/template-form/template-form.utilities.spec.ts` cover
  reusable registration-question write normalization, RPC shape, read model, and
  form state preservation without Browser/runtime setup.
- `src/server/effect/rpc/handlers/templates.handlers.spec.ts` and
  `src/app/templates/template-details/template-details.component.spec.ts` cover
  the current reusable add-on read model and detail-surface labels without
  requiring Browser/runtime setup.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts`,
  `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts`, and
  `src/app/events/event-details/event-details.component.spec.ts` cover copied
  event add-on storage, RPC shape, and read-only event-detail labels.
- `tests/specs/seed/seed-baseline.test.ts` now treats seeded reusable template
  add-ons as part of the reset-from-zero contract for template detail review.
- The generic `tests/docs/template.doc.ts` discovery placeholder was removed; product template documentation lives in `tests/docs/templates/templates.doc.ts`.
- Permission matrix coverage checks template create link visibility plus direct route denial for template create/edit/create-event routes. `src/app/templates/templates.routes.spec.ts` keeps the guarded template write-route manifest explicit. Server unit coverage proves template RPC denial, template offset ordering, tenant-owned template category/role validation, and template location schema rejection.

### Product Questions Answered Above

- Is simple mode the intended relaunch template scope, or should richer registration options/add-ons/questions/organizer notes be available before relaunch? Answered locally: keep simple mode primary and expose organizer planning tips, ESNcard discounted prices, reusable add-ons, reusable registration questions, event-side question visibility, and submitted answer collection for registration/waitlist writes now.
- Should `random` and `application` registration modes be selectable now if registration fulfillment does not implement those semantics?
- Should template view require `templates:view`, or should organizers with `events:create` inherit template view through permission dependencies only?
- Should template category management remain a separate capability from template creation/editing?

### Recommended Cleanup Actions

- Keep permission-matrix coverage for direct template write-route denial.
- Keep focused `SimpleTemplateService` coverage for tenant-owned template category/role validation.
- Keep focused `SimpleTemplateService` coverage for template offset ordering.
- Keep template and event RPC location fields aligned on the shared `EventLocation` schema.
- Keep organizer planning tips private to the template/organizer surface unless
  a later product decision makes them event-facing.
- Keep the active template tax-rate UI coverage aligned with the current simple-mode payment fields, and add broader page-backed no-compatible-rate or bulk-operation coverage only when those behaviors have real UI surfaces.
- Keep `random` and `application` hidden until their fulfillment semantics are
  implemented end to end.

## Roles and Permissions

### Current Behavior

- Permissions are string capabilities grouped by admin, internal, events, templates, users, and finance.
- Tenant roles store permission arrays plus default user/organizer flags and hub-display fields.
- New accounts receive tenant roles marked as default user roles.
- Event/template registration eligibility is modeled through role ids stored on registration options.
- The client `PermissionsService` supports direct permissions, group wildcard checks, the legacy `admin:manageTaxes` alias, and configured permission dependencies.
- Server authorization paths use the same shared `includesPermission` evaluator through `RpcAccess.ensurePermission` or handler-local checks that still read legacy context headers.
- The role form automatically selects dependent permissions and marks them read-only when a parent permission is selected.
- Admin role create, update, delete, find-one, find-many, and search RPCs require `admin:manageRoles`; `users.findMany` requires `users:viewAll`.
- `admin.roles.findHubRoles` requires only authentication.
- Admin role routes require `admin:manageRoles`; admin user routes require `users:viewAll`; general settings require `admin:changeSettings`; tax rates require `admin:tax`; event reviews require `events:review`.
- Browser verification with an organizer account showed direct `/admin` and `/admin/roles` stay on the requested URL but render only the app shell/navigation instead of a clear not-allowed page.

### Intended Behavior From Product Context

- Tenants define their own roles; there is no single system-defined default role.
- Default roles are tenant-managed and assigned to users by default in that tenant.
- Capabilities should have admin-facing names/descriptions and can imply access to related data.
- Role-based eligibility should remain the main way to model special cases instead of scattered flags.
- Administrators manage tenant roles, permissions, tenant settings, and user-role assignment.
- Tenant isolation and permission safety are core quality gates.

### Issues and Risks

- **Addressed in this stabilization pass:** client and server permission checks now share `includesPermission`, including dependency expansion, wildcard checks, and the legacy `admin:manageTaxes` -> `admin:tax` alias. Legacy header-based handlers, `RpcAccess.ensurePermission`, tax-rate visibility, event visibility/edit checks, and finance receipt helpers all route through the shared evaluator.
- **Addressed in this stabilization pass:** admin role, user, settings, tax-rate, and event-review child routes now have route-level permission guards, and the admin shell requires at least one admin-child capability.
- **Addressed in this stabilization pass:** denied permission guards now route to the root `/403` page instead of a child-relative `403` path, so direct admin/finance/template denials render a clear not-allowed page instead of an empty feature shell.
- **Addressed in this stabilization pass:** `admin.roles.findMany` now requires `admin:manageRoles`; permission-bearing role records are no longer exposed to every authenticated tenant user.
- **Addressed in this stabilization pass:** shared role selection and template default-role queries now use lookup-only `roles.findMany` / `roles.findOne` RPCs. The lookup API returns only id, name, and default-role flags and is available to event/template authoring permissions plus role admins.
- **Addressed in stabilization pass:** role create/update now writes `displayInHub` and `collapseMembersInHup`, and the role form uses the same `displayInHub` field that `findHubRoles` reads. The legacy `showInHub` role field has been removed from the Drizzle schema and admin role RPC records, leaving `displayInHub` as the canonical hub-visibility field.
- **Addressed in stabilization pass:** `users:assignRoles` is now labeled as a future/migration permission in the role form metadata, the user list explicitly says existing-user role assignment is deferred for relaunch, and the roles doc records the read-only user-list behavior.
- **Addressed in stabilization pass:** the user list no longer shows placeholder selection or "Edit template" actions for user-role assignment.
- **Addressed in stabilization pass:** permission metadata now has explicit admin-facing labels and descriptions in the shared permission source, the role form renders those descriptions, and shared tests require every visible permission to keep non-empty metadata.
- **Addressed in stabilization pass:** role-form dependent-permission copy now uses shared admin-facing permission labels instead of raw permission keys, and the generated permission reference keeps both the label and key visible.
- **Addressed in this stabilization pass:** role create/edit submits now share a tested disabled guard across the role form template and submit handler, and parent create/update handlers ignore duplicate submit events while the role write is pending.
- **Addressed in stabilization pass:** the tenant event-review queue now shares
  one tested action guard between Approve/Reject buttons and the handler, so a
  pending review mutation cannot open another rejection dialog or submit a
  second review write.
- **Addressed in stabilization pass:** server authorization source coverage now
  rejects raw permission-array `.includes(...)` checks in RPC/HTTP handlers, so
  new permission gates stay routed through the shared `includesPermission`
  evaluator or `RpcAccess.ensurePermission`.
- **Acceptable for now:** roles are tenant-scoped in schema and role-management write queries include tenant boundaries.

### Test and Documentation Quality

- `src/shared/permissions/permissions.spec.ts` covers direct permissions, dependency expansion, legacy tax aliases, wildcard checks, and rejection of unrelated permissions. `RpcAccess` and tax-rate handler unit tests prove server use of the shared evaluator.
- `src/shared/permissions/permissions.spec.ts` covers shared permission labels used by role-form dependency copy and falls back to raw keys only for technical permissions not shown in normal role management.
- `src/app/core/guards/permission.guard.spec.ts` covers denied route redirects to the root not-allowed page and positive permission allow behavior, preventing child-route denials such as `/admin/roles` from resolving to an empty feature shell.
- `src/app/admin/components/role-form/role-form.component.spec.ts` covers role
  submit disabling for invalid, submitting, and mutation-pending states.
- `src/app/admin/event-reviews/event-reviews.component.spec.ts` covers the
  tenant event-review queue guard that disables Approve/Reject while a review
  mutation is pending.
- Permission matrix coverage checks admin tax-rate, role-management, user-list, settings, and template write route denial. `src/app/admin/admin.routes.spec.ts` keeps the guarded admin route manifest explicit. Role lookup UI behavior still needs manual Browser review once runtime review is available; current Playwright specs cover duplicate-hiding behavior in both template creation and event editing.
- `tests/docs/roles/roles.doc.ts` documents role creation, dependent permissions, and the explicit deferral of existing-user role assignment for relaunch.
- `tests/docs/roles/roles.doc.ts` now creates a deterministic unique role,
  asserts dependent permission selection, reads the persisted role permissions
  from the database, and cleans up the generated role after the docs journey.
- `tests/docs/roles/about-permissions.doc.ts` generates the `/docs/about-permissions` source from shared permission metadata, including group labels, permission keys/descriptions, dependent permissions, and the tenant-role/global-admin distinction.
- `tests/docs/roles/roles.doc.ts` links to `/docs/about-permissions` for permission reference details.
- `tests/specs/admin/roles-management.spec.ts` functionally covers the
  tenant-admin user review and role-management relaunch surface: read-only user
  list search, role create, dependent permission selection, hub-display flags,
  role detail assertions, role edit persistence, and DB readback.
- Server unit coverage proves role lookup permissions, lookup-only result shaping, tenant-scoped lookup filters for both list and single-role lookup, role lookup not-found errors, and admin role list denial without `admin:manageRoles`.
- `helpers/testing/user-list-source.spec.ts` keeps the tenant user list aligned
  with the read-only relaunch surface by guarding review-only columns, the
  visible role-assignment deferral copy, tenant-scoped role-name reads, and
  generated roles documentation.
- `helpers/testing/authorization-source.spec.ts` keeps server RPC/HTTP
  authorization on the shared permission evaluator path and keeps the public
  role lookup contract free of permission-bearing admin role fields.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` verifies `users.findMany` aggregates role names into the RPC contract shape without leaking the joined `role` column.
- `src/shared/permissions/permissions.spec.ts` requires explicit labels and descriptions for every permission shown in role management.
- `src/db/schema/legacy-stabilization-fields.spec.ts` proves the active role schema exposes `displayInHub` instead of `showInHub`, and guards the global migration step that drops physical `roles.showInHub`, `event_registrations.paymentStatus`, and the unused `payment_status` enum before tenant-scoped migration work.

### Product Questions Answered Above

- Which role reads should be available to organizers creating events/templates, and should they expose only id/name/default flags instead of permissions?
- Should `events:create` imply `templates:view` only in the client, or should resolved permissions always include dependencies before reaching server handlers?
- Should admin overview be visible to users with any `admin:*` capability, or should each admin child be discoverable only by its own permission?
- What is the intended relaunch scope for assigning users to roles?
- Should the legacy `showInHub` field be removed in a migration or backfilled before removal? Answered locally: remove it from the application schema/API surface because active writes and reads use `displayInHub`.

### Recommended Cleanup Actions

- Keep permission checks routed through `includesPermission` or `RpcAccess.ensurePermission`; avoid reintroducing direct `.includes(...)` authorization checks.
- Keep the authorization source guard current if a new server-side permission
  helper is introduced intentionally.
- Keep route-manifest specs and permission-matrix route-denial cases aligned as admin, finance, template, and global-admin route trees change.
- Keep role create/edit submit guards aligned with the actual mutation
  lifecycle, not only the signal-form submit callback.
- Keep UI/E2E coverage aligned so least-privilege organizers can search/select tenant roles in event/template eligibility forms; current Playwright coverage exercises duplicate-hiding behavior in both template creation and event editing, while manual Browser review remains pending until local runtime is available.
- Keep `migration/steps/004_drop_legacy_stabilization_fields.ts` in the
  production migration path so any existing physical `showInHub`,
  `paymentStatus`, and `payment_status` artifacts are dropped when the
  schema/API surface is applied.
- Keep user-role assignment explicitly deferred until a real role-assignment RPC and UI are implemented.
- Keep the current read-only user-list role-name read tenant-scoped while role
  assignment remains migration/future-work only.
- Add Browser-backed least-privilege organizer review for event/template role selectors once the local runtime is available; current server coverage proves lookup permissions and lookup-only result shaping, and the template/event Playwright autocomplete specs fail loudly when seeded role state is missing.

## Finance/Receipts

### Current Behavior

- Paid event registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and stores a pending `registration` transaction with Stripe checkout ids.
- Stripe `checkout.session.completed` marks the local transaction successful, confirms the registration, and moves the buyer plus guest spots from reserved to confirmed when the session is complete and paid.
- Stripe `checkout.session.expired` marks the local transaction cancelled, cancels the registration, releases the buyer plus guest reserved spots, and restores reserved registration-time add-on quantities when the session is expired.
- Finance navigation is hidden behind `finance:*`, and `/finance` requires at least one finance child capability.
- The finance overview links to transactions, receipt approvals, and receipt reimbursements only when the user has the matching child permission.
- `finance.transactions.findMany` returns non-cancelled tenant transactions only to users with `finance:viewTransactions`.
- Event organizers or users with receipt-management capabilities can submit receipts from the event organize page.
- Receipt upload is a separate RPC that requires the target event id, preflights the caller through the same receipt-submit authorization used by `finance.receipts.submit`, then stores image/PDF originals in object storage or a local-unavailable placeholder when storage config is absent.
- Finance reviewers can approve/reject submitted receipts; reimbursement users can group approved receipts by submitter and record manual reimbursement transactions.
- Finance receipt approval and reimbursement read models display the submitter's notification email when configured, with Auth0 login email as fallback.
- Profile shows the current user's submitted receipts.

### Intended Behavior From Product Context

- Stripe is the payment source of truth; local state should mirror Stripe lifecycle and must not fake successful payment state.
- Users should receive registration confirmation and QR code only after successful registration; for paid events, after successful payment.
- Organizers may submit receipts before, during, or after an event so pre-event
  spending can be recorded without waiting for the event end time.
- Receipts are reviewed and reimbursed; the first version does not need sophisticated budgeting or receipt categories.
- Receipt review should support email notification when a receipt is reviewed.
- Finance and payment flows are high-risk and should be permission-safe, tenant-safe, and payment-safe.

### Issues and Risks

- **Addressed in this stabilization pass:** Stripe checkout completion now moves paid registration spots from `reservedSpots` to `confirmedSpots`, and checkout expiry releases the reserved spots. Both counter transitions are conditional on the registration actually leaving `PENDING`, preserving webhook replay safety.
- **Addressed in this stabilization pass:** `finance.transactions.findMany` now requires `finance:viewTransactions`, so direct RPC calls cannot read transaction amounts, comments, methods, or fees with authentication alone.
- **Addressed in this stabilization pass:** finance parent and child routes now have route-level permission guards. Transactions require `finance:viewTransactions`, receipt approvals require `finance:approveReceipts`, and receipt reimbursement requires `finance:refundReceipts`.
- **Addressed in stabilization pass:** the transaction list no longer shows a
  dead manual "Create transaction" action while no matching route/workflow
  exists.
- **Addressed in this stabilization pass:** receipt media upload now includes the target `eventId`, checks tenant event existence for authorized callers, and requires `canSubmitEventReceipts` before object storage is touched. A signed-in user without receipt-submit access can no longer create orphan receipt objects through the upload RPC.
- **Addressed in stabilization pass:** manual receipt reimbursement is now labeled as recording a reimbursement in the finance overview, reimbursement list, receipt submit hint, profile payout fields, visible server messages, docs, and Playwright coverage. The reimbursement queue now explicitly says Evorto only records the finance transaction and money must be transferred manually through the selected payout method. Reimbursement transaction comments no longer copy the full payout reference into free text. The legacy route path, permission name, RPC name, receipt status, and transaction type still use "refund" internally until a broader data/API migration is worthwhile.
- **Addressed in stabilization pass:** receipt submission and review now reject tax amounts greater than the total amount, matching the existing deposit/alcohol amount consistency guard.
- **Addressed in stabilization pass:** receipt submission now follows the
  pre-event spending decision. The server still verifies the target event exists
  and the caller can submit receipts for it, but it no longer blocks submission
  only because the event end time is in the future.
- **Addressed in stabilization pass:** profile and user-event summaries no longer read `event_registrations.paymentStatus`; payment display is derived from registration transaction rows. Seed and webhook-replay setup stopped writing `paymentStatus` for new fixture registrations, and the legacy payment-status column/enum have been removed from the application schema.
- **Addressed in stabilization pass:** receipt review records status locally, and the review detail page, success feedback, and finance docs explicitly tell finance reviewers that submitter notification is manual until a real delivery path exists.
- **Addressed in this stabilization pass:** finance receipt approval and reimbursement lists now prefer the user's editable notification email over the Auth0 login email when rendering submitter contact details.
- **Addressed in this stabilization pass:** the event organizer receipt action now stays disabled while the original receipt upload is pending, not only while the final submit mutation is pending, and the click handler shares the same guard.
- **Addressed in stabilization pass:** receipt reimbursement recording now
  shares one disabled guard between the queue button and handler so missing
  selections, missing payout details, and mutation-pending writes cannot record
  duplicate reimbursement transactions on slow networks.
- **Addressed in stabilization pass:** receipt preview rendering now rejects
  non-network preview URLs before showing image previews, iframe PDF previews,
  or "open in new tab" links. This keeps signed R2/MinIO HTTP(S) preview URLs
  usable while preventing malformed, `javascript:`, `data:`, or local
  placeholder URLs from being trusted by the Angular resource sanitizer.
- **Acceptable for now:** receipt review/reimbursement queries are tenant-scoped, and receipt reimbursement creation uses a transaction plus status preconditions to avoid reimbursing the wrong submitter or already-reimbursed receipts.

### Test and Documentation Quality

- Stripe webhook replay specs cover idempotent completed sessions, paid-registration counter transitions, expired-session reservation release, processing-claim behavior, stale-claim reclaim, payment-intent fallback, and ignoring unpaid completed sessions. `src/shared/registration-spots.spec.ts` pins the buyer-plus-guests spot count used by webhook counter updates.
- Receipt flow specs cover receipt submission UI, receipt approval/reimbursement path, and tenant "Other" receipt country visibility.
- `tests/specs/finance/finance-overview-permissions.spec.ts` covers the
  finance overview navigation contract, proving that transaction, receipt
  approval, and receipt reimbursement links appear only for users with the
  matching finance capability.
- **Addressed in stabilization pass:** `tests/specs/finance/receipts-flows.spec.ts` now hard-fails when the seeded pending receipt, refundable receipt group, row checkbox, enabled reimbursement action, or tenant "Other" country option is missing.
- Finance overview docs now describe the current navigation-style finance UI, current finance capability names, and the manual submitter-notification caveat before and after receipt review.
- **Addressed in stabilization pass:** `tests/docs/finance/finance-overview.doc.ts`
  now seeds visible and cancelled transaction rows, proves the transaction list
  renders the non-cancelled row, and proves cancelled rows stay omitted before
  generating the transaction-list screenshot.
- **Addressed in stabilization pass:** `tests/docs/finance/receipt-review-reimbursement.doc.ts` now walks the exact seeded receipt through the approval queue, approval detail page, manual submitter-notification caveat, reimbursement queue, payout-detail selection, and manual reimbursement recording, then reads back the final receipt state and restores the seeded row.
- `src/app/finance/receipt-refund-list/receipt-refund-list.component.spec.ts` pins the reimbursement queue's manual money-movement notice, payout-detail gating, payout-detail labels, selected-total math, and reimbursement record disabled guard. The receipt reimbursement doc/spec assert the manual-money notice on the page.
- `src/app/finance/receipt-approval-detail/receipt-approval-detail.component.spec.ts`
  pins the approval/rejection action guard for invalid forms, loading receipt
  details, and mutation-pending review writes.
- Tax-rate docs and specs provide better active coverage for `admin:tax` and inclusive Stripe tax-rate import/selection.
- Server finance unit tests are still thin, but now include transaction-list permission denial, receipt-media upload preflight denial/success coverage, profile `finance.receipts.my` output normalization, submitter notification-email fallback, receipt review precondition rejection, mixed-submitter reimbursement rejection, payout-detail validation before reimbursement recording, reimbursement precondition-race rejection, and tax-amount consistency rejection on receipt submit/review.
- Event organize app coverage pins the receipt submission disabled state while
  the event has not loaded yet and across upload-pending and submit-pending
  phases.

### Product Questions Answered Above

- Should paid registration webhook handling update `confirmedSpots`/`reservedSpots`, or should counters be derived from registration rows instead of stored?
- Is `paymentStatus` still part of the model, or should it be removed/migrated in favor of registration status plus transactions? Answered locally: remove it from the application schema; current active reads use registration status plus transaction rows.
- Which finance capability should gate the transaction list: `finance:viewTransactions`, `finance:manageReceipts`, or a broader finance overview permission?
- Should receipt uploads be created only after submit authorization succeeds, or should upload sessions be issued from a receipt-submit preflight?
- Should receipt reimbursement remain a manual ledger action, or will it eventually integrate with a payout provider?
- Should receipts be restricted to event end dates, or is pre-event spending
  intentionally allowed? Answered locally: pre-event spending and submission are
  allowed once the event exists and the caller has receipt-submit access.

### Recommended Cleanup Actions

- Keep webhook-side regression tests asserting registration status, transaction status, and option counters together for paid checkout completion and expiry.
- Keep direct-route Playwright denial coverage for finance transaction, receipt approval, and receipt reimbursement routes. `src/app/finance/finance.routes.spec.ts` keeps the guarded finance route manifest explicit.
- Keep receipt reimbursement UI copy honest about recording a manual reimbursement unless an actual payout integration is added.
- Keep receipt amount consistency checks aligned between submit and review.
- Keep `migration/steps/004_drop_legacy_stabilization_fields.ts` in the
  production migration path so any existing physical `paymentStatus` column and
  unused `payment_status` enum are dropped when the schema/API surface is
  applied.
- Keep receipt flow specs deterministic: seeded approval/reimbursement paths should fail loudly when expected rows, controls, or options are missing.
- Keep finance overview docs aligned with current navigation UI and permission names as reimbursement wording changes.
- Keep transaction list actions aligned with implemented finance routes; manual
  transaction creation should be added back only with a real guarded route and
  workflow.

## Scanning/Check-In

### Current Behavior

- Confirmed user registrations show a "Your event ticket" card with a QR image at `/qr/registration/:registrationId`.
- The QR HTTP route looks up the registration by id, finds the registration tenant, and encodes a scan target URL using the current request protocol plus the tenant domain.
- `/scan` is an authenticated route that starts a camera-based QR scanner and navigates to `/scan/registration/:registrationId` when the scanned absolute URL has the exact `/scan/registration/:registrationId` path. The scanner intentionally accepts any URL origin and lets the scan-read RPC enforce event/tenant authorization.
- `/scan/registration/:registrationId` calls `events.registrationScanned`, shows attendee name, event title/start time, registration option title, ESNcard discount notice, guest check-in progress, same-user warning, future-event warning, registration-status warning, and already-checked-in warning.
- The scan result enables "Confirm Check In" when the scanned registration is confirmed, does not belong to the scanner, is inside the current fixed one-hour pre-start check-in window, and either the buyer or remaining guests can still be checked in. The button calls `events.checkInRegistration` with the selected guest count, then refetches scan state and shows a recorded-check-in state.
- `events.registrationScanned` and `events.checkInRegistration` require event check-in access: either `events:organizeAll` or a confirmed organizer/helper registration for the same event.
- `events.checkInRegistration` sets `event_registrations.checkInTime`, tracks `checkedInGuestCount`, and increments `event_registration_options.checkedInSpots` by the buyer plus selected guest spots in one transaction. Duplicate scans return idempotent success without incrementing the option counter again, while later guest arrivals can still check in remaining guest spots.
- Event organize pages show aggregate checked-in counts from option counters and participant lists from registration rows; the old table-based check-in status UI is commented out.
- Seed data simulates check-ins for past events by writing `checkInTime` and `checkedInSpots`, so local/demo data can look more complete than the runtime behavior.

### Intended Behavior From Product Context

- Organizers run events and check in participants with QR-code check-in.
- Participants receive registration/check-in information only after successful registration; paid participants should only receive QR/check-in access after successful payment.
- Check-in is a high-risk event/registration state transition because it touches registration persistence, organizer access, guest quantities, QR codes, and event archival.
- Playwright should cover checking in participants and guest quantities for durable behavior.

### Issues and Risks

- **Addressed in this stabilization pass:** "Confirm Check In" now persists check-in state through `events.checkInRegistration` and updates `checkInTime`, `checkedInGuestCount`, and `checkedInSpots` transactionally.
- **Addressed in this stabilization pass:** scan reads and check-in writes are gated to `events:organizeAll` or a confirmed organizer/helper registration for the same event, so a normal authenticated tenant user cannot read attendee scan details by registration id.
- **Addressed in this stabilization pass:** duplicate scans are idempotent; already-checked-in registrations show a warning and the write path does not increment counters again.
- **Addressed in stabilization pass:** event timing is enforced in both scan-read state and the check-in mutation. Confirmed other-user registrations can only be checked in during the current fixed one-hour pre-start window or after event start.
- **Addressed in stabilization pass:** QR generation now requires an authenticated current-tenant user. The endpoint returns ticket QR images only for confirmed registrations when the requester owns the registration, has `events:organizeAll`, or has a confirmed organizer/helper registration for the same event; unauthorized or non-confirmed registrations fail closed.
- **Addressed in stabilization pass:** scanner URL parsing now explicitly accepts absolute URLs from any origin by product decision, but only when the path is exactly `/scan/registration/:registrationId`; malformed payloads and extra path segments are rejected before navigation.
- **Addressed in stabilization pass:** scanner camera startup is awaited and maps denied permission, missing devices, and busy devices into visible retryable error messages. The scanner also shows a starting state and keeps a retry button available after camera startup failures.
- **Addressed in stabilization pass:** scanner guest-quantity behavior is explicit. Organizers can choose how many remaining guests to check in with the buyer, and later scans can record additional guest arrivals without re-counting the buyer.
- **Addressed in stabilization pass:** direct check-in writes now have server
  coverage for invalid guest-count payloads, including negative counts and
  counts above the remaining guest quantity.
- **Addressed in this stabilization pass:** scanner guest-count input handling now has focused app coverage that clamps blank, invalid, negative, and over-limit guest selections before the check-in mutation payload is built.
- **Addressed in stabilization pass:** scanned-registration check-in copy now uses readable singular/plural spot labels, a lower-noise pending label, and clearer future-event warning wording.
- **Addressed in this stabilization pass:** the scanned-registration check-in action now stays disabled after a successful local check-in while the refreshed scan state catches up, so slow refetches do not briefly expose another write action.
- **Addressed in stabilization pass:** scanner Playwright coverage now creates
  explicit confirmed registrations against the seeded past event instead of
  relying on generated filler registrations, so buyer-plus-guest and remaining
  guest-arrival assertions stay tied to deterministic fixture state.
- **Acceptable for now:** QR code display is limited to confirmed registrations in the active registration UI, so pending paid registrations do not show the ticket card there.

### Test and Documentation Quality

- `tests/specs/scanning/scanner.test.ts` now creates deterministic confirmed
  registrations for the seeded past event, clicks "Confirm Check In" with
  selected guests, asserts that `checkInTime`, `checkedInGuestCount`, and
  `checkedInSpots` update, covers later remaining-guest arrival after the buyer
  was already checked in, and opens the organizer overview to assert the
  checked-in aggregate shown there before restoring the seeded counter.
- `src/app/events/event-organize/event-organize.spec.ts` covers organizer overview stat aggregation from registration-option counters, including scanner-updated `checkedInSpots` totals.
- Server unit coverage proves scan-read denial for unauthorized tenant users, check-in counter updates for organizer access, selected guest check-in behavior, invalid guest-count rejection, remaining-guest scan behavior after buyer check-in, idempotent duplicate check-in behavior, and same-user check-in denial.
- `src/server/http/qr-code.web-handler.spec.ts` covers unauthenticated QR denial, owner access, same-event organizer access, other-user denial, and pending-registration denial.
- `src/app/scanning/scanner/scanner.component.spec.ts` covers scanner URL parsing for current-origin tickets, other-origin tenant tickets, malformed payloads, and non-exact scan paths.
- `src/app/scanning/handle-registration/handle-registration.component.spec.ts` covers scanned-registration check-in button and spot-count labels.
- `src/app/scanning/handle-registration/handle-registration.component.spec.ts` also covers the local check-in action guard for unavailable, completed, pending, and empty spot-count states, plus guest-count input clamping before mutation payload creation.
- Server unit coverage proves future-event timing disables scan check-in and rejects direct check-in writes before the pre-start window opens. Server unit coverage also proves pending, cancelled, and waitlisted registrations disable scan check-in and reject direct check-in writes.
- `tests/docs/events/register.doc.ts` documents that the ticket QR code is available after registration/payment and no longer claims QR email delivery exists in the current relaunch flow.
- `tests/docs/events/event-management.doc.ts` documents the organizer-facing QR scan/check-in flow, including scan warnings, check-in authorization, buyer-plus-selected-guests checked-in count updates, and selected guest-quantity check-in.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts`
  now seeds a deterministic confirmed registration with guests, opens the
  scanned-registration page, asserts guest progress and the buyer-plus-guests
  check-in action, captures that page for generated documentation, records the
  check-in, reads back the persisted registration/counter state, and restores
  the seeded checked-in counter during cleanup.
- `QUALITY.md` lists participant and guest-quantity check-in as high-value Playwright flows; the scanner spec now covers selected guest check-in and the organizer overview aggregate. Manual Browser review still depends on local runtime availability.

### Product Questions Answered Above

- Should check-in be allowed for confirmed organizer/helper registrations, users with `events:organizeAll`, a new `events:checkIn` capability, or all of those?
- Should scanning be allowed before event start, within a configurable window, or only after a manual organizer override?
- Should duplicate scans be idempotent success, warning-only, or blocked after the first check-in?
- Should QR generation require the registration owner/organizer, or is an unguessable registration id considered enough for the image endpoint? Answered locally: require the confirmed registration owner, `events:organizeAll`, or a confirmed organizer/helper registration for the same event.
- Should scanner URL validation require the current tenant domain, any known tenant domain, or any URL with the expected path? Answered locally: accept any absolute URL origin because ticket URLs may be opened through tenant/custom domains, but require the exact scan-registration path and rely on server scan authorization for tenant/event access.
- What is the minimum relaunch scope for guest quantity check-in? Answered locally: the scanner lets organizers choose how many remaining guests to check in, so partial guest arrival is supported while buyer check-in remains idempotent.

### Recommended Cleanup Actions

- Keep server tests for same-user scans, unauthorized tenant users, duplicate scans, and counter updates.
- Keep server tests for invalid guest-count check-in payloads so direct RPC
  writes cannot bypass the scanner UI clamping.
- Keep server tests for pending/cancelled/waitlisted registrations.
- Keep the Playwright scanner spec aligned with the organizer overview/check-in aggregate and run the manual Browser review once local runtime is available.
- Keep organizer check-in documentation aligned with the dedicated scanner flow as check-in UI and guest-quantity behavior evolve.
- Keep scanner camera-error mapping covered by unit tests as browser/device behavior changes.

## Profile/Account Flows

### Current Behavior

- `/profile` is guarded by `userAccountGuard` and `authGuard`; anonymous direct access redirects to Auth0 login.
- `/create-account` is guarded by `authGuard`, so anonymous direct access starts the authenticated account-creation flow instead of rendering the form with empty auth data.
- Authenticated users without a tenant user assignment are redirected to `/create-account` by `userAccountGuard`.
- `users.createAccount` runs in one database transaction, creates a global user row when needed, creates a current-tenant assignment, and assigns tenant default-user roles.
- If a user with the same Auth0 id already exists globally, `users.createAccount` attaches that user to the current tenant unless the tenant assignment already exists.
- Profile overview shows the user's name, login email, notification email, logout action, section navigation, richer event-registration cards, discount-card management when ESNcard is enabled, and submitted receipts.
- Profile edit updates global user name, notification email, and optional global reimbursement details. IBAN and PayPal fields are labeled as manual receipt reimbursement details used across tenants.
- ESNcard profile management stores one card per user/type globally, validates through `esncard.org`, and shows current card status/validity when the current tenant has ESNcard support enabled.
- Submitted receipts on profile are fetched through `finance.receipts.my`, scoped by current tenant and current user.

### Intended Behavior From Product Context

- Anonymous users may browse eligible listed events, but registration requires an account.
- Users are global and may belong to multiple tenants. A user should ideally have a home tenant so the app can warn when they are browsing another tenant.
- Role-based eligibility and default tenant roles should determine what a new user can access after account creation.
- ESN-card behavior should be opt-in because not every tenant is an ESN section.
- Special cases such as ESN-card-only access should be modeled through roles and registration-option eligibility rather than scattered flags.
- Essential profile/account flows should be documented through generated Playwright docs where practical.

### Issues and Risks

- **Addressed in stabilization pass:** create-account stores `communicationEmail`, and profile now shows the Auth0 login email separately from the editable notification email. Profile edit updates `communicationEmail` alongside name and reimbursement fields.
- **Addressed in stabilization pass:** profile event cards now link to event details and show registration status, selected option, guest quantity and purchased add-ons when applicable, payment state, and check-in time when available. Profile still leaves QR/ticket display, cancellation action, and unpaid transfer workflows to the event-detail flow while exposing pending checkout continuation directly.
- **Addressed in stabilization pass:** profile event cards now label their event-details action as "Open event page" instead of implying that the profile card itself renders the ticket; confirmed ticket access remains on the event detail surface.
- **Addressed in stabilization pass:** profile event cards now point pending checkout registrations at the implemented profile-level recovery action, route ticket, cancellation, unpaid transfer, and waitlist details back to the event page, and no longer carry deferred automatic-refund, paid-transfer, or resale copy.
- **Addressed in stabilization pass:** checked-in profile event cards no longer advertise cancellation or transfer as available detail-page actions.
- **Addressed in stabilization pass:** profile reimbursement fields are global user fields by product decision, and the profile copy now labels them as optional global reimbursement details used for manual receipt reimbursements across tenants.
- **Addressed in stabilization pass:** profile edit now shares one tested
  update-pending guard between the Edit profile button and handler, so a
  profile update in flight cannot open another edit dialog on slow networks.
- **Addressed in stabilization pass:** ESNcard save, refresh, and remove actions now clear stale errors, show visible pending button states, and map mutation failures through `getErrorMessage(...)` instead of rendering raw error objects.
- **Addressed in this stabilization pass:** ESNcard save, refresh, and remove actions now share one in-flight guard so slow validation, refresh, or removal requests cannot overlap with another profile discount-card write.
- **Addressed in this stabilization pass:** profile discount-card rows now render readable ESNcard status labels instead of raw persisted status values.
- **Addressed in stabilization pass:** ESNcard validation now uses a bounded provider request and distinguishes provider unavailability from invalid/expired card results. Save/refresh mutations surface provider outages as retryable bad-request errors instead of collapsing them into card validation status, and ESNcard save validates before changing the stored card identifier so provider outages leave the current card unchanged.
- **Addressed in stabilization pass:** create-account mutation failures now render a visible retryable error on the form instead of failing silently after the submit attempt.
- **Addressed in stabilization pass:** the create-account form labels `communicationEmail` as "Notification email" so the UI, generated docs, and profile terminology agree that Auth0 login email and user-managed notification email are separate concepts.
- **Addressed in this stabilization pass:** create-account submit handling now shares the same invalid/submitting/mutation-pending guard as the button disabled state, so duplicate submit events on slow account creation writes are ignored.
- **Acceptable for now:** profile receipt reads are tenant-scoped and user-scoped through `finance.receipts.my`.
- **Acceptable for now:** event price reads and registration writes both require a verified ESNcard in the current tenant before applying the ESNcard discount.

### Test and Documentation Quality

- `tests/docs/profile/user-profile.doc.ts` documents navigation, profile display, edit dialog validation, notification email persistence, event cards, and the receipts tab. It now saves a deterministic notification email, reads the updated user row back from the database, seeds deterministic confirmed, pending-checkout, waitlisted, and checked-in profile event cards with free add-ons where applicable, then asserts the event title, event-detail link, status, guest, add-on, payment, checkout continuation, waitlist routing, ticket-routing, and checked-in no-cancellation/no-transfer labels before taking the Events-section screenshot. It also seeds a deterministic submitted receipt, asserts its filename, submitted status, event title, and amount on the profile Receipts tab, and reads the generated receipt row back from the database.
- `tests/specs/profile/user-profile-events.spec.ts` reuses the same deterministic
  profile event-card seed helper as the generated docs, giving the
  pending-checkout, waitlisted, confirmed, and checked-in states direct
  functional Playwright coverage in addition to product documentation.
- `tests/specs/profile/user-profile-receipts.spec.ts` mirrors the generated
  profile receipts documentation with functional coverage: it seeds a submitted
  receipt, opens the profile receipts tab by fragment, asserts filename,
  submitted status, event context, and amount, reads the persisted receipt row,
  fails explicitly if that row is missing, and cleans it up.
- `src/app/profile/user-profile/edit-profile-dialog.component.spec.ts` covers profile edit payload normalization for notification email and optional global reimbursement details before the update mutation receives the dialog result.
- `tests/specs/profile/user-profile-edit.spec.ts` functionally covers profile
  edit persistence for notification email, IBAN, and PayPal reimbursement
  details, including profile summary refresh, explicit database readback, and
  fixture cleanup.
- `src/app/profile/user-profile/user-profile.component.spec.ts` covers profile event action routing, payment-continuation visibility, guest-quantity, checked-in action copy, implemented-action notes, payment-continuation next-step copy, payment-state, registration-status labels, submitted-receipt status and amount labels, ESNcard action/status labels, ESNcard save disabled state, ESNcard upsert payload normalization, and readable ESNcard mutation error fallback/provider messages. `src/server/effect/rpc/handlers/users.handlers.spec.ts` and the users RPC schema spec now pin purchased add-ons on profile event summaries.
- Profile app coverage also pins that payment continuation links only render for
  pending Stripe Checkout HTTPS URLs, so malformed or unexpected checkout URL
  values fail closed instead of becoming profile-card links.
- Profile app coverage pins that profile edit is disabled while the profile
  update mutation is pending.
- Profile app coverage also pins that ESNcard save, refresh, and remove actions
  all stay disabled while any ESNcard write is pending.
- **Addressed in stabilization pass:** the profile doc no longer uses a fixed stabilization wait before the profile screenshot, now saves and verifies notification email persistence, and opens the Events section to assert and document event-card semantics.
- `tests/docs/profile/discounts.doc.ts` documents the discount-card section and
  current pending/error behavior. Its helper-backed baseline note asserts
  readable ESNcard statuses, save/refresh/remove pending labels, shared
  in-flight write guards, identifier trimming, and provider-unavailable error
  copy without calling the external provider. Its page-backed journey asserts
  the seeded verified ESNcard identifier/status, visible refresh/remove actions,
  and the invalid-card-number save guard. It still does not call the external
  ESNcard provider for live add/refresh/remove outcomes.
- `tests/specs/profile/user-profile-discounts.spec.ts` functionally covers the
  same seeded profile discount-card state from a direct `#discounts` link,
  including verified-card display, refresh/remove action visibility, and the
  invalid-card-number save guard.
- `tests/specs/discounts/esn-discounts.test.ts` verifies a seeded verified ESNcard affects paid event price labels and the register button copy.
- No reviewed Playwright spec proves live profile discount-card
  add/refresh/remove provider outcomes or browser-level account creation
  fallback behavior without Auth0 Management credentials. Local helper/server
  coverage now pins the visible profile/account copy and action states that can
  be verified without page-backed runtime, the create-account docs include a
  baseline helper-backed account-creation note, the discounts docs assert
  helper-backed ESNcard status/pending/error semantics plus seeded
  status/action/invalid-input behavior, the profile discounts spec pins the
  seeded direct-link discount-card journey, and the profile docs journey asserts
  confirmed, pending-checkout, waitlisted, and checked-in profile event-card
  route/status/guest/add-on/payment/checkout/waitlist/ticket/action labels plus
  submitted-receipt visibility. The generated docs and functional
  profile-event spec both pin those seeded card states to their expected
  event-page links so ticket, cancellation, unpaid-transfer, and waitlist
  recovery routing cannot silently drift while Browser runtime review is
  unavailable.
- `tests/docs/users/create-account.doc.ts` includes a baseline helper-backed
  account-creation documentation note for verified-email gating, Auth0-data
  prefill, notification-email terminology, payload trimming, retryable errors,
  and duplicate-submit guards without Auth0 Management credentials. Its live
  Auth0 login/create-account journey remains integration-tagged and skips
  without Auth0 Management credentials.
- `tests/specs/profile/create-account.spec.ts` adds the matching functional
  integration coverage for Auth0-backed tenant account creation: a generated
  Auth0 user signs in, creates the current-tenant account, lands on profile,
  persists notification email/name fields, receives a tenant assignment plus
  default role assignments, and cleans up the created database rows.
- `tests/docs/users/create-account.doc.ts` asserts the account form exposes the editable address as "Notification email" when the integration path can run.
- `src/app/app.routes.spec.ts` pins the relaunch route contract that public event browsing uses only account-assignment checks, feature areas require assigned authenticated accounts, `/create-account` stays auth-only for tenantless authenticated users, and `/global-admin` remains auth-only before tenant assignment checks.
- `src/app/core/create-account/create-account.helpers.spec.ts` covers Auth0-data prefill fallback, explicit email-verification gating, create-account submit payload normalization, retryable submit disabled state, and create-account error message mapping without needing Auth0 Management credentials.
- `src/shared/rpc-contracts/app-rpcs/users.rpcs.spec.ts` covers notification email format validation at the account-creation and profile-update RPC boundary, matching the create-account and profile-edit form validation.
- `src/server/discounts/providers/index.spec.ts` covers ESNcard provider validation parsing and provider-unavailable distinction without hitting the external provider.
- `src/server/effect/rpc/handlers/discounts.handlers.spec.ts` covers global-per-user ESNcard reads, updating an existing global user card from another tenant context, refresh revalidation persistence, provider-outage upsert rejection without mutating the stored card, and current-user/type-scoped card removal.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` covers `users.events` tenant/user scoping, cancelled-registration exclusion, sorting, checkout URLs, check-in timestamps, guest counts, and payment-state mapping, plus `users.findMany` role aggregation, account creation transactionality, existing-global-user tenant joining, duplicate tenant-assignment conflict behavior, profile update persistence, and `users.userAssigned` behavior.

### Product Questions Answered Above

- Should a previously known global user be able to join a tenant automatically after Auth0 login, or should tenant joining require an invite/admin approval flow? Current implementation follows the automatic tenant-join direction for authenticated users who reach account creation.
- What is the intended home-tenant model, and should profile expose or warn about current tenant vs home tenant?
- Is `communicationEmail` a user-managed notification email, and should it differ from Auth0 login email?
- Are payout details global per person or tenant-specific per reimbursement context? Current implementation follows the global-per-person direction for relaunch.
- Are ESNcard records intended to be global per user, tenant-specific, or shared globally by card identifier? Current implementation follows the global-per-user direction while still requiring the current tenant to have ESNcard support enabled before managing or applying the card.
- Which profile event states should users be able to act on from the profile page: payment continuation, ticket QR, cancellation, waitlist, transfer/resale?

### Recommended Cleanup Actions

- Keep Browser-backed profile edit persistence coverage aligned with notification email and global reimbursement-detail behavior.
- Keep Browser-backed profile event-card coverage aligned with route/status/guest/add-on/payment/ticket/check-in labels and rerun it during manual runtime review.
- Add Browser-backed profile discount-card tests for live add/refresh/remove provider validation outcomes once runtime review is available. Local app/server coverage already proves upsert payload normalization, readable mutation errors, global card reads/upserts, refresh persistence, scoped removal, and generated docs assert seeded card display plus invalid-input blocking.
- Add Browser-backed profile/account coverage for account creation retry/tenant-join behavior, profile edit persistence, ESNcard add/refresh/remove, and profile event action rendering once local runtime review is available. Local helper/server coverage already covers account creation retry/tenant join, profile edit payload persistence, ESNcard action labels/errors/payloads, profile event labels/actions, and submitted receipt status/amount/server rows; generated profile docs now assert submitted receipt visibility.

## Tenant/Global Admin

### Current Behavior

- Tenants are resolved from request host first. On local hosts, the `evorto-tenant` cookie can select the tenant domain; otherwise the host domain is authoritative.
- If tenant resolution fails, SSR and RPC requests fail closed with a 404. A local probe with `Host: no-such-tenant.invalid` returned 404.
- Tenant records currently store one unique `domain`, name, currency, locale, timezone, theme, default location, Stripe account id, receipt settings, discount provider settings, SEO title/description, tenant legal links, hosted legal text, and app-origin or externally hosted logo/favicon URLs.
- Client config loads the current tenant and permission list through RPC and applies `theme-${tenant.theme}` to the document root.
- Tenant admin "General settings" shows a read-only identity summary with tenant name, primary domain, currency, locale, timezone, and Stripe connection state including the connected account id when configured. It lets tenant admins change default location, site theme, uploaded or externally hosted logo/favicon URLs, SEO title/description, legal links or hosted legal text, receipt countries/allow-other, and ESNcard provider enablement plus buy URL. Configured legal URLs appear in the public app footer as off-site links; configured hosted legal text appears through public `/legal/*` pages. Configured favicon URLs update the browser tab icon.
- Tenant settings writes are tenant-scoped and require `admin:changeSettings`; tax-rate admin reads/writes require `admin:tax`.
- `/global-admin` is guarded by authentication at the app route and by `globalAdmin:manageTenants` in the global-admin route config. The navigation link is hidden behind `globalAdmin:*`, and the tenant list RPC requires `globalAdmin:manageTenants`.
- Global admin currently exposes a searchable tenant list, tenant create/edit flows for the one active primary domain and operational tenant settings, and tenant detail review with non-sensitive operational tenant state. Custom-domain verification, multi-domain automation, and impersonation remain deferred.
- Global-admin permissions are derived from Auth0 app metadata `evorto.app/app_metadata.globalAdmin === true` independently from current-tenant membership. Tenant user context still requires a current-tenant assignment.
- Anonymous direct `/global-admin` redirects to Auth0. Stored auth states were stale, so authenticated global-admin UI was not reverified through Playwright in this pass.

### Intended Behavior From Product Context

- Tenants own events, templates, roles, registrations, settings, branding, legal/privacy configuration, and payment-related tenant configuration.
- Tenants are resolved by domain, including Evorto-provided subdomains and custom domains. Unknown domains should fail closed or show tenant-not-found.
- Users are global and may belong to multiple tenants; home tenant support is desirable.
- Admins configure tenant settings, roles, legal pages, branding, payment settings, review/publishing behavior, and financial workflows.
- Global/admin workflows should remain permission-safe, tenant-safe, SSR-safe, and discoverable through the UI.

### Issues and Risks

- **Addressed in stabilization pass:** root product and architecture docs now state the relaunch domain scope honestly: one active primary domain per tenant, with automated multi-domain/custom-domain verification deferred to later tenant-onboarding work.
- **Addressed in stabilization pass:** tenant general settings now expose tenant name, primary domain, and Stripe connection state as read-only operator context.
- **Addressed in this stabilization pass:** tenant general-settings identity rows now include the connected Stripe account id when present, matching the support lookup detail already exposed in global-admin tenant review.
- **Addressed in stabilization pass:** tenant general settings now include a visible deferred-settings summary for custom-domain verification, email sender name, review/publishing settings, registration limits, and Stripe account management. These fields are still not editable unless explicitly called out below.
- **Addressed in this stabilization pass:** supported tenant currency, locale, and timezone values are now editable from general settings, persisted through `admin.tenant.updateSettings`, and validated against the shared Tenant relaunch policy before the RPC responds.
- **Addressed in this stabilization pass:** general settings reloads the app after saved currency, locale, or timezone changes so Angular's bootstrap-level currency and locale providers are refreshed instead of leaving the current session on stale formatting defaults.
- **Addressed in stabilization pass:** tenant logo and favicon URLs are now part of the `Tenant` RPC schema, editable from general settings, validated by `admin.tenant.updateSettings`, persisted with empty values normalized to `null`, and the configured favicon updates the browser tab icon.
- **Addressed in stabilization pass:** tenant logo and favicon uploads now use the app's object-storage path and return stable app-origin `/tenant-assets/*` URLs that can be saved through the existing tenant settings form. Logo uploads accept PNG, JPEG, WebP, or GIF files; favicon uploads also accept ICO files. SVG uploads stay unsupported for this path.
- **Addressed in this stabilization pass:** tenant logo and favicon upload actions now stay disabled while any brand asset upload is active or the upload mutation is pending, and duplicate file-change events are ignored instead of starting another upload.
- **Addressed in stabilization pass:** tenant SEO title and description are now part of the `Tenant` RPC schema, editable from general settings, persisted by `admin.tenant.updateSettings`, and used as the tenant-level document title/meta description when configured.
- **Addressed in stabilization pass:** tenant imprint/legal notice, privacy policy, and terms URLs are now part of the `Tenant` RPC schema, editable from general settings, validated by `admin.tenant.updateSettings`, persisted with empty values normalized to `null`, and rendered in the public app footer when configured.
- **Addressed in stabilization pass:** tenant-admin child routes now have route-level guards. Settings require `admin:changeSettings`, roles require `admin:manageRoles`, users require `users:viewAll`, tax rates require `admin:tax`, and event reviews require `events:review`.
- **Addressed in stabilization pass:** tenant settings saves now show a success notification and map failed updates through the shared readable error-message helper instead of relying only on mutation state.
- **Addressed in this stabilization pass:** tenant general-settings save actions now stay disabled while the update mutation is pending, and the submit handler ignores duplicate submit events during the in-flight settings write.
- **Addressed in stabilization pass:** tenant general-settings documentation now covers the implemented relaunch surface and explicitly calls out deferred custom-domain automation, email sender, review policy, registration limit, and Stripe-account settings.
- **Addressed in stabilization pass:** tenant-hosted legal text is now editable alongside external legal URLs. The public footer links to external URLs when configured, otherwise it links to hosted `/legal/imprint`, `/legal/privacy`, and `/legal/terms` pages when tenant text exists.
- **Addressed in stabilization pass:** the tenant settings RPC payload schema is now exported and covered by a focused contract spec, including the current editable fields and the fact that deferred custom-domain automation, email sender, review policy, registration limit, and Stripe account-management fields are outside the update payload.
- **Addressed in stabilization pass:** tenant general-settings payload shaping is now extracted and covered locally, including trim/blank normalization for editable URLs/SEO/ESNcard fields before the RPC call.
- **Addressed in stabilization pass:** the global-admin tenant list and read-only detail page render the tenant operational state returned by the RPC, including connected Stripe account ids for support lookup, and generated docs describe the current searchable list plus detail-review global tenant administration surface.
- **Addressed in stabilization pass:** global-admin tenant create/edit now supports the relaunch one-domain tenant administration surface: name, primary domain, theme, locale, currency, timezone, and connected Stripe account id.
- **Addressed in stabilization pass:** global-admin tenant create/edit normalizes the primary-domain form value to the same single-host shape enforced by the server and keeps the one-domain/custom-domain-automation deferral visible in the form.
- **Addressed in stabilization pass:** global-admin tenant create/edit now rejects duplicate primary domains with an explicit RPC bad-request error before relying on the database unique constraint, while allowing updates that keep the current tenant's own domain.
- **Addressed in this stabilization pass:** global-admin tenant create/edit now
  shows the relaunch tenant scope as a visible form notice: one active primary
  domain, deferred custom-domain verification and multi-domain automation, and
  no tenant-admin impersonation in the current relaunch surface.
- **Addressed in this stabilization pass:** generated-docs source coverage now
  keeps the global-admin tenant-management guide aligned with the one-domain,
  deferred custom-domain automation, and no-impersonation relaunch scope.
- **Addressed in stabilization pass:** global-admin tenant create/edit submit
  actions now stay disabled while the create/update mutation is pending and
  the submit handlers ignore duplicate submit events during the in-flight
  mutation.
- **Acceptable for now:** tenant settings writes are scoped to the current tenant id and validate the returned tenant shape before responding.
- **Acceptable for now:** unknown host requests fail closed with 404 instead of guessing a tenant.
- **Acceptable for now:** RPC request-context headers are overwritten server-side before handler execution, so client-supplied `x-evorto-*` headers are not trusted as the source of tenant/user context.

### Test and Documentation Quality

- `src/server/context/tenant-schema.spec.ts` covers tenant schema defaults and RPC header serialization around optional default location.
- `src/server/effect/rpc/handlers/middleware/rpc-request-context.middleware.spec.ts` covers decoding RPC context headers, including tenant and permissions.
- `src/app/core/effect-rpc-angular-client.spec.ts` covers SSR RPC origin selection from incoming URL and forwarded headers.
- `tests/specs/auth/storage-state-refresh.test.ts` covers stale/wrong tenant cookies in saved Playwright storage state, not runtime tenant resolution.
- `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts` checks seeded tenant tax-rate isolation directly in the database, but does not exercise the RPC/UI tenant context switch.
- `tests/specs/permissions/matrix.spec.ts` covers route denial for `/admin/settings`, `/admin/roles`, `/admin/users`, `/admin/tax-rates`, `/finance/transactions`, `/finance/receipts-approval`, `/finance/receipts-refunds`, and template write routes. `tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts` adds focused tax-rate route denial coverage. Route-manifest unit specs cover admin, finance, template, and global-admin guard declarations without requiring page-backed runtime. `tests/specs/permissions/global-admin-route-guard.spec.ts` covers direct `/global-admin`, `/global-admin/tenants/create`, `/global-admin/tenants/:tenantId`, and `/global-admin/tenants/:tenantId/edit` allow/deny behavior once page-backed runtime is available.
- `helpers/testing/permission-matrix-source.spec.ts` keeps finance
  route-denial cases aligned with the guarded finance route manifest, including
  the transaction list, receipt approval list/detail, and reimbursement routes.
- `tests/docs/admin/general-settings.doc.ts` documents the current tenant general-settings page, including the deferred-settings summary, read-only tenant identity summary with Stripe account support lookup detail, editable locale/money policy plus reload behavior, uploaded or externally hosted brand asset URLs, editable tenant legal links or hosted text, and public footer/favicon exposure, and records which domain/operations settings are not editable yet.
- `tests/specs/admin/general-settings.spec.ts` functionally covers tenant
  general-settings persistence for editable brand asset URLs, SEO copy, hosted
  legal text, external legal URLs, receipt-country settings, and ESNcard
  provider buy-link settings with explicit database readback.
- `tests/docs/admin/global-admin.doc.ts` documents the current searchable
  global-admin tenant list, tenant create/edit workflow, visible relaunch
  tenant-scope notice, and tenant detail review, pins the list/create/detail/edit
  navigation targets plus the external tenant-domain link, reads the documented
  tenant row from the database before asserting operational fields, and records
  that custom-domain verification, multi-domain automation, and impersonation
  workflows are not implemented yet.
- `helpers/testing/generated-docs-source.spec.ts` keeps the global-admin guide
  aligned with the one-domain/no-impersonation relaunch scope. It also keeps
  profile/account docs aligned with implemented notification-email semantics,
  global reimbursement details, event-card routing/check-in copy, submitted
  receipt visibility, account-creation retry errors, and existing-global-user
  tenant joins.
- `tests/docs/finance/inclusive-tax-rates.doc.ts` documents tenant tax-rate management.
- `src/app/admin/components/import-tax-rates-dialog/import-tax-rates-dialog.component.spec.ts` covers the local Stripe tax-rate import guard so empty selections and pending imports cannot submit duplicate tax-rate writes.
- `src/shared/rpc-contracts/app-rpcs/admin.rpcs.spec.ts` covers the tenant settings update payload scope.
- `src/app/admin/general-settings/general-settings.payload.spec.ts` covers the client-side tenant-settings payload sent by the form, including trimmed optional editable fields and blank-to-undefined normalization.
- `src/app/admin/general-settings/general-settings.component.spec.ts` covers
  tenant settings save disabling for invalid, submitting, and mutation-pending
  states, plus brand-asset upload disabling while any upload is active or
  mutation-pending.
- `src/app/global-admin/global-admin.routes.spec.ts` covers route-level global-admin permission requirements for list, create, detail, and edit routes.
- `src/app/global-admin/tenant-form/tenant-form.model.spec.ts` covers create/edit payload shaping, including primary-domain normalization and path rejection before the RPC call, plus disabled submit state for invalid, submitting, and mutation-pending tenant writes.
- `src/server/effect/rpc/handlers/global-admin.handlers.spec.ts` covers server-side primary-domain normalization, duplicate-domain rejection before create mutation, and same-domain edit allowance for the one-domain relaunch workflow.
- `src/app/global-admin/tenant-list/tenant-list.rows.spec.ts` covers global-admin tenant operational rows, readable Stripe account labels, and search across support fields including connected Stripe account ids.
- `src/app/global-admin/tenant-detail/tenant-detail.component.spec.ts` covers
  the tenant-domain external-link helper so malformed legacy tenant domains fail
  closed instead of becoming "Open tenant domain" links.
- `src/server/effect/rpc/handlers/global-admin.handlers.spec.ts` covers explicit `globalAdmin:manageTenants` authorization, `globalAdmin:*` dependency authorization, tenant create/update normalization, and fail-closed forbidden/unauthorized tenant-list reads before querying tenants.
- `src/server/context/request-context-resolver.spec.ts` covers host-first tenant resolution, localhost tenant-cookie fallback, stale localhost tenant-cookie fallback, unknown-host failure, global-admin permissions resolving without a tenant user assignment, and tenant-user context failing closed when the Auth0 user has no current-tenant assignment.
- `tests/specs/admin/roles-management.spec.ts` functionally covers the current
  admin user-list review surface and role create/edit flow, including
  permission dependency display and explicit create/edit database readbacks.
- Playwright browser probing was limited because the bundled Playwright browser was not installed and stored auth states were stale; system Chrome confirmed anonymous/global-admin redirects to Auth0.

### Product Questions Answered Above

- Should global admins be independent platform principals, tenant users with special metadata, or tenant users plus a separate platform-role table?
- Can a global admin administer tenants before being assigned to the current tenant? Current implementation allows global-admin permissions from Auth0 app metadata without requiring a tenant assignment.
- Should tenants support multiple domains, and how should custom domain verification/ownership be modeled? Answered locally for relaunch: no automated multi-domain management yet; each tenant has one active primary domain.
- What is the minimum relaunch scope for tenant branding/legal settings versus later tenant onboarding work?
- Should tenant currency/locale/timezone be editable after payment/event data exists?
- Should global admin be able to create tenants, edit domains/settings, impersonate tenant admin views, or only list tenants for support?

### Recommended Cleanup Actions

- Keep one-domain-per-tenant documented and visible as the relaunch scope; leave
  automated multi-domain/custom-domain management for later work.
- Keep generated global-admin tenant-management documentation aligned as tenant create/edit, custom-domain verification, multi-domain automation, or impersonation support changes.
- Keep tenant settings save feedback aligned with the shared notification/error-message pattern.
- Keep tenant settings save guards aligned with the actual mutation lifecycle,
  not only the signal-form submit callback.
- Keep tenant SEO title/description, legal links, and hosted legal text aligned between the Tenant RPC schema, general settings, public footer/pages, and generated documentation.
- Keep tenant brand-asset upload guards aligned with the actual upload mutation lifecycle, not only the visible upload button state.

## Generated Documentation and Playwright Coverage

### Current Behavior

- Playwright has separate baseline spec, baseline docs, and integration-only
  projects. Baseline specs exclude `tests/docs/**`; docs baseline runs
  `tests/docs/**/*.doc.ts`; integration-only specs/docs are selected with
  `@needs-*` tags.
- Local docs/spec discovery is runnable again after replacing stale Effect config APIs in `playwright.config.ts` and Playwright support files, and Auth0 Management credentials are no longer required just to import baseline fixtures.
- `bun run test:e2e -- --list` discovers 101 baseline tests across 34 files,
  including setup projects, without requiring local Auth0/Stripe secrets.
- `bun run test:e2e:docs -- --list` discovers 30 baseline docs/setup tests
  across 19 files without requiring local Auth0/Stripe secrets.
- `bun run test:e2e:integration -- --list` discovers 9 setup/integration tests
  across 4 files: the Auth0 Management account-creation functional spec and
  generated doc plus shared setup projects.
- The custom documentation reporter writes grouped Markdown pages and image assets to paths from `DOCS_OUT_DIR` / `DOCS_IMG_OUT_DIR`, defaulting to ignored repository-local `test-results/docs` paths.
- The reporter initializes and clears docs/image output roots on `onBegin` only for real test execution. During Playwright `--list` discovery it no-ops and does not clean or write docs output.
- Reporter-path tests pass with `bun run test:e2e -- tests/specs/reporting/reporter-paths.test.ts --no-deps`.
- The focused screenshot helper test cannot currently run here with the default
  browser channel because the configured Playwright Chromium binary is missing;
  exploratory local runs can opt into system Chrome with
  `E2E_BROWSER_CHANNEL=chrome`.

### Intended Behavior From Product Context

- Generated documentation should reflect real product workflows and should not describe unimplemented UI.
- Browser/manual exploration is useful for discovery, while Playwright is the durable layer for regressions and generated documentation.
- Documentation and tests should stay lightweight and operational, not become a heavyweight requirements matrix.
- Product-critical flows should be discoverable for users and repeatable for future agents.

### Issues and Risks

- **Addressed in stabilization pass:** `tests/specs/events/price-labels-inclusive.spec.ts` now replaces the old placeholder/fixme declarations with real page-level UI assertions backed by seeded event and template data.
- **Must fix before agent scaling:** some specs still intentionally skip for integration credentials or explicit deferred coverage, but the known misleading fixture-state examples from this pass now fail loudly when expected seeded state is missing: receipt approval/refund rows, receipt dialog options, unlisted-event seed state, event-creation setup, scanner preconditions, regular-user registration tenant setup, template icons, and template role autocomplete.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts` now documents the current event details, registration, review/listing, organizer overview, participant grouping, and receipt surfaces instead of stale attendee export, attendee messaging, settings, tags, featured images, notifications, integrations, or deletion flows.
- **Addressed in stabilization pass:** `tests/docs/finance/finance-overview.doc.ts` now documents the current finance permission split and transaction/receipt navigation behavior.
- **Addressed in stabilization pass:** Playwright discovery was broken by stale Effect config APIs and by import-time Auth0 Management config reads in baseline fixtures. Both are fixed locally, but they show the e2e/docs surface was not being exercised recently enough.
- **Addressed in stabilization pass:** list-only Playwright commands no longer initialize docs output, clear generated docs/image directories, or require Auth0 Management credentials for baseline fixture imports.
- **Addressed in stabilization pass:** list-only Playwright config now uses inert placeholder values for runtime-only Auth0/Stripe secrets, so docs/spec discovery can enumerate tests without local secret stubs, starting Docker, or contacting external services.
- **Addressed in stabilization pass:** participant-facing event registration cards now receive tax-rate label metadata from `events.findOne`, render paid option prices through the shared inclusive tax label component, and have page-level Playwright assertions for the seeded inclusive-price states.
- **Addressed in stabilization pass:** page-backed Playwright specs no longer
  depend only on a bundled Chromium download for local exploratory runs.
  Bundled Chromium remains the default browser channel, but
  `E2E_BROWSER_CHANNEL=chrome` can use system Chrome on hosts where it is
  installed. In this checkout, full page-backed execution is still blocked by
  missing runtime secrets until `NEON_API_KEY`, `CLIENT_SECRET`, and
  `STRIPE_API_KEY` are provided.
- **Addressed in stabilization pass:** `tests/test-inventory.md` now maps current Playwright specs/docs by suite ownership, records intentional fixme and credential-gated paths, and lists the Browser-backed coverage still needed from the remaining stabilization gaps.
- **Addressed in stabilization pass:** the remaining `test.skip` audit removed the dead mobile skip from `tests/specs/permissions/override.test.ts`, corrected the inventory entry for that spec, made the Auth0 Management doc skip name the required credentials explicitly, moved Stripe webhook replay's credential gate to a file-level skip before page/database fixtures are requested, and keeps the skip/fixme allowlist tied to explicit local reasons.
- **Addressed in stabilization pass:** global-admin route guard coverage now has a direct Playwright spec for the global-admin allow path and signed-in non-global-admin deny path.
- **Addressed in stabilization pass:** global-admin tenant workflow coverage now
  has a functional Playwright spec for tenant list filtering, no-match state,
  operational row fields, connected Stripe-account support lookup, tenant
  detail review, create/edit form relaunch-scope copy, disabled empty create
  submit, and enabled seeded edit submit.
- **Addressed in stabilization pass:** tenant-admin role/user management now has
  a functional Playwright spec for read-only user review, role create/edit,
  dependent permission persistence, hub-display flags, role details, and DB
  readback.
- **Addressed in stabilization pass:** finance overview navigation now has
  functional Playwright coverage proving each finance child link is shown only
  when the current user has the matching finance permission.
- **Addressed in stabilization pass:** profile edit persistence now has a
  functional Playwright spec that saves notification email plus global
  reimbursement fields, verifies the refreshed profile summary, reads the
  persisted user row, and restores the original fixture data.
- **Addressed in stabilization pass:** create-account now has a
  credential-gated functional Playwright spec alongside the generated
  documentation journey, covering a generated Auth0 user creating a tenant
  account, landing on profile, persisted account fields, tenant/default-role
  assignment, and cleanup.
- **Addressed in stabilization pass:** scanning/check-in docs now describe the dedicated QR scanner, scan warnings, authorization, checked-in count updates, and selected guest-quantity check-in. The remaining scanner follow-up is manual Browser-backed runtime review, not missing automated aggregate coverage or product documentation.
- **Addressed in stabilization pass:** scanner Playwright coverage now includes
  the partial guest-arrival case where the buyer and one guest were already
  checked in, then a later scan records the remaining guest without re-counting
  the buyer.
- **Remaining runtime review:** live provider-backed profile discount add/refresh/remove outcomes still need Browser review once local runtime and provider credentials are available. Local docs/spec coverage now pins seeded verified-card display, direct `#discounts` routing, refresh/remove action visibility, invalid-input blocking, readable statuses, pending labels, shared write guards, and provider-unavailable retry copy without calling the external provider.
- **Addressed in stabilization pass:** the generic `tests/docs/template.doc.ts` discovery placeholder was removed; current template documentation lives in `tests/docs/templates/templates.doc.ts`.
- **Addressed in stabilization pass:** the focused `docScreenshot` helper now
  resolves `DOCS_IMG_OUT_DIR` at call time instead of import time, so tests and
  docs jobs can set output paths per run.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts` now waits on concrete headings instead of fixed one-second delays before its major screenshots.
- **Addressed in stabilization pass:** Playwright inventory coverage now rejects
  fixed `.waitForTimeout(...)` waits in specs and generated docs, so future
  docs/specs must wait on concrete UI state instead of reintroducing
  time-based sleeps.
- **Addressed in stabilization pass:** required `@track`, `@req`, and `@doc`
  title metadata was removed from the custom Playwright lint rule and the rule
  was dropped. Test guidance now prefers clear behavior-oriented titles without
  forcing placeholder metadata.
- **Addressed in stabilization pass:** real Playwright spec/doc titles no
  longer carry placeholder `@track`, `@req`, or `@doc` metadata. Semantic tags
  such as `@finance`, `@admin`, `@permissions`, and `@stripe` remain for
  filtering and inventory, and reporter fixture strings still exercise legacy
  tag stripping.
- **Acceptable for now:** the documentation reporter has focused tests for output paths, cleanup, grouping, and permissions callouts.
- **Acceptable for now:** deterministic seed helpers and scenario handles exist; the issue is where specs turn missing seeded state into skips or no-op passes.

### Test and Documentation Quality

- Generated docs are valuable but currently mix real walkthroughs with aspirational copy. Future agents need stale docs removed or clearly marked before treating docs as product truth.
- The docs suite favors screenshots and prose, but many docs do not assert that the workflow was completed or persisted.
- Some functional specs have strong names and tags but weak assertions. These are more dangerous than absent tests because they imply coverage.
- Integration-only docs are correctly taggable, but baseline docs should still cover account/profile/tenant flows that do not require Auth0 Management or external APIs.
- Normal local docs output now stays in this repository's ignored
  `test-results/docs` paths. Publishing into the sibling documentation checkout
  is intentionally explicit through `bun run test:e2e:docs:publish`.

### Product Questions Answered Above

- Should generated documentation be checked into this repository, the sibling documentation app, or treated only as generated CI artifacts?
- Which generated docs are product-facing and must be accurate before relaunch, versus internal examples for agent/testing workflows?
- Should list/discovery commands run reporters at all, or should docs generation be a separate explicit command?
- Should required `@req` / tracking-style Playwright tags be removed?
- What is the minimum durable Playwright coverage for relaunch across registration, finance, scanning, roles, tenant admin, and profile flows?

### Recommended Cleanup Actions

- Keep active price-label specs aligned with seeded event and template tax-rate data as price display behavior changes.
- Keep event-management and finance-overview docs aligned as the live UI changes; both were rewritten during this stabilization pass and should not be treated as stale product truth.
- Continue auditing remaining `test.skip` usage so credential/integration skips stay honest and fixture-state gaps become hard failures or explicit, reason-recorded `test.fixme` states.
- Keep Playwright specs and generated docs waiting on concrete UI states rather
  than fixed sleeps.
- Keep docs/list commands free of reporter output cleanup, runtime secret requirements, and local browser startup.
- Update `tests/test-inventory.md` after stale/placeholder docs are pruned.
- Add missing docs/specs for tenant/global-admin settings, account/profile persistence, role/user management, and negative registration paths as those flows are stabilized.

## Local Runtime/Developer Workflow

### Current Behavior

- The repo is Bun-first. `packageManager`, the Docker base image, local Bun, and CI setup now agree on Bun `1.3.11`.
- Important entrypoints remain visible in `package.json`: app build/dev, unit tests, Playwright e2e/docs, Docker stack start/resume/webServer/stop, database commands, dependency updates, Stripe/Sentry ops, theme generation, and receipt-image cleanup.
- Local runtime config uses `.env.dev.local` for tracked shared defaults, `.env.dev` for generated worktree-specific values, and `.env` for untracked developer secrets.
- `bun run env:runtime` writes `.env.dev` with worktree-specific `COMPOSE_PROJECT_NAME`, Neon Local port, MinIO ports, `BASE_URL`, and local `DATABASE_URL`.
- Local `test:e2e`, `test:e2e:ui`, `test:e2e:integration`,
  `test:e2e:docs`, `db:*`, and `docker:*` scripts now refresh `.env.dev`
  before running `dotenv -c dev`, reducing fresh-worktree and wrong-database
  risk.
- Docker Compose uses Neon Local, MinIO, Stripe CLI, a one-shot `db-setup` service, and an `evorto` app container. `bun run docker:check` verifies required local secrets before any Docker start command tears down or starts containers, and now also reports Bun, Docker Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright browser-cache readiness.
- `bun run build:app`, `bun run test:unit -- --watch=false`, and `bun run test:unit:server` pass in the current checkout.
- Playwright test discovery works through the package scripts without local
  Auth0/Stripe secrets, but full page-backed Playwright execution still
  requires installing the matching browser binaries and providing runtime
  secrets.
- The shell has another `dotenv` binary earlier on `PATH`; bare `dotenv -c dev` fails, while package scripts and `node_modules/.bin/dotenv -c dev` work.

### Intended Behavior From Product Context

- Future agents should be able to find the correct local command without reconstructing workflow rules from chat history.
- Local runtime setup should be deterministic, worktree-safe, tenant-safe, and hard to accidentally point at shared/remote state.
- Verification commands should be honest: each script should own a clear slice of tests and should not hide stale, duplicate, or misleading coverage.
- Documentation should stay lightweight, operational, and close to the code or workflow it governs.

### Issues and Risks

- **Must fix before agent scaling:** fixed in this pass: `bun run test:unit` previously let Angular's unit-test builder discover server/database specs that belong to `test:unit:server`, causing a hard compile failure before the fix and noisy duplicate bundling after only narrowing `tsconfig.spec.json`.
- **Must fix before agent scaling:** fixed in this pass: local destructive/runtime scripts could run without first generating `.env.dev`, which made fresh worktrees dependent on stale or missing local runtime overrides and increased wrong-database risk.
- **Must fix before agent scaling:** fixed in this pass: local docs did not expose a package script for installing Playwright browser binaries even though page-backed Playwright specs fail without them.
- **Addressed in this stabilization pass:** docs generation defaults resolve to ignored repository-local `test-results/docs` paths unless explicitly overridden, and the documentation reporter now skips output cleanup/writes during Playwright `--list` discovery.
- **Addressed in stabilization pass:** CI e2e docs no longer skip `@finance` docs in the baseline docs run, so rewritten finance docs participate in the normal documentation artifact.
- **Addressed in stabilization pass:** Playwright `webServer` now runs
  `docker:webserver`, a foreground Compose command that keeps the preflight and
  build/start behavior but does not force `docker compose down` first.
- **Addressed in stabilization pass:** `bun run docker:resume` now provides a non-recreating resume path for an already initialized Docker stack, while `docker:start`, `docker:start:foreground`, and `docker:start:watch` keep the explicit reset-from-zero behavior.
- **Addressed in this stabilization pass:** `bun run docker:check` reports missing Neon Local, Auth0, Stripe, session, and Font Awesome registry variables before Docker Compose mutates local containers. Docker now writes the same Font Awesome registry scopes as the checked-in `.npmrc`, so premium and brand icon packages can use the same build-secret token path. It also reports local tool readiness and warns when Playwright browsers are missing without blocking Docker start. The Compose-managed Stripe CLI listener writes its generated webhook signing secret into a shared volume and the app reads it through `STRIPE_WEBHOOK_SECRET_FILE`, so a static `STRIPE_WEBHOOK_SECRET` is no longer a Docker-start blocker. The current worktree is missing `NEON_API_KEY`, `CLIENT_SECRET`, and `STRIPE_API_KEY`, so a fresh full Docker start is intentionally blocked until those secrets are provided.
- **Addressed in stabilization pass:** Playwright local runs now default to the
  bundled Chromium channel while allowing `E2E_BROWSER_CHANNEL=chrome` for
  exploratory system-Chrome runs. `docker:check` reports the system Chrome path
  instead of warning about a missing bundled Chromium cache when that opt-in is
  active.
- **Addressed in stabilization pass:** `bun run test:e2e:integration` now
  exposes the credential-gated `local-chrome-integration` and
  `docs-integration` projects as a first-class package script, so generated
  Auth0 Management account-creation docs and functional integration coverage
  can be run without reconstructing project arguments.
- **Addressed in stabilization pass:** when bundled Playwright Chromium is
  missing but system Chrome is installed, `docker:check` now points local
  exploratory runs at `E2E_BROWSER_CHANNEL=chrome` instead of only recommending
  the network-heavy browser install path.
- **Addressed in stabilization pass:** `helpers/testing/runtime-preflight.spec.ts` now pins that destructive Docker start scripts call `docker:check` first, required runtime variables are wired into Compose services, and Font Awesome registry access remains available to Docker through the same secret path for premium and brand icon packages.
- **Addressed in this stabilization pass:** remaining Angular Material icon usage for app action icons was removed from the role, event-review, template-list, and template-category surfaces. App source coverage now keeps Angular app icons on the Font Awesome component path, so premium and brand icon packages continue using the same package/token mechanic instead of a separate Material icon registry path.
- **Addressed in stabilization pass:** `specs/seed/seed-baseline.test.ts` now treats the reset-from-zero seed as a runtime contract: default user/organizer roles, every template seed family, paid/free registration options, paid tax-rate wiring, open/closed/draft/past scenario handles, confirmed registrations, and scanner aggregate data must all exist after seeding.
- **Addressed in stabilization pass:** `.env.example` is now a checked-in
  no-secret checklist for Docker-required local secrets, and runtime preflight
  tests keep it aligned with the variables that `docker:check` validates. The
  failing preflight message points developers at the checklist before asking
  them to add missing values to `.env` or the shell environment.
- **Addressed in stabilization pass:** local workflow guidance now consistently routes developers through `bun run ...` package scripts or `node_modules/.bin/dotenv -c dev -- ...` for direct external-tool calls. The server config guidance no longer treats unsupported `.env.local` as part of the normal local dotenv contract.
- **Acceptable for now:** keeping core commands visible in `package.json` makes the workflow easier for agents than hiding orchestration in helper wrappers.
- **Acceptable for now:** `.env.dev` is ignored and generated per worktree, while `.env.dev.local` remains tracked for shared defaults.
- **Acceptable for now:** Docker Compose config validates with the local dotenv-cli path without starting services, even when local secrets are absent.

### Test and Documentation Quality

- Root, test, helper, and config docs now agree that local runtime scripts refresh `.env.dev`, use `dotenv -c dev`, and provide a non-mutating Docker preflight.
- The Angular unit-test target now has explicit app/shared discovery ownership; server/db/helper specs remain covered by Vitest through `test:unit:server`.
- The generated-docs pass already records stale docs and placeholder Playwright coverage; the workflow pass removed the list-mode docs-output mutation risk.
- CI and local setup both install or expose Playwright browser installation, and
  local exploratory runs can opt into system Chrome with
  `E2E_BROWSER_CHANNEL=chrome`. Full local e2e still was not run because it
  would start/reset the Docker runtime; bundled Chromium runs still need
  `bun run test:e2e:install` when the matching browser cache is absent.

### Product Questions Answered Above

- Should generated docs output default to this repository's ignored `test-results/docs` locally, with publishing to `evorto-pages` handled by an explicit docs-publish flow?
- Should `docker:start` keep resetting local database state on every start, or should there be separate reset and non-reset local server commands?
- Should finance docs remain excluded from CI docs baseline until the finance behavior is stabilized, or should they fail loudly now? Answered locally: include them in the baseline docs run now that the finance overview documentation has been rewritten to current behavior.
- Should Playwright use bundled Chromium only, or should local development prefer a system Chrome channel when available?

### Recommended Cleanup Actions

- Keep docs publishing explicit if `evorto-pages` output is needed; normal local docs output stays in ignored `test-results/docs`.
- Keep `docker:resume` scoped to already initialized detached stacks, keep
  `docker:webserver` as Playwright's foreground non-teardown command, and use
  the destructive `docker:start*` scripts when seeded-from-zero behavior matters.
- Keep rewritten finance docs in the CI docs baseline unless a future integration-only dependency is introduced and explicitly tagged.
- Keep `package.json` as the visible command surface and avoid moving core workflow commands into hidden helper CLIs.

## Prioritized Cleanup Backlog

### Must Fix Before Agent Scaling

1. Keep product-facing generated docs free of placeholder metadata and stale
   claims before agents treat generated docs as product truth. Profile/account
   docs now document the current notification email, ESNcard, receipt, and
   event-card behavior; the profile doc now asserts confirmed event-card
   route/status/guest/add-on/payment/ticket labels. Remaining profile/account
   gaps are Browser-backed or Auth0-management-gated coverage, not known
   placeholder doc titles.
2. Keep the Playwright skip/fixme inventory guard current whenever an
   intentional credential gate or Browser-backed placeholder changes.
3. Keep server-side template permission, validation, and route-guard coverage in place as template behavior expands beyond simple mode.
4. Keep role lookup APIs lookup-only for event/template eligibility flows; do not re-expose admin role-management data to organizers.
5. Keep admin, finance, global-admin, and template direct-route denial coverage current as route trees change.
6. Keep `tests/test-inventory.md` aligned whenever placeholder specs/docs are removed or reclassified.

### Should Fix Before Relaunch

1. Implement paid transfer/resale money movement, resale-specific workflows, and automatic refund handling. Participant and organizer-assisted unpaid transfer now exist for confirmed, not checked-in registrations.
2. Run the active negative-registration Playwright coverage once local runtime
   is available; `specs/events/negative-registration-states.spec.ts` now covers
   closed registration windows, role-ineligible direct links, and waitlist
   affordances.
3. Keep simple-mode templates as the primary authoring UI, but expand reusable
   template support for discounts, add-ons, and questions where practical.
   Organizer planning tips are now exposed as the first private organizer-notes
   field, existing reusable template add-ons are now visible on template detail,
   simple template create/edit can persist reusable add-ons, and event creation
   copies reusable add-ons into event-scoped read-model records. Simple
   template create/edit can now persist reusable registration questions, show
   them on template detail, and copy them into event-scoped read-model records.
   Event registration and waitlist writes now collect/persist submitted
   question answers. Registration-time add-on purchase is now part of
   registration checkout, while standalone before-event and during-event add-on
   sales remain separate fuller product/runtime slices.
4. Run manual Browser-backed scanner/organizer aggregate review once local runtime is available. The page-backed scanner spec now asserts that the checked-in aggregate changes after buyer-plus-guest check-in.
5. Run Browser-backed profile coverage for payment-continuation, ticket/cancellation routing, waitlist messaging, and ESNcard provider failure semantics once local runtime is available. The generated user-profile doc now seeds and asserts the pending-checkout, waitlisted, confirmed, and checked-in event-card states; live runtime execution remains blocked by missing local secrets.
6. Fill the remaining tenant settings implementation gap for automated onboarding/domain workflows. The current general-settings page exposes SEO fields, uploaded or externally hosted logo/favicon URLs, tenant legal links or hosted legal text, editable supported locale/currency/timezone values, read-only runtime identity, and a visible deferred-settings summary. The current global-admin surface supports a searchable tenant list, tenant create/edit, and tenant detail review, while custom-domain verification, multi-domain automation, and impersonation remain out of scope.
7. Keep `docker:start` reset behavior intentional, use `docker:resume` only for existing local stacks, and ensure seeded data is sufficient to get going from zero.

### Acceptable For Now

1. Server-side edit locks are duplicated with UI guards; keep until broader event authorization is reviewed.
2. Browser walkthrough coverage for anonymous event browsing is enough for this first pass; authenticated manual behavior should be revisited after server preconditions are fixed.
3. Rich seeded demo data is useful even if some seeded states are ahead of implemented product behavior, as long as tests do not treat those states as complete features.
4. The current template detail page is discoverable and useful as a summary of simple template defaults.
5. Tenant scoping for role-management writes is explicit in the reviewed handlers and schema.
6. Receipt review/reimbursement write paths are tenant-scoped and use status preconditions before changing receipt state.
7. QR code display is limited to confirmed registrations in the active registration UI.
8. Profile receipt reads are tenant-scoped and user-scoped.
9. Verified ESNcard discounts are checked in both event detail price display and registration payment resolution.
10. Unknown tenant hosts fail closed with 404 in the current runtime.
11. Tenant settings writes are tenant-scoped and validate the returned tenant shape before responding.
12. Documentation reporter path/grouping tests pass after the Effect config compatibility fix.
13. Local runtime scripts now refresh `.env.dev` before running Playwright, database, or Docker commands.
14. Angular and server unit-test commands now have separate test discovery ownership.
15. Docker start commands now run a non-mutating required-secret preflight before tearing down or starting containers.
16. Organizer/helper signup copy is covered separately from participant registration copy, and full participant options expose the waitlist action instead of a normal registration action.

### Product Decisions Recorded

The product questions from the first stabilization pass are answered in the
Product Decision Draft near the top of this document. Future cleanup should
implement those decisions or explicitly revise them there before changing code.

## Fixes Applied In This Pass

- None. The obvious issues found in Events and Registrations affect server-side behavior and need focused tests, so they should be handled as small follow-up cleanup commits rather than opportunistic edits inside the audit document commit.
- Registration race-coverage pass: added focused `EventRegistrationService` tests for same-event second registrations across options, transactional duplicate races, and transactional capacity races.
- Registration mode pass: blocked direct registration attempts for stored `random` and `application` registration options until their fulfillment semantics are implemented.
- Registration mode backlog cleanup: removed the stale relaunch checklist item for `random`/`application` UI exposure after confirming event/template authoring controls only pass `fcfs`, template docs document that scope, and stored unsupported modes remain rejected server-side.
- Price-label spec cleanup pass: converted the inclusive price-label Playwright spec to fixme-only declarations and removed placeholder page-load assertions.
- Unlisted-event spec cleanup pass: changed unlisted-event visibility tests to require an approved unlisted seeded event instead of skipping when the seed state is missing.
- Event-creation spec cleanup pass: changed the template-create-event Playwright spec to require the deterministic seeded hike template, registration options, tax-rate completeness, and enabled submit button instead of skipping fixture/setup failures.
- Event-creation template-discount pass: revalidated copied ESNcard template discounts during event creation so changed event prices, free toggles, or later-disabled ESNcard providers cannot create invalid event discount rows.
- Scanner spec cleanup pass: changed the scanner Playwright spec to require an unchecked confirmed registration and matching registration option instead of skipping fixture/setup failures.
- Free-registration spec cleanup pass: removed the impossible missing-tenant skip so the regular-user registration flow relies on the required tenant fixture and fails if fixture setup breaks.
- Template spec cleanup pass: changed template category and role autocomplete coverage to require seeded icons, seeded roles, and concrete role option text instead of skipping fixture/setup failures.
- None in the Templates pass. The highest-value issues are permission and contract validation gaps that need targeted tests with the fixes.
- Template docs/spec cleanup pass: removed the generic template doc discovery placeholder, converted the deferred template tax-rate spec to honest fixme-only declarations, and updated the Playwright inventory.
- Template tax-rate UI coverage pass: replaced the fixme-only template tax-rate file with active simple-mode Browser-backed assertions for the paid tax-rate requirement and seeded inclusive tax-rate save path.
- Template tax-rate fixme cleanup pass: removed the future bulk/no-compatible-rate
  fixme declarations from the paid-template Playwright spec after confirming
  there is no bulk UI surface and local component coverage already pins the
  no-compatible-rate select feedback.
- Event price-label UI coverage pass: replaced the fixme-only inclusive-price file with active page-level assertions for paid event labels, free event options, zero-percent tax-free labels, fallback tax labels, ESNcard discounted prices retaining tax labels, and paid template detail summaries.
- Permission evaluator pass: routed legacy server permission checks through the shared `includesPermission` helper so client and server agree on dependencies, wildcards, and legacy aliases, and added direct unit coverage for the shared evaluator plus tax-rate dependency behavior.
- Role/user cleanup pass: removed placeholder user-list selection/edit affordances, aligned the roles doc with the current no-role-assignment UI, and fixed `users.findMany` to return only the RPC contract shape.
- User-list read-only source pass: added local source coverage so the tenant
  user list keeps review-only name/email/role columns, visible
  role-assignment deferral copy, and generated roles docs until a real
  assignment workflow exists.
- Role hub-field pass: migrated active role create/update form and RPC writes to `displayInHub`, persisted `collapseMembersInHup`, updated role docs, and removed legacy `showInHub` from the application schema/API surface.
- None in the Finance/receipts pass. The highest-value issues touch payment-derived state, transaction visibility, and upload authorization, so they need targeted regression tests with the fixes.
- Scanning/check-in pass: added `events.checkInRegistration`, gated scan reads and check-in writes to event organizers or `events:organizeAll`, made duplicate check-ins idempotent, wired the scanner button to persist and refetch state, and extended scanner tests to assert persisted check-in state.
- Scanner timing pass: enforced the current fixed one-hour pre-start check-in window in scan-read state and direct check-in writes, with focused server coverage for the disabled scan state and rejected mutation.
- Scanner camera-error pass: awaited scanner camera startup, added visible retryable messages for denied permissions, missing cameras, and busy devices, and covered the error mapping in app unit tests.
- Profile/account pass: guarded `/create-account` with authentication, reworked `users.createAccount` into a transactional tenant-account creation flow that can attach an existing global user to the current tenant while assigning default roles, and aligned ESNcard records with the global-per-user decision.
- Profile ESNcard UX pass: mapped discount-card save/refresh/remove failures through readable error messages, added visible pending button states, and documented the current profile discount-card behavior.
- Profile ESNcard provider pass: added bounded ESNcard provider requests and mapped provider outages to retryable validation errors instead of invalid-card state.
- Profile notification-email pass: exposed login email and notification email separately in the profile UI, made notification email editable through the profile dialog, and persisted it through `users.updateProfile`.
- Profile event-card pass: extended `users.events` to return active registration summaries with option, guest quantity, status, payment, and check-in fields, and rendered profile event cards with event-detail links and readable registration state.
- Profile event-action pass: extended `users.events` to return pending checkout URLs and rendered profile event cards with an implemented "Continue payment" action for pending Stripe registrations plus clearer confirmed-ticket routing.
- Profile reimbursement-details pass: clarified that profile IBAN and PayPal fields are optional global reimbursement details used across tenants when finance users record manual receipt reimbursements.
- Profile account-assignment coverage pass: added focused server coverage for `users.userAssigned` so account-creation routing keeps failing closed when the current-tenant assignment header is absent.
- Profile ESNcard message coverage pass: covered readable save/refresh/remove fallback messages and provider/RPC message preference in app unit tests.
- Profile ESNcard mutation coverage pass: added focused handler coverage for refresh revalidation persistence and current-user/type-scoped card removal without requiring browser runtime or the external provider.
- Profile ESNcard upsert payload pass: extracted and covered ESNcard identifier
  trimming before the profile upsert mutation receives the form payload.
- Profile notification-email validation pass: shared the email-shape validation
  between create-account and profile-edit forms and pinned the same constraint at
  the users RPC contract boundary.
- Profile/account route-contract pass: added root route-manifest coverage so `/create-account` remains reachable to authenticated users without a tenant assignment while protected feature routes keep assigned-account and auth guards.
- Permission reference docs pass: added a generated about-permissions documentation source backed by shared permission metadata so the role-creation docs no longer link to a missing checked-in source.
- Role form submit-guard pass: shared a tested role submit-disabled helper
  between the role-form template and submit handler, and guarded parent
  create/edit handlers against duplicate in-flight role writes.
- Template tax-rate coverage pass: covered the compatible active/inclusive current-tenant tax-rate query and paid missing-tax-rate submit normalization so the remaining fixme is narrowed to page-level simple-mode UI assertions.
- Scanner aggregate coverage pass: extracted organizer overview stat aggregation and covered the checked-in total against registration-option `checkedInSpots`, keeping local app logic aligned with scanner mutation counters while Browser aggregate review remains blocked.
- Scanner aggregate Playwright pass: extended the scanner spec to open the organizer overview after buyer-plus-guest check-in and assert the checked-in aggregate shown there.
- Profile edit-dialog coverage pass: covered profile edit payload normalization so notification email and optional global reimbursement details are trimmed/null-normalized before persistence.
- Create-account payload coverage pass: normalized submitted account-creation names and notification email before the RPC mutation and covered that behavior in helper unit tests.
- Profile receipt-label coverage pass: rendered submitted receipt statuses through readable profile labels and covered all persisted receipt states in app unit tests.
- Profile receipt-read coverage pass: covered `finance.receipts.my` server output normalization for profile receipt cards without requiring Browser/runtime setup.
- CI finance-docs pass: removed the explicit `@finance` exclusion from the CI docs baseline after finance documentation was rewritten to current behavior.
- Scanning docs backlog cleanup: clarified that event-management docs already cover the QR scanner/check-in mutation behavior and that the remaining scanner gap is Browser-backed organizer aggregate assertion.
- Tenant/global-admin pass: guarded global-admin routes with `globalAdmin:manageTenants`, decoupled global-admin permission resolution from current-tenant assignment, required tenant user context to have a current-tenant assignment, and fixed granted group wildcards such as `globalAdmin:*` to satisfy concrete permission checks.
- Tenant-resolution pass: added focused `resolveTenantContext` coverage for non-local host precedence over cookies, localhost cookie fallback, stale localhost cookie fallback, and unknown non-local host failure.
- Generated docs/Playwright pass: replaced stale Effect config-provider calls in Playwright config/support files so `test:e2e -- --list` and `test:e2e:docs -- --list` can discover tests again.
- Local runtime/developer workflow pass: refreshed `.env.dev` automatically in local runtime scripts, added a visible Playwright browser-install script, split Angular/server unit-test discovery, aligned CI Bun with the repo runtime, added Docker required-secret preflight before mutating start commands, extended `docker:check` into a broader health report, and updated workflow docs.
- Playwright docs-output pass: made the documentation reporter no-op during `--list` discovery so list commands no longer clear or rewrite generated docs output.
- Docker Stripe-account pass: passed `STRIPE_TEST_ACCOUNT_ID` into the Docker `db-setup` and app services, made `docker:check` require it, and documented that seeded paid flows use the configured connected Stripe test account.
- Docker Stripe-webhook pass: added `STRIPE_WEBHOOK_SECRET_FILE` support so the Compose-managed Stripe CLI listener can write its generated webhook signing secret into a shared volume and the app can verify forwarded local checkout webhooks against the same runtime secret.
- Playwright discovery pass: deferred Auth0 Management config reads to the `newUser` fixture so baseline list/discovery does not require integration-only credentials.
- Playwright inventory pass: refreshed `tests/test-inventory.md` into a current suite-ownership and stabilization-gap guide for specs/docs instead of a flat stale snapshot.
- Playwright title-metadata pass: removed mandatory `@track`, `@req`, and
  `@doc` title metadata from test workflow docs and dropped the custom
  Playwright title-tag lint rule.
- Finance access pass: gated finance transaction reads with `finance:viewTransactions`, added finance route guards/link visibility for transaction, receipt approval, and receipt reimbursement pages, added permission-matrix coverage, and rewrote the finance overview doc copy to current permissions and UI behavior.
- Finance webhook counter pass: moved paid checkout completion/expiry counter updates into the Stripe webhook transaction and extended webhook replay specs to assert registration status, transaction status, and option counters together.
- Finance receipt-upload pass: added event-scoped receipt-media upload preflight so object storage writes require receipt-submit authorization before upload, while `finance.receipts.submit` keeps its own authorization check.
- Finance receipt-spec cleanup pass: removed silent early returns from approval/refund and "Other country" receipt Playwright coverage so missing seeded UI state fails instead of passing.
- Finance receipt exact-row pass: tightened the receipt approval/reimbursement
  Playwright flow to follow the exact seeded receipt by id/file name, assert the
  approval route target, read the reimbursed row back from the database, and
  fail explicitly when the tenant fixture needed for receipt settings is absent.
- Receipt reimbursement wording pass: renamed finance-facing receipt reimbursement copy away from "refund" for manual ledger actions while leaving legacy internal route/API/database names for a later migration.
- Receipt amount validation pass: rejected receipt submit/review payloads where tax exceeds the total amount and added focused server coverage for both write paths.
- Payment-status deprecation pass: stopped active profile/user-event reads and fixture setup from relying on `event_registrations.paymentStatus`; user-facing payment state now derives from registration transaction rows, and the legacy field/enum have been removed from the application schema.
- Receipt timing pass: aligned receipt submission with the pre-event spending
  decision by removing the event-end-time gate while keeping event existence,
  tenant scoping, and receipt-submit authorization checks in place.
- Receipt timing backlog cleanup: replaced the stale post-event submission note
  with the current pre-event spending/submission decision and server coverage.
- Receipt submission guard pass: kept the organizer Add receipt action disabled
  during both upload and submit mutations, with the template and handler sharing
  the same tested helper.
- Receipt review action guard pass: shared the receipt approval/rejection
  disabled state and handler early return so invalid, loading, and
  mutation-pending review writes cannot double-submit.
- Receipt reimbursement action guard pass: shared the reimbursement record
  disabled state and handler early return so missing payout inputs and
  mutation-pending writes cannot duplicate reimbursement transactions.
- Receipt preview URL guard pass: shared receipt preview URL validation between
  approval details, reimbursement previews, and preview dialogs so only HTTP(S)
  or app-relative URLs are rendered or opened.
- Scanner action guard pass: kept the scanned-registration check-in action
  disabled after a successful local write while the scan-result query refetches,
  with the template and handler sharing the same tested helper.
- Scanner status-coverage pass: added focused scan-read and direct-check-in coverage for pending, cancelled, and waitlisted registrations.
- Tenant settings feedback pass: added explicit success and readable error notifications for general settings saves.
- Tenant settings save-guard pass: shared a tested save-disabled helper between
  the general-settings template and submit handler so invalid, submitting, and
  mutation-pending settings writes cannot double-submit on slow networks.
- Tenant SEO settings pass: exposed stored tenant SEO title/description through the Tenant RPC schema, general settings UI, admin settings persistence, and tenant-level document metadata.
- Tenant domain-scope docs pass: aligned root product/architecture docs with the current one-active-domain relaunch model and left automated multi-domain/custom-domain verification as later tenant-onboarding work.
- Tenant locale/timezone contract pass: narrowed the shared Tenant contract to
  the database-supported relaunch currency, locale, and timezone values while
  normalizing legacy `en` / `Europe/Amsterdam` context payloads to supported
  defaults.
- Tenant locale/money settings pass: moved supported currency, locale, and
  timezone out of the read-only/deferred tenant-settings bucket and through the
  general-settings form, admin RPC payload, persistence handler, generated docs,
  and focused payload/handler coverage.
- Tenant legal-text pass: added editable hosted imprint, privacy, and terms
  text fields to tenant settings, persisted them through the Tenant/RPC schema,
  exposed public `/legal/*` pages, and kept external legal URLs as the footer
  preference when configured.
- Tenant locale/money reload pass: reloads the app after saved currency,
  locale, or timezone changes so bootstrap-level formatting defaults are not
  stale in the current session.
- Legacy schema migration pass: added an idempotent migration step that drops
  physical `roles.showInHub`, `event_registrations.paymentStatus`, and the
  unused `payment_status` enum when present.
- Migration failure signal pass: made the production migration command exit
  non-zero when a top-level migration step fails, so the legacy cleanup path
  cannot be logged as failed while still looking successful to automation.
- Tenant admin route-guard audit: confirmed and documented route-level guards plus permission-matrix coverage for tenant admin settings, roles, users, and tax rates.
- Global-admin authorization coverage pass: extended handler coverage for the
  tenant list so explicit `globalAdmin:manageTenants`, wildcard access, and
  forbidden/anonymous fail-closed paths are all covered before Browser-backed
  global-admin review is available.
- Permission metadata pass: replaced generated camelCase permission labels with explicit admin-facing labels/descriptions and rendered descriptions in the role form.
- Route-guard backlog cleanup: replaced the stale "extend route-guard coverage" follow-up after admin, finance, template, and global-admin route-manifest specs plus permission-matrix denial coverage were in place.
- Role autocomplete backlog cleanup: replaced the stale skip-based autocomplete follow-up with the remaining Browser-backed least-privilege organizer review, after confirming role lookup unit coverage and the active template/event autocomplete specs already fail loudly on missing seeded roles.
- Registration negative-path backlog cleanup: clarified the Playwright inventory so closed-window, role-ineligible, unsupported-mode, and waitlist items point to the remaining Browser-backed page states rather than implying server/app negative-path coverage is absent.
- Registration negative-path Playwright pass: added active page-backed coverage
  for closed registration windows, role-ineligible direct links, and full
  participant-option waitlist affordances. Execution still depends on local
  runtime secrets and the matching Playwright browser cache.
- Event registration readback-hardening pass: made self-service transfer and
  waitlist Playwright specs fail explicitly when the expected transferred or
  waitlisted registration row is missing after the page flow.
- Waitlist question integration-doc pass: extended full-option waitlist specs
  and generated registration docs to exercise required answer gating and
  persisted answer storage before joining a waitlist.
- Waitlist leave integration-doc pass: extended the full-option waitlist docs
  and page-backed spec to leave the waitlist after joining, then assert the
  cancelled registration and released waitlist counter.
- Template docs persistence pass: extended generated template docs so the
  reusable add-on/question walkthrough saves a template, verifies detail-page
  output, reads back planning tips, add-on attachment/quantity, and required
  question state, then cleans up the created rows.
- Registration unavailable-state docs pass: extended the registration generated
  docs journey with page-backed closed-window, full-option waitlist, and
  role-ineligible direct-link states, so negative registration behavior is
  documented from the real event page instead of only server/app unit coverage.
- Active-registration deferred-action pass: kept transfer/resale visibly
  unavailable on event active-registration cards for pending, confirmed, and
  waitlisted registrations until the real transfer/resale flow exists.
- Tax-rate validation coverage pass: covered the shared server validator for
  paid/free registration option tax-rate rules, including tenant-missing,
  inactive, and exclusive tax rates.
- Receipt review docs pass: added a generated documentation journey for receipt approval and manual reimbursement recording, then removed receipt review/reimbursement from the generic missing-docs backlog.
- Receipt review docs readback pass: made the generated receipt
  approval/reimbursement journey follow the seeded receipt by filename/id, read
  back approved/refunded states, and restore the seeded receipt plus generated
  reimbursement transaction.
- Finance receipt contact pass: receipt approval/reimbursement read models now
  render the submitter's notification email when present, falling back to the
  Auth0 login email only when no notification email is configured.
- Profile edit docs pass: extended the user-profile documentation journey to save a changed notification email, assert the refreshed profile summary, and restore the seeded user record after the doc run.
- Profile event-card docs pass: extended the user-profile documentation journey with deterministic confirmed and checked-in registrations plus free add-ons and asserted the profile event-card title, event-detail link, status, guest, add-on, payment, ticket-routing, and checked-in action labels.
- Profile pending/waitlist docs pass: extended the user-profile documentation
  journey with deterministic pending-checkout and waitlisted event cards so the
  generated docs assert the Continue payment action, Stripe checkout link,
  payment-pending next step, waitlist status, and leave-waitlist event-page
  routing before runtime Browser review is unblocked.
- Profile event-card spec pass: extracted deterministic profile event-card
  seeding into a shared Playwright helper and added a functional spec that
  asserts confirmed, pending-checkout, waitlisted, and checked-in event cards
  outside the generated documentation suite.
- Profile event-card route pass: pinned the functional profile event-card spec
  to the exact seeded event-page links for confirmed, pending-checkout,
  waitlisted, and checked-in cards while authenticated Browser review remains
  runtime-gated.
- Profile docs route pass: pinned the generated user-profile documentation
  journey to the same seeded event-page links for confirmed, pending-checkout,
  waitlisted, and checked-in profile event cards.
- Profile receipt docs pass: extended the user-profile documentation journey with a deterministic submitted receipt and asserted the profile receipt-card filename, submitted status, event title, and amount.
- Profile docs persistence pass: added generated-doc database readbacks for the
  saved notification email and submitted receipt row so the profile
  documentation journey proves persisted state, not only rendered copy.
- Create-account gate coverage pass: extracted the email-verification form gate into a typed helper and covered verified, unverified, null, and absent Auth0 email-verification states without requiring Auth0 Management credentials.
- Playwright skip-inventory pass: added a local unit guard that allowlists every
  current Playwright `test.skip` and `test.fixme`, keeping future fixture-state
  gaps from becoming silent placeholders.
- Playwright fixed-wait cleanup pass: replaced remaining shared
  `.waitForTimeout(...)` waits in docs screenshot and Stripe checkout helpers
  with UI/render-state waits, and extended the Playwright inventory guard so
  future specs/docs cannot reintroduce fixed sleeps silently.
- Finance reimbursement precondition pass: added server coverage for the case
  where selected receipts are approved during lookup but no longer satisfy the
  reimbursement update preconditions inside the transaction.
- Finance reimbursement payout-validation pass: added server coverage proving
  missing IBAN, missing PayPal, and changed payout references reject before
  recording a reimbursement transaction.
- Receipt review precondition pass: added server coverage proving refunded
  receipts, missing rejection reasons, and invalid receipt dates reject before
  receipt review updates are written.
- Finance transaction-list action cleanup: removed the dead manual
  create-transaction link from the transaction list and added a regression
  guard so it stays hidden until an implemented route/workflow exists.
- Finance permission-matrix source pass: added local coverage tying guarded
  finance child routes to page-backed permission matrix cases and added the
  missing receipt approval detail route-denial case.
- Scanner guest-count server validation pass: added direct handler coverage for
  negative guest-count payloads and guest-count values above the remaining
  guest quantity before check-in writes can run.
- Global-admin tenant-list pass: expanded the tenant list contract and UI with
  non-sensitive operational state for support review, including theme,
  locale/currency/timezone, and Stripe connection status.
- Global-admin tenant-search pass: added client-side search across tenant
  operational fields and removed the dead placeholder tenant-list action while
  keeping the current surface read-only.
- Global-admin tenant-list error pass: mapped tenant-list query failures
  through shared readable error-message handling instead of rendering raw error
  objects in the current global-admin surface.
- Global-admin tenant-detail pass: added a guarded read-only tenant detail RPC,
  route, and UI so platform admins can review one tenant's operational state
  from the searchable tenant list without introducing tenant editing or
  impersonation semantics.
- Global-admin tenant-create/edit pass: added guarded platform-admin tenant
  create/edit RPCs and routes for the one-domain relaunch model, covering
  tenant name, primary domain, theme, locale, currency, timezone, and connected
  Stripe account id while keeping custom-domain verification and impersonation
  deferred.
- Global-admin tenant-submit guard pass: kept tenant create/edit submit actions
  disabled while the create/update mutation is pending and ignored duplicate
  submit events during in-flight writes.
- Global-admin tenant-scope notice pass: showed the one-domain relaunch scope,
  deferred custom-domain/multi-domain automation, and absent impersonation flow
  directly in tenant create/edit forms, with local form-model coverage and docs
  alignment.
- Global-admin route-guard coverage pass: extended the page-backed direct-route
  guard spec and inventory notes to cover `/global-admin/tenants/create`,
  `/global-admin/tenants/:tenantId`, and
  `/global-admin/tenants/:tenantId/edit` in addition to the global-admin shell
  route.
- User-list pagination pass: fixed the read-only tenant user list to paginate
  tenant-user assignments before loading role rows, so users with multiple
  roles no longer consume multiple page slots.
- User-list search pass: wired the existing `users.findMany.search` contract
  into the server query and the read-only user list UI so larger tenants can
  filter by name or email before pagination.
- Docker preflight visibility pass: `bun run docker:check` now lists required
  variables that are already available without printing secret values, so
  Font Awesome premium/brand icon registry access can be confirmed even when
  missing runtime secrets still block Docker startup.
- Docker preflight contract pass: added regression coverage that Docker start
  scripts remain gated by `docker:check`, Compose consumes the required runtime
  variables, and the Font Awesome build secret path continues to support both
  premium and brand icon packages.
- Profile action-helper coverage pass: moved the profile pending-checkout
  continuation rule into a tested helper so the card only renders the external
  payment action for pending registrations with a checkout URL while all event
  states continue routing users back to the event page for ticket,
  cancellation, and waitlist details.
- Migration docs alignment pass: refreshed `migration/README.md` to document
  the current global migration-step phase, including idempotent DDL cleanup for
  legacy physical fields, and removed stale conductor/track guidance.
- Docker resume command pass: added `bun run docker:resume` as a non-recreating
  path for already initialized Docker stacks and documented the difference from
  reset-from-zero `docker:start*` commands.
- Font Awesome registry contract pass: pinned that both the premium duotone icon
  package and the brand icon package stay installed through the shared Font
  Awesome registry path used by local installs and Docker builds.
- Playwright browser-channel pass: made bundled Chromium the default local/CI
  browser channel while adding `E2E_BROWSER_CHANNEL=chrome` as an explicit
  system-Chrome opt-in for exploratory local runs without a browser-cache
  download.
- Authorization source-guard pass: added local coverage that rejects raw
  permission-array checks in server RPC/HTTP handlers and keeps role lookup
  contracts free of permission-bearing admin role fields.
- Profile discount-fragment pass: kept `/profile#discounts` stable while
  tenant ESNcard provider data loads, so direct links and docs journeys do not
  fall back permanently to the overview before the Discounts section becomes
  available.
- Shared price-label coverage pass: added focused Angular coverage for the
  shared price/tax label component's paid, free, zero-tax, and fallback states,
  narrowing the remaining inclusive-price fixme to page-level Browser
  assertions.
- Shared price-label currency pass: changed the shared price/tax label to
  inherit Angular's tenant-level `DEFAULT_CURRENCY_CODE` and locale by default,
  while keeping explicit currency overrides available for future cross-currency
  surfaces.
- Registration spot-count pass: extracted and covered the buyer-plus-guests
  spot-count helper used by Stripe webhook completion/expiry counter updates,
  then corrected the finance notes that still described expiry as releasing one
  spot.
- Registration-card unsupported-mode coverage pass: pinned that stored
  `random` and `application` participant options do not expose the lightweight
  waitlist action when full, keeping the card aligned with the server-side
  fail-closed registration-mode policy.
- Registration cancellation guest-copy pass: aligned active-registration
  cancellation helper text and generated registration docs with buyer-plus-guest
  spot release behavior.
- Waitlist leave-action pass: allowed waitlisted participants to cancel their
  waitlist registration before event start, decrementing `waitlistSpots`
  transactionally and exposing **Leave waitlist** copy on the active
  registration card.
- Registration cancellation counter coverage pass: routed cancellation counter
  rollback through the shared buyer-plus-guest spot-count helper and covered
  pending and confirmed guest cancellations so reserved/confirmed spot
  decrement behavior stays pinned without Browser/runtime setup.
- Template create-event submit-guard pass: shared the create-event-from-template
  submit disabled state and handler early return so invalid, submitting, and
  mutation-pending writes cannot duplicate event creation.
- Tenant event-review queue guard pass: shared the Approve/Reject disabled
  state and handler early return so mutation-pending reviews cannot open a
  second rejection dialog or submit another lifecycle write.
- Organizer-assisted transfer primitive pass: added
  `events.findTransferTargets` and `events.transferEventRegistration` RPCs for
  confirmed, not checked-in, unpaid registrations, gated them to event
  organizers or `events:organizeAll`, required the target user to belong to the
  current tenant and remain eligible for the registration option, rejected
  duplicate active target registrations, and kept paid transfer blocked until
  refund/resale money movement exists.
- Organizer-assisted transfer UI pass: exposed the unpaid transfer primitive on
  the organizer overview for not-yet-checked-in participant registrations,
  added an eligible-member lookup dialog, refreshed organizer/event data after
  successful transfer, and updated generated event-management docs to separate
  organizer-assisted unpaid transfer from participant self-service resale and
  paid money movement.
- Organizer action guard pass: shared the organizer overview checked-in and
  mutation-pending guard across cancellation and organizer-assisted transfer
  buttons plus handlers, keeping duplicate or already-checked-in participant
  mutations blocked locally.
- Event review action guard pass: shared event detail review and
  submit-for-review guards between template disabled state and handler early
  returns, keeping pending review writes from double-triggering on slow
  networks.
- Event approval docs persistence pass: hardened the generated approval journey
  with deterministic event data, database readbacks for pending/rejected/
  approved status transitions, reviewer/comment assertions, and cleanup of the
  generated event plus registration option.
- Participant unpaid transfer pass: added `events.transferMyRegistration` so a
  participant can transfer their own confirmed, not checked-in, unpaid
  registration to an existing eligible tenant user by email, exposed the action
  on active registration cards only when the server marks the registration
  transferable, and updated profile/event docs to route unpaid transfer details
  through the event page while keeping paid transfer/resale and refunds honest.
- Participant unpaid transfer functional pass: added page-backed coverage for
  the regular-user transfer dialog and database readback to prove the current
  relaunch transfer workflow outside server/app helper tests.
- Participant paid-transfer blocked pass: extended the registration-transfer
  Playwright spec with a paid confirmed registration and successful transaction
  so the event page must render disabled transfer-unavailable copy instead of
  exposing the unpaid transfer dialog.
- Registration transfer fixture cleanup pass: made the unpaid and paid
  registration-transfer specs delete generated registration/transaction rows
  and restore touched fixture registration statuses after their page-backed
  assertions.
- Free-registration fixture cleanup pass: made the free-registration Playwright
  spec restore deleted fixture registrations and registration-option counters
  after asserting the confirmed registration readback.
- Registration add-on fixture cleanup pass: made the registration add-on
  Playwright spec seed an isolated registration question, remove generated
  add-on/question data, and restore touched registration rows and counters after
  asserting add-on and question-answer persistence.
- Registration transfer documentation pass: added a generated registration-doc
  journey for the unpaid transfer dialog, eligible target email entry, and
  explicit paid-transfer/resale deferral.
- Registration paid-transfer docs pass: extended generated registration docs so
  paid confirmed registrations must show disabled transfer-unavailable copy
  until refund or resale money movement exists.
- Profile payment next-step coverage pass: extracted the profile event-card
  pending-checkout next-step copy into a helper and covered that it only appears
  when a pending registration has an actual checkout URL.
- Docs publish command pass: added an explicit
  `bun run test:e2e:docs:publish` script for writing generated docs and
  screenshots into the sibling `evorto-pages` checkout, while keeping normal
  `test:e2e:docs` output in ignored local `test-results/docs` paths.
- Profile/account docs metadata pass: removed placeholder `@track`/`@doc`
  title metadata from the profile, ESN discount-card, and create-account docs
  while keeping meaningful gating tags such as `@finance` and
  `@needs-auth0-management`.
- Profile/account docs source-guard pass: extended generated-docs source
  coverage so user-profile and create-account docs stay aligned with current
  notification-email, global reimbursement, event-card, submitted-receipt,
  retry-error, and tenant-join behavior.
- Generated docs metadata pass: removed the remaining placeholder
  `@track`/`@doc` title metadata from product-facing generated docs while
  keeping meaningful suite tags such as `@admin`, `@globalAdmin`, and
  `@finance` visible in list/discovery output.
- Generated docs wording guard pass: aligned the tenant general-settings docs
  with implemented brand-asset uploads and hosted legal routes, and added a
  source guard so those docs do not describe implemented settings as deferred
  again.
- Generated template docs source-guard pass: pinned the template guide to the
  role-autocomplete hard failures that prove seeded role options exist and have
  names before documenting duplicate-hiding behavior.
- Playwright spec metadata pass: removed placeholder `@track`/`@req` title
  metadata from active Playwright specs while keeping meaningful suite tags such
  as `@finance`, `@stripe`, `@permissions`, `@taxRates`, and `@isolation`.
  Reporter fixture strings still exercise tag stripping without putting
  placeholder metadata in real test titles.
- Playwright inventory metadata pass: refreshed `tests/test-inventory.md` and
  the generated-docs/current-behavior counts after title metadata cleanup.
- Runtime blocker refresh: reran `bun run docker:check`; Docker remains
  intentionally blocked until `NEON_API_KEY`, `CLIENT_SECRET`, and
  `STRIPE_API_KEY` are provided, while Font Awesome premium/brand registry
  access and Docker Compose config still validate. Playwright browser cache is
  still missing; page-backed runs need either `bun run test:e2e:install` or
  `E2E_BROWSER_CHANNEL=chrome` on a machine with system Chrome installed.
- Playwright browser preflight pass: when bundled Chromium is missing and system
  Chrome is installed, `docker:check` now reports
  `E2E_BROWSER_CHANNEL=chrome` as the low-network local option for exploratory
  page-backed runs.
- Playwright web-server pass: added `docker:webserver` and moved Playwright's
  `webServer` command to it, so page-backed runs no longer force
  `docker compose down` before starting the foreground Compose stack.
- Docker media isolation pass: forced the app container to use the Compose
  MinIO endpoint for media/uploads even when developer dotenv values point
  normal local runs at an external S3-compatible endpoint.
- Playwright webhook-secret gate pass: local non-CI Playwright runs can now
  reach the Stripe webhook replay spec's file-level skip when
  `STRIPE_WEBHOOK_SECRET` is absent, while CI still requires the static secret
  for replay coverage. Docker app verification can continue to use the
  Compose-managed `STRIPE_WEBHOOK_SECRET_FILE`.
- Backlog evidence refresh: reran the skip/fixme inventory guard, the legacy
  stabilization field guard, and the focused registration copy/deferred-action
  component specs before pruning completed organizer/helper signup and skip
  audit action wording from the prioritized backlog.
- Tenant branding upload pass: added admin logo/favicon upload support backed by
  object storage and app-origin `/tenant-assets/*` delivery URLs, keeping
  externally hosted asset URLs available and leaving automated domain onboarding
  as the remaining tenant-settings implementation gap.
- Legacy migration backlog cleanup: removed the stale relaunch backlog item for
  `showInHub`, `paymentStatus`, and `payment_status` cleanup after confirming
  the idempotent global migration step and schema guard specs already cover the
  cut-over path.
- Template add-on boundary refresh: corrected the richer-template backlog notes
  to match the current schema surface and added a schema guard for the fact that
  add-ons were template-scoped only and registration-question schemas still
  needed a template/event copy path.
- Template-to-event mapping pass: extracted the create-event-from-template form
  mapper and pinned copied event defaults, registration source option ids,
  offset-derived registration windows, and the current boundary that organizer
  planning tips remain private to template detail instead of flowing into event
  instances.
- Registration-mode label pass: centralized readable registration-mode labels
  and wired event/template authoring selects plus template detail summaries to
  show "First come, first served" instead of raw `fcfs` storage values.
- Event edit submit-guard pass: shared the event edit Save Changes disabled
  state and handler early return so invalid, submitting, and mutation-pending
  update writes cannot double-submit.
- Template category action-guard pass: shared one create/update pending guard
  across category buttons and handlers so category dialogs and writes cannot
  overlap while a category mutation is in flight.
- Template category fixture-hardening pass: made template-category Playwright
  coverage require a seeded category before edit and read back the created and
  edited category rows from the database after the page flows.
- Template fixture-hardening pass: made template create/detail/tax-rate
  Playwright coverage require seeded template categories/templates up front and
  fail explicitly when reusable add-on attachment or question readbacks are
  missing after the page flow.
- Template role-picker docs hardening pass: made generated template docs fail
  explicitly if the role autocomplete has no seeded role options or nameless
  options before asserting selected roles are hidden from suggestions.
- Create-account retry guard pass: made the create-account submit button stay
  disabled while the account mutation is pending and pinned that invalid,
  submitting, and mutation-pending states all block duplicate submissions
  without requiring Auth0 Management credentials.
- Profile receipt card coverage pass: moved submitted-receipt amount display
  into a tested helper so the profile receipt section has local coverage for
  both status labels and cents-to-euro amount presentation while page-backed
  submitted-receipt visibility remains a Browser/runtime follow-up.
- Profile ESNcard action coverage pass: moved discount-card save, refresh, and
  remove pending labels plus save-disabled state into tested helpers, keeping
  add/refresh/remove Browser coverage as a runtime follow-up while preserving
  local coverage for the visible action states.
- Profile ESNcard docs pass: extended the discounts documentation journey to
  assert the seeded verified ESNcard identifier/status, refresh/remove action
  visibility, and invalid-card-number save guard.
- Profile ESNcard baseline-docs pass: added a helper-backed discounts
  documentation note for readable statuses, pending action labels, shared
  in-flight guards, trimmed save payloads, and retryable provider-unavailable
  copy without calling the external provider.
- Profile ESNcard write-guard pass: shared one in-flight guard across save,
  refresh, and remove so profile discount-card writes cannot overlap on slow
  networks, and pinned that guard in local app tests.
- Profile edit action-guard pass: shared the Edit profile disabled state and
  handler early return so profile updates in flight cannot open overlapping
  edit dialogs.
- Profile/account backlog alignment pass: narrowed the remaining profile and
  account cleanup language to page-backed runtime coverage after confirming
  local helper/server tests already cover retry, tenant join, ESNcard action
  states, profile event labels, and submitted receipt card labels.
- Tax-rate import action-guard pass: shared the import dialog disabled state
  and handler early return so empty selections and in-flight Stripe tax-rate
  imports cannot submit overlapping tenant tax-rate writes.
- Template create/edit submit-guard pass: shared a tested submit-disabled helper
  across simple template create/edit buttons and handlers so mutation-pending
  create/update writes cannot duplicate template writes on slow networks.
- Participant registration action-guard pass: shared a tested
  mutation-pending guard across registration and waitlist buttons plus handlers,
  so participant event registration writes cannot double-trigger locally.
- Template add-on read-model pass: returned existing reusable template add-ons
  from `templates.findOne`, displayed them on template detail with pricing,
  timing, quantity, and attached registration-option labels, and kept
  registration-time event add-on fulfillment plus registration questions as
  explicit later slices.
- Template add-on seed pass: added free and paid reusable add-ons to the
  reset-from-zero template seed data and pinned their registration-option
  attachments in the seed baseline.
- Template create-event add-on boundary pass: showed a create-event notice when
  a source template has reusable add-ons and pinned that current event form data
  keeps add-ons out of client submit payloads while server-side event creation
  copies them by source registration option for event-level purchase handling.
- Event add-on copy pass: added event-scoped add-on tables, copied reusable
  template add-ons by source registration option during event creation, and
  surfaced copied add-ons on event detail.
- Registration add-on checkout pass: added registration add-on purchase storage,
  registration-card add-on quantity controls, server-side add-on validation and
  stock reservation, paid add-on Stripe checkout line items, and add-on stock
  restoration on cancellation or checkout expiry. Standalone before-event and
  during-event add-on sales remain future work.
- Registration add-on readback pass: returned purchased add-ons on active
  registration, profile event-card, and organizer overview summaries so
  participants and organizers can see fulfilled registration-time add-ons after
  checkout.
- Registration add-on/question integration-doc pass: added a page-backed free
  registration add-on and required-question spec, then updated generated
  registration docs to exercise add-on quantity selection, required answer
  gating, persisted answer storage, and active-registration readback without
  depending on Stripe secrets.
- Template question source pass: added template-scoped registration-question
  storage, simple template create/edit controls, `templates.findOne` read-model
  support, and template detail display.
- Template question seed pass: added reusable participant and organizer
  questions to reset-from-zero template seed data and pinned their
  registration-option attachments in the seed baseline.
- Event question copy pass: added event-scoped registration-question storage,
  copied reusable template questions by source registration option during event
  creation, and surfaced copied questions on event registration option cards.
- Event question answer pass: added event-scoped registration-question answer
  storage, submitted answer payloads for registration and waitlist writes,
  server-side required-question validation, and local component coverage for
  required-answer guards and payload normalization.
- Active-registration action-guard pass: shared tested cancellation and
  transfer disabled-state helpers between active-registration buttons and
  handlers so participant cancellation and unpaid transfer writes cannot
  overlap locally.
- Playwright metadata inventory pass: extended the local skip/fixme inventory
  guard to also reject placeholder `@track`, `@req`, and `@doc` metadata in real
  Playwright spec/doc titles, while keeping the reporter stripping fixture
  isolated to its own reporter contract test.
- Template tax-rate empty-state pass: made the paid template registration-option
  tax-rate select show an explicit no-compatible-inclusive-rates message instead
  of an empty menu, and pinned loading, empty, failed, and available states in
  local component helper coverage.
- Profile checkout-link guard pass: constrained profile payment-continuation
  links to pending Stripe Checkout HTTPS URLs so malformed or unexpected stored
  checkout values do not render as actionable profile links.
- Global-admin tenant-domain link pass: constrained the tenant-detail "Open
  tenant domain" link to single-host tenant domain values so malformed legacy
  domain data fails closed on the support review surface.
- Tenant general-settings functional pass: added page-backed tenant-admin
  coverage for saving editable relaunch settings and reading back persisted
  brand, SEO, legal, and ESNcard provider fields from the tenant row.
- Font Awesome app-icon guard pass: tightened local source coverage so new
  Material icon-package imports fail outside the existing root bootstrap
  registry exception, preserving the premium/brand Font Awesome package path for
  app action and brand icons.
- Finance docs source-guard pass: pinned generated finance receipt docs to the
  current manual submitter-notification and manual reimbursement money-movement
  scope so relaunch docs do not imply automatic email or payout behavior.
- Template docs source-guard pass: pinned generated template docs to the
  current simple-mode relaunch surface with one organizer block, one participant
  block, reusable add-ons, registration questions, and private organizer
  planning tips instead of implying bulk registration options or standalone
  add-on sales are configured there.
- Registration docs source-guard pass: pinned generated registration docs to
  the current unavailable-state and transfer scope, including closed windows,
  full-option waitlists, role-ineligible direct links, unpaid transfer, paid
  transfer/resale deferral, and no QR email delivery.
- Scanner docs source-guard pass: pinned generated event-management docs to the
  dedicated QR scanner flow, scanner warning states, guest-quantity checked-in
  counts, organizer cancellation scope, and paid-transfer/refund deferrals.
- Permission docs source-guard pass: pinned generated role docs to the
  generated permission reference and kept that reference aligned with
  tenant-scoped roles, wildcard permissions, dependent permissions, and
  separate global-admin semantics.
- ESN discount docs source-guard pass: pinned generated discounts docs to the
  local ESNcard helper functions, trimmed submit payloads, shared write guards,
  readable statuses/actions, and retryable provider-outage semantics.
- Finance overview docs source-guard pass: pinned generated finance overview
  docs to permission-scoped child navigation so receipt approval access does not
  imply transaction-list access.
- Profile receipt docs source-guard pass: pinned generated profile docs to the
  deterministic submitted-receipt seed, card assertions, submitted status,
  event title, and formatted amount so the profile receipt walkthrough cannot
  drift back to a placeholder section while Browser runtime review is blocked.
- Global-admin docs source-guard pass: pinned generated global-admin docs to the
  searchable tenant list, no-match state, operational row fields, read-only
  tenant detail review, external tenant-domain link, and create/edit form
  relaunch-scope surface while authenticated Browser review is still blocked.
- Global-admin page-backed support-lookup pass: extended the global-admin
  tenant Playwright spec so the searchable tenant list proves connected Stripe
  account ids work as support lookup terms, not only tenant domains.
- Global-admin page-backed route pass: pinned the global-admin tenant spec and
  generated docs to the list/create/detail/edit navigation targets and the
  external tenant-domain link while authenticated Browser review remains
  runtime-gated.
- Global-admin docs readback pass: tied the generated guide's tenant list,
  detail, search, and edit-form assertions to the seeded localhost tenant row
  instead of only matching generic visible values.
- Tenant general-settings docs source-guard pass: pinned generated settings docs
  to the implemented tenant identity, locale/money, SEO, legal, receipt-country,
  ESNcard, and separate tax-rate surfaces while keeping deferred domain/email/
  policy/limit/Stripe-account settings explicit.
- Template relaunch docs source-guard pass: pinned generated template docs to
  option descriptions, ESNcard discounted pricing, selected-role eligibility,
  duplicate-hiding role autocomplete, payment/tax-rate visibility, add-ons,
  questions, and private organizer planning tips.
- Registration-mode source-guard pass: pinned event/template authoring surfaces
  to first-come-first-served mode while keeping persisted `random` and
  `application` modes readable through shared labels instead of re-exposing
  unsupported fulfillment modes in create/edit flows.
- Negative registration page-backed pass: extended the negative registration
  Playwright spec so full stored unsupported modes still render as full without
  exposing normal registration or waitlist actions, matching the fail-closed
  server policy and local component helper coverage.
- Free registration fixture-hardening pass: made the free registration and
  registration add-on Playwright specs assert the seeded `freeOpen` event option
  exists for the current tenant before they reset counters or attach add-ons, so
  fixture drift fails at the seed contract instead of later UI or FK side
  effects. Those specs now also fail explicitly when expected registration or
  add-on readback rows are missing after the page flow.
- Seed baseline scenario-handle pass: made the seed-baseline contract fail
  explicitly when `freeOpen`, `paidOpen`, `closedReg`, `draft`, or `past`
  handles point at missing event or registration-option rows, before downstream
  page-backed specs depend on those handles.
- Registration docs fixture-hardening pass: made the event registration
  documentation journey fail explicitly when the regular-user fixture is missing
  or the seeded `paidOpen` registration option does not exist as a paid option,
  instead of falling back to the first configured user.
- Profile event-card fixture-hardening pass: made the shared profile event-card
  seeding helper fail explicitly when the seeded source registration options for
  confirmed or checked-in cards are missing, so both profile docs and functional
  profile-event specs catch fixture drift before inserting dependent rows.
- Profile readback fixture-hardening pass: made profile edit and submitted
  receipt Playwright specs fail explicitly when the expected persisted user or
  receipt row is missing after the page flow, instead of relying on optional
  property assertions.
- Tenant/admin readback fixture-hardening pass: made general-settings and
  roles-management Playwright specs fail explicitly when expected tenant or role
  readbacks are missing after save/create/edit flows, before checking persisted
  values.
- Scanner page-backed action-guard pass: extended scanner Playwright coverage
  so buyer-plus-guest check-in and later guest-arrival check-in both assert the
  visible check-in action remains disabled after local success while the scan
  state refetch catches up.
- Scanner docs persistence pass: extended event-management docs to execute the
  generated guest check-in, assert the persisted check-in time, selected guest
  count, and checked-in counter, and restore the seeded event option counter.

## Review Next

All ten first-pass review areas are now represented in this document. The next
stabilization work should continue with small cleanup commits around the
remaining relaunch gaps: Browser-backed profile action coverage, Browser-backed
scanner aggregate review, automated onboarding/domain workflows, and manual
global tenant-admin Browser review. Richer reusable template add-ons and questions are
now implemented in the simple template flow and should be kept aligned as those
surfaces evolve. Normal generated docs output now stays local unless
`test:e2e:docs:publish` is run intentionally. New Playwright
skips/fixmes should be added only as explicit credential gates or honest
Browser-backed stabilization placeholders. Receipt notification remains a
future product delivery path; the current relaunch scope records receipt review
locally and keeps finance-facing copy explicit that submitter notification is
manual.
