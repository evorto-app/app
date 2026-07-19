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
5. **Platform administration:** inspect tenant list/detail/create/edit behavior,
   target-scoped event/template/registration, user-role, finance/refund, and tax
   operations, plus the stated custom-domain and impersonation boundaries. For
   scanner review, prefer a deterministic registration-result URL; emulate a
   camera in Playwright only when the browser path is straightforward and
   reliable.
6. **Required production providers:** the Release workflow must complete the
   protected **Production Provider Certification** job. It runs the Auth0
   Management and Google Maps integration projects before active-card add,
   refresh, remove, expired-card status, and provider-error UX. Use its manual
   dispatch for rotation checks. Local ESNcard certification runs with
   `E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:live-esncard:release`
   and must pass the same fail-closed credential preflight plus the provider
   error unit check. A missing identifier fails the run; live-provider coverage
   is never converted into a skipped test.

## Done Criteria

### Local-first CI gate

Before any push, PR update, or other action that can trigger CI, run the full
local equivalent of every CI test suite that the change will trigger. The local
run must complete entirely: every collected test passes, with zero failures,
skips, todos, fixmes, expected failures, retries/flakes, interrupted tests, or
focused tests. A suite that omits tests because a database, external service,
environment variable, or credential is unavailable does not satisfy this gate.
Resolve the dependency and rerun locally before CI is attempted. CI is
confirmation of an already-green local result, not the first place to discover
whether the complete suite passes.

The canonical, unfiltered repository-owned Vitest and Playwright commands
enforce completeness within each collected suite at runtime: skipped, todo,
interrupted, expected-failure, retried/flaky, or focused tests make the run
fail. Any caller-forwarded selector beyond a canonical package script that
reduces collection is diagnostic-only and never counts as final gate evidence,
including file arguments, `--filter`, `--grep`, `--grep-invert`, `--include`,
`--last-failed`, `--related`, project, shard, `--changed`, or reporter
overrides. Run the complete PR-equivalent command set documented in `README.md`;
one selected suite or a clean source scan never replaces the complete runtime
result. Before any push, PR update, merge, or release that triggers provider
certification, run both `bun run test:e2e:integration` with the approved Auth0
Management and Google Maps credentials and
`bun run test:e2e:live-esncard:release` with the protected live-provider
active and permanently expired identifiers. The live ESNcard provider portion
is not the whole provider gate. Both commands must finish locally with
every collected test passing and zero incomplete outcomes before CI is
attempted. Cloudflare Images is being removed and is not a release gate.

Stripe tax-rate metadata has non-null account ownership in the fresh target
schema. Event, template, tax-rate import, and account-rotation writers must take
the same tenant-row lock before changing paid or tax-rate configuration. Legacy
data transfer must fail closed unless provider verification can assign exact
account ownership; nullable staging rows and production backfills are not a
supported release path.

Repository-owned workflows pin every external action to a reviewed full commit
SHA and retain a readable release/tag comment. Workflow- and job-level
environment blocks must not contain Actions secrets: validate required values
before checkout/tool setup, then expose each secret only to the install, build,
runtime, or certification step that needs it. Copilot cloud-agent runtime
credentials belong in GitHub Agents secrets/variables, not broad setup-workflow
environment.

Docker-backed Playwright follows explicit ownership. When Playwright starts
`docker:webserver`, that process removes its own project-scoped Compose objects
on exit or shutdown. When `reuseExistingServer` finds a running app, Playwright
does not own that stack and leaves it running. A final gate must not trust an
unknown reused server: stop it and let the gate start a fresh stack, or start
the exact checkout being pushed and verify that provenance explicitly.
`/readyz` proves behavior, not commit identity. `docker:resume` is valid only
for an already initialized plain PostgreSQL/MinIO/Mailpit/Stripe/web/worker
Compose project whose one-shot database and bucket setup completed
successfully. Use `docker:start` for an intentional schema reset and reseed;
the disposable Playwright-owned stack removes its project volumes on exit.

For a typical change, before finishing:

- the local-first CI gate passes for every CI suite the change will trigger
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
- run targeted tests during the edit loop, then the complete local-first CI
  gate before any CI-triggering action
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
