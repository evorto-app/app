# Stabilization Review

This document tracks a pragmatic stabilization pass before deeper agent-driven
development. It is not a requirements matrix. Keep findings concrete, scoped,
and useful for small cleanup batches.

## Review Status

| Area                                            | Status                            | Confidence | Notes                                                                                        |
| ----------------------------------------------- | --------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Events                                          | First pass complete               | partial    | Code, tests, docs, and an unauthenticated Browser walkthrough reviewed.                      |
| Registrations                                   | First pass complete               | partial    | Free/paid registration paths reviewed; several server-side precondition gaps need follow-up. |
| Templates                                       | First pass complete               | partial    | Simple-mode template flow reviewed; permission and model-depth gaps need follow-up.          |
| Roles and permissions                           | Not started                       | unknown    | Needed to validate event eligibility and admin surfaces.                                     |
| Finance/receipts                                | Not started                       | unknown    | Payment and receipt flows are high-risk and partially coupled to registrations.              |
| Scanning/check-in                               | Not started                       | unknown    | Registration QR and organizer permissions depend on this.                                    |
| Profile/account flows                           | Not started                       | unknown    | Account-required registration and discount cards depend on this.                             |
| Tenant/global admin                             | Not started                       | unknown    | Tenant resolution, branding, and global admin boundaries need review.                        |
| Generated documentation and Playwright coverage | First pass for event-related docs | partial    | Event docs exist, but some docs/specs encode aspirational or placeholder behavior.           |
| Local runtime/developer workflow                | Lightly reviewed                  | partial    | Root/test/helper guidance and visible scripts reviewed.                                      |

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

## Prioritized Cleanup Backlog

### Must Fix Before Agent Scaling

1. Server-side registration preconditions: event must be approved, option must belong to the current tenant/event, registration window must be open, and user roles must be eligible.
2. Registration capacity updates must be concurrency-safe and transactional.
3. Event create/update date validation must reject invalid ordering and invalid registration windows.
4. Replace or validate `Schema.Any` event location at the RPC boundary.
5. Add server-side template permission checks for view/create/edit and direct route guards for template write flows.
6. Validate template category/role ids and template offset ordering at the server boundary.
7. Remove misleading placeholder tests/docs from the event registration, event management, and template tax-rate surfaces.

### Should Fix Before Relaunch

1. Implement or explicitly defer guest quantities, waitlists, participant/admin cancellation, and transfer/resale.
2. Fix template discount copying to use stable identities instead of title matching.
3. Add Playwright coverage for negative registration paths and role-ineligible direct links.
4. Make organizer signup semantics visible and distinct if it remains modeled as a registration option.
5. Decide whether simple-mode templates are sufficient for relaunch or expand template support for discounts, add-ons, questions, and organizer notes.
6. Hide unsupported template registration modes until their runtime behavior exists, or clearly mark them as draft-only configuration.

### Acceptable For Now

1. Server-side edit locks are duplicated with UI guards; keep until broader event authorization is reviewed.
2. Browser walkthrough coverage for anonymous event browsing is enough for this first pass; authenticated manual behavior should be revisited after server preconditions are fixed.
3. Rich seeded demo data is useful even if some seeded states are ahead of implemented product behavior, as long as tests do not treat those states as complete features.
4. The current template detail page is discoverable and useful as a summary of simple template defaults.

### Product Decision Needed

1. Minimum relaunch scope for guest quantities, waitlists, transfers/resale, and cancellation.
2. Exact UX for role-ineligible direct event links.
3. Whether rejected events can be resubmitted unchanged.
4. Whether event creation may produce organizer-only events.
5. Whether simple-mode templates are a temporary authoring UI or the intended relaunch model.
6. Whether random/application registration modes should remain selectable before their semantics exist.

## Fixes Applied In This Pass

- None. The obvious issues found in Events and Registrations affect server-side behavior and need focused tests, so they should be handled as small follow-up cleanup commits rather than opportunistic edits inside the audit document commit.
- None in the Templates pass. The highest-value issues are permission and contract validation gaps that need targeted tests with the fixes.

## Review Next

Review Roles and permissions next. The Events, Registrations, and Templates passes all found capability/eligibility questions that should be resolved before touching finance or check-in behavior.
