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
| Finance/receipts                                | First pass complete | partial    | Payments, transactions, receipt review/refund, and docs reviewed; high-risk gaps remain.                                                              |
| Scanning/check-in                               | First pass complete | partial    | QR display and persisted check-in mutation exist; timing, camera, and guest-quantity follow-ups remain.                                               |
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
- **QR generation authorization:** an unguessable registration id is enough to
  render the QR image.
  - Option A: unguessable id is enough.
  - Option B: require owner or organizer/check-in authorization.
  - Option C: signed expiring QR URLs.
  - Decision: Option A. QR links behave like common event paper tickets and must
    be usable in email. Check-in should validate registration status and expose
    attendee identity so the scanner can confirm the right person is presenting
    the ticket.
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
- Event creation copies template option discounts by submitted source template option id instead of matching option titles.

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
- Paid registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and shows a payment continuation link.
- Registration writes enforce approved event status, tenant scope, open/close windows, role eligibility, one active registration per user/event, and capacity before creating a registration.
- Capacity reservation/confirmation uses a database transaction with a conditional counter update.
- Full registration options are labeled as full in the event detail UI; waitlist joining remains unavailable.
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
- **Should fix before relaunch:** no guest quantity is present in the event registration contract or UI, even though guest spots are an intended first-version behavior.
- **Addressed in stabilization pass:** full options no longer present an enabled registration action; the UI labels waitlist joining as unavailable until the separate waitlist flow exists.
- **Addressed in stabilization pass:** registration submission now rejects stored `random` and `application` options server-side instead of silently handling them as first-come-first-served.
- **Should fix before relaunch:** cancellation exists only for pending user registrations; participant cancellation, admin cancellation, transfer/resale, and refund flows are not implemented in the reviewed event registration path.
- **Addressed in stabilization pass:** active registration status now uses the shared persisted registration status literal union instead of raw `Schema.String`.
- **Acceptable for now:** paid registration rollback is careful about cleaning up a failed checkout session creation path; deeper Stripe lifecycle review belongs in the finance pass.

### Test and Documentation Quality

- `tests/specs/events/free-registration.test.ts` covers the free registration happy path using seeded scenario handles.
- `src/server/effect/rpc/handlers/events/event-registration.service.spec.ts` covers server-side rejection for duplicate active registration, unpublished events, closed registration windows, role-ineligible users, cross-tenant options, full options, unsupported registration modes, same-event second registrations across options, transactional duplicate races, and transactional capacity races.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers server-side rejection of end-before-start events and close-before-open registration windows for event create/update.
- `src/server/effect/rpc/handlers/events/events-lifecycle.handlers.spec.ts` covers template discount copying by stable source option id when template options share the same title.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers acceptance and rejection for the shared event location schema now used by Events RPC contracts.
- `src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts` covers the active registration status literal union and rejects unknown statuses.
- `tests/docs/events/event-management.doc.ts` now documents only the current event details, registration, review/listing, edit, organizer overview, participant grouping, and receipt surfaces.
- `tests/docs/events/unlisted-admin.doc.ts` covers the updated direct-link explanation in the listing dialog and on unlisted event details.
- `tests/docs/events/register.doc.ts` covers free and paid registration as generated documentation and Stripe-backed evidence.
- `src/server/price/format-inclusive-tax-label.spec.ts` covers the shared inclusive-tax label formatter.
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
- Template detail pages show description, optional location, registration option role chips, price/tax label when paid, capacity, mode, and registration open/close offsets.
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
- **Should fix before relaunch:** template discounts and add-ons exist in schema, but simple-mode template create/update does not expose or persist discounts/add-ons. Event creation has separate discount-copying logic, but the simple template editing path cannot maintain those richer fields.
- **Addressed in this stabilization pass:** registration mode now only offers first-come-first-served in event/template authoring controls. The contracts still accept existing stored `random`/`application` values, but new/edit UI no longer presents unsupported fulfillment modes.
- **Addressed in this stabilization pass:** template create/edit components use scoped `consola/browser` loggers instead of direct `console.*` calls.
- **Acceptable for now:** the template detail page is a useful read-only summary and the "Create event" action is discoverable from the detail surface.

### Test and Documentation Quality

- `tests/specs/templates/templates.test.ts` covers create, view, empty-category add flow, and role autocomplete duplicate hiding.
- `tests/docs/templates/templates.doc.ts` documents simple-mode template creation, role defaults, payment field visibility, and role-picker behavior.
- `tests/specs/templates/paid-option-requires-tax-rate.spec.ts` is intentionally fixme-only until template tax-rate behavior has active simple-mode UI coverage.
- The generic `tests/docs/template.doc.ts` discovery placeholder was removed; product template documentation lives in `tests/docs/templates/templates.doc.ts`.
- Permission matrix coverage checks template create link visibility plus direct route denial for template create/edit/create-event routes. Server unit coverage proves template RPC denial, template offset ordering, tenant-owned template category/role validation, and template location schema rejection.

### Product Questions Answered Above

- Is simple mode the intended relaunch template scope, or should richer registration options/add-ons/questions/organizer notes be available before relaunch?
- Should `random` and `application` registration modes be selectable now if registration fulfillment does not implement those semantics?
- Should template view require `templates:view`, or should organizers with `events:create` inherit template view through permission dependencies only?
- Should template category management remain a separate capability from template creation/editing?

### Recommended Cleanup Actions

