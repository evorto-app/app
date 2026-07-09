# Quality Context

Evorto quality means the app preserves core product behavior, remains understandable to future agents, and can be verified without relying on chat history or human memory.

Avoid a heavy requirements/test matrix for now. Use a lightweight behavior and verification model:

1. Describe important workflows.
2. Verify those workflows with the right tool.
3. Keep generated docs and tests current.
4. Provide clear evidence before finishing.

## What Good Means

A good Evorto change is:

- correct for the product workflow
- tenant-safe
- permission-safe
- type-safe
- SSR-safe where relevant
- payment-safe where relevant
- documented if it affects user/admin behavior
- discoverable through the UI
- verified through tests and/or Browser walkthroughs
- consistent with existing architecture choices

A change is not done if:

- it only works by typing a hidden URL
- it bypasses roles/capabilities
- it weakens tenant isolation
- it fakes Stripe/payment state
- it leaves essential generated docs stale
- it adds a new workflow without a repeatable verification path
- it silently ignores errors
- it relies on unclear assumptions that should have been raised

## Lightweight Behavior and Verification Model

For each meaningful change, agents should identify:

- affected workflow
- affected persona
- affected tenant boundary
- affected capabilities/permissions
- expected user-visible behavior
- verification performed
- remaining risks or watchpoints

This is not a rigid ID system. Do not introduce a complex requirements matrix unless explicitly requested.

## Browser Plugin vs Playwright

Use the Codex in-app Browser plugin for exploratory and manual-style
verification.

Good Browser use cases:

- understand current page structure
- reproduce a bug
- inspect console errors
- inspect network behavior
- validate a changed UI visually
- check that a flow feels usable
- find selectors or stable user paths before writing Playwright
- verify that a new page is reachable through a click path

Use Playwright for repeatable verification.

Good Playwright use cases:

- essential regression coverage
- deterministic end-to-end flows
- CI coverage
- generated product documentation
- screenshot-backed user/admin docs
- proving that a bug is fixed

Preferred flow for UI behavior changes:

1. Use Browser to explore and validate manually.
2. Add or update Playwright coverage for the durable expected behavior.
3. Update generated documentation when the user/admin workflow changes.

If Browser is unavailable because the plugin, pane, or control transport is not
healthy, keep durable validation moving with Playwright and record the Browser
blocker explicitly. Do not treat Playwright, screenshots, or system Chrome as a
substitute for a requested in-app Browser walkthrough.

## Unit Tests

Use unit tests for deterministic logic close to the source.

Good unit-test targets:

- pure transformation logic
- schema validation behavior
- permission/capability helper logic
- date/time calculations
- registration eligibility calculations
- capacity/waitlist calculations
- simple/advanced configuration conversion and warning rules
- add-on attachment, included-entitlement, stock, redemption, undo, and
  cancellation calculations
- organizer/check-in and unilateral-cancellation capability checks
- transfer/resale state transitions where isolated
- receipt/payment helper behavior where isolated

Do not use unit tests as a substitute for verifying complete user flows.

## Playwright Regression Tests

Use Playwright for important user journeys and integration behavior.

High-value Playwright flows include:

- browsing listed events
- creating an event from a template
- configuring participant and organizer signup settings
- switching simple/advanced registration configuration without mutating existing
  event snapshots
- attaching reusable add-ons to one or more registration options, including
  included and optional quantities
- submitting an event for review
- returning an event to draft
- publishing an event
- registering for a free event
- registering for a paid event
- receiving registration confirmation / QR code
- joining a waitlist
- cancelling a registration
- transferring/reselling a registration
- checking in participants
- checking in guest quantities
- redeeming and immediately undoing registration add-ons from a scanned ticket
- organizer cancellation of unredeemed add-on units with and without a refund
- submitting a receipt
- reviewing a receipt
- managing roles/capabilities
- tenant branding/settings/legal page behavior

Keep tests deterministic. Prefer seeded scenario handles over fuzzy discovery.
Relaunch coverage should include happy paths plus the critical permission,
tenant, payment, and recovery-path failures that would make shipping unsafe if
broken. Do not turn this into a broad matrix for its own sake.

Avoid noisy Playwright tests that only assert implementation details without protecting meaningful behavior.

## Playwright-Generated Documentation

Generated documentation is product documentation first and verification evidence second.

Essential product flows should have generated documentation with screenshots where helpful.
Documentation generation should happen through explicit docs commands. List or
discovery commands do not clean or rewrite generated docs output.

Organize generated docs by feature area, such as:

- events
- templates
- registrations
- payments
- check-in
- roles and permissions
- tenant settings
- receipts
- documentation/help

Persona tags or metadata may be added later.

When a user/admin workflow changes, update the generated documentation scenario as part of the change.

## Visual and Manual Verification

Use screenshots for visible UI changes.

Use Browser verification for:

- layout changes
- Material 3 component behavior
- Tailwind responsive behavior
- forms
- modals/dialogs
- event cards/lists
- registration flows
- check-in flows
- admin settings
- generated documentation pages

