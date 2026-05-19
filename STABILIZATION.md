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
| Tenant/global admin                             | Fixes applied       | partial    | Tenant resolution, tenant settings, and global-admin list surface reviewed; global-admin route and permission context fixes applied.                  |
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
- **Addressed in stabilization pass:** full participant options no longer present the normal registration action and instead expose a distinct waitlist action backed by a `WAITLIST` registration and `waitlistSpots` counter update.
- **Addressed in stabilization pass:** registration submission now rejects stored `random` and `application` options server-side instead of silently handling them as first-come-first-served.
- **Addressed in stabilization pass:** event registration option cards now label participant options separately from organizer/helper options and use distinct organizer/helper signup action copy while preserving the shared registration-option model.
- **Addressed in stabilization pass:** role-ineligible direct event links keep the event visible but show an explicit registration-unavailable state instead of silently rendering an empty registration section.
- **Addressed in stabilization pass:** participant self-cancellation now covers pending and confirmed registrations before event start, rolls back reserved/confirmed counters, blocks checked-in cancellations, and keeps refund copy honest for paid registrations.
- **Addressed in stabilization pass:** organizer/admin cancellation is available from the organizer overview for confirmed participant registrations, requires event-organizer access or `events:organizeAll`, blocks checked-in cancellations, and rolls back confirmed counters without promising automatic refunds.
- **Addressed in stabilization pass:** active registration cards now make transfer/resale unavailability explicit for pending, confirmed, and waitlisted registrations until the real transfer/resale flow exists.
- **Should fix before relaunch:** transfer/resale and automatic refund flows are not implemented in the reviewed event registration path.
- **Addressed in stabilization pass:** active registration status now uses the shared persisted registration status literal union instead of raw `Schema.String`.
- **Acceptable for now:** paid registration rollback is careful about cleaning up a failed checkout session creation path; deeper Stripe lifecycle review belongs in the finance pass.

### Test and Documentation Quality

- `tests/specs/events/free-registration.test.ts` covers the free registration happy path using seeded scenario handles.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers registration-card state for full options, distinct waitlist availability, remaining-capacity guest selection helpers, and too-early/too-late registration windows without requiring a page-backed browser.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers that stored `random` and `application` participant options do not expose a waitlist affordance even when full.
- `src/server/effect/rpc/handlers/events/event-registration.service.spec.ts` covers server-side rejection for duplicate active registration, unpublished events, closed registration windows, role-ineligible users, cross-tenant options, full options, unsupported registration modes, same-event second registrations across options, transactional duplicate races, transactional capacity races, participant waitlist joining, and participant guest quantities.
- `src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts` covers participant self-cancellation for pending and confirmed registrations plus checked-in and waitlist rejection paths.
- `src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts` covers organizer/admin cancellation for confirmed registrations and denial without event-organizer access.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers server-side rejection of end-before-start events and close-before-open registration windows for event create/update.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers template discount copying by stable source option id when template options share the same title, plus pre-insert rejection when copied ESNcard discounts are disabled or exceed the target event option price.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers acceptance and rejection for the shared event location schema now used by Events RPC contracts.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers the active registration status literal union and rejects unknown statuses.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers the tax-rate label fields returned with event registration options for paid event cards.
- `src/app/events/event-active-registration/event-active-registration.component.spec.ts` covers participant cancellation copy and the visible transfer/resale-unavailable notes for pending, confirmed, and waitlisted active registrations.
- `tests/docs/events/event-management.doc.ts` now documents only the current event details, registration, review/listing, edit, organizer overview, participant grouping/cancellation, and receipt surfaces.
- `tests/docs/events/unlisted-admin.doc.ts` covers the updated direct-link explanation in the listing dialog and on unlisted event details.
- `tests/docs/events/register.doc.ts` covers free and paid registration as generated documentation and Stripe-backed evidence, including guest quantity selection, the participant versus organizer/helper option wording, and participant self-cancellation copy.
- `tests/docs/events/register.doc.ts` documents the role-ineligible direct-link state even though page-backed Browser coverage still depends on local runtime availability.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers the participant versus organizer/helper registration option copy.
- `src/app/events/event-registration-option/event-registration-option.component.spec.ts` covers discounted buyer-price plus full-price guest totals for paid registration actions.
- `src/server/price/format-inclusive-tax-label.spec.ts` covers the shared inclusive-tax label formatter.
- `src/app/shared/components/inclusive-price-label/price-with-tax.component.spec.ts` covers paid, free, zero-tax, and fallback rendering for the shared price/tax label used by event registration cards and template detail summaries.
- **Addressed in stabilization pass:** event registration option cards now render paid prices through the shared inclusive tax label component using tax-rate details from `events.findOne`; Browser-backed price-label assertions are still needed before removing the Playwright fixme file.
- `tests/specs/events/price-labels-inclusive.spec.ts` is explicitly quarantined with `test.fixme` until it is replaced with real UI assertions.

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
- **Should fix before relaunch:** simple-mode create/update always writes exactly two registration options. That matches the current UI but is thinner than the product model for reusable event knowledge.
- **Should fix before relaunch:** template add-ons and registration questions exist in schema or product context, but simple-mode template create/update does not expose or persist them. Event creation has separate add-on copying logic, but the simple template editing path cannot maintain those richer fields yet.
- **Addressed in stabilization pass:** simple-mode template create/edit now exposes optional ESNcard discounted prices when the tenant ESNcard provider is enabled, persists them in `templateRegistrationOptionDiscounts`, returns them through `templates.findOne`, and shows them on template detail.
- **Addressed in stabilization pass:** simple-mode template registration
  options now preserve editable option names plus public and registered-user
  rich-text descriptions. Those fields are shown on template detail and already
  flow into event creation through the existing template-to-event mapping.
- **Addressed in stabilization pass:** simple-mode template create/edit now exposes the existing `planningTips` field as private organizer planning tips, persists trimmed notes through the template RPC/service, and shows them on the template detail page.
- **Addressed in this stabilization pass:** registration mode now only offers first-come-first-served in event/template authoring controls. The contracts still accept existing stored `random`/`application` values, but new/edit UI no longer presents unsupported fulfillment modes.
- **Addressed in this stabilization pass:** template create/edit components use scoped `consola/browser` loggers instead of direct `console.*` calls.
- **Addressed in stabilization pass:** template detail paid-option summaries now use the shared inclusive tax label component, matching the event registration card display and preserving the same fallback label when tax-rate details are unavailable.
- **Addressed in stabilization pass:** template create/edit submit normalization clears hidden payment fields for free registrations, so toggling a paid option back to free no longer submits a stale `stripeTaxRateId` that the server correctly rejects.
- **Acceptable for now:** the template detail page is a useful read-only summary and the "Create event" action is discoverable from the detail surface.