- Keep permission-matrix coverage for direct template write-route denial.
- Keep focused `SimpleTemplateService` coverage for tenant-owned template category/role validation.
- Keep focused `SimpleTemplateService` coverage for template offset ordering.
- Keep template and event RPC location fields aligned on the shared `EventLocation` schema.
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
- **Should fix before relaunch:** role form fields for hub display are misleading. The form exposes "Show this role in the hub" and "Collapse the members of this role by default", but create/update contracts and handlers ignore those fields, and `findHubRoles` filters `displayInHub` while the form edits `showInHub`.
- **Should fix before relaunch:** `users:assignRoles` exists and depends on `users:viewAll`, but there is no reviewed role-assignment RPC or working UI.
- **Addressed in stabilization pass:** the user list no longer shows placeholder selection or "Edit template" actions for user-role assignment.
- **Should fix before relaunch:** permission metadata is mostly generated from camelCase keys and lacks durable admin-facing descriptions, even though product context says capabilities should have admin-facing names and descriptions.
- **Acceptable for now:** roles are tenant-scoped in schema and role-management write queries include tenant boundaries.

### Test and Documentation Quality

- `src/shared/permissions/permissions.spec.ts` covers direct permissions, dependency expansion, legacy tax aliases, wildcard checks, and rejection of unrelated permissions. `RpcAccess` and tax-rate handler unit tests prove server use of the shared evaluator.
- Permission matrix coverage checks admin tax-rate, role-management, user-list, settings, and template write route denial. Role lookup UI behavior still needs Browser/E2E coverage once runtime review is available.
- `tests/docs/roles/roles.doc.ts` documents role creation and dependent permissions without claiming that current role-management UI can assign roles to existing users.
- `tests/docs/roles/roles.doc.ts` links to `/docs/about-permissions`; no matching checked-in documentation source was found in this pass.
- Server unit coverage proves role lookup permissions, lookup-only result shaping, role lookup not-found errors, and admin role list denial without `admin:manageRoles`.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` verifies `users.findMany` aggregates role names into the RPC contract shape without leaking the joined `role` column.

### Product Questions Answered Above

- Which role reads should be available to organizers creating events/templates, and should they expose only id/name/default flags instead of permissions?
- Should `events:create` imply `templates:view` only in the client, or should resolved permissions always include dependencies before reaching server handlers?
- Should admin overview be visible to users with any `admin:*` capability, or should each admin child be discoverable only by its own permission?
- What is the intended relaunch scope for assigning users to roles?
- Should hub role visibility use `showInHub` or `displayInHub`, and should one of those fields be removed/migrated?

### Recommended Cleanup Actions

- Keep permission checks routed through `includesPermission` or `RpcAccess.ensurePermission`; avoid reintroducing direct `.includes(...)` authorization checks.
- Extend route-guard coverage to the remaining permission-sensitive surfaces, including finance routes and global-admin routes.
- Add UI/E2E coverage that least-privilege organizers can search/select tenant roles in event/template eligibility forms once Browser/runtime review is available.
- Fix or remove hub role form fields until `showInHub` / `displayInHub` semantics are explicit and persisted.
- Implement or explicitly defer user-role assignment before exposing assignment controls.
- Replace skip-based role autocomplete coverage with an assertion that proves least-privilege organizers can see selectable roles when editing event/template eligibility.

## Finance/Receipts

### Current Behavior

- Paid event registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and stores a pending `registration` transaction with Stripe checkout ids.
- Stripe `checkout.session.completed` marks the local transaction successful, confirms the registration, and moves one spot from reserved to confirmed when the session is complete and paid.
- Stripe `checkout.session.expired` marks the local transaction cancelled, cancels the registration, and releases one reserved spot when the session is expired.
- Finance navigation is hidden behind `finance:*`, and `/finance` requires at least one finance child capability.
- The finance overview links to transactions, receipt approvals, and receipt refunds only when the user has the matching child permission.
- `finance.transactions.findMany` returns non-cancelled tenant transactions only to users with `finance:viewTransactions`.
- Event organizers or users with receipt-management capabilities can submit receipts from the event organize page.
- Receipt upload is a separate RPC that requires the target event id, preflights the caller through the same receipt-submit authorization used by `finance.receipts.submit`, then stores image/PDF originals in object storage or a local-unavailable placeholder when storage config is absent.
- Finance reviewers can approve/reject submitted receipts; refund users can group approved receipts by submitter and create manual refund/reimbursement transactions.
- Profile shows the current user's submitted receipts.

### Intended Behavior From Product Context

- Stripe is the payment source of truth; local state should mirror Stripe lifecycle and must not fake successful payment state.
- Users should receive registration confirmation and QR code only after successful registration; for paid events, after successful payment.
- Organizers may submit receipts after an event.
- Receipts are reviewed and reimbursed; the first version does not need sophisticated budgeting or receipt categories.
- Receipt review should support email notification when a receipt is reviewed.
- Finance and payment flows are high-risk and should be permission-safe, tenant-safe, and payment-safe.

### Issues and Risks

- **Addressed in this stabilization pass:** Stripe checkout completion now moves a paid registration spot from `reservedSpots` to `confirmedSpots`, and checkout expiry releases the reserved spot. Both counter transitions are conditional on the registration actually leaving `PENDING`, preserving webhook replay safety.
- **Addressed in this stabilization pass:** `finance.transactions.findMany` now requires `finance:viewTransactions`, so direct RPC calls cannot read transaction amounts, comments, methods, or fees with authentication alone.
- **Addressed in this stabilization pass:** finance parent and child routes now have route-level permission guards. Transactions require `finance:viewTransactions`, receipt approvals require `finance:approveReceipts`, and receipt reimbursement requires `finance:refundReceipts`.
- **Addressed in this stabilization pass:** receipt media upload now includes the target `eventId`, checks tenant event existence for authorized callers, and requires `canSubmitEventReceipts` before object storage is touched. A signed-in user without receipt-submit access can no longer create orphan receipt objects through the upload RPC.
- **Should fix before relaunch:** manual receipt reimbursement is labeled as "Issue refund" / "Refund transaction created", but it only records a successful local transfer/PayPal transaction. The UI should avoid implying that money was actually sent through a payout provider.
- **Should fix before relaunch:** receipt submission and review validate deposit/alcohol against total, but do not reject tax amounts greater than the total amount.
- **Should fix before relaunch:** receipts are intended as post-event submissions, but the reviewed server path allows receipt submission for any event where the user is allowed to organize/manage receipts.
- **Should fix before relaunch:** `event_registrations.paymentStatus` exists and tests seed it as `PENDING`, but the reviewed registration/payment paths do not maintain it. It is stale unless the product intentionally uses registration `status` as the only payment lifecycle state.
- **Should fix before relaunch:** receipt review records status locally but no reviewed-email or notification delivery path was found.
- **Acceptable for now:** receipt review/refund queries are tenant-scoped, and receipt refund creation uses a transaction plus status preconditions to avoid refunding the wrong submitter or already-refunded receipts.

### Test and Documentation Quality

- Stripe webhook replay specs cover idempotent completed sessions, paid-registration counter transitions, expired-session reservation release, processing-claim behavior, stale-claim reclaim, payment-intent fallback, and ignoring unpaid completed sessions.
- Receipt flow specs cover receipt submission UI, receipt approval/refund path, and tenant "Other" receipt country visibility.
- **Addressed in stabilization pass:** `tests/specs/finance/receipts-flows.spec.ts` now hard-fails when the seeded pending receipt, refundable receipt group, row checkbox, enabled reimbursement action, or tenant "Other" country option is missing.
- Finance overview docs now describe the current navigation-style finance UI and current finance capability names.
- Tax-rate docs and specs provide better active coverage for `admin:tax` and inclusive Stripe tax-rate import/selection.
- Server finance unit tests are still thin, but now include transaction-list permission denial plus receipt-media upload preflight denial/success coverage. Receipt submit/review amount preconditions remain mostly untested at the handler level.

### Product Questions Answered Above

- Should paid registration webhook handling update `confirmedSpots`/`reservedSpots`, or should counters be derived from registration rows instead of stored?
- Is `paymentStatus` still part of the model, or should it be removed/migrated in favor of registration status plus transactions?
- Which finance capability should gate the transaction list: `finance:viewTransactions`, `finance:manageReceipts`, or a broader finance overview permission?
- Should receipt uploads be created only after submit authorization succeeds, or should upload sessions be issued from a receipt-submit preflight?
- Should receipt reimbursement remain a manual ledger action, or will it eventually integrate with a payout provider?
- Should receipts be restricted to event end dates, or is pre-event spending intentionally allowed?

### Recommended Cleanup Actions

- Keep webhook-side regression tests asserting registration status, transaction status, and option counters together for paid checkout completion and expiry.
- Keep direct-route Playwright denial coverage for finance transaction, receipt approval, and receipt reimbursement routes.
- Rename receipt reimbursement UI copy from "refund" to "record reimbursement" unless an actual payout integration is added.
- Validate receipt tax amount against total amount on submit and review.
- Remove or deprecate `paymentStatus` in favor of registration status plus
  transaction rows after confirming no active behavior depends on it.
- Keep receipt flow specs deterministic: seeded approval/refund paths should fail loudly when expected rows, controls, or options are missing.
- Keep finance overview docs aligned with current navigation UI and permission names as reimbursement wording changes.

## Scanning/Check-In

### Current Behavior

- Confirmed user registrations show a "Your event ticket" card with a QR image at `/qr/registration/:registrationId`.
- The QR HTTP route looks up the registration by id, finds the registration tenant, and encodes a scan target URL using the current request protocol plus the tenant domain.
- `/scan` is an authenticated route that starts a camera-based QR scanner and navigates to `/scan/registration/:registrationId` when the QR URL path starts with `/scan/registration/`.
- `/scan/registration/:registrationId` calls `events.registrationScanned`, shows attendee name, event title/start time, registration option title, ESNcard discount notice, same-user warning, future-event warning, registration-status warning, and already-checked-in warning.
- The scan result enables "Confirm Check In" when the scanned registration is confirmed and does not belong to the scanner. The button calls `events.checkInRegistration`, then refetches scan state and shows a recorded-check-in state.
- `events.registrationScanned` and `events.checkInRegistration` require event check-in access: either `events:organizeAll` or a confirmed organizer/helper registration for the same event.
- `events.checkInRegistration` sets `event_registrations.checkInTime` and increments `event_registration_options.checkedInSpots` in one transaction. Duplicate scans return idempotent success without incrementing the option counter again.
- Event organize pages show aggregate checked-in counts from option counters and participant lists from registration rows; the old table-based check-in status UI is commented out.
- Seed data simulates check-ins for past events by writing `checkInTime` and `checkedInSpots`, so local/demo data can look more complete than the runtime behavior.

### Intended Behavior From Product Context

- Organizers run events and check in participants with QR-code check-in.
- Participants receive registration/check-in information only after successful registration; paid participants should only receive QR/check-in access after successful payment.
- Check-in is a high-risk event/registration state transition because it touches registration persistence, organizer access, guest quantities, QR codes, and event archival.
- Playwright should cover checking in participants and guest quantities for durable behavior.

### Issues and Risks

- **Addressed in this stabilization pass:** "Confirm Check In" now persists check-in state through `events.checkInRegistration` and updates both `checkInTime` and `checkedInSpots` transactionally.
- **Addressed in this stabilization pass:** scan reads and check-in writes are gated to `events:organizeAll` or a confirmed organizer/helper registration for the same event, so a normal authenticated tenant user cannot read attendee scan details by registration id.
- **Addressed in this stabilization pass:** duplicate scans are idempotent; already-checked-in registrations show a warning and the write path does not increment counters again.
- **Should fix before relaunch:** event timing is only a UI warning. `allowCheckin` is true for any confirmed other-user registration, even if the event starts more than one hour in the future.
- **Should fix before relaunch:** QR generation is unauthenticated. Registration ids are not discoverable in normal UI except by the holder, but the endpoint will generate a ticket QR for any known registration id without proving the requester is the attendee or an organizer.
- **Should fix before relaunch:** the scanner accepts any absolute URL whose path starts with `/scan/registration/`, ignoring origin. That keeps tenant-domain QR codes portable, but it should be an explicit product/security decision.
- **Should fix before relaunch:** camera startup errors are not mapped to a visible typed state. `qrScanner.start()` is fired without awaited error handling, so denied camera permission or unsupported devices can fail outside the component's error display.
- **Acceptable for now:** QR code display is limited to confirmed registrations in the active registration UI, so pending paid registrations do not show the ticket card there.

### Test and Documentation Quality

- `tests/specs/scanning/scanner.test.ts` now clicks "Confirm Check In" and asserts that `checkInTime` is set and `checkedInSpots` increments, then restores the seeded row.
- Server unit coverage proves scan-read denial for unauthorized tenant users, check-in counter updates for organizer access, idempotent duplicate check-in behavior, and same-user check-in denial.
- No server unit/integration test covers pending/cancelled/waitlisted scan denial or future-event timing enforcement.
- `tests/docs/events/register.doc.ts` documents that the ticket QR code is available after registration/payment, but there is no generated documentation journey for organizers scanning attendees.
- `QUALITY.md` lists participant and guest-quantity check-in as high-value Playwright flows, but guest quantities are not represented in the reviewed check-in contract/UI.

### Product Questions Answered Above

- Should check-in be allowed for confirmed organizer/helper registrations, users with `events:organizeAll`, a new `events:checkIn` capability, or all of those?
- Should scanning be allowed before event start, within a configurable window, or only after a manual organizer override?
- Should duplicate scans be idempotent success, warning-only, or blocked after the first check-in?
- Should QR generation require the registration owner/organizer, or is an unguessable registration id considered enough for the image endpoint?
- Should scanner URL validation require the current tenant domain, any known tenant domain, or any URL with the expected path?
- What is the minimum relaunch scope for guest quantity check-in?

### Recommended Cleanup Actions

- Keep server tests for same-user scans, unauthorized tenant users, duplicate scans, and counter updates.
- Add server tests for pending/cancelled/waitlisted registrations and event timing when the timing behavior is enforced.
- Extend the Playwright scanner spec to assert the organizer overview/check-in aggregate once runtime Browser review is available.
- Add generated organizer documentation for scanning an attendee once the mutation exists.
- Add visible scanner camera-error handling for permission denial and unsupported devices.

## Profile/Account Flows

### Current Behavior

- `/profile` is guarded by `userAccountGuard` and `authGuard`; anonymous direct access redirects to Auth0 login.
- `/create-account` is guarded by `authGuard`, so anonymous direct access starts the authenticated account-creation flow instead of rendering the form with empty auth data.
- Authenticated users without a tenant user assignment are redirected to `/create-account` by `userAccountGuard`.
- `users.createAccount` runs in one database transaction, creates a global user row when needed, creates a current-tenant assignment, and assigns tenant default-user roles.
- If a user with the same Auth0 id already exists globally, `users.createAccount` attaches that user to the current tenant unless the tenant assignment already exists.
- Profile overview shows name/email, logout, an edit dialog for first name, last name, IBAN, and PayPal email, a simple event list, discount-card management when ESNcard is enabled, and submitted receipts.
- Profile edit updates global user name and payout fields; it does not expose or update the `communicationEmail` collected during account creation.
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

- **Should fix before relaunch:** create-account collects `communicationEmail`, but profile displays Auth0 `email` and profile edit cannot view or update `communicationEmail`. Notification/contact email semantics are unclear.
- **Should fix before relaunch:** profile event cards show only event title and start date. They do not link to event details, show registration status, option, payment state, waitlist state, QR/ticket availability, or cancellation/refund state.
- **Should fix before relaunch:** profile payout fields are global user fields. That may be fine for a global user model, but reimbursement workflows may need tenant-specific payout preferences or at least clear copy.
- **Should fix before relaunch:** ESNcard mutation failures render raw error objects in the profile form and validation uses no visible loading/error state beyond the mutation text.
- **Should fix before relaunch:** ESNcard validation calls the external provider without an explicit timeout or typed provider-error distinction. Provider downtime currently maps through adapter status, but the UX cannot explain retry vs invalid card clearly.
- **Acceptable for now:** profile receipt reads are tenant-scoped and user-scoped through `finance.receipts.my`.
- **Acceptable for now:** event price reads and registration writes both require a verified ESNcard in the current tenant before applying the ESNcard discount.

### Test and Documentation Quality

- `tests/docs/profile/user-profile.doc.ts` documents navigation, profile display, edit dialog validation, and the receipts tab.
- The profile doc uses a fixed `waitForTimeout(1000)` and does not save a profile edit, prove persistence, or cover event-card semantics.
- `tests/docs/profile/discounts.doc.ts` documents the discount-card section but does not add, refresh, remove, or assert any ESNcard validation outcome.
- `tests/specs/discounts/esn-discounts.test.ts` verifies a seeded verified ESNcard affects paid event price labels and the register button copy.
- No reviewed Playwright spec proves profile discount-card management itself, browser-level account creation fallback behavior without Auth0 Management credentials, profile event links/statuses, or submitted receipt visibility after receipt submission.
- `tests/docs/users/create-account.doc.ts` is integration-tagged and skips without Auth0 Management credentials, so baseline docs do not prove the account-creation path.
- `src/server/effect/rpc/handlers/discounts.handlers.spec.ts` covers global-per-user ESNcard reads and updating an existing global user card from another tenant context.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` covers `users.events` sorting, `users.findMany` role aggregation, account creation transactionality, existing-global-user tenant joining, and duplicate tenant-assignment conflict behavior, but not profile update validation or `userAssigned` behavior.

