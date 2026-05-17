# Stabilization Review

This document tracks a pragmatic stabilization pass before deeper agent-driven
development. It is not a requirements matrix. Keep findings concrete, scoped,
and useful for small cleanup batches.

## Review Status

| Area                                            | Status              | Confidence | Notes                                                                                        |
| ----------------------------------------------- | ------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Events                                          | First pass complete | partial    | Code, tests, docs, and an unauthenticated Browser walkthrough reviewed.                      |
| Registrations                                   | First pass complete | partial    | Free/paid registration paths reviewed; several server-side precondition gaps need follow-up. |
| Templates                                       | First pass complete | partial    | Simple-mode template flow reviewed; permission and model-depth gaps need follow-up.          |
| Roles and permissions                           | First pass complete | partial    | Core permission model reviewed; route/RPC semantics and role management gaps need follow-up. |
| Finance/receipts                                | First pass complete | partial    | Payments, transactions, receipt review/refund, and docs reviewed; high-risk gaps remain.     |
| Scanning/check-in                               | First pass complete | partial    | QR display and scan read path exist, but actual check-in mutation and gating are incomplete. |
| Profile/account flows                           | First pass complete | partial    | Profile, account creation, discount cards, receipts, and auth guards reviewed.               |
| Tenant/global admin                             | First pass complete | partial    | Tenant resolution, tenant settings, and global-admin list surface reviewed.                  |
| Generated documentation and Playwright coverage | First pass complete | partial    | Docs/spec inventory is discoverable again, but several docs/specs are stale or misleading.   |
| Local runtime/developer workflow                | Lightly reviewed    | partial    | Root/test/helper guidance and visible scripts reviewed.                                      |

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
- Template Playwright specs/docs: `tests/specs/templates/**`, `tests/docs/templates/templates.doc.ts`, `tests/docs/template.doc.ts`
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

## Events

### Current Behavior

- Anonymous users can browse approved listed events when registration options overlap tenant default roles.
- Event details are available for approved events and show description plus registration options.
- Draft/rejected events are editable by creator or `events:editAll`; pending/approved events are locked by server-side `findOneForEdit` and `events.update` checks.
- Submit/review lifecycle supports `DRAFT`, `PENDING_REVIEW`, `APPROVED`, and `REJECTED`.
- Listing visibility is separate from status through the `unlisted` flag; admins with the right permission can see/toggle it.
- Event list filtering defaults to all statuses only for users with `events:seeDrafts`; other users only request approved events.

### Intended Behavior From Product Context

- Event lifecycle is draft -> pending review -> published, with publishing as the approval act.
- Material event fields should be locked after submission for review.
- Listing is separate from publishing; published events may be listed or unlisted.
- Anonymous visibility should match default-role eligibility and should not show events the same user would lose after signing in.
- User-facing features must be discoverable through the UI, not hidden URLs.

### Issues and Risks

- **Must fix before agent scaling:** event creation/update validate date parseability, but not event ordering or registration-window ordering beyond "both dates parse." `events.create` and `events.update` should reject end-before-start and close-before-open before future agents build on the model.
- **Must fix before agent scaling:** event update accepts any `location` shaped as `Schema.Any`; app forms pass structured location data, but the RPC boundary does not validate it.
- **Should fix before relaunch:** event creation copies template option discounts by matching title plus organizer flag. Duplicate option titles can copy discounts to the wrong option.
- **Should fix before relaunch:** `event-management.doc.ts` describes attendees, settings tabs, event categories/tags, featured images, and notification settings that do not appear to exist in the current event UI. This is misleading documentation, not just incomplete coverage.
- **Should fix before relaunch:** direct event detail access for unlisted events is covered and seems intended, but the UI should make sharing semantics clearer for organizers/admins.
- **Acceptable for now:** event edit locks are duplicated in guard, details `canEdit`, `findOneForEdit`, and `events.update`. Duplication is not ideal, but server-side checks are the source of truth.

### Open Product Questions

- Should rejected events be resubmitted without requiring any edit, or should the app require creators to acknowledge/change something first?
- Should admins with `events:review` be able to edit pending events, or only approve/reject them?
- Should event creation require at least one participant registration option, or can organizer-only/private operational events exist?

### Recommended Cleanup Actions

- Add focused server tests for date ordering and registration-window ordering in `events.create` / `events.update`.
- Replace `Schema.Any` for event location with a real shared schema or explicitly document why location remains unchecked.
- Fix template-to-event discount copying to use stable source option identity instead of title matching.
- Rewrite stale sections of `tests/docs/events/event-management.doc.ts` to describe only current UI behavior.

## Registrations

### Current Behavior

- Registration options are attached to events and contain role eligibility, price, payment flag, capacity counters, registration windows, and organizer/participant distinction.
- UI hides register actions from anonymous users and offers a login link back to the event.
- UI disables registration before open time and after close time based on client time.
- Free registration creates a confirmed registration and increments `confirmedSpots`.
- Paid registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and shows a payment continuation link.
- Successful paid registration is confirmed through Stripe/webhook-side effects; the active registration UI only shows QR code for confirmed registrations.
- Users with confirmed organizer registrations, `events:organizeAll`, or `finance:manageReceipts` can open the organize view.

### Intended Behavior From Product Context

- Registration requires an account.
- Registration options are mutually exclusive per event.
- A user cannot be both organizer/helper and participant for the same event.
- Registration options define role-based eligibility.
- Registration should respect capacity, registration windows, free/paid state, Stripe lifecycle, pending cleanup, waitlists, cancellation, transfer/resale, and guest quantities.
- Users should receive confirmation and QR code only after successful registration; for paid events, after successful payment.

### Issues and Risks