### Test and Documentation Quality

- `tests/specs/templates/templates.test.ts` covers create, view, empty-category add flow, and role autocomplete duplicate hiding.
- `tests/docs/templates/templates.doc.ts` documents simple-mode template creation, organizer planning tips, role defaults, payment field visibility, optional ESNcard discounted price fields, and role-picker behavior.
- `tests/specs/templates/paid-option-requires-tax-rate.spec.ts` is intentionally fixme-only until template tax-rate behavior has active simple-mode UI coverage.
- `src/app/templates/shared/template-form/template-registration-option-form.utilities.spec.ts` covers paid template tax-rate and ESNcard discount preservation, paid missing-tax-rate pass-through for server validation, and free-registration payment-field cleanup before create/edit submission.
- `src/server/effect/rpc/handlers/tax-rates.handlers.spec.ts` covers `taxRates.listActive` permission behavior and the current-tenant active/inclusive filter used to populate compatible template tax-rate selects.
- `src/server/utils/validate-tax-rate.spec.ts` covers the shared server rule that paid options require a tenant-owned active inclusive tax rate and free options cannot carry stale tax-rate ids.
- `src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts` covers paid template registrations without tax rates, free template registrations with stale tax-rate ids, and invalid ESNcard discounted prices failing through the server-side validation path.
- The generic `tests/docs/template.doc.ts` discovery placeholder was removed; product template documentation lives in `tests/docs/templates/templates.doc.ts`.
- Permission matrix coverage checks template create link visibility plus direct route denial for template create/edit/create-event routes. `src/app/templates/templates.routes.spec.ts` keeps the guarded template write-route manifest explicit. Server unit coverage proves template RPC denial, template offset ordering, tenant-owned template category/role validation, and template location schema rejection.

### Product Questions Answered Above

- Is simple mode the intended relaunch template scope, or should richer registration options/add-ons/questions/organizer notes be available before relaunch? Answered locally: keep simple mode primary and expose organizer planning tips plus ESNcard discounted prices now; add-ons and questions remain separate follow-up work.
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
- Replace fixme-only template tax-rate specs with active coverage for the current simple-mode UI.
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
- **Addressed in this stabilization pass:** `admin.roles.findMany` now requires `admin:manageRoles`; permission-bearing role records are no longer exposed to every authenticated tenant user.
- **Addressed in this stabilization pass:** shared role selection and template default-role queries now use lookup-only `roles.findMany` / `roles.findOne` RPCs. The lookup API returns only id, name, and default-role flags and is available to event/template authoring permissions plus role admins.
- **Addressed in stabilization pass:** role create/update now writes `displayInHub` and `collapseMembersInHup`, and the role form uses the same `displayInHub` field that `findHubRoles` reads. The legacy `showInHub` role field has been removed from the Drizzle schema and admin role RPC records, leaving `displayInHub` as the canonical hub-visibility field.
- **Addressed in stabilization pass:** `users:assignRoles` is now labeled as a future/migration permission in the role form metadata, the user list explicitly says existing-user role assignment is deferred for relaunch, and the roles doc records the read-only user-list behavior.
- **Addressed in stabilization pass:** the user list no longer shows placeholder selection or "Edit template" actions for user-role assignment.
- **Addressed in stabilization pass:** permission metadata now has explicit admin-facing labels and descriptions in the shared permission source, the role form renders those descriptions, and shared tests require every visible permission to keep non-empty metadata.
- **Acceptable for now:** roles are tenant-scoped in schema and role-management write queries include tenant boundaries.

### Test and Documentation Quality

- `src/shared/permissions/permissions.spec.ts` covers direct permissions, dependency expansion, legacy tax aliases, wildcard checks, and rejection of unrelated permissions. `RpcAccess` and tax-rate handler unit tests prove server use of the shared evaluator.
- Permission matrix coverage checks admin tax-rate, role-management, user-list, settings, and template write route denial. `src/app/admin/admin.routes.spec.ts` keeps the guarded admin route manifest explicit. Role lookup UI behavior still needs Browser/E2E coverage once runtime review is available.
- `tests/docs/roles/roles.doc.ts` documents role creation, dependent permissions, and the explicit deferral of existing-user role assignment for relaunch.
- `tests/docs/roles/about-permissions.doc.ts` generates the `/docs/about-permissions` source from shared permission metadata, including group labels, permission keys/descriptions, dependent permissions, and the tenant-role/global-admin distinction.
- `tests/docs/roles/roles.doc.ts` links to `/docs/about-permissions` for permission reference details.
- Server unit coverage proves role lookup permissions, lookup-only result shaping, tenant-scoped lookup filters, role lookup not-found errors, and admin role list denial without `admin:manageRoles`.
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
- Keep route-manifest specs and permission-matrix route-denial cases aligned as admin, finance, template, and global-admin route trees change.
- Add UI/E2E coverage that least-privilege organizers can search/select tenant roles in event/template eligibility forms once Browser/runtime review is available.
- Keep `migration/steps/004_drop_legacy_stabilization_fields.ts` in the
  production migration path so any existing physical `showInHub`,
  `paymentStatus`, and `payment_status` artifacts are dropped when the
  schema/API surface is applied.
- Keep user-role assignment explicitly deferred until a real role-assignment RPC and UI are implemented.
- Add Browser-backed least-privilege organizer review for event/template role selectors once the local runtime is available; current server coverage proves lookup permissions and lookup-only result shaping, and the template Playwright autocomplete spec fails loudly when seeded roles are missing.

## Finance/Receipts

### Current Behavior

- Paid event registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and stores a pending `registration` transaction with Stripe checkout ids.
- Stripe `checkout.session.completed` marks the local transaction successful, confirms the registration, and moves the buyer plus guest spots from reserved to confirmed when the session is complete and paid.
- Stripe `checkout.session.expired` marks the local transaction cancelled, cancels the registration, and releases one reserved spot when the session is expired.
- Finance navigation is hidden behind `finance:*`, and `/finance` requires at least one finance child capability.
- The finance overview links to transactions, receipt approvals, and receipt reimbursements only when the user has the matching child permission.
- `finance.transactions.findMany` returns non-cancelled tenant transactions only to users with `finance:viewTransactions`.
- Event organizers or users with receipt-management capabilities can submit receipts from the event organize page.
- Receipt upload is a separate RPC that requires the target event id, preflights the caller through the same receipt-submit authorization used by `finance.receipts.submit`, then stores image/PDF originals in object storage or a local-unavailable placeholder when storage config is absent.
- Finance reviewers can approve/reject submitted receipts; reimbursement users can group approved receipts by submitter and record manual reimbursement transactions.
- Profile shows the current user's submitted receipts.