### Product Questions Answered Above

- Should a previously known global user be able to join a tenant automatically after Auth0 login, or should tenant joining require an invite/admin approval flow? Current implementation follows the automatic tenant-join direction for authenticated users who reach account creation.
- What is the intended home-tenant model, and should profile expose or warn about current tenant vs home tenant?
- Is `communicationEmail` a user-managed notification email, and should it differ from Auth0 login email?
- Are payout details global per person or tenant-specific per reimbursement context?
- Are ESNcard records intended to be global per user, tenant-specific, or shared globally by card identifier? Current implementation follows the global-per-user direction while still requiring the current tenant to have ESNcard support enabled before managing or applying the card.
- Which profile event states should users be able to act on from the profile page: payment continuation, ticket QR, cancellation, waitlist, transfer/resale?

### Recommended Cleanup Actions

- Expose and validate `communicationEmail` consistently in profile edit, or remove it from account creation until it is used.
- Add profile event cards that link to events and display registration/payment/waitlist/ticket state from durable contract fields.
- Replace raw ESNcard mutation errors with `getErrorMessage(...)` and explicit retry/invalid-card copy.
- Add profile/account tests for account creation retry/tenant-join behavior, profile edit persistence, ESNcard add/refresh/remove, and submitted receipt visibility.

## Tenant/Global Admin