- **Must fix before agent scaling:** `EventRegistrationService.registerForEvent` does not enforce event approval status. A caller with an event id and option id can attempt registration even if the event is draft, pending review, or rejected.
- **Must fix before agent scaling:** registration open/close windows are enforced in the UI but not in the server registration write path. This makes direct RPC calls and stale clients unsafe.
- **Must fix before agent scaling:** role eligibility is enforced when listing/detailing options, but not in `registerForEvent`. Server-side registration must verify the selected option overlaps the current user's tenant roles.
- **Must fix before agent scaling:** registration writes check capacity using previously read counters and then update counters outside a transaction/conditional update. Concurrent registrations can overbook.
- **Must fix before agent scaling:** registration preflight checks for an existing user registration by `eventId` and `userId` but not `tenantId`. Event ids are intended to be stable IDs, but tenant-scoped queries should consistently include tenant constraints.
- **Must fix before agent scaling:** the registration option lookup does not include tenant context through the event relation. It relies on event/option ids being unguessable rather than preserving the tenant boundary at the query.
- **Should fix before relaunch:** no guest quantity is present in the event registration contract or UI, even though guest spots are an intended first-version behavior.
- **Should fix before relaunch:** waitlist state exists in schema and seeded data, but registration write behavior fails when full instead of joining a waitlist.
- **Should fix before relaunch:** cancellation exists only for pending user registrations; participant cancellation, admin cancellation, transfer/resale, and refund flows are not implemented in the reviewed event registration path.
- **Should fix before relaunch:** active registration status is a raw `Schema.String`, so the client can silently accept statuses not represented in the UI branches.
- **Acceptable for now:** paid registration rollback is careful about cleaning up a failed checkout session creation path; deeper Stripe lifecycle review belongs in the finance pass.

### Test and Documentation Quality

- `tests/specs/events/free-registration.test.ts` covers the free registration happy path using seeded scenario handles.
- `tests/docs/events/register.doc.ts` covers free and paid registration as generated documentation and Stripe-backed evidence.
- No reviewed test covers registration rejection for unpublished events, closed windows, ineligible roles, same user registering for organizer plus participant options, or concurrent capacity.
- `tests/specs/events/price-labels-inclusive.spec.ts` is mostly placeholder assertions with TODOs. It should not be treated as real price-label regression coverage.

### Open Product Questions

- Should full options join a waitlist automatically, expose a separate waitlist action, or fail until a later waitlist feature lands?
- Are organizer registrations meant to use the same user-facing register button, or should organizer signup have a separate affordance/copy?
- What is the minimum relaunch scope for guest quantities, transfer/resale, and participant/admin cancellation?
- Should role-ineligible direct links hide the event entirely, show the event with no options, or show an explicit ineligible state?

### Recommended Cleanup Actions

- Add server-side registration precondition checks for approved event status, tenant scope, registration window, role eligibility, and option ownership.
- Move capacity reservation/confirmation into a transaction with conditional counter updates.
- Add focused unit/integration tests around registration preconditions before expanding registration features.
- Replace raw registration status strings in the RPC contract with the existing status literal union.
- Either implement waitlist behavior or remove/label waitlist UI/data paths as seeded/demo-only until implemented.
- Replace placeholder price-label specs with assertions that match current behavior, or quarantine them as known pending coverage.

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

- **Must fix before agent scaling:** `templates.createSimpleTemplate`, `templates.updateSimpleTemplate`, `templates.findOne`, and `templates.groupedByCategory` only check authentication, not `templates:view`, `templates:create`, or `templates:editAll`. UI links hide some actions, but direct RPC calls remain too permissive.
- **Must fix before agent scaling:** template create/update accept `categoryId` and registration `roleIds` without checking that those ids belong to the current tenant. The database may reject some invalid category ids, but the error is not an explicit domain error and role ids are stored as arrays without FK constraints.
- **Must fix before agent scaling:** template registration offsets validate as non-negative numbers, but the server does not enforce that registration opens before it closes. Because offsets are "hours before event", `openRegistrationOffset` should be greater than or equal to `closeRegistrationOffset` for a normal window.
- **Must fix before agent scaling:** template location is `Schema.Any`, matching the event boundary issue. It should use a real shared location schema or an explicit documented escape hatch.
- **Should fix before relaunch:** simple-mode create/update always writes exactly two registration options. That matches the current UI but is thinner than the product model for reusable event knowledge.
- **Should fix before relaunch:** template discounts and add-ons exist in schema, but simple-mode template create/update does not expose or persist discounts/add-ons. Event creation has separate discount-copying logic, but the simple template editing path cannot maintain those richer fields.
- **Should fix before relaunch:** registration mode allows `random` and `application`, while docs mark random as not available and registration behavior currently acts like first-come-first-served. The UI should either restrict unsupported modes or document that they are stored-only.
- **Should fix before relaunch:** template create/edit components still use `console.*` instead of the app guidance to use `consola/browser`.
- **Acceptable for now:** the template detail page is a useful read-only summary and the "Create event" action is discoverable from the detail surface.

### Test and Documentation Quality

- `tests/specs/templates/templates.test.ts` covers create, view, empty-category add flow, and role autocomplete duplicate hiding.
- `tests/docs/templates/templates.doc.ts` documents simple-mode template creation, role defaults, payment field visibility, and role-picker behavior.
- `tests/specs/templates/paid-option-requires-tax-rate.spec.ts` is fully `test.fixme(...)` and contains placeholder assertions. It should not be treated as active tax-rate validation coverage.
- `tests/docs/template.doc.ts` is only a discovery/tagging placeholder, not product documentation.
- Permission matrix tests check template create link visibility, but they do not prove direct route or RPC denial.

### Open Product Questions

- Is simple mode the intended relaunch template scope, or should richer registration options/add-ons/questions/organizer notes be available before relaunch?
- Should `random` and `application` registration modes be selectable now if registration fulfillment does not implement those semantics?
- Should template view require `templates:view`, or should organizers with `events:create` inherit template view through permission dependencies only?
- Should template category management remain a separate capability from template creation/editing?

### Recommended Cleanup Actions

- Add server-side permission checks for template view/create/edit RPCs and route-level guards for direct `/templates/create`, `/templates/:id/edit`, and `/templates/:id/create-event` access.
- Validate template category and role ids against the current tenant before persisting.
- Add server-side offset ordering validation and focused unit tests in `SimpleTemplateService`.
- Replace `Schema.Any` location fields with a shared schema or document why the boundary remains intentionally loose.
- Quarantine or replace placeholder/fixme template tax-rate specs with active coverage for the current simple-mode UI.
- Decide whether unsupported registration modes should be hidden until their behavior exists.