### Intended Behavior From Product Context

- Stripe is the payment source of truth; local state should mirror Stripe lifecycle and must not fake successful payment state.
- Users should receive registration confirmation and QR code only after successful registration; for paid events, after successful payment.
- Organizers may submit receipts after an event.
- Receipts are reviewed and reimbursed; the first version does not need sophisticated budgeting or receipt categories.
- Receipt review should support email notification when a receipt is reviewed.
- Finance and payment flows are high-risk and should be permission-safe, tenant-safe, and payment-safe.

### Issues and Risks

- **Addressed in this stabilization pass:** Stripe checkout completion now moves paid registration spots from `reservedSpots` to `confirmedSpots`, and checkout expiry releases the reserved spots. Both counter transitions are conditional on the registration actually leaving `PENDING`, preserving webhook replay safety.
- **Addressed in this stabilization pass:** `finance.transactions.findMany` now requires `finance:viewTransactions`, so direct RPC calls cannot read transaction amounts, comments, methods, or fees with authentication alone.
- **Addressed in this stabilization pass:** finance parent and child routes now have route-level permission guards. Transactions require `finance:viewTransactions`, receipt approvals require `finance:approveReceipts`, and receipt reimbursement requires `finance:refundReceipts`.
- **Addressed in this stabilization pass:** receipt media upload now includes the target `eventId`, checks tenant event existence for authorized callers, and requires `canSubmitEventReceipts` before object storage is touched. A signed-in user without receipt-submit access can no longer create orphan receipt objects through the upload RPC.
- **Addressed in stabilization pass:** manual receipt reimbursement is now labeled as recording a reimbursement in the finance overview, reimbursement list, receipt submit hint, profile payout fields, visible server messages, docs, and Playwright coverage. Reimbursement transaction comments no longer copy the full payout reference into free text. The legacy route path, permission name, RPC name, receipt status, and transaction type still use "refund" internally until a broader data/API migration is worthwhile.
- **Addressed in stabilization pass:** receipt submission and review now reject tax amounts greater than the total amount, matching the existing deposit/alcohol amount consistency guard.
- **Addressed in stabilization pass:** receipt submission now requires the target event to have ended before the server inserts a submitted receipt. The receipt Playwright flow uses the deterministic past event fixture for submission/review setup.
- **Addressed in stabilization pass:** profile and user-event summaries no longer read `event_registrations.paymentStatus`; payment display is derived from registration transaction rows. Seed and webhook-replay setup stopped writing `paymentStatus` for new fixture registrations, and the legacy payment-status column/enum have been removed from the application schema.
- **Addressed in stabilization pass:** receipt review records status locally, and the review detail page, success feedback, and finance docs explicitly tell finance reviewers that submitter notification is manual until a real delivery path exists.
- **Acceptable for now:** receipt review/reimbursement queries are tenant-scoped, and receipt reimbursement creation uses a transaction plus status preconditions to avoid reimbursing the wrong submitter or already-reimbursed receipts.

### Test and Documentation Quality

- Stripe webhook replay specs cover idempotent completed sessions, paid-registration counter transitions, expired-session reservation release, processing-claim behavior, stale-claim reclaim, payment-intent fallback, and ignoring unpaid completed sessions.
- Receipt flow specs cover receipt submission UI, receipt approval/reimbursement path, and tenant "Other" receipt country visibility.
- **Addressed in stabilization pass:** `tests/specs/finance/receipts-flows.spec.ts` now hard-fails when the seeded pending receipt, refundable receipt group, row checkbox, enabled reimbursement action, or tenant "Other" country option is missing.
- Finance overview docs now describe the current navigation-style finance UI, current finance capability names, and the manual submitter-notification caveat before and after receipt review.
- **Addressed in stabilization pass:** `tests/docs/finance/receipt-review-reimbursement.doc.ts` now walks the receipt approval queue, approval detail page, manual submitter-notification caveat, reimbursement queue, payout-detail selection, and manual reimbursement recording.
- Tax-rate docs and specs provide better active coverage for `admin:tax` and inclusive Stripe tax-rate import/selection.
- Server finance unit tests are still thin, but now include transaction-list permission denial, receipt-media upload preflight denial/success coverage, profile `finance.receipts.my` output normalization, and tax-amount consistency rejection on receipt submit/review.

### Product Questions Answered Above

- Should paid registration webhook handling update `confirmedSpots`/`reservedSpots`, or should counters be derived from registration rows instead of stored?
- Is `paymentStatus` still part of the model, or should it be removed/migrated in favor of registration status plus transactions? Answered locally: remove it from the application schema; current active reads use registration status plus transaction rows.
- Which finance capability should gate the transaction list: `finance:viewTransactions`, `finance:manageReceipts`, or a broader finance overview permission?
- Should receipt uploads be created only after submit authorization succeeds, or should upload sessions be issued from a receipt-submit preflight?
- Should receipt reimbursement remain a manual ledger action, or will it eventually integrate with a payout provider?
- Should receipts be restricted to event end dates, or is pre-event spending intentionally allowed? Current behavior restricts submitted receipts to events whose end time has passed.

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
- **Acceptable for now:** QR code display is limited to confirmed registrations in the active registration UI, so pending paid registrations do not show the ticket card there.

### Test and Documentation Quality

- `tests/specs/scanning/scanner.test.ts` now clicks "Confirm Check In" with selected guests and asserts that `checkInTime`, `checkedInGuestCount`, and `checkedInSpots` update, then restores the seeded row.
- `src/app/events/event-organize/event-organize.spec.ts` covers organizer overview stat aggregation from registration-option counters, including scanner-updated `checkedInSpots` totals.
- Server unit coverage proves scan-read denial for unauthorized tenant users, check-in counter updates for organizer access, selected guest check-in behavior, remaining-guest scan behavior after buyer check-in, idempotent duplicate check-in behavior, and same-user check-in denial.
- `src/server/http/qr-code.web-handler.spec.ts` covers unauthenticated QR denial, owner access, same-event organizer access, other-user denial, and pending-registration denial.
- `src/app/scanning/scanner/scanner.component.spec.ts` covers scanner URL parsing for current-origin tickets, other-origin tenant tickets, malformed payloads, and non-exact scan paths.
- Server unit coverage proves future-event timing disables scan check-in and rejects direct check-in writes before the pre-start window opens. Server unit coverage also proves pending, cancelled, and waitlisted registrations disable scan check-in and reject direct check-in writes.
- `tests/docs/events/register.doc.ts` documents that the ticket QR code is available after registration/payment and no longer claims QR email delivery exists in the current relaunch flow.
- `tests/docs/events/event-management.doc.ts` documents the organizer-facing QR scan/check-in flow, including scan warnings, check-in authorization, checked-in count updates, and selected guest-quantity check-in.
- `QUALITY.md` lists participant and guest-quantity check-in as high-value Playwright flows; the scanner spec now covers selected guest check-in, while Browser-backed organizer aggregate review still depends on local runtime availability.