### Current Behavior

- Tenants are resolved from request host first. On local hosts, the `evorto-tenant` cookie can select the tenant domain; otherwise the host domain is authoritative.
- If tenant resolution fails, SSR and RPC requests fail closed with a 404. A local probe with `Host: no-such-tenant.invalid` returned 404.
- Tenant records currently store one unique `domain`, name, currency, locale, timezone, theme, default location, Stripe account id, receipt settings, discount provider settings, and SEO title/description.
- Client config loads the current tenant and permission list through RPC and applies `theme-${tenant.theme}` to the document root.
- Tenant admin "General settings" lets tenant admins change default location, site theme, receipt countries/allow-other, and ESNcard provider enablement plus buy URL.
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

- **Should fix before relaunch:** the tenant schema supports one `domain`, not multiple domains or domain verification states. Product context allows Evorto subdomains plus custom domains.
- **Should fix before relaunch:** tenant settings UI does not expose tenant name, domain/custom domain, logo, favicon, legal/privacy/terms/imprint configuration, email sender name, review/publishing settings, registration limits, locale, currency, timezone, or Stripe account state.
- **Should fix before relaunch:** tenant schema has `seoTitle` and `seoDescription`, but the `Tenant` RPC schema and settings UI do not expose or use them.
- **Should fix before relaunch:** route-level guards are inconsistent in tenant admin. `/admin/tax-rates` and event reviews have route guards, but `/admin/settings`, roles, and users rely on links/RPCs or broader prior findings.
- **Should fix before relaunch:** tenant settings save has no visible success/error feedback beyond mutation state, and raw errors can surface through the form flow.
- **Acceptable for now:** tenant settings writes are scoped to the current tenant id and validate the returned tenant shape before responding.
- **Acceptable for now:** unknown host requests fail closed with 404 instead of guessing a tenant.
- **Acceptable for now:** RPC request-context headers are overwritten server-side before handler execution, so client-supplied `x-evorto-*` headers are not trusted as the source of tenant/user context.