## Roles and Permissions

### Current Behavior

- Permissions are string capabilities grouped by admin, internal, events, templates, users, and finance.
- Tenant roles store permission arrays plus default user/organizer flags and hub-display fields.
- New accounts receive tenant roles marked as default user roles.
- Event/template registration eligibility is modeled through role ids stored on registration options.
- The client `PermissionsService` supports direct permissions, group wildcard checks, the legacy `admin:manageTaxes` alias, and configured permission dependencies.
- The role form automatically selects dependent permissions and marks them read-only when a parent permission is selected.
- Admin role create, update, delete, find-one, and search RPCs require `admin:manageRoles`; `users.findMany` requires `users:viewAll`.
- `admin.roles.findMany` and `admin.roles.findHubRoles` require only authentication.
- Admin role routes, user routes, and general settings routes do not have route-level guards; tax rates and event reviews do.
- Browser verification with an organizer account showed direct `/admin` and `/admin/roles` stay on the requested URL but render only the app shell/navigation instead of a clear not-allowed page.

### Intended Behavior From Product Context

- Tenants define their own roles; there is no single system-defined default role.
- Default roles are tenant-managed and assigned to users by default in that tenant.
- Capabilities should have admin-facing names/descriptions and can imply access to related data.
- Role-based eligibility should remain the main way to model special cases instead of scattered flags.
- Administrators manage tenant roles, permissions, tenant settings, and user-role assignment.
- Tenant isolation and permission safety are core quality gates.

### Issues and Risks

- **Must fix before agent scaling:** client and server permission semantics are not centralized. The client expands dependencies and wildcard checks, while most server handlers check raw header permissions with `includes(...)`; `RpcAccess.ensurePermission` also checks only direct permissions. Future fixes can easily pass a UI guard while failing or bypassing server behavior.
- **Must fix before agent scaling:** admin role/user/settings routes are missing capability guards. Direct navigation can reach admin URLs without a clear `403` result, and route-level behavior is inconsistent across admin children.
- **Must fix before agent scaling:** `admin.roles.findMany` returns permission-bearing role records to any authenticated user. This currently supports template default-role queries, but it mixes low-risk role lookup with role administration data.
- **Must fix before agent scaling:** shared role selection uses `admin.roles.search` and `admin.roles.findOne`, both gated by `admin:manageRoles`. Organizers need role selection for event/template registration options, so this should be split into a least-privilege role lookup API instead of borrowing the admin role-management API.
- **Should fix before relaunch:** role form fields for hub display are misleading. The form exposes "Show this role in the hub" and "Collapse the members of this role by default", but create/update contracts and handlers ignore those fields, and `findHubRoles` filters `displayInHub` while the form edits `showInHub`.
- **Should fix before relaunch:** `users:assignRoles` exists and depends on `users:viewAll`, but there is no reviewed role-assignment RPC or working UI. The user list shows role chips and placeholder "Edit template" actions.
- **Should fix before relaunch:** permission metadata is mostly generated from camelCase keys and lacks durable admin-facing descriptions, even though product context says capabilities should have admin-facing names and descriptions.
- **Acceptable for now:** roles are tenant-scoped in schema and role-management write queries include tenant boundaries.

### Test and Documentation Quality