### Product Questions Answered Above

- Should check-in be allowed for confirmed organizer/helper registrations, users with `events:organizeAll`, a new `events:checkIn` capability, or all of those?
- Should scanning be allowed before event start, within a configurable window, or only after a manual organizer override?
- Should duplicate scans be idempotent success, warning-only, or blocked after the first check-in?
- Should QR generation require the registration owner/organizer, or is an unguessable registration id considered enough for the image endpoint? Answered locally: require the confirmed registration owner, `events:organizeAll`, or a confirmed organizer/helper registration for the same event.
- Should scanner URL validation require the current tenant domain, any known tenant domain, or any URL with the expected path? Answered locally: accept any absolute URL origin because ticket URLs may be opened through tenant/custom domains, but require the exact scan-registration path and rely on server scan authorization for tenant/event access.
- What is the minimum relaunch scope for guest quantity check-in? Answered locally: the scanner lets organizers choose how many remaining guests to check in, so partial guest arrival is supported while buyer check-in remains idempotent.

### Recommended Cleanup Actions

- Keep server tests for same-user scans, unauthorized tenant users, duplicate scans, and counter updates.
- Keep server tests for pending/cancelled/waitlisted registrations.
- Extend the Playwright scanner spec to assert the organizer overview/check-in aggregate once runtime Browser review is available.
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
- **Addressed in stabilization pass:** profile event cards now link to event details and show registration status, selected option, guest quantity when applicable, payment state, and check-in time when available. Profile still leaves QR/ticket display, cancellation/refund action, and transfer/resale workflows to the event-detail flow or future work while exposing pending checkout continuation directly.
- **Addressed in stabilization pass:** profile event cards now label their event-details action as "Open event page" instead of implying that the profile card itself renders the ticket; confirmed ticket access remains on the event detail surface.
- **Addressed in stabilization pass:** profile event cards now point pending checkout registrations at the implemented profile-level recovery action, route ticket and cancellation details back to the event page, and keep waitlist movement, automatic refunds, and transfer/resale visibly out of the current implemented profile scope.
- **Addressed in stabilization pass:** profile reimbursement fields are global user fields by product decision, and the profile copy now labels them as optional global reimbursement details used for manual receipt reimbursements across tenants.
- **Addressed in stabilization pass:** ESNcard save, refresh, and remove actions now clear stale errors, show visible pending button states, and map mutation failures through `getErrorMessage(...)` instead of rendering raw error objects.
- **Addressed in stabilization pass:** ESNcard validation now uses a bounded provider request and distinguishes provider unavailability from invalid/expired card results. Save/refresh mutations surface provider outages as retryable bad-request errors instead of collapsing them into card validation status.
- **Addressed in stabilization pass:** create-account mutation failures now render a visible retryable error on the form instead of failing silently after the submit attempt.
- **Acceptable for now:** profile receipt reads are tenant-scoped and user-scoped through `finance.receipts.my`.
- **Acceptable for now:** event price reads and registration writes both require a verified ESNcard in the current tenant before applying the ESNcard discount.

### Test and Documentation Quality