### Test and Documentation Quality

- `src/server/context/tenant-schema.spec.ts` covers tenant schema defaults and RPC header serialization around optional default location.
- `src/server/effect/rpc/handlers/middleware/rpc-request-context.middleware.spec.ts` covers decoding RPC context headers, including tenant and permissions.
- `src/app/core/effect-rpc-angular-client.spec.ts` covers SSR RPC origin selection from incoming URL and forwarded headers.
- `tests/specs/auth/storage-state-refresh.test.ts` covers stale/wrong tenant cookies in saved Playwright storage state, not runtime tenant resolution.
- `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts` checks seeded tenant tax-rate isolation directly in the database, but does not exercise the RPC/UI tenant context switch.
- `tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts` covers route denial for `/admin/tax-rates`, but there is no matching coverage for `/admin/settings` or `/global-admin`.
- `tests/docs/finance/inclusive-tax-rates.doc.ts` documents tenant tax-rate management, but there is no generated documentation for tenant general settings, tenant branding/legal settings, or global tenant administration.
- `src/app/global-admin/global-admin.routes.spec.ts` covers route-level global-admin permission requirements.
- `src/server/effect/rpc/handlers/global-admin.handlers.spec.ts` covers `globalAdmin:*` satisfying `globalAdmin:manageTenants` RPC authorization.
- `src/server/context/request-context-resolver.spec.ts` covers host-first tenant resolution, localhost tenant-cookie fallback, stale localhost tenant-cookie fallback, unknown-host failure, global-admin permissions resolving without a tenant user assignment, and tenant-user context failing closed when the Auth0 user has no current-tenant assignment.
- Playwright browser probing was limited because the bundled Playwright browser was not installed and stored auth states were stale; system Chrome confirmed anonymous/global-admin redirects to Auth0.

### Product Questions Answered Above

- Should global admins be independent platform principals, tenant users with special metadata, or tenant users plus a separate platform-role table?
- Can a global admin administer tenants before being assigned to the current tenant? Current implementation allows global-admin permissions from Auth0 app metadata without requiring a tenant assignment.
- Should tenants support multiple domains, and how should custom domain verification/ownership be modeled?
- What is the minimum relaunch scope for tenant branding/legal settings versus later tenant onboarding work?
- Should tenant currency/locale/timezone be editable after payment/event data exists?
- Should global admin be able to create tenants, edit domains/settings, impersonate tenant admin views, or only list tenants for support?