For visible UI changes, evidence should usually include:

- a short description of the browser walkthrough
- screenshot(s) if the visual result matters
- confirmation that console/network behavior was checked when relevant
- Playwright coverage or explanation why it was not useful

## Manual Review Queue

Use this compact queue when a Codex in-app Browser walkthrough is requested and
the Browser control transport is healthy. It complements, but does not replace,
the durable Playwright and generated-documentation coverage.

1. **Anonymous event discovery:** browse the event list and a public event,
   then open an unlisted event from its direct link.
2. **Participant registration and profile:** inspect free, paid, waitlist,
   cancellation, ticket, and receipt states.
3. **Organizer authoring and check-in:** create or edit a template/event,
   inspect event management, and exercise scanner feedback, add-on redemption
   and undo, and guest check-in.
4. **Tenant administration and finance:** inspect settings, roles, finance
   navigation, receipt review, reimbursement recording, and tax-rate access.
5. **Global administration:** inspect tenant list/detail/create/edit behavior
   and the stated custom-domain and impersonation boundaries.
6. **Live ESNcard provider:** run
   `E2E_LIVE_ESN_CARD_IDENTIFIER=... bun run test:e2e:live-esncard` as a
   release requirement, then inspect the add, refresh, remove, and provider UX.

## Done Criteria

For a typical change, before finishing:

- relevant tests pass
- lint/format expectations are satisfied
- new or changed behavior has tests where practical
- Browser walkthrough was performed for UI behavior changes
- Playwright coverage was added or updated for durable behavior
- generated docs were updated for relevant user/admin workflow changes
- screenshots are provided for visual changes
- the feature has a discoverable click path
- release/change-file expectations are met when release-relevant
- any unresolved design watchpoint is called out

For a bug fix:

- reproduce the bug where practical
- add or update a test that would have failed before the fix
- verify the fixed behavior
- mention any related generated docs or screenshots if user-visible

For a new feature:

- verify the happy path
- verify important edge cases
- add Playwright coverage for the durable flow
- update generated documentation
- check tenant/permission boundaries
- provide Browser evidence for the implemented UI

For a refactor:

- keep behavior unchanged
- run targeted tests
- avoid changing product behavior accidentally
- mention if any product behavior changed intentionally

## High-Risk Areas

Use extra caution when touching:

- tenant resolution
- tenant isolation in queries and caches
- roles and capabilities
- event review/publishing lifecycle
- event listing/visibility
- registration options
- registration exclusivity
- capacity limits
- waitlists
- guest quantities
- add-on entitlement, stock, redemption, cancellation, and partial-refund state
- Stripe checkout/webhooks/refunds
- transfer/resale
- QR code check-in
- receipts/reimbursements
- event archival
- SSR/auth/cookie behavior
- generated documentation flows
- local runtime/worktree isolation

## Browser Evidence Expectations

When Browser verification is used, summarize:

- page or flow checked
- user path followed
- visible result
- whether console/network looked clean, if relevant
- screenshots captured, if relevant
- any issue found and fixed

Do not claim Browser verification was performed if it was not.
If Browser could not be used, name the blocker and summarize the fallback
validation separately.

## Playwright Evidence Expectations

When Playwright is used, summarize:

- command or project run
- tests added or updated
- result
- generated docs affected
- trace/video/screenshot evidence if relevant

Use Playwright traces/videos when they help explain a failure or validate a complex workflow.

## Release and Change Files

For release-relevant work, add a Knope change file in `.changeset/*.md`.

A change is release-relevant when it affects:

- user-visible behavior
- admin-visible behavior
- API/runtime behavior
- schema/data behavior
- payment behavior
- generated documentation
- deployment/runtime expectations

## Open Questions and Watchpoints

Root docs may include open questions when they are actionable.

A good watchpoint includes:

- current default
- when to raise it
- what not to decide casually

Agents should mention a watchpoint when working nearby instead of silently choosing a product direction.

## Quality Watchpoints

### Generated documentation coverage

Current default: every essential product flow should eventually be documented through Playwright-generated docs.

Raise this when: adding or changing a user/admin flow.

Do not: ship an important workflow change while leaving docs knowingly stale.

### Browser versus Playwright

Current default: Browser is for exploration and manual validation; Playwright is for durable regression and documentation.

Raise this when: a flow is hard to verify repeatably or Browser finds behavior that should become a regression test.

Do not: rely only on screenshots for behavior that should be covered by Playwright.

### Hidden pages

Current default: new pages and features need discoverable click paths.

Raise this when: adding routes, admin pages, settings pages, documentation pages, or feature entry points.

Do not: leave functionality accessible only through a manually typed URL unless it is explicitly internal/debug-only.

### Permission-sensitive changes

Current default: role/capability checks are product behavior and must be verified.

Raise this when: changing visibility, registration eligibility, event review/publishing, tenant settings, or admin workflows.

Do not: relax permission checks to make tests or UI flows pass.