- `tests/docs/profile/user-profile.doc.ts` documents navigation, profile display, edit dialog validation, notification email persistence, event cards, and the receipts tab.
- `src/app/profile/user-profile/edit-profile-dialog.component.spec.ts` covers profile edit payload normalization for notification email and optional global reimbursement details before the update mutation receives the dialog result.
- `src/app/profile/user-profile/user-profile.component.spec.ts` covers profile event action, guest-quantity, deferred-action notes, payment-continuation next-step copy, payment-state, registration-status labels, submitted-receipt status labels, ESNcard upsert payload normalization, and readable ESNcard mutation error fallback/provider messages.
- **Addressed in stabilization pass:** the profile doc no longer uses a fixed stabilization wait before the profile screenshot, now saves and verifies notification email persistence, and opens the Events section to document event-card semantics.
- `tests/docs/profile/discounts.doc.ts` documents the discount-card section and current pending/error behavior, but does not add, refresh, remove, or assert any ESNcard validation outcome.
- `tests/specs/discounts/esn-discounts.test.ts` verifies a seeded verified ESNcard affects paid event price labels and the register button copy.
- No reviewed Playwright spec proves profile discount-card management itself, browser-level account creation fallback behavior without Auth0 Management credentials, profile event action rendering, or submitted receipt visibility after receipt submission.
- `tests/docs/users/create-account.doc.ts` is integration-tagged and skips without Auth0 Management credentials, so baseline docs do not prove the account-creation path.
- `src/app/app.routes.spec.ts` pins the relaunch route contract that public event browsing uses only account-assignment checks, feature areas require assigned authenticated accounts, `/create-account` stays auth-only for tenantless authenticated users, and `/global-admin` remains auth-only before tenant assignment checks.
- `src/app/core/create-account/create-account.helpers.spec.ts` covers Auth0-data prefill fallback, explicit email-verification gating, create-account submit payload normalization, and create-account error message mapping without needing Auth0 Management credentials.
- `src/shared/rpc-contracts/app-rpcs/users.rpcs.spec.ts` covers notification email format validation at the account-creation and profile-update RPC boundary, matching the create-account and profile-edit form validation.
- `src/server/discounts/providers/index.spec.ts` covers ESNcard provider validation parsing and provider-unavailable distinction without hitting the external provider.
- `src/server/effect/rpc/handlers/discounts.handlers.spec.ts` covers global-per-user ESNcard reads, updating an existing global user card from another tenant context, refresh revalidation persistence, and current-user/type-scoped card removal.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` covers `users.events` tenant/user scoping, cancelled-registration exclusion, sorting, checkout URLs, check-in timestamps, guest counts, and payment-state mapping, plus `users.findMany` role aggregation, account creation transactionality, existing-global-user tenant joining, duplicate tenant-assignment conflict behavior, profile update persistence, and `users.userAssigned` behavior.

### Product Questions Answered Above

- Should a previously known global user be able to join a tenant automatically after Auth0 login, or should tenant joining require an invite/admin approval flow? Current implementation follows the automatic tenant-join direction for authenticated users who reach account creation.
- What is the intended home-tenant model, and should profile expose or warn about current tenant vs home tenant?
- Is `communicationEmail` a user-managed notification email, and should it differ from Auth0 login email?
- Are payout details global per person or tenant-specific per reimbursement context? Current implementation follows the global-per-person direction for relaunch.
- Are ESNcard records intended to be global per user, tenant-specific, or shared globally by card identifier? Current implementation follows the global-per-user direction while still requiring the current tenant to have ESNcard support enabled before managing or applying the card.
- Which profile event states should users be able to act on from the profile page: payment continuation, ticket QR, cancellation, waitlist, transfer/resale?

### Recommended Cleanup Actions

- Keep Browser-backed profile edit persistence coverage aligned with notification email behavior.
- Add Browser-backed profile event-card coverage for event links and registration/guest/payment/check-in state once runtime review is available.
- Add Browser-backed profile discount-card tests for add/refresh/remove and provider validation outcomes once runtime review is available. Local app/server coverage already proves upsert payload normalization, readable mutation errors, global card reads/upserts, refresh persistence, and scoped removal.
- Add profile/account tests for account creation retry/tenant-join behavior, profile edit persistence, ESNcard add/refresh/remove, profile event action rendering, and submitted receipt visibility.

## Tenant/Global Admin

### Current Behavior

- Tenants are resolved from request host first. On local hosts, the `evorto-tenant` cookie can select the tenant domain; otherwise the host domain is authoritative.
- If tenant resolution fails, SSR and RPC requests fail closed with a 404. A local probe with `Host: no-such-tenant.invalid` returned 404.
- Tenant records currently store one unique `domain`, name, currency, locale, timezone, theme, default location, Stripe account id, receipt settings, discount provider settings, SEO title/description, tenant legal links, and externally hosted logo/favicon URLs.
- Client config loads the current tenant and permission list through RPC and applies `theme-${tenant.theme}` to the document root.
- Tenant admin "General settings" shows a read-only identity summary with tenant name, primary domain, currency, locale, timezone, and Stripe connection state. It lets tenant admins change default location, site theme, externally hosted logo/favicon URLs, SEO title/description, legal links, receipt countries/allow-other, and ESNcard provider enablement plus buy URL. Configured legal links appear in the public app footer, and configured favicon URLs update the browser tab icon.
- Tenant settings writes are tenant-scoped and require `admin:changeSettings`; tax-rate admin reads/writes require `admin:tax`.
- `/global-admin` is guarded by authentication at the app route and by `globalAdmin:manageTenants` in the global-admin route config. The navigation link is hidden behind `globalAdmin:*`, and the tenant list RPC requires `globalAdmin:manageTenants`.
- Global admin currently exposes only a tenant list with id/name/domain. There is no tenant create/edit/detail flow.
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
- **Addressed in stabilization pass:** tenant general settings now expose tenant name, primary domain, currency, locale, timezone, and Stripe connection state as read-only operator context without expanding the settings update payload.
- **Addressed in stabilization pass:** tenant general settings now include a visible deferred-settings summary for custom-domain verification, logo/favicon uploads beyond externally hosted URLs, hosted legal text pages beyond external links, email sender name, review/publishing settings, registration limits, editable locale/currency/timezone, and Stripe account management. These fields are still not editable unless explicitly called out below.
- **Addressed in stabilization pass:** tenant logo and favicon URLs are now part of the `Tenant` RPC schema, editable from general settings, validated by `admin.tenant.updateSettings`, persisted with empty values normalized to `null`, and the configured favicon updates the browser tab icon.
- **Addressed in stabilization pass:** tenant SEO title and description are now part of the `Tenant` RPC schema, editable from general settings, persisted by `admin.tenant.updateSettings`, and used as the tenant-level document title/meta description when configured.
- **Addressed in stabilization pass:** tenant imprint/legal notice, privacy policy, and terms URLs are now part of the `Tenant` RPC schema, editable from general settings, validated by `admin.tenant.updateSettings`, persisted with empty values normalized to `null`, and rendered in the public app footer when configured.
- **Addressed in stabilization pass:** tenant-admin child routes now have route-level guards. Settings require `admin:changeSettings`, roles require `admin:manageRoles`, users require `users:viewAll`, tax rates require `admin:tax`, and event reviews require `events:review`.
- **Addressed in stabilization pass:** tenant settings saves now show a success notification and map failed updates through the shared readable error-message helper instead of relying only on mutation state.
- **Addressed in stabilization pass:** tenant general-settings documentation now covers the implemented relaunch surface and explicitly calls out deferred domain, branding, hosted legal text pages, email sender, review policy, registration limit, locale/currency/timezone, and Stripe-account settings.
- **Addressed in stabilization pass:** the tenant settings RPC payload schema is now exported and covered by a focused contract spec, including the current editable fields and the fact that deferred branding/domain fields are outside the update payload.
- **Addressed in stabilization pass:** the global-admin tenant list now renders the tenant domain and id returned by the RPC, and generated docs describe the current list-only global tenant administration surface.
- **Acceptable for now:** tenant settings writes are scoped to the current tenant id and validate the returned tenant shape before responding.
- **Acceptable for now:** unknown host requests fail closed with 404 instead of guessing a tenant.
- **Acceptable for now:** RPC request-context headers are overwritten server-side before handler execution, so client-supplied `x-evorto-*` headers are not trusted as the source of tenant/user context.

### Test and Documentation Quality

- `src/server/context/tenant-schema.spec.ts` covers tenant schema defaults and RPC header serialization around optional default location.
- `src/server/effect/rpc/handlers/middleware/rpc-request-context.middleware.spec.ts` covers decoding RPC context headers, including tenant and permissions.
- `src/app/core/effect-rpc-angular-client.spec.ts` covers SSR RPC origin selection from incoming URL and forwarded headers.
- `tests/specs/auth/storage-state-refresh.test.ts` covers stale/wrong tenant cookies in saved Playwright storage state, not runtime tenant resolution.
- `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts` checks seeded tenant tax-rate isolation directly in the database, but does not exercise the RPC/UI tenant context switch.
- `tests/specs/permissions/matrix.spec.ts` covers route denial for `/admin/settings`, `/admin/roles`, `/admin/users`, `/admin/tax-rates`, `/finance/transactions`, `/finance/receipts-approval`, `/finance/receipts-refunds`, and template write routes. `tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts` adds focused tax-rate route denial coverage. Route-manifest unit specs cover admin, finance, template, and global-admin guard declarations without requiring page-backed runtime. `tests/specs/permissions/global-admin-route-guard.spec.ts` covers direct `/global-admin` allow/deny behavior once page-backed runtime is available.
- `tests/docs/admin/general-settings.doc.ts` documents the current tenant general-settings page, including the deferred-settings summary, read-only tenant identity summary, editable brand asset URLs, editable tenant legal links, and public footer/favicon exposure, and records which branding/domain/hosted-legal-text settings are not editable yet.
- `tests/docs/admin/global-admin.doc.ts` documents the current global-admin tenant list and records that tenant create/edit/detail, custom-domain verification, and impersonation workflows are not implemented yet.
- `tests/docs/finance/inclusive-tax-rates.doc.ts` documents tenant tax-rate management.
- `src/shared/rpc-contracts/app-rpcs/admin.rpcs.spec.ts` covers the tenant settings update payload scope.
- `src/app/global-admin/global-admin.routes.spec.ts` covers route-level global-admin permission requirements.
- `src/server/effect/rpc/handlers/global-admin.handlers.spec.ts` covers explicit `globalAdmin:manageTenants` authorization, `globalAdmin:*` dependency authorization, and fail-closed forbidden/unauthorized tenant-list reads before querying tenants.
- `src/server/context/request-context-resolver.spec.ts` covers host-first tenant resolution, localhost tenant-cookie fallback, stale localhost tenant-cookie fallback, unknown-host failure, global-admin permissions resolving without a tenant user assignment, and tenant-user context failing closed when the Auth0 user has no current-tenant assignment.
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
- Keep generated global-admin tenant-management documentation aligned if the surface expands beyond the current tenant list.
- Keep tenant settings save feedback aligned with the shared notification/error-message pattern.
- Keep tenant SEO title/description and legal links aligned between the Tenant RPC schema, general settings, and generated documentation.

## Generated Documentation and Playwright Coverage

### Current Behavior

- Playwright has separate baseline spec and docs projects. Baseline specs exclude `tests/docs/**`; docs baseline runs `tests/docs/**/*.doc.ts`; integration-only docs are selected with `@needs-*` tags.
- Local docs/spec discovery is runnable again after replacing stale Effect config APIs in `playwright.config.ts` and Playwright support files, and Auth0 Management credentials are no longer required just to import baseline fixtures.
- `bun run test:e2e -- --list` discovers 81 baseline tests across 23 files,
  including setup projects, without requiring local Auth0/Stripe secrets.
- `bun run test:e2e:docs -- --list` discovers 25 baseline docs/setup tests
  across 18 files without requiring local Auth0/Stripe secrets.
- The custom documentation reporter writes grouped Markdown pages and image assets to paths from `DOCS_OUT_DIR` / `DOCS_IMG_OUT_DIR`, defaulting to ignored repository-local `test-results/docs` paths.
- The reporter initializes and clears docs/image output roots on `onBegin` only for real test execution. During Playwright `--list` discovery it no-ops and does not clean or write docs output.
- Reporter-path tests pass with `bun run test:e2e -- tests/specs/reporting/reporter-paths.test.ts --no-deps`.
- The focused screenshot helper test cannot currently run here because the configured Playwright Chromium binary is missing.

### Intended Behavior From Product Context

- Generated documentation should reflect real product workflows and should not describe unimplemented UI.
- Browser/manual exploration is useful for discovery, while Playwright is the durable layer for regressions and generated documentation.
- Documentation and tests should stay lightweight and operational, not become a heavyweight requirements matrix.
- Product-critical flows should be discoverable for users and repeatable for future agents.

### Issues and Risks

- **Addressed in stabilization pass:** `tests/specs/events/price-labels-inclusive.spec.ts` is now fixme-only. The old TODO-heavy placeholder bodies and page-load assertions are gone, so it no longer appears to provide active inclusive-price UI coverage.
- **Addressed in stabilization pass:** intentionally deferred price/tax `test.fixme` declarations no longer carry placeholder `@track`/`@req` ids; they remain plain backlog declarations until active Browser-backed coverage replaces them.
- **Must fix before agent scaling:** some specs still intentionally skip for integration credentials or explicit deferred coverage, but the known misleading fixture-state examples from this pass now fail loudly when expected seeded state is missing: receipt approval/refund rows, receipt dialog options, unlisted-event seed state, event-creation setup, scanner preconditions, regular-user registration tenant setup, template icons, and template role autocomplete.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts` now documents the current event details, registration, review/listing, organizer overview, participant grouping, and receipt surfaces instead of stale attendee export, attendee messaging, settings, tags, featured images, notifications, integrations, or deletion flows.
- **Addressed in stabilization pass:** `tests/docs/finance/finance-overview.doc.ts` now documents the current finance permission split and transaction/receipt navigation behavior.
- **Addressed in stabilization pass:** Playwright discovery was broken by stale Effect config APIs and by import-time Auth0 Management config reads in baseline fixtures. Both are fixed locally, but they show the e2e/docs surface was not being exercised recently enough.
- **Addressed in stabilization pass:** list-only Playwright commands no longer initialize docs output, clear generated docs/image directories, or require Auth0 Management credentials for baseline fixture imports.
- **Addressed in stabilization pass:** list-only Playwright config now uses inert placeholder values for runtime-only Auth0/Stripe secrets, so docs/spec discovery can enumerate tests without local secret stubs, starting Docker, or contacting external services.
- **Addressed in stabilization pass:** participant-facing event registration cards now receive tax-rate label metadata from `events.findOne` and render paid option prices through the shared inclusive tax label component. The Playwright price-label file remains fixme-only until Browser-backed page assertions can run in a local runtime.
- **Should fix before relaunch:** page-backed Playwright specs still fail in this checkout because the configured Chromium binary is missing. `tests/specs/screenshot/doc-screenshot.test.ts` seeds data and then fails at browser launch.
- **Addressed in stabilization pass:** `tests/test-inventory.md` now maps current Playwright specs/docs by suite ownership, records intentional fixme and credential-gated paths, and lists the Browser-backed coverage still needed from the remaining stabilization gaps.
- **Addressed in stabilization pass:** the remaining `test.skip` audit removed the dead mobile skip from `tests/specs/permissions/override.test.ts`, corrected the inventory entry for that spec, made the Auth0 Management doc skip name the required credentials explicitly, and moved Stripe webhook replay's credential gate to a file-level skip before page/database fixtures are requested.
- **Addressed in stabilization pass:** global-admin route guard coverage now has a direct Playwright spec for the global-admin allow path and signed-in non-global-admin deny path.
- **Addressed in stabilization pass:** scanning/check-in docs now describe the dedicated QR scanner, scan warnings, authorization, checked-in count updates, and selected guest-quantity check-in. The remaining scanner follow-up is Browser-backed organizer aggregate assertion, not missing product documentation.
- **Should fix before relaunch:** docs coverage is still missing or thin for tenant/global-admin settings beyond the current list/settings pages, account creation outside Auth0-management integration, profile discount add/refresh/remove flows, role assignment/user management, and registration negative paths.
- **Addressed in stabilization pass:** the generic `tests/docs/template.doc.ts` discovery placeholder was removed; current template documentation lives in `tests/docs/templates/templates.doc.ts`.
- **Addressed in stabilization pass:** the focused `docScreenshot` helper now resolves `DOCS_IMG_OUT_DIR` at call time instead of import time, so tests and docs jobs can set output paths per run. Some docs journeys still contain fixed waits and should be tightened as those flows are revisited.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts` now waits on concrete headings instead of fixed one-second delays before its major screenshots.
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

- Replace fixme-only price-label specs with focused assertions once the seeded/browser UI path can prove the behavior.
- Keep event-management and finance-overview docs aligned as the live UI changes; both were rewritten during this stabilization pass and should not be treated as stale product truth.
- Continue auditing remaining `test.skip` usage so credential/integration skips stay honest and fixture-state gaps become hard failures or explicit `test.fixme` states.
- Keep docs/list commands free of reporter output cleanup, runtime secret requirements, and local browser startup.
- Update `tests/test-inventory.md` after stale/placeholder docs are pruned.
- Add missing docs/specs for tenant/global-admin settings, account/profile persistence, role/user management, and negative registration paths as those flows are stabilized.

## Local Runtime/Developer Workflow

### Current Behavior

- The repo is Bun-first. `packageManager`, the Docker base image, local Bun, and CI setup now agree on Bun `1.3.11`.
- Important entrypoints remain visible in `package.json`: app build/dev, unit tests, Playwright e2e/docs, Docker stack start/resume/stop, database commands, dependency updates, Stripe/Sentry ops, theme generation, and receipt-image cleanup.
- Local runtime config uses `.env.dev.local` for tracked shared defaults, `.env.dev` for generated worktree-specific values, and `.env` for untracked developer secrets.
- `bun run env:runtime` writes `.env.dev` with worktree-specific `COMPOSE_PROJECT_NAME`, Neon Local port, MinIO ports, `BASE_URL`, and local `DATABASE_URL`.
- Local `test:e2e`, `test:e2e:ui`, `test:e2e:docs`, `db:*`, and `docker:*` scripts now refresh `.env.dev` before running `dotenv -c dev`, reducing fresh-worktree and wrong-database risk.
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
- **Should fix before relaunch:** Playwright `webServer` still runs the foreground Docker stack through a destructive `docker compose down` and `db-setup` reset. This is documented, but future agents should treat it as a database-resetting command, not a harmless server start.
- **Addressed in stabilization pass:** `bun run docker:resume` now provides a non-recreating resume path for an already initialized Docker stack, while `docker:start`, `docker:start:foreground`, and `docker:start:watch` keep the explicit reset-from-zero behavior.
- **Addressed in this stabilization pass:** `bun run docker:check` reports missing Neon Local, Auth0, Stripe, session, and Font Awesome registry variables before Docker Compose mutates local containers. Docker now writes the same Font Awesome registry scopes as the checked-in `.npmrc`, so premium and brand icon packages can use the same build-secret token path. It also reports local tool readiness and warns when Playwright browsers are missing without blocking Docker start. The Compose-managed Stripe CLI listener writes its generated webhook signing secret into a shared volume and the app reads it through `STRIPE_WEBHOOK_SECRET_FILE`, so a static `STRIPE_WEBHOOK_SECRET` is no longer a Docker-start blocker. The current worktree is missing `NEON_API_KEY`, `CLIENT_SECRET`, and `STRIPE_API_KEY`, so a fresh full Docker start is intentionally blocked until those secrets are provided.
- **Addressed in stabilization pass:** `helpers/testing/runtime-preflight.spec.ts` now pins that destructive Docker start scripts call `docker:check` first, required runtime variables are wired into Compose services, and Font Awesome registry access remains available to Docker through the same secret path for premium and brand icon packages.
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
- CI and local setup both install or expose Playwright browser installation, but full local e2e still was not run because it would start/reset the Docker runtime; an earlier page-backed check showed the matching browser binary still needs `bun run test:e2e:install`.

### Product Questions Answered Above

- Should generated docs output default to this repository's ignored `test-results/docs` locally, with publishing to `evorto-pages` handled by an explicit docs-publish flow?
- Should `docker:start` keep resetting local database state on every start, or should there be separate reset and non-reset local server commands?
- Should finance docs remain excluded from CI docs baseline until the finance behavior is stabilized, or should they fail loudly now? Answered locally: include them in the baseline docs run now that the finance overview documentation has been rewritten to current behavior.
- Should Playwright use bundled Chromium only, or should local development prefer a system Chrome channel when available?

### Recommended Cleanup Actions

- Keep docs publishing explicit if `evorto-pages` output is needed; normal local docs output stays in ignored `test-results/docs`.
- Keep `docker:resume` scoped to already initialized stacks; use the destructive `docker:start*` scripts when seeded-from-zero behavior matters.
- Keep rewritten finance docs in the CI docs baseline unless a future integration-only dependency is introduced and explicitly tagged.
- Keep `package.json` as the visible command surface and avoid moving core workflow commands into hidden helper CLIs.

## Prioritized Cleanup Backlog

### Must Fix Before Agent Scaling

1. Continue pruning misleading placeholder tests/docs from profile/account and remaining thin documentation surfaces before agents treat generated docs as product truth.
2. Keep the Playwright skip/fixme inventory guard current whenever an
   intentional credential gate or Browser-backed placeholder changes.
3. Keep server-side template permission, validation, and route-guard coverage in place as template behavior expands beyond simple mode.
4. Keep role lookup APIs lookup-only for event/template eligibility flows; do not re-expose admin role-management data to organizers.
5. Keep admin, finance, global-admin, and template direct-route denial coverage current as route trees change.
6. Keep `tests/test-inventory.md` aligned whenever placeholder specs/docs are removed or reclassified.

### Should Fix Before Relaunch

1. Implement transfer/resale; keep automatic refund handling visible until the finance flow is implemented.
2. Add Playwright coverage for negative registration paths and role-ineligible direct links.
3. Keep simple-mode templates as the primary authoring UI, but expand reusable template support for discounts, add-ons, and questions where practical. Organizer planning tips are now exposed as the first private organizer-notes field.
4. Run the covered legacy-field migration path in production so any existing physical `showInHub`, `paymentStatus`, and `payment_status` artifacts are dropped now that active schema/API code no longer uses them.
5. Add Browser-backed scanner/organizer aggregate review once local runtime is available.
6. Add Browser-backed profile coverage for payment-continuation, ticket/cancellation routing, waitlist messaging, and ESNcard provider failure semantics once local runtime is available.
7. Fill the remaining tenant settings implementation gap for branding uploads, legal text pages, onboarding/domain workflows, locale/currency/timezone policy, and global tenant-admin workflows. The current general-settings page exposes SEO fields, externally hosted logo/favicon URLs, tenant legal links, read-only runtime identity, and a visible deferred-settings summary.
8. Keep `docker:start` reset behavior intentional, use `docker:resume` only for existing local stacks, and ensure seeded data is sufficient to get going from zero.

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
- Permission evaluator pass: routed legacy server permission checks through the shared `includesPermission` helper so client and server agree on dependencies, wildcards, and legacy aliases, and added direct unit coverage for the shared evaluator plus tax-rate dependency behavior.
- Role/user cleanup pass: removed placeholder user-list selection/edit affordances, aligned the roles doc with the current no-role-assignment UI, and fixed `users.findMany` to return only the RPC contract shape.
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
- Template tax-rate coverage pass: covered the compatible active/inclusive current-tenant tax-rate query and paid missing-tax-rate submit normalization so the remaining fixme is narrowed to page-level simple-mode UI assertions.
- Scanner aggregate coverage pass: extracted organizer overview stat aggregation and covered the checked-in total against registration-option `checkedInSpots`, keeping local app logic aligned with scanner mutation counters while Browser aggregate review remains blocked.
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
- Receipt reimbursement wording pass: renamed finance-facing receipt reimbursement copy away from "refund" for manual ledger actions while leaving legacy internal route/API/database names for a later migration.
- Receipt amount validation pass: rejected receipt submit/review payloads where tax exceeds the total amount and added focused server coverage for both write paths.
- Payment-status deprecation pass: stopped active profile/user-event reads and fixture setup from relying on `event_registrations.paymentStatus`; user-facing payment state now derives from registration transaction rows, and the legacy field/enum have been removed from the application schema.
- Receipt timing pass: restricted receipt submission to events whose end time has passed and pointed receipt Playwright setup at the deterministic past event fixture.
- Receipt timing backlog cleanup: removed the stale relaunch checklist item that still treated pre-event receipt submission policy as undecided after the server rule, Playwright setup, and finance notes had already settled on post-event submission.
- Scanner status-coverage pass: added focused scan-read and direct-check-in coverage for pending, cancelled, and waitlisted registrations.
- Tenant settings feedback pass: added explicit success and readable error notifications for general settings saves.
- Tenant SEO settings pass: exposed stored tenant SEO title/description through the Tenant RPC schema, general settings UI, admin settings persistence, and tenant-level document metadata.
- Tenant domain-scope docs pass: aligned root product/architecture docs with the current one-active-domain relaunch model and left automated multi-domain/custom-domain verification as later tenant-onboarding work.
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
- Role autocomplete backlog cleanup: replaced the stale skip-based autocomplete follow-up with the remaining Browser-backed least-privilege organizer review, after confirming role lookup unit coverage and the active template autocomplete spec already fail loudly on missing seeded roles.
- Registration negative-path backlog cleanup: clarified the Playwright inventory so closed-window, role-ineligible, unsupported-mode, and waitlist items point to the remaining Browser-backed page states rather than implying server/app negative-path coverage is absent.
- Active-registration deferred-action pass: kept transfer/resale visibly
  unavailable on event active-registration cards for pending, confirmed, and
  waitlisted registrations until the real transfer/resale flow exists.
- Tax-rate validation coverage pass: covered the shared server validator for
  paid/free registration option tax-rate rules, including tenant-missing,
  inactive, and exclusive tax rates.
- Receipt review docs pass: added a generated documentation journey for receipt approval and manual reimbursement recording, then removed receipt review/reimbursement from the generic missing-docs backlog.
- Profile edit docs pass: extended the user-profile documentation journey to save a changed notification email, assert the refreshed profile summary, and restore the seeded user record after the doc run.
- Create-account gate coverage pass: extracted the email-verification form gate into a typed helper and covered verified, unverified, null, and absent Auth0 email-verification states without requiring Auth0 Management credentials.
- Playwright skip-inventory pass: added a local unit guard that allowlists every
  current Playwright `test.skip` and `test.fixme`, keeping future fixture-state
  gaps from becoming silent placeholders.
- Global-admin tenant-list pass: expanded the tenant list contract and UI with
  non-sensitive operational state for support review, including theme,
  locale/currency/timezone, and Stripe connection status.
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
- Docker resume command pass: added `bun run docker:resume` as a non-recreating
  path for already initialized Docker stacks and documented the difference from
  reset-from-zero `docker:start*` commands.
- Font Awesome registry contract pass: pinned that both the premium duotone icon
  package and the brand icon package stay installed through the shared Font
  Awesome registry path used by local installs and Docker builds.
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
- Registration-card unsupported-mode coverage pass: pinned that stored
  `random` and `application` participant options do not expose the lightweight
  waitlist action when full, keeping the card aligned with the server-side
  fail-closed registration-mode policy.
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
- Generated docs metadata pass: removed the remaining placeholder
  `@track`/`@doc` title metadata from product-facing generated docs while
  keeping meaningful suite tags such as `@admin`, `@globalAdmin`, and
  `@finance` visible in list/discovery output.
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
  still missing and needs `bun run test:e2e:install` before page-backed runs.
- Backlog evidence refresh: reran the skip/fixme inventory guard, the legacy
  stabilization field guard, and the focused registration copy/deferred-action
  component specs before pruning completed organizer/helper signup and skip
  audit action wording from the prioritized backlog.

## Review Next

All ten first-pass review areas are now represented in this document. The next
stabilization work should continue with small cleanup commits around the
remaining relaunch gaps: Browser-backed profile action coverage, Browser-backed
scanner aggregate review, the remaining tenant settings implementation scope,
running the legacy-field migration path for production data, and replacing
intentionally fixme-only price/tax specs with active Browser-backed coverage
once the local runtime is available. Normal generated docs output now stays
local unless `test:e2e:docs:publish` is run intentionally. New Playwright
skips/fixmes should be added only as explicit credential gates or honest
Browser-backed stabilization placeholders. Receipt notification remains a
future product delivery path; the current relaunch scope records receipt review
locally and keeps finance-facing copy explicit that submitter notification is
manual.