### Recommended Cleanup Actions

- Document one-domain-per-tenant as the relaunch scope; leave automated
  multi-domain/custom-domain management for later work.
- Add tenant settings docs/specs for current settings and clearly mark missing branding/legal/domain settings as not implemented.
- Decide whether `seoTitle` / `seoDescription` are product fields, then expose them through tenant config or remove/defer them.

## Generated Documentation and Playwright Coverage

### Current Behavior

- Playwright has separate baseline spec and docs projects. Baseline specs exclude `tests/docs/**`; docs baseline runs `tests/docs/**/*.doc.ts`; integration-only docs are selected with `@needs-*` tags.
- Local docs/spec discovery is runnable again after replacing stale Effect config APIs in `playwright.config.ts` and Playwright support files, and Auth0 Management credentials are no longer required just to import baseline fixtures.
- `bun run test:e2e -- --list` discovers 78 baseline tests across 22 files, including setup projects, when the normal local runtime secrets are provided or stubbed for discovery.
- `bun run test:e2e:docs -- --list` discovers 21 baseline docs tests across 14 files, including setup projects, when the normal local runtime secrets are provided or stubbed for discovery.
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
- **Must fix before agent scaling:** some specs still intentionally skip for integration credentials or explicit deferred coverage, but the known misleading fixture-state examples from this pass now fail loudly when expected seeded state is missing: receipt approval/refund rows, receipt dialog options, unlisted-event seed state, event-creation setup, scanner preconditions, regular-user registration tenant setup, template icons, and template role autocomplete.
- **Addressed in stabilization pass:** `tests/docs/events/event-management.doc.ts` now documents the current event details, registration, review/listing, organizer overview, participant grouping, and receipt surfaces instead of stale attendee export, attendee messaging, settings, tags, featured images, notifications, integrations, or deletion flows.
- **Addressed in stabilization pass:** `tests/docs/finance/finance-overview.doc.ts` now documents the current finance permission split and transaction/receipt navigation behavior.
- **Addressed in stabilization pass:** Playwright discovery was broken by stale Effect config APIs and by import-time Auth0 Management config reads in baseline fixtures. Both are fixed locally, but they show the e2e/docs surface was not being exercised recently enough.
- **Addressed in stabilization pass:** list-only Playwright commands no longer initialize docs output, clear generated docs/image directories, or require Auth0 Management credentials for baseline fixture imports.
- **Should fix before relaunch:** page-backed Playwright specs still fail in this checkout because the configured Chromium binary is missing. `tests/specs/screenshot/doc-screenshot.test.ts` seeds data and then fails at browser launch.
- **Should fix before relaunch:** `tests/test-inventory.md` is stale and still reads like a March 2026 snapshot rather than a current guide for generated docs and Playwright coverage.
- **Should fix before relaunch:** docs coverage is missing or thin for scanning/check-in mutation behavior, tenant/global-admin settings, account creation outside Auth0-management integration, profile discount add/refresh/remove flows, finance route gates, receipt review/refund behavior, role assignment/user management, and registration negative paths.
- **Addressed in stabilization pass:** the generic `tests/docs/template.doc.ts` discovery placeholder was removed; current template documentation lives in `tests/docs/templates/templates.doc.ts`.
- **Should fix before relaunch:** docs screenshot helpers use fixed waits or import-time environment reads in some paths. That adds flakiness and makes focused helper tests less reliable.
- **Should fix before relaunch:** required `@track`, `@req`, and `@doc` tags
  should be removed if they do not provide useful product or verification value.
- **Acceptable for now:** the documentation reporter has focused tests for output paths, cleanup, grouping, and permissions callouts.
- **Acceptable for now:** deterministic seed helpers and scenario handles exist; the issue is where specs turn missing seeded state into skips or no-op passes.

### Test and Documentation Quality

- Generated docs are valuable but currently mix real walkthroughs with aspirational copy. Future agents need stale docs removed or clearly marked before treating docs as product truth.
- The docs suite favors screenshots and prose, but many docs do not assert that the workflow was completed or persisted.
- Some functional specs have strong names and tags but weak assertions. These are more dangerous than absent tests because they imply coverage.
- Integration-only docs are correctly taggable, but baseline docs should still cover account/profile/tenant flows that do not require Auth0 Management or external APIs.
- The current reporter output target points outside this repository, so this repo does not contain the generated documentation artifact it depends on.

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
- Make docs/list commands avoid reporter output cleanup and make the local browser installation expectation explicit.
- Update `tests/test-inventory.md` after stale/placeholder docs are pruned.
- Add missing docs/specs for scanning mutation, tenant/global-admin settings, account/profile persistence, role/user management, and negative registration paths as those flows are stabilized.

## Local Runtime/Developer Workflow

### Current Behavior