- `src/shared/permissions/permissions.spec.ts` only checks schema literal round-tripping; it does not cover dependency expansion or client/server parity.
- Permission matrix coverage currently checks admin tax rates and template creation link visibility, but it does not cover admin role/user/settings routes, role lookup APIs, or direct route denial for template creation.
- `tests/docs/roles/roles.doc.ts` documents role creation and dependent permissions, but says users can be assigned to roles even though the reviewed UI/API does not implement role assignment.
- `tests/docs/roles/roles.doc.ts` links to `/docs/about-permissions`; no matching checked-in documentation source was found in this pass.
- `tests/specs/templates/templates.test.ts` skips the role autocomplete assertion when no role options are available, which can hide the non-admin role lookup problem.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` expects `users.findMany` to return an extra `role` property not present in the RPC contract. That test encodes an implementation leak rather than the contract shape.

### Open Product Questions

- Which role reads should be available to organizers creating events/templates, and should they expose only id/name/default flags instead of permissions?
- Should `events:create` imply `templates:view` only in the client, or should resolved permissions always include dependencies before reaching server handlers?
- Should admin overview be visible to users with any `admin:*` capability, or should each admin child be discoverable only by its own permission?
- What is the intended relaunch scope for assigning users to roles?
- Should hub role visibility use `showInHub` or `displayInHub`, and should one of those fields be removed/migrated?

### Recommended Cleanup Actions

- Add a shared permission evaluation helper that handles dependencies, legacy aliases, and group checks consistently for client and server authorization.
- Add route guards and Playwright denial coverage for admin role, user, settings, template write, and other permission-sensitive direct routes.
- Split role lookup into separate APIs: admin role management for `admin:manageRoles`, and minimal tenant role lookup for event/template eligibility editing.
- Fix or remove hub role form fields until `showInHub` / `displayInHub` semantics are explicit and persisted.
- Implement or explicitly defer user-role assignment; remove placeholder "Edit template" actions from the user list if assignment is out of scope.
- Replace skip-based role autocomplete coverage with an assertion that proves least-privilege organizers can see selectable roles when editing event/template eligibility.

## Finance/Receipts

### Current Behavior

- Paid event registration creates a pending registration, reserves a spot, creates a Stripe Checkout session, and stores a pending `registration` transaction with Stripe checkout ids.
- Stripe `checkout.session.completed` marks the local transaction successful and the registration confirmed when the session is complete and paid.
- Stripe `checkout.session.expired` marks the local transaction cancelled and the registration cancelled.
- Finance navigation is hidden behind `finance:*`, but `/finance` and its child routes are only guarded by authentication/user-account guards.
- The finance overview links to transactions, receipt approvals, and receipt refunds.
- `finance.transactions.findMany` returns non-cancelled tenant transactions to any authenticated user.
- Event organizers or users with receipt-management capabilities can submit receipts from the event organize page.
- Receipt upload is a separate authenticated RPC that stores image/PDF originals in object storage, or a local-unavailable placeholder when storage config is absent.
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

- **Must fix before agent scaling:** Stripe checkout completion confirms the registration but does not move the registration option counters from `reservedSpots` to `confirmedSpots`. Checkout expiry also cancels the registration but does not decrement `reservedSpots`. This makes paid registration capacity/state drift after webhook processing.
- **Must fix before agent scaling:** `finance.transactions.findMany` only checks authentication, while navigation and docs imply finance capability gating. Any authenticated tenant user can call the RPC directly and read transaction amounts, comments, methods, and fees.
- **Must fix before agent scaling:** finance routes have no capability guards. Some child RPCs will fail, but direct routes do not consistently produce a clear `403`, and the transaction route currently has a permissive RPC behind it.
- **Must fix before agent scaling:** receipt media upload is authenticated-only and not tied to an event, pending receipt, or receipt-submit permission check. A signed-in user can create orphan receipt objects even if `finance.receipts.submit` later rejects the event.
- **Should fix before relaunch:** manual receipt reimbursement is labeled as "Issue refund" / "Refund transaction created", but it only records a successful local transfer/PayPal transaction. The UI should avoid implying that money was actually sent through a payout provider.
- **Should fix before relaunch:** receipt submission and review validate deposit/alcohol against total, but do not reject tax amounts greater than the total amount.
- **Should fix before relaunch:** receipts are intended as post-event submissions, but the reviewed server path allows receipt submission for any event where the user is allowed to organize/manage receipts.
- **Should fix before relaunch:** `event_registrations.paymentStatus` exists and tests seed it as `PENDING`, but the reviewed registration/payment paths do not maintain it. It is stale unless the product intentionally uses registration `status` as the only payment lifecycle state.
- **Should fix before relaunch:** receipt review records status locally but no reviewed-email or notification delivery path was found.
- **Acceptable for now:** receipt review/refund queries are tenant-scoped, and receipt refund creation uses a transaction plus status preconditions to avoid refunding the wrong submitter or already-refunded receipts.

### Test and Documentation Quality

- Stripe webhook replay specs cover idempotent completed sessions, processing-claim behavior, stale-claim reclaim, payment-intent fallback, and ignoring unpaid completed sessions.
- Existing Stripe webhook specs assert registration/transaction status but not paid-registration capacity counters or `paymentStatus`, so they miss the counter drift.
- Receipt flow specs cover receipt submission UI, receipt approval/refund path, and tenant "Other" receipt country visibility.
- `tests/specs/finance/receipts-flows.spec.ts` contains early `return` paths when no pending receipt, no refundable receipt, no checkbox, or no enabled refund action exists. Those branches can make the approval/refund test pass without proving the behavior.
- Finance overview docs describe totals, recent transactions, filtering, and sorting that are not visible in the current finance UI.
- Finance overview docs use stale permission names (`finance:view`, `finance:manage`) instead of current capabilities.
- Tax-rate docs and specs provide better active coverage for `admin:tax` and inclusive Stripe tax-rate import/selection.
- Server finance unit tests are thin: handler composition and one receipt media MIME-type rejection. Receipt preconditions and transaction visibility are mostly untested at the handler level.

### Open Product Questions

- Should paid registration webhook handling update `confirmedSpots`/`reservedSpots`, or should counters be derived from registration rows instead of stored?
- Is `paymentStatus` still part of the model, or should it be removed/migrated in favor of registration status plus transactions?
- Which finance capability should gate the transaction list: `finance:viewTransactions`, `finance:manageReceipts`, or a broader finance overview permission?
- Should receipt uploads be created only after submit authorization succeeds, or should upload sessions be issued from a receipt-submit preflight?
- Should receipt reimbursement remain a manual ledger action, or will it eventually integrate with a payout provider?
- Should receipts be restricted to event end dates, or is pre-event spending intentionally allowed?

### Recommended Cleanup Actions

- Add webhook-side counter updates for paid checkout completion/expiry and regression tests that assert registration status, transaction status, and option counters together.
- Gate finance routes and `finance.transactions.findMany` with explicit finance permissions and direct-route Playwright denial coverage.
- Tie receipt media upload to authorized receipt submission or add a submit preflight/upload-token flow to prevent orphan object creation.
- Rename receipt reimbursement UI copy from "refund" to "record reimbursement" unless an actual payout integration is added.
- Validate receipt tax amount against total amount on submit and review.
- Decide whether `paymentStatus` remains a supported field; then either maintain it in payment flows or remove/deprecate it.
- Replace early-return receipt flow tests with deterministic fixtures and hard assertions for approval and reimbursement.
- Rewrite finance overview docs so they describe the current tabbed UI and current permission names only.

## Scanning/Check-In

### Current Behavior

- Confirmed user registrations show a "Your event ticket" card with a QR image at `/qr/registration/:registrationId`.
- The QR HTTP route looks up the registration by id, finds the registration tenant, and encodes a scan target URL using the current request protocol plus the tenant domain.
- `/scan` is an authenticated route that starts a camera-based QR scanner and navigates to `/scan/registration/:registrationId` when the QR URL path starts with `/scan/registration/`.
- `/scan/registration/:registrationId` calls `events.registrationScanned`, shows attendee name, event title/start time, registration option title, ESNcard discount notice, same-user warning, future-event warning, and registration-status warning.
- The scan result enables "Confirm Check In" when the scanned registration is confirmed and does not belong to the scanner.
- `events.registrationScanned` is a read-only RPC. It does not update `event_registrations.checkInTime` or `event_registration_options.checkedInSpots`.
- Event organize pages show aggregate checked-in counts from option counters and participant lists from registration rows; the old table-based check-in status UI is commented out.
- Seed data simulates check-ins for past events by writing `checkInTime` and `checkedInSpots`, so local/demo data can look more complete than the runtime behavior.

### Intended Behavior From Product Context

- Organizers run events and check in participants with QR-code check-in.
- Participants receive registration/check-in information only after successful registration; paid participants should only receive QR/check-in access after successful payment.
- Check-in is a high-risk event/registration state transition because it touches registration persistence, organizer access, guest quantities, QR codes, and event archival.
- Playwright should cover checking in participants and guest quantities for durable behavior.

### Issues and Risks

- **Must fix before agent scaling:** "Confirm Check In" is a no-op. The component method returns after checking `allowCheckin`, and there is no check-in mutation in the RPC contract or handler set. This makes the primary check-in workflow appear implemented while it cannot update attendance.
- **Must fix before agent scaling:** `events.registrationScanned` only requires authentication. Any authenticated tenant user who obtains a registration id can read attendee first/last name, event title/start, option title, and discount flag. The route and RPC should be restricted to event organizers or an explicit check-in capability.
- **Must fix before agent scaling:** check-in permission/capability is not modeled. Current permissions include event create/review/listing/organize-all, but no stable `events:checkIn` or equivalent capability for organizers/helpers who can scan without broad event-management rights.
- **Must fix before agent scaling:** scan eligibility does not consider whether the registration was already checked in. The handler does not read `checkInTime`, so duplicate scans would still look allowable once a mutation is added unless the write path handles it explicitly.
- **Should fix before relaunch:** event timing is only a UI warning. `allowCheckin` is true for any confirmed other-user registration, even if the event starts more than one hour in the future.
- **Should fix before relaunch:** QR generation is unauthenticated. Registration ids are not discoverable in normal UI except by the holder, but the endpoint will generate a ticket QR for any known registration id without proving the requester is the attendee or an organizer.
- **Should fix before relaunch:** the scanner accepts any absolute URL whose path starts with `/scan/registration/`, ignoring origin. That keeps tenant-domain QR codes portable, but it should be an explicit product/security decision.
- **Should fix before relaunch:** camera startup errors are not mapped to a visible typed state. `qrScanner.start()` is fired without awaited error handling, so denied camera permission or unsupported devices can fail outside the component's error display.
- **Acceptable for now:** QR code display is limited to confirmed registrations in the active registration UI, so pending paid registrations do not show the ticket card there.

### Test and Documentation Quality

- `tests/specs/scanning/scanner.test.ts` verifies that a confirmed registration opens the scan-result page and enables "Confirm Check In".
- The scanner test can skip when no confirmed registration is found, and it does not click the button or assert any persisted check-in state. It currently encodes the misleading no-op behavior by stopping at button enabled.
- No server unit/integration test covers scan authorization, same-user denial, already-checked-in behavior, future-event behavior, or check-in counter updates.
- `tests/docs/events/register.doc.ts` documents that the ticket QR code is available after registration/payment, but there is no generated documentation journey for organizers scanning attendees.
- `QUALITY.md` lists participant and guest-quantity check-in as high-value Playwright flows, but guest quantities are not represented in the reviewed check-in contract/UI.

### Open Product Questions

- Should check-in be allowed for confirmed organizer/helper registrations, users with `events:organizeAll`, a new `events:checkIn` capability, or all of those?
- Should scanning be allowed before event start, within a configurable window, or only after a manual organizer override?
- Should duplicate scans be idempotent success, warning-only, or blocked after the first check-in?
- Should QR generation require the registration owner/organizer, or is an unguessable registration id considered enough for the image endpoint?
- Should scanner URL validation require the current tenant domain, any known tenant domain, or any URL with the expected path?
- What is the minimum relaunch scope for guest quantity check-in?

### Recommended Cleanup Actions

- Add an `events.checkInRegistration` mutation that atomically sets `checkInTime`, increments `checkedInSpots`, and rejects or idempotently handles duplicate scans.
- Gate scan routes and scan/check-in RPCs through event organizer status or a dedicated check-in capability.
- Add server tests for same-user scans, unauthorized tenant users, pending/cancelled/waitlisted registrations, duplicate scans, event timing, and counter updates.
- Update the Playwright scanner spec to click "Confirm Check In" and assert persisted organizer overview/check-in state instead of only checking that the button is enabled.
- Add generated organizer documentation for scanning an attendee once the mutation exists.
- Add visible scanner camera-error handling for permission denial and unsupported devices.

## Profile/Account Flows

### Current Behavior

- `/profile` is guarded by `userAccountGuard` and `authGuard`; anonymous direct access redirects to Auth0 login.
- `/create-account` is not route-guarded. Anonymous direct access renders the create-account page and shows "Your email is not verified" because `users.authData` returns an empty auth-data object.
- Authenticated users without a tenant user assignment are redirected to `/create-account` by `userAccountGuard`.
- `users.createAccount` creates a global user row, creates a current-tenant assignment, and assigns tenant default-user roles.
- If a user with the same Auth0 id already exists globally, `users.createAccount` fails with a conflict instead of adding the current tenant assignment.
- Profile overview shows name/email, logout, an edit dialog for first name, last name, IBAN, and PayPal email, a simple event list, discount-card management when ESNcard is enabled, and submitted receipts.
- Profile edit updates global user name and payout fields; it does not expose or update the `communicationEmail` collected during account creation.
- ESNcard profile management stores one card per user/tenant/type, validates through `esncard.org`, and shows current card status/validity.
- Submitted receipts on profile are fetched through `finance.receipts.my`, scoped by current tenant and current user.

### Intended Behavior From Product Context

- Anonymous users may browse eligible listed events, but registration requires an account.
- Users are global and may belong to multiple tenants. A user should ideally have a home tenant so the app can warn when they are browsing another tenant.
- Role-based eligibility and default tenant roles should determine what a new user can access after account creation.
- ESN-card behavior should be opt-in because not every tenant is an ESN section.
- Special cases such as ESN-card-only access should be modeled through roles and registration-option eligibility rather than scattered flags.
- Essential profile/account flows should be documented through generated Playwright docs where practical.

### Issues and Risks

- **Must fix before agent scaling:** account creation does not support adding an existing global Auth0 user to another tenant. The global user conflict contradicts the product model that users may belong to multiple tenants and makes future multi-tenant account work unsafe.
- **Must fix before agent scaling:** `users.createAccount` performs user insert, tenant assignment insert, and default-role insert as separate database effects. A mid-flow failure can leave a global user without tenant assignment or default roles, after which retrying can hit the global-user conflict path.
- **Must fix before agent scaling:** `/create-account` is anonymous-reachable and renders a misleading "Your email is not verified" error instead of requiring login or explaining that account creation starts after authentication.
- **Must fix before agent scaling:** discount card uniqueness is global by `(type, identifier)`, while the app stores cards as tenant/user records. The handler allows the same user to reuse an identifier, but a second-tenant insert for the same user/card can still hit the database unique constraint.
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
- No reviewed Playwright spec proves profile discount-card management itself, account creation fallback behavior without Auth0 Management credentials, profile event links/statuses, or submitted receipt visibility after receipt submission.
- `tests/docs/users/create-account.doc.ts` is integration-tagged and skips without Auth0 Management credentials, so baseline docs do not prove the account-creation path.
- `src/server/effect/rpc/handlers/users.handlers.spec.ts` covers `users.events` sorting and `users.findMany` role aggregation, but not account creation transactionality, existing-global-user tenant joining, profile update validation, or `userAssigned` behavior.

### Open Product Questions

- Should a previously known global user be able to join a tenant automatically after Auth0 login, or should tenant joining require an invite/admin approval flow?
- What is the intended home-tenant model, and should profile expose or warn about current tenant vs home tenant?
- Is `communicationEmail` a user-managed notification email, and should it differ from Auth0 login email?
- Are payout details global per person or tenant-specific per reimbursement context?
- Are ESNcard records intended to be global per user, tenant-specific, or shared globally by card identifier?
- Which profile event states should users be able to act on from the profile page: payment continuation, ticket QR, cancellation, waitlist, transfer/resale?

### Recommended Cleanup Actions

- Rework account creation into an atomic "ensure current tenant account" flow that can create a new global user, attach an existing global user to the current tenant, and assign default roles transactionally.
- Guard `/create-account` with authentication or replace anonymous rendering with a login-start state that preserves the intended redirect.
- Decide and encode the uniqueness model for ESNcard identifiers; make the database constraint match tenant/global product semantics.
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
- `/global-admin` is guarded by authentication only at the route level. The navigation link is hidden behind `globalAdmin:*`, and the tenant list RPC requires `globalAdmin:manageTenants`.
- Global admin currently exposes only a tenant list with id/name/domain. There is no tenant create/edit/detail flow.
- Global-admin permissions are derived from Auth0 app metadata `evorto.app/app_metadata.globalAdmin === true`, but only after a global user row and current-tenant assignment are found.
- Anonymous direct `/global-admin` redirects to Auth0. Stored auth states were stale, so authenticated global-admin UI was not reverified through Playwright in this pass.

### Intended Behavior From Product Context

- Tenants own events, templates, roles, registrations, settings, branding, legal/privacy configuration, and payment-related tenant configuration.
- Tenants are resolved by domain, including Evorto-provided subdomains and custom domains. Unknown domains should fail closed or show tenant-not-found.
- Users are global and may belong to multiple tenants; home tenant support is desirable.
- Admins configure tenant settings, roles, legal pages, branding, payment settings, review/publishing behavior, and financial workflows.
- Global/admin workflows should remain permission-safe, tenant-safe, SSR-safe, and discoverable through the UI.

### Issues and Risks

- **Must fix before agent scaling:** global-admin app routes are only protected by `authGuard`. Direct `/global-admin` access by a non-global authenticated tenant user can reach the global-admin shell and rely on the RPC to fail. Route-level permission denial should match the RPC and navigation rules.
- **Must fix before agent scaling:** global-admin status depends on Auth0 app metadata but is only evaluated after finding a tenant-scoped user assignment. That makes the global-admin model coupled to the current tenant and conflicts with the need to administer tenants even when tenant membership is missing, broken, or being repaired.
- **Must fix before agent scaling:** server permission checks compare exact permission strings and do not share the client wildcard/dependency logic. A user with `globalAdmin:*` can see the client navigation but fail `globalAdmin:manageTenants` RPC authorization.
- **Must fix before agent scaling:** tenant resolution has no focused unit tests for host-first precedence, local cookie fallback, unknown-host failure, or stale/wrong tenant cookies. Current coverage checks storage-state freshness and tenant schema headers, but not the resolver contract itself.
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
- Playwright browser probing was limited because the bundled Playwright browser was not installed and stored auth states were stale; system Chrome confirmed anonymous/global-admin redirects to Auth0.

### Open Product Questions

- Should global admins be independent platform principals, tenant users with special metadata, or tenant users plus a separate platform-role table?
- Can a global admin administer tenants before being assigned to the current tenant?
- Should tenants support multiple domains, and how should custom domain verification/ownership be modeled?
- What is the minimum relaunch scope for tenant branding/legal settings versus later tenant onboarding work?
- Should tenant currency/locale/timezone be editable after payment/event data exists?
- Should global admin be able to create tenants, edit domains/settings, impersonate tenant admin views, or only list tenants for support?

### Recommended Cleanup Actions

- Add route-level `globalAdmin:manageTenants` protection and Playwright denial coverage for `/global-admin` and `/global-admin/tenants`.
- Decouple global-admin authorization from current tenant membership, or document and enforce that global admins must always have a platform tenant assignment.
- Centralize server permission evaluation so wildcard permissions, aliases, and dependencies match the client.
- Add unit tests for `resolveTenantContext` covering host-first resolution, local cookie fallback, unknown-host 404 behavior, and stale tenant-cookie behavior.
- Introduce an explicit tenant-domain model if custom domains are in relaunch scope; otherwise document one-domain-per-tenant as a temporary limit.
- Add tenant settings docs/specs for current settings and clearly mark missing branding/legal/domain settings as not implemented.
- Decide whether `seoTitle` / `seoDescription` are product fields, then expose them through tenant config or remove/defer them.

## Generated Documentation and Playwright Coverage

### Current Behavior

- Playwright has separate baseline spec and docs projects. Baseline specs exclude `tests/docs/**`; docs baseline runs `tests/docs/**/*.doc.ts`; integration-only docs are selected with `@needs-*` tags.
- Local docs/spec discovery is runnable again after replacing stale Effect config APIs in `playwright.config.ts` and Playwright support files.
- `bun run test:e2e -- --list` discovers 60 baseline tests across 22 files, including setup projects.
- `bun run test:e2e:docs -- --list` discovers 22 docs tests across 15 files, including setup projects.
- The custom documentation reporter writes grouped Markdown pages and image assets to paths from `DOCS_OUT_DIR` / `DOCS_IMG_OUT_DIR`. In the current local env those resolve into the sibling `evorto-pages` checkout, not this repository.
- The reporter initializes and clears docs/image output roots on `onBegin`, including during list-only commands.
- Reporter-path tests pass with `bun run test:e2e -- tests/specs/reporting/reporter-paths.test.ts --no-deps`.
- The focused screenshot helper test cannot currently run here because the configured Playwright Chromium binary is missing.

### Intended Behavior From Product Context

- Generated documentation should reflect real product workflows and should not describe unimplemented UI.
- Browser/manual exploration is useful for discovery, while Playwright is the durable layer for regressions and generated documentation.
- Documentation and tests should stay lightweight and operational, not become a heavyweight requirements matrix.
- Product-critical flows should be discoverable for users and repeatable for future agents.

### Issues and Risks

- **Must fix before agent scaling:** `tests/specs/events/price-labels-inclusive.spec.ts` contains active `@req` tests with TODOs and placeholder page-load assertions. These tests can go green while protecting none of the price-label semantics their names claim.
- **Must fix before agent scaling:** several specs silently return or skip when required product state is missing. Examples include receipt approval/refund rows, receipt dialog options, event creation setup, unlisted-event seed state, and scanner preconditions. This makes future agents trust coverage that may not have exercised behavior.
- **Must fix before agent scaling:** `tests/docs/events/event-management.doc.ts` documents attendee management, event categories/tags, featured images, settings tabs, notification settings, custom confirmations, integrations, deletion, and messaging that do not match the current reviewed UI.
- **Must fix before agent scaling:** `tests/docs/finance/finance-overview.doc.ts` claims finance permissions and dashboard behavior that do not match the current permission names or the reviewed finance implementation.
- **Must fix before agent scaling:** Playwright discovery was broken by stale Effect config APIs until this pass. This is fixed locally, but it shows the e2e/docs surface was not being exercised recently enough.
- **Should fix before relaunch:** list-only Playwright commands still initialize the docs reporter and can clear generated docs/image output directories. Discovery should be side-effect-light.
- **Should fix before relaunch:** page-backed Playwright specs still fail in this checkout because the configured Chromium binary is missing. `tests/specs/screenshot/doc-screenshot.test.ts` seeds data and then fails at browser launch.
- **Should fix before relaunch:** `tests/test-inventory.md` is stale and still reads like a March 2026 snapshot rather than a current guide for generated docs and Playwright coverage.
- **Should fix before relaunch:** docs coverage is missing or thin for scanning/check-in mutation behavior, tenant/global-admin settings, account creation outside Auth0-management integration, profile discount add/refresh/remove flows, finance route gates, receipt review/refund behavior, role assignment/user management, and registration negative paths.
- **Should fix before relaunch:** `tests/docs/template.doc.ts` is a generic template placeholder and should not ship as product documentation.
- **Should fix before relaunch:** docs screenshot helpers use fixed waits or import-time environment reads in some paths. That adds flakiness and makes focused helper tests less reliable.
- **Acceptable for now:** required `@track`, `@req`, and `@doc` tags make test intent easier to inventory.
- **Acceptable for now:** the documentation reporter has focused tests for output paths, cleanup, grouping, and permissions callouts.
- **Acceptable for now:** deterministic seed helpers and scenario handles exist; the issue is where specs turn missing seeded state into skips or no-op passes.

### Test and Documentation Quality

- Generated docs are valuable but currently mix real walkthroughs with aspirational copy. Future agents need stale docs removed or clearly marked before treating docs as product truth.
- The docs suite favors screenshots and prose, but many docs do not assert that the workflow was completed or persisted.
- Some functional specs have strong names and tags but weak assertions. These are more dangerous than absent tests because they imply coverage.
- Integration-only docs are correctly taggable, but baseline docs should still cover account/profile/tenant flows that do not require Auth0 Management or external APIs.
- The current reporter output target points outside this repository, so this repo does not contain the generated documentation artifact it depends on.

### Open Product Questions

- Should generated documentation be checked into this repository, the sibling documentation app, or treated only as generated CI artifacts?
- Which generated docs are product-facing and must be accurate before relaunch, versus internal examples for agent/testing workflows?
- Should list/discovery commands run reporters at all, or should docs generation be a separate explicit command?
- Should placeholder `@req` ids be retired when the behavior is not implemented, or kept only as `test.fixme` with no green path?
- What is the minimum durable Playwright coverage for relaunch across registration, finance, scanning, roles, tenant admin, and profile flows?

### Recommended Cleanup Actions

- Replace placeholder price-label specs with focused assertions or mark them `test.fixme` until the behavior is implemented.
- Rewrite or remove stale event-management and finance-overview docs before agents use generated docs as product guidance.
- Convert silent no-op passes in finance, scanner, unlisted-event, and event-creation specs into explicit fixture setup, hard failures, or honest `test.fixme` states.
- Make docs/list commands avoid reporter output cleanup and make the local browser installation expectation explicit.
- Remove `tests/docs/template.doc.ts` or replace it with a real product doc.
- Update `tests/test-inventory.md` after stale/placeholder docs are pruned.
- Add missing docs/specs for scanning mutation, tenant/global-admin settings, account/profile persistence, role/user management, and negative registration paths as those flows are stabilized.

## Prioritized Cleanup Backlog

### Must Fix Before Agent Scaling

1. Server-side registration preconditions: event must be approved, option must belong to the current tenant/event, registration window must be open, and user roles must be eligible.
2. Registration capacity updates must be concurrency-safe and transactional.
3. Event create/update date validation must reject invalid ordering and invalid registration windows.
4. Replace or validate `Schema.Any` event location at the RPC boundary.
5. Add server-side template permission checks for view/create/edit and direct route guards for template write flows.
6. Validate template category/role ids and template offset ordering at the server boundary.
7. Centralize permission evaluation so client and server agree on dependencies, legacy aliases, and direct permission checks.
8. Add route guards and direct-route denial coverage for admin role/user/settings and other permission-sensitive routes.
9. Split role lookup APIs so organizers can select event/template eligibility roles without receiving admin role-management data.
10. Fix paid-registration webhook counter updates so Stripe completion/expiry keeps `reservedSpots` and `confirmedSpots` consistent.
11. Gate finance transaction listing and finance routes with explicit finance permissions.
12. Tie receipt media upload to receipt-submit authorization or an upload preflight to avoid orphan authenticated uploads.
13. Implement real check-in mutation behavior and make the visible scan UI persist `checkInTime` / `checkedInSpots`.
14. Gate scan result and check-in behavior to organizers or a dedicated check-in capability.
15. Make account creation transactional and compatible with global users joining multiple tenants.
16. Fix anonymous `/create-account` behavior so it requires authentication or starts the login flow.
17. Align ESNcard uniqueness/storage with the tenant/global user model.
18. Add route-level global-admin protection and decouple global-admin authorization from current tenant membership.
19. Add focused tenant-resolution tests for host/cookie precedence and unknown-host failure.
20. Remove misleading placeholder tests/docs from the event registration, event management, template tax-rate, role-assignment, finance overview, scanner, and profile/account surfaces.
21. Replace green placeholder specs and silent no-op Playwright tests with real assertions, hard fixture setup, or explicit `test.fixme` states.

### Should Fix Before Relaunch

1. Implement or explicitly defer guest quantities, waitlists, participant/admin cancellation, and transfer/resale.
2. Fix template discount copying to use stable identities instead of title matching.
3. Add Playwright coverage for negative registration paths and role-ineligible direct links.
4. Make organizer signup semantics visible and distinct if it remains modeled as a registration option.
5. Decide whether simple-mode templates are sufficient for relaunch or expand template support for discounts, add-ons, questions, and organizer notes.
6. Hide unsupported template registration modes until their runtime behavior exists, or clearly mark them as draft-only configuration.
7. Fix role hub display persistence or remove the currently misleading hub flags from the role form.
8. Implement or explicitly defer user-role assignment, then align `users:assignRoles`, user-list actions, and role docs.
9. Clarify receipt reimbursement as a manual ledger action or add a real payout integration.
10. Validate receipt tax amount consistency and decide whether receipts can be submitted before an event ends.
11. Add check-in timing, duplicate-scan, camera-error, and guest-quantity behavior before treating scanner UI as relaunch-ready.
12. Clarify profile event cards, communication email, payout preference scope, and ESNcard validation UX before relaunch.
13. Fill the tenant settings gap for domain/custom domain, branding, legal links/text, locale/currency/timezone, SEO fields, and global tenant-admin workflows.
14. Make Playwright list/discovery side-effect-light and document or automate the local browser installation expectation.
15. Update or regenerate `tests/test-inventory.md` after placeholder docs/specs are pruned.

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

### Product Decision Needed

1. Minimum relaunch scope for guest quantities, waitlists, transfers/resale, and cancellation.
2. Exact UX for role-ineligible direct event links.
3. Whether rejected events can be resubmitted unchanged.
4. Whether event creation may produce organizer-only events.
5. Whether simple-mode templates are a temporary authoring UI or the intended relaunch model.
6. Whether random/application registration modes should remain selectable before their semantics exist.
7. Which role reads are safe for organizers and whether those reads should expose permissions.
8. Whether role hub visibility should use `showInHub`, `displayInHub`, or a migrated replacement field.
9. Whether `event_registrations.paymentStatus` remains a supported model field.
10. Whether receipts are allowed before event end, and whether manual reimbursement is enough for relaunch.
11. Which users/capabilities can check in attendees, when scanning is allowed, and how duplicate scans should behave.
12. Whether QR image generation and scanner URL parsing should enforce attendee/organizer identity or tenant-domain origin.
13. How existing global users join additional tenants, and whether tenant joining needs invitation/approval.
14. Whether `communicationEmail`, payout details, and ESNcard records are global user data or tenant-specific profile data.
15. Whether global admins are independent platform principals or tenant users with special metadata/current-tenant assignment.
16. Whether tenants need multiple verified domains for relaunch, and which branding/legal settings are production blockers.
17. Whether generated documentation is checked into this repository, checked into the sibling documentation app, or published only from CI artifacts.

## Fixes Applied In This Pass

- None. The obvious issues found in Events and Registrations affect server-side behavior and need focused tests, so they should be handled as small follow-up cleanup commits rather than opportunistic edits inside the audit document commit.
- None in the Templates pass. The highest-value issues are permission and contract validation gaps that need targeted tests with the fixes.
- None in the Roles and permissions pass. The obvious fixes touch authorization behavior and should be done with route/RPC denial tests instead of as opportunistic audit edits.
- None in the Finance/receipts pass. The highest-value issues touch payment-derived state, transaction visibility, and upload authorization, so they need targeted regression tests with the fixes.
- None in the Scanning/check-in pass. The obvious issue is a missing state-changing workflow; it should be fixed as a focused mutation plus authorization and persistence tests.
- None in the Profile/account pass. The high-value issues affect account transactionality, multi-tenant user semantics, and profile data modeling, so they need focused contract/schema tests with the fixes.
- None in the Tenant/global admin pass. The obvious fixes affect authorization semantics and tenant-resolution tests, so they should be done as focused code/test commits rather than mixed into the audit document commit.
- Generated docs/Playwright pass: replaced stale Effect config-provider calls in Playwright config/support files so `test:e2e -- --list` and `test:e2e:docs -- --list` can discover tests again.

## Review Next

Review local runtime/developer workflow next. The generated-docs pass found Playwright browser installation and reporter/discovery issues that should be folded into the workflow review alongside scripts, env setup, Docker/database helpers, and local verification guidance.