- The repo is Bun-first. `packageManager`, the Docker base image, local Bun, and CI setup now agree on Bun `1.3.11`.
- Important entrypoints remain visible in `package.json`: app build/dev, unit tests, Playwright e2e/docs, Docker stack, database commands, dependency updates, Stripe/Sentry ops, theme generation, and receipt-image cleanup.
- Local runtime config uses `.env.dev.local` for tracked shared defaults, `.env.dev` for generated worktree-specific values, and `.env` for untracked developer secrets.
- `bun run env:runtime` writes `.env.dev` with worktree-specific `COMPOSE_PROJECT_NAME`, Neon Local port, MinIO ports, `BASE_URL`, and local `DATABASE_URL`.
- Local `test:e2e`, `test:e2e:ui`, `test:e2e:docs`, `db:*`, and `docker:*` scripts now refresh `.env.dev` before running `dotenv -c dev`, reducing fresh-worktree and wrong-database risk.
- Docker Compose uses Neon Local, MinIO, Stripe CLI, a one-shot `db-setup` service, and an `evorto` app container. `bun run docker:check` verifies required local secrets before any Docker start command tears down or starts containers, and now also reports Bun, Docker Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright browser-cache readiness.
- `bun run build:app`, `bun run test:unit -- --watch=false`, and `bun run test:unit:server` pass in the current checkout.
- Playwright test discovery works through the package scripts, but full page-backed Playwright execution still requires installing the matching browser binaries.
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
- **Should fix before relaunch:** CI e2e docs intentionally skip `@finance` docs in the baseline docs run. That may be pragmatic while finance docs are unstable, but it should remain visible because finance documentation can drift from product behavior.
- **Should fix before relaunch:** `docker:start` and Playwright `webServer` run the foreground Docker stack through a destructive `docker compose down` and `db-setup` reset. This is documented, but future agents should treat it as a database-resetting command, not a harmless server start.
- **Addressed in this stabilization pass:** `bun run docker:check` reports missing Neon Local, Auth0, Stripe, session, and Font Awesome registry variables before Docker Compose mutates local containers. It also reports local tool readiness and warns when Playwright browsers are missing without blocking Docker start. The current worktree is missing `NEON_API_KEY`, `CLIENT_SECRET`, `STRIPE_API_KEY`, and `STRIPE_WEBHOOK_SECRET`, so a fresh full Docker start is intentionally blocked until those secrets are provided.
- **Should fix before relaunch:** the direct shell `dotenv` command is ambiguous on this machine. Future instructions should consistently say `bun run ...` or `node_modules/.bin/dotenv`, not bare `dotenv`.
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
- Should finance docs remain excluded from CI docs baseline until the finance behavior is stabilized, or should they fail loudly now?
- Should Playwright use bundled Chromium only, or should local development prefer a system Chrome channel when available?

### Recommended Cleanup Actions

- Keep docs publishing explicit if `evorto-pages` output is needed; normal local docs output stays in ignored `test-results/docs`.
- Consider splitting Docker commands into destructive reset/start and non-destructive restart flows if local developer data preservation becomes important.
- Revisit the CI docs `@finance` exclusion after finance docs are rewritten to current behavior.
- Keep `package.json` as the visible command surface and avoid moving core workflow commands into hidden helper CLIs.

## Prioritized Cleanup Backlog

### Must Fix Before Agent Scaling

1. Continue pruning misleading placeholder tests/docs from profile/account and remaining thin documentation surfaces before agents treat generated docs as product truth.
2. Continue auditing remaining `test.skip` usage so credential/integration skips stay explicit and fixture-state gaps become hard failures or honest `test.fixme` states.
3. Keep server-side template permission, validation, and route-guard coverage in place as template behavior expands beyond simple mode.
4. Keep role lookup APIs lookup-only for event/template eligibility flows; do not re-expose admin role-management data to organizers.
5. Keep admin, finance, global-admin, and template direct-route denial coverage current as route trees change.
6. Keep `tests/test-inventory.md` aligned whenever placeholder specs/docs are removed or reclassified.

### Should Fix Before Relaunch

1. Implement guest quantities, distinct waitlist joining, participant/admin cancellation, and transfer/resale.
2. Add Playwright coverage for negative registration paths and role-ineligible direct links.
3. Make organizer signup semantics visible and distinct if it remains modeled as a registration option.
4. Keep simple-mode templates as the primary authoring UI, but expand reusable template support for discounts, add-ons, questions, and organizer notes/checklists where practical.
5. Implement `random` and `application` registration fulfillment semantics if
   those modes remain in the relaunch UI; otherwise hide them until their
   runtime behavior exists.
6. Fix role hub display persistence or remove the currently misleading hub flags from the role form.
7. Clarify receipt reimbursement as a manual ledger action and rename UI away from "refund" unless money is actually moved.
8. Validate receipt tax amount consistency and support pre-event receipt spending/submission.
9. Add check-in timing, duplicate-scan, camera-error, and guest-quantity behavior before treating scanner UI as relaunch-ready.
10. Clarify profile event cards, notification/login email behavior, global payout preference visibility, and global-per-user ESNcard validation UX before relaunch.
11. Fill the tenant settings gap for one-domain relaunch support, branding, legal links/text, locale/currency/timezone, SEO fields, and global tenant-admin workflows.
12. Make Playwright list/discovery side-effect-free and document or automate the local browser installation expectation.
13. Update or regenerate `tests/test-inventory.md` after placeholder docs/specs are pruned.
14. Move local generated docs defaults away from the sibling documentation checkout, or introduce an explicit docs-publish flow that cannot run accidentally during list/discovery.
15. Keep `docker:start` reset behavior intentional and ensure seeded data is sufficient to get going from zero.

### Acceptable For Now

1. Server-side edit locks are duplicated with UI guards; keep until broader event authorization is reviewed.
2. Browser walkthrough coverage for anonymous event browsing is enough for this first pass; authenticated manual behavior should be revisited after server preconditions are fixed.
3. Rich seeded demo data is useful even if some seeded states are ahead of implemented product behavior, as long as tests do not treat those states as complete features.
4. The current template detail page is discoverable and useful as a summary of simple template defaults.
5. Tenant scoping for role-management writes is explicit in the reviewed handlers and schema.
6. Receipt review/refund write paths are tenant-scoped and use status preconditions before changing receipt state.
7. QR code display is limited to confirmed registrations in the active registration UI.
8. Profile receipt reads are tenant-scoped and user-scoped.
9. Verified ESNcard discounts are checked in both event detail price display and registration payment resolution.
10. Unknown tenant hosts fail closed with 404 in the current runtime.
11. Tenant settings writes are tenant-scoped and validate the returned tenant shape before responding.
12. Documentation reporter path/grouping tests pass after the Effect config compatibility fix.
13. Local runtime scripts now refresh `.env.dev` before running Playwright, database, or Docker commands.
14. Angular and server unit-test commands now have separate test discovery ownership.
15. Docker start commands now run a non-mutating required-secret preflight before tearing down or starting containers.

### Product Decisions Recorded

The product questions from the first stabilization pass are answered in the
Product Decision Draft near the top of this document. Future cleanup should
implement those decisions or explicitly revise them there before changing code.

## Fixes Applied In This Pass

- None. The obvious issues found in Events and Registrations affect server-side behavior and need focused tests, so they should be handled as small follow-up cleanup commits rather than opportunistic edits inside the audit document commit.
- Registration race-coverage pass: added focused `EventRegistrationService` tests for same-event second registrations across options, transactional duplicate races, and transactional capacity races.
- Registration mode pass: blocked direct registration attempts for stored `random` and `application` registration options until their fulfillment semantics are implemented.
- Price-label spec cleanup pass: converted the inclusive price-label Playwright spec to fixme-only declarations and removed placeholder page-load assertions.
- Unlisted-event spec cleanup pass: changed unlisted-event visibility tests to require an approved unlisted seeded event instead of skipping when the seed state is missing.
- Event-creation spec cleanup pass: changed the template-create-event Playwright spec to require the deterministic seeded hike template, registration options, tax-rate completeness, and enabled submit button instead of skipping fixture/setup failures.
- Scanner spec cleanup pass: changed the scanner Playwright spec to require an unchecked confirmed registration and matching registration option instead of skipping fixture/setup failures.
- Free-registration spec cleanup pass: removed the impossible missing-tenant skip so the regular-user registration flow relies on the required tenant fixture and fails if fixture setup breaks.
- Template spec cleanup pass: changed template category and role autocomplete coverage to require seeded icons, seeded roles, and concrete role option text instead of skipping fixture/setup failures.
- None in the Templates pass. The highest-value issues are permission and contract validation gaps that need targeted tests with the fixes.
- Template docs/spec cleanup pass: removed the generic template doc discovery placeholder, converted the deferred template tax-rate spec to honest fixme-only declarations, and updated the Playwright inventory.
- Permission evaluator pass: routed legacy server permission checks through the shared `includesPermission` helper so client and server agree on dependencies, wildcards, and legacy aliases, and added direct unit coverage for the shared evaluator plus tax-rate dependency behavior.
- Role/user cleanup pass: removed placeholder user-list selection/edit affordances, aligned the roles doc with the current no-role-assignment UI, and fixed `users.findMany` to return only the RPC contract shape.
- None in the Finance/receipts pass. The highest-value issues touch payment-derived state, transaction visibility, and upload authorization, so they need targeted regression tests with the fixes.
- Scanning/check-in pass: added `events.checkInRegistration`, gated scan reads and check-in writes to event organizers or `events:organizeAll`, made duplicate check-ins idempotent, wired the scanner button to persist and refetch state, and extended scanner tests to assert persisted check-in state.
- Profile/account pass: guarded `/create-account` with authentication, reworked `users.createAccount` into a transactional tenant-account creation flow that can attach an existing global user to the current tenant while assigning default roles, and aligned ESNcard records with the global-per-user decision.
- Tenant/global-admin pass: guarded global-admin routes with `globalAdmin:manageTenants`, decoupled global-admin permission resolution from current-tenant assignment, required tenant user context to have a current-tenant assignment, and fixed granted group wildcards such as `globalAdmin:*` to satisfy concrete permission checks.
- Tenant-resolution pass: added focused `resolveTenantContext` coverage for non-local host precedence over cookies, localhost cookie fallback, stale localhost cookie fallback, and unknown non-local host failure.
- Generated docs/Playwright pass: replaced stale Effect config-provider calls in Playwright config/support files so `test:e2e -- --list` and `test:e2e:docs -- --list` can discover tests again.
- Local runtime/developer workflow pass: refreshed `.env.dev` automatically in local runtime scripts, added a visible Playwright browser-install script, split Angular/server unit-test discovery, aligned CI Bun with the repo runtime, added Docker required-secret preflight before mutating start commands, extended `docker:check` into a broader health report, and updated workflow docs.
- Playwright docs-output pass: made the documentation reporter no-op during `--list` discovery so list commands no longer clear or rewrite generated docs output.
- Playwright discovery pass: deferred Auth0 Management config reads to the `newUser` fixture so baseline list/discovery does not require integration-only credentials.
- Finance access pass: gated finance transaction reads with `finance:viewTransactions`, added finance route guards/link visibility for transaction, receipt approval, and receipt reimbursement pages, added permission-matrix coverage, and rewrote the finance overview doc copy to current permissions and UI behavior.
- Finance webhook counter pass: moved paid checkout completion/expiry counter updates into the Stripe webhook transaction and extended webhook replay specs to assert registration status, transaction status, and option counters together.
- Finance receipt-upload pass: added event-scoped receipt-media upload preflight so object storage writes require receipt-submit authorization before upload, while `finance.receipts.submit` keeps its own authorization check.
- Finance receipt-spec cleanup pass: removed silent early returns from approval/refund and "Other country" receipt Playwright coverage so missing seeded UI state fails instead of passing.

## Review Next

All ten first-pass review areas are now represented in this document. The next stabilization work should continue with small cleanup commits around the remaining relaunch gaps: profile/account clarity, receipt reimbursement wording and validation, scanner timing/camera-error behavior, tenant settings scope, role hub-field semantics, and replacing intentionally fixme-only price/tax specs with active Browser-backed coverage once the local runtime is available.
