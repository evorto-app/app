# Full Application Compliance Audit

Audit date: 2026-07-09
Remediation updated: 2026-07-10
Audit baseline: `origin/main` at `9545a2c68d2` (`feat: implement relaunch registration decisions (#83)`)
Remediation baseline: `origin/main` at `df7c2c0143b307bb17d7e763ccf9ef13e6646b30`
Scope: static, folder-by-folder review of the application, server/runtime, data layer, shared contracts, tests, CI, and product documentation.

## Outcome

The application has a strong tenant/permission/registration foundation, but it is **not ready to be treated as a full production replacement** against the root product, architecture, and quality documents until the remaining P0/P1 items below are resolved or explicitly re-scoped. SCAN-001 is resolved in the current remediation branch. The highest remaining risks are payment integrity races/trust gaps, absent product-required notification types and paid resale, and unimplemented onboarding/tenant-runtime behavior.

## Method and constraints

- Read the root product, architecture, and quality documents plus the nearest module guidance.
- Reviewed `src/app`, `src/server`, `src/db`, `src/shared`, `tests`, `helpers`, root tooling, and CI configuration. The source surface includes 439 TypeScript/HTML/SCSS application files.
- Applied the requested Effect, Uncodixfy, and Material 3 reviews. Material findings are adapted to Angular Material and the project’s `--mat-sys-*`/Tailwind bridge; this is not an `@material/web` audit.
- Ran the safe documentation-discovery command: `bun run test:e2e:docs -- --list`. It found 31 docs/setup tests in 19 files, including the `@finance` documents that CI currently filters out.
- The initial audit did not start Docker or run destructive database commands. Remediation now uses an isolated, freshly seeded worktree Compose stack, Playwright, generated-documentation screenshots, and an in-app Browser baseline. The authenticated Browser scanner walkthrough remains pending the user signing in to the open in-app Browser and returning control.
- The requested Effect skill and its guides now use this repository’s approved `repos/effect` vendor location; no second vendor or symlink is maintained.
- Consolidated the prior stabilization ledger into the root documents, this audit, and the concise `QUALITY.md` manual review queue. The historical ledger is intentionally removed rather than retained as a second release-truth document.

## Severity definitions

| Severity | Meaning                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| P0       | Direct release blocker: can prevent a core workflow or cause immediate payment/security harm.                                |
| P1       | High-risk product, payment, security, or verification failure that must be resolved before a production-replacement release. |
| P2       | Material correctness, UX, resilience, or release-confidence gap; schedule in the next stabilization batch.                   |
| P3       | Important conformance or maintainability cleanup with bounded immediate impact.                                              |

## Findings at a glance

| ID         | Severity | Area                | Short finding                                                                                              |
| ---------- | -------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| SCAN-001   | P0       | Check-in            | **Resolved 2026-07-10:** first-party camera policy and scanner entry coverage are restored.                |
| PAY-001    | P0       | Payments            | Concurrent manual approval can create multiple Checkout sessions for one registration.                     |
| PAY-002    | P1       | Payments            | Webhooks trust session metadata without proving local transaction/session ownership.                       |
| SEC-001    | P1       | Runtime             | RPC and Stripe webhooks buffer unbounded request bodies.                                                   |
| EVT-001    | P1       | Event review        | The application keeps a durable `REJECTED` state despite the accepted return-to-draft lifecycle.           |
| PROD-001   | P1       | Notifications       | Most email notifications required by `PRODUCT.md` have no producer or outbox kind.                         |
| PROD-002   | P1       | Registrations       | Paid transfer/resale remains intentionally unavailable, but is required for the production replacement.    |
| ESN-001    | P1       | ESNcard             | Live external ESNcard add, refresh, and remove verification is required but remains credential-gated.      |
| FIN-001    | P1       | Finance UI          | Receipt amounts are rendered as EUR even when the tenant currency is CZK or AUD.                           |
| ONB-001    | P1       | Tenant onboarding   | Accepted privacy/onboarding/home-tenant rules have no model, form, or server enforcement.                  |
| TEN-001    | P1       | Tenant settings     | Fixed `de-DE` formatting and tenant currency/timezone are not consistently applied at runtime.             |
| ADMIN-001  | P1       | Platform admin      | Platform admins have broad permissions but cannot perform normal tenant actions without tenant membership. |
| CI-001     | P1       | CI/docs             | CI silently excludes all `@finance` generated docs despite those flows being product-facing.               |
| TEST-001   | P1       | Manual approval     | The newly supported application/manual-approval journey has no page-backed spec or generated doc.          |
| TEST-002   | P1       | Roles               | Existing-user role assignment has no mutation/readback browser or docs coverage.                           |
| SEC-002    | P2       | Links               | Approval emails and Stripe return URLs trust caller-provided `Origin`.                                     |
| OPS-001    | P2       | Notifications       | A process crash can leave outbox rows permanently in `sending`.                                            |
| OPS-002    | P2       | Test infrastructure | Neon Local restart/expiry gaps can leave remote branches or deleted-worktree Compose projects behind.      |
| DATA-001   | P2       | Tenancy             | Cross-tenant role/registration tuple integrity is enforced in handlers but not by database constraints.    |
| UX-001     | P2       | Permissions         | Template actions are visible even when the user lacks the corresponding capability.                        |
| UX-002     | P2       | Resilience          | Several core views have no first-load error/retry state.                                                   |
| UX-003     | P2       | Location            | Location-provider/configuration failures are presented as “no results.”                                    |
| UI-001     | P2       | Theming             | The Material/Tailwind semantic success/warning token bridge is incomplete.                                 |
| A11Y-001   | P2       | Accessibility       | Reusable icon selection and several icon-only actions lack keyboard or accessible-name support.            |
| TEST-003   | P1       | Release confidence  | CI has E2E and an implicit Docker build, but no branch protection, lint, unit, or Knope quality gate.      |
| TEST-004   | P2       | Coverage            | New tenant operational settings and the global Email Outbox lack durable UI/docs coverage.                 |
| EFFECT-001 | P3       | Contracts           | The tenant settings RPC accepts `defaultLocation` through `Schema.Any`.                                    |
| EFFECT-002 | P3       | Tests               | One server Effect test bypasses the project’s preferred `it.effect` runtime.                               |

## Release blockers and high-risk findings

### SCAN-001 — Global security policy makes QR check-in unusable

**Severity:** P0
**Status:** Resolved on 2026-07-10 in `codex/production-readiness-compliance`
**Why it matters:** QR scanning is a core organizer workflow.

**Original evidence**

- `src/server/http/security-headers.ts:4` sends `Permissions-Policy: camera=(), geolocation=(), microphone=()`.
- `src/server.ts:381-398` applies that header through global middleware, with no scanner-route exception.
- `src/app/scanning/scanner/scanner.component.ts:106-139` creates `QrScanner` and calls `scanner.start()`.

`camera=()` denies camera access to the document itself, so browser permission cannot make the scanner work. The component’s retry guidance therefore sends an organizer toward a browser setting that cannot fix the policy-level denial.

**Resolution evidence**

1. `src/server/http/security-headers.ts` now permits `camera=(self)` while keeping microphone and geolocation denied; `security-headers.spec.ts` locks the exact policy.
2. The scanner exposes accessible loading, ready, and failure states and keeps the camera preview bounded on wide layouts.
3. Check-in timing is server-authoritative: the scan RPC returns the timing issue, the UI no longer compares against its own wall clock, and successful check-in records the same configured server instant used for eligibility.
4. Worktree runtime generation passes one deterministic clock and seed key to database setup, the app container, and Playwright so seeded event windows cannot drift from server decisions.
5. `tests/specs/scanning/scanner.test.ts` verifies allowed and denied camera paths through a deterministic canvas-backed `MediaStream`, in addition to the registration, guest, timing, and persisted-counter cases.
6. `tests/docs/scanning/check-in.doc.ts` starts from the visible **Scanner** navigation item, proves camera startup, and documents attendee verification, partial guest arrival, duplicate scans, persistence, recovery, permissions, and ticket security.
7. The documentation screenshot helper now disables animations for capture, preventing Angular view-transition crossfades from mixing the previous and current pages.

### PAY-001 — Concurrent manual approval can create duplicate payments

**Severity:** P0
**Why it matters:** Two organizers can approve the same pending application concurrently, leading to duplicate capacity reservations, two Checkout sessions, and potentially two charges.

**Evidence**

- `src/server/effect/rpc/handlers/events/event-registration.service.ts:465-476` checks for a pending transaction before entering the approval transaction.
- `src/server/effect/rpc/handlers/events/event-registration.service.ts:571-670` reserves capacity but leaves a paid application registration in `PENDING`; the conditional status update therefore does not claim the approval.
- `src/server/effect/rpc/handlers/events/event-registration.service.ts:729-867` creates the Checkout session and pending transaction later, outside that reservation transaction.
- `src/server/http/stripe-webhook.web-handler.ts:481-513` marks a transaction successful before it discovers whether the registration was already confirmed by another event.

**Fix direction**

1. Atomically claim approval with a distinct state or a durable lease before any Stripe call.
2. Create/record exactly one live registration-payment transaction under the same lock, then reuse its Checkout session/idempotency key.
3. Add a database constraint for one live pending registration payment and a concurrency test with two simultaneous approvals.

### PAY-002 — Checkout webhook handling does not prove local payment ownership

**Severity:** P1
**Why it matters:** Stripe is the payment source of truth, but the completion and expiry handlers can mutate a registration based on webhook metadata that is not tied back to the expected local Checkout session.

**Evidence**

- `src/server/http/stripe-webhook.web-handler.ts:80-120` accepts complete metadata even when no local transaction is found for the session/payment intent.
- `src/server/http/stripe-webhook.web-handler.ts:481-536` conditionally updates a transaction only by id/status/tenant, ignores whether it changed a row, then confirms the registration.
- The completion/expiry paths do not require the expected `stripeCheckoutSessionId`, expected payment intent, registration id, amount/currency, or connected account event to match before changing registration/capacity state.

**Fix direction**

1. Resolve a pending transaction by the received Checkout session id, then verify tenant, registration id, payment intent, amount, currency, and connected account.
2. Make the transaction conditional update return a row; do not touch the registration unless that row proves the webhook owns the pending local payment.
3. Apply equivalent correlation checks to expiry and replay handling.
4. Add negative webhook tests for validly signed but unrelated sessions, mismatched metadata, mismatched account, and duplicate completion/expiry events.

### SEC-001 — RPC/webhook bodies are buffered without a size limit

**Severity:** P1
**Why it matters:** A resolvable tenant accepts unauthenticated requests to `/rpc`; an oversized body is buffered before authentication, schema decoding, or downstream upload-size checks.

**Evidence**

- `src/server/effect/rpc/app-rpcs.request-handler.ts:80-97` calls `request.arrayBuffer()` for every non-GET RPC request.
- `src/server.ts:338-363` resolves tenant context for `/rpc` but does not require authentication before body handling.
- No application source supplies Effect’s `HttpIncomingMessage.MaxBodySize`; the vendored Effect default is `undefined` in `repos/effect/packages/effect/src/unstable/http/HttpIncomingMessage.ts:109-118`.
- `src/server/http/stripe-webhook.web-handler.ts:251-264` likewise consumes the complete body before its nominal 200 KB check.

**Fix direction**

1. Enforce a global pre-buffer `Content-Length`/stream limit, with lower limits for RPC and webhook routes.
2. Give base64 asset and receipt paths explicit, documented endpoint limits before decoding.
3. Add boundary tests for missing/misleading `Content-Length`, streamed oversized bodies, and acceptable valid payloads.

### EVT-001 — Event rejection retains a stale durable lifecycle state

**Severity:** P1
**Why it matters:** The accepted product lifecycle is `draft` → `pending review` → `published`; a negative review returns the event to draft with feedback. The current state machine stores `REJECTED`, forcing creators and reviewers through a separate lifecycle that the product no longer wants.

**Evidence**

- `src/db/schema/event-instances.ts:18-23` includes `REJECTED` in the persisted event-status enum.
- `src/server/effect/rpc/handlers/events/events-review.handlers.ts:51` writes `REJECTED` on a negative review.
- `src/shared/rpc-contracts/app-rpcs/events.rpcs.ts:31-38`, `src/app/events/guards/event-edit.guard.ts:24-31`, and generated event-review documentation all expose that state.

**Fix direction**

Replace the negative-review transition with `DRAFT` plus persisted reviewer feedback. Remove `REJECTED` from the schema/contracts/UI, preserve the feedback/audit record, and update the lifecycle, route, unit, Playwright, and generated-documentation coverage together.

### PROD-001 — Required notification workflows are mostly absent

**Severity:** P1
**Why it matters:** `PRODUCT.md:339-344,365-372` explicitly puts successful
registration with an authenticated ticket link, waitlist availability, event and
registration cancellation, transfer completion, and receipt review in scope.

**Evidence**

- `src/db/schema/email-outbox.ts:20-23` permits only `manualApproval` and `receiptReviewed` kinds.
- `src/server/notifications/email-delivery.ts:151-202` exposes producers only for those two kinds.
- `src/server/effect/rpc/handlers/finance/finance-receipts.handlers.ts:662-714` correctly queues receipt-reviewed email transactionally, but no alternate outbound or in-app producer exists for the remaining in-scope transitions.

**Fix direction**

1. Add idempotent outbox kinds and transactional producers for confirmed registration (including an authenticated ticket link), waitlist availability, participant/admin cancellation, event cancellation when implemented, and transfer completion.
2. Render every customer-facing template with React Email while keeping recipient, retry, idempotency, and failure-observability rules in the outbox/delivery boundary.
3. Cover each producer with a unit/handler test and at least one page-backed documentation flow where the workflow is user-facing.

### PROD-002 — Paid transfer/resale is still unavailable

**Severity:** P1
**Why it matters:** `PRODUCT.md:227-251` requires a transfer/resale flow that
accepts recipient payment, cancels the original registration, and refunds it
through Stripe.

**Evidence**

- `src/server/effect/rpc/handlers/events/events-registration.handlers.ts:695-700` and `:1156-1178` reject paid transfer until refund/resale handling exists.
- `src/app/events/event-active-registration/event-active-registration.component.ts:98-102` tells users that paid registration transfer/resale is not automatic.

**Fix direction**

This is an accepted paid-event launch requirement. Define the recipient payment,
original-registration cancellation, Stripe refund timing/failure recovery,
resale eligibility, and audit trail; then implement the complete state machine
and documentation. Use the tenant's Stripe Connect account for every payment
and refund request, attaching its account id as the connected-account context.
Evorto adds its application fee; cancellation/fee-refund timing defaults belong
to the tenant and may be overridden per registration option. The recipient
completes the current selected option's full flow and eligibility check rather
than inheriting the original participant's price, discount, or answers. Confirm
the recipient before cancelling/refunding the original registration. A
non-fee-refund amount returns the payment less applicable fees so the tenant is
net zero; seed transfer-until-event-start, five-day cancellation, and fee-refund
defaults for new tenants.

### ESN-001 — Live ESNcard provider coverage is a release requirement

**Severity:** P1
**Why it matters:** Enabled tenant ESNcard programs need live external add,
refresh, and remove verification. A credential-gated optional run cannot prove
that the provider works in the production-replacement release.

**Evidence**

- `QUALITY.md:203-205` currently records the provider under the manual review
  queue and names the credentialed test command.
- `tests/specs/profile/user-profile-live-esncard.spec.ts` contains the existing
  live-provider coverage path, but it cannot be treated as optional for this
  release requirement.

**Fix direction**

Provision an approved non-production provider identity and credential path for
CI/release verification. Exercise add, refresh, remove, errors, and the
user-visible provider state with a live integration test; document the required
credential ownership and rotation procedure without exposing secrets.

### FIN-001 — Tenant-configurable money is displayed as EUR in receipt flows

**Severity:** P1
**Why it matters:** The tenant can use EUR, CZK, or AUD, but finance UI labels and values can show a euro symbol regardless of tenant currency.

**Evidence**

- `src/app/app.config.ts:89-92` supplies `DEFAULT_CURRENCY_CODE` from tenant configuration.
- EUR/€ is hard-coded in `src/app/finance/shared/receipt-form/receipt-form-fields.component.html:25-72`, `src/app/finance/receipt-approval-list/receipt-approval-list.component.html:34`, `src/app/finance/receipt-refund-list/receipt-refund-list.component.html:39-45`, `src/app/events/event-organize/event-organize.html:275-277`, and `src/app/profile/user-profile/user-profile.component.ts:213-214`.

**Fix direction**

Use `CurrencyPipe`/the injected tenant currency consistently for field labels, lists, totals, and profile summaries. Add CZK/AUD rendering coverage alongside the current EUR flows.

### ONB-001 — Accepted tenant onboarding and home-tenant rules are not implemented

**Severity:** P1
**Why it matters:** The accepted relaunch rule is automatic tenant joining after privacy-policy acceptance and required tenant-wide answers, with a home-tenant warning. The current flow joins immediately and has no records for those obligations or for a home tenant.

**Evidence**

- `src/shared/rpc-contracts/app-rpcs/users.rpcs.ts:44-49` accepts only name and communication-email fields for account creation.
- `src/app/core/create-account/create-account.component.html:20-72` presents only those fields.
- `src/server/effect/rpc/handlers/users.handlers.ts:317-461` immediately creates the tenant membership and default roles after authentication.
- `src/db/schema/users.ts:20-110` has neither a home-tenant relation nor tenant-onboarding acceptance/answer records.

**Fix direction**

Model versioned privacy acceptance and tenant-scoped required-question answers.
Collect and validate them before the membership transaction, preserve their audit
trail, and make that first completed membership the home tenant. Add the
home-tenant warning and an explicit profile action to change it; a later
automatic cross-tenant join must never overwrite it. Every policy change must
require re-acceptance and inform the tenant administrator who made the change.
Support only short-text and selection-list tenant questions. Resolve current
requirements for every authenticated tenant user and require immediate
completion when information or policy acceptance is missing.

### TEN-001 — Fixed formatting locale and tenant currency/timezone are not applied at runtime

**Severity:** P1
**Why it matters:** The product uses fixed `de-DE` formatting while currency and business timezone remain tenant settings. The current application provides the tenant currency to Angular, but does not consistently apply the fixed locale or tenant timezone.

**Evidence**

- `src/db/schema/tenants.ts:23-71` stores currency, locale, and timezone, but the current tenant-locales enum does not include fixed `de-DE`.
- `src/app/app.config.ts:89-92` supplies `DEFAULT_CURRENCY_CODE`, but does not provide tenant `LOCALE_ID`, a date/time default zone, or Luxon zone configuration.
- `src/app/admin/general-settings/general-settings.component.ts:230-247` reloads after a locale/timezone edit even though the runtime does not apply those values consistently.
- `src/server/effect/rpc/handlers/admin.handlers.ts:162-205` locks tenant-admin edits after event/payment data exists, while `src/server/effect/rpc/handlers/global-admin.handlers.ts:100-190` has no equivalent guarded/audited override path.

**Fix direction**

Fix the formatting locale to `de-DE` and remove it as a tenant-editable choice.
Support the Section App currency set (`EUR`, `CZK`, `AUD`) and IANA tenant
timezones with `Europe/Berlin` as the default. Wire the fixed locale, tenant
currency, and tenant timezone safely through SSR, Angular/Material formatting,
Luxon conversion, and server-side business-time calculations. Keep recorded
transaction currency and event instants immutable; make any post-data
platform-admin override explicit and auditable.

### ADMIN-001 — Platform administrator policy exceeds the current tenant-membership boundary

**Severity:** P1
**Why it matters:** The accepted policy lets platform administrators perform any tenant operation at any time. The current runtime grants broad permissions, but the normal tenant UI and user-context flows still require a tenant assignment.

**Evidence**

- `src/server/context/request-context-resolver.ts:42-58` grants a global administrator `ALL_PERMISSIONS` and `globalAdmin:manageTenants`.
- `src/app/app.routes.ts:14-46` wraps normal event, admin, finance, profile, and scanner routes in `userAccountGuard`; only `/global-admin` avoids that guard.
- `src/app/core/guards/user-account.guard.ts:8-18` redirects an authenticated but unassigned user to `/create-account`.
- `src/app/global-admin/global-admin.routes.ts:5-49` currently exposes tenant and Email Outbox operations only.

**Fix direction**

Represent platform-administrator authority explicitly in request context, route guards, and server authorization rather than treating it as an ordinary tenant role. Allow the intended direct platform operations without a tenant membership, log each cross-tenant action with actor and target tenant, and keep user-context actions distinct from platform actions.

Use application/API append-only audit entries with actor, target tenant, action,
before/after data, reason, and timestamp. Keep authorization in the Effect
server layer; do not claim database-level RLS or privilege enforcement.

### CI-001 — CI excludes product-facing finance docs

**Severity:** P1
**Why it matters:** Finance/receipts are high-risk product workflows, and local documentation discovery includes them.

**Evidence**

- `.github/workflows/e2e-baseline.yml:182-187` runs the docs project with `--grep-invert "@finance"`.
- `tests/docs/finance/finance-overview.doc.ts:11`, `tests/docs/finance/receipt-review-reimbursement.doc.ts:14`, and `tests/docs/finance/inclusive-tax-rates.doc.ts` are therefore omitted, as is `tests/docs/profile/discounts.doc.ts:62`.
- `bun run test:e2e:docs -- --list` on this audit branch found those tests locally, proving the CI exclusion is not a discovery limitation.

**Fix direction**

Remove the inversion and repair any failure it reveals. If a real external dependency remains, split only that explicit integration path into a separate job and keep deterministic finance docs in baseline CI.

### TEST-001 — Manual approval has no complete page-backed journey

**Severity:** P1
**Why it matters:** The application/manual-approval mode now has participant application copy and organizer approval UI, but no durable flow proves the end-to-end behavior.

**Evidence**

- `src/app/events/event-registration-option/event-registration-option.component.ts:93-100` presents the application behavior.
- `src/app/events/event-organize/event-organize.html:79-126` exposes organizer approval.
- `tests/test-inventory.md:30-83` has no manual-approval spec/doc entry.

**Fix direction**

Add a seeded participant-application → organizer-approval → free confirmation or paid Checkout → outbox-visible path, with capacity and duplicate-approval negative cases. Generate product documentation from the same flow.

### TEST-002 — Existing-user role assignment is not verified in the browser

**Severity:** P1
**Why it matters:** Roles/capabilities are a core tenant safety boundary. The server handler is covered, but the discoverable UI has no durable mutation/readback proof.

**Evidence**

- The UI mutates assignments in `src/app/admin/user-list/user-list.component.ts:96-114`.
- `tests/specs/admin/roles-management.spec.ts:20-34` only asserts that role controls are visible.
- `tests/docs/roles/roles.doc.ts:42-75` likewise documents visibility rather than changing a role and reading it back.

**Fix direction**

Use a disposable role and tenant user in a functional spec and generated doc: change the selection, assert the persisted assignment and updated UI, clean up, and cover the unauthorized/read-only view.

## Stabilization and quality findings

### SEC-002 — Request `Origin` can select email and Checkout destinations

**Severity:** P2

`src/server/effect/rpc/app-rpcs.request-handler.ts:30-60` preserves original request headers. `src/server/effect/rpc/handlers/events/event-registration.service.ts:86-96` trusts `headers['origin']` without validating it against the tenant, then uses it for approval emails (`:566`) and Stripe success/cancel URLs (`:801-817`). An authorized or compromised organizer can choose a phishing destination for an applicant.

**Fix direction:** normalize the tenant's persisted primary domain and derive
its production public origin as HTTPS. Only a platform administrator may change
the saved tenant host. Use an explicit loopback runtime origin in development;
never trust caller-controlled `Origin`, forwarded-host, or request headers.

### OPS-001 — Claimed outbox messages can remain permanently stuck in `sending`

**Severity:** P2

`src/server/notifications/email-delivery.ts:307-326` changes a row to `sending`; later polling at `:328-344` selects only `queued` and `failed`. A crash after claim and before terminal update loses the notification indefinitely.

**Fix direction:** add a claim lease timestamp and stale-claim recovery. Reclaim safely with the existing Resend idempotency key and cover restart/crash recovery.

### OPS-002 — Neon Local cleanup has restart and deleted-worktree gaps

**Severity:** P2

Read-only runtime inspection found an active Neon Local container whose Compose
labels refer to a deleted worktree, plus remote ephemeral branches without an
expiration. The primary Playwright cause is resolved: `playwright.config.ts`
now gives a `docker:webserver` process it started a 60-second `SIGTERM` shutdown
window, while `reuseExistingServer` keeps pre-existing user-owned stacks
untouched.

The remaining gaps are independent of that fix. Compose project names are
derived from each checkout path, so stopping one checkout cannot clean an old
project. `db-expiration` runs only once, a later `db` restart can create another
branch without an expiry, and `docker-compose.yml` currently suppresses expiry
failures with `|| true`.

**Fix direction:** surface bounded typed expiration failures, make branch-expiry
installation follow every Neon Local branch creation, warn about Compose
projects whose worktree no longer exists, and add lifecycle coverage for owned
versus reused stacks. Existing orphaned containers or remote branches must be
listed for deliberate operator cleanup rather than deleted automatically.

### DATA-001 — Important tenant boundaries lack database-level tuple constraints

**Severity:** P2

`src/db/schema/users.ts:96-109` can pair a role with a tenant membership from another tenant; handler checks reduce the risk, but request-context permission resolution can consume that role if bad data enters the database. Similarly, `src/db/schema/event-registrations.ts:16-40` independently stores tenant, event, and option references, while event options are keyed only to event in `src/db/schema/event-registration-options.ts:14-42`.

**Fix direction:** model tenant-aware composite keys/foreign keys or use database-enforced tuple checks. Preserve handler validation as defense in depth and add direct constraint tests.

### UX-001 — Template pages expose actions that direct server guards will deny

**Severity:** P2

- `src/app/templates/template-list/template-list.component.html:12-24` always shows “Manage categories”; `src/app/templates/categories/category-list/category-list.component.html:8-17,76-82` always exposes creation/edit actions.
- `src/server/effect/rpc/handlers/template-categories.handlers.ts:65-67,101-103` correctly requires `templates:manageCategories`.
- `src/app/templates/template-details/template-details.component.html:27-42` always shows Edit/Create event, while `src/app/templates/templates.routes.ts:45-65` guards those routes.

**Fix direction:** use the corresponding capability directives for actions, offer a deliberate read-only category view, and surface denied mutation errors instead of leaving users at a dead end.

### UX-002 — Core first-load failures have no user-visible error/retry state

**Severity:** P2

Examples include `src/app/templates/template-create-event/template-create-event.component.html:5-63`, `src/app/admin/user-list/user-list.component.html:21-86`, `src/app/finance/transaction-list/transaction-list.component.html:4-123`, and `src/app/core/create-account/create-account.component.html:10-78`. They handle pending/success but leave initial query failures blank or misleading.

**Fix direction:** standardize pending/error/success branches with a readable `role="alert"` state and retry/refetch action for every primary data query.

### UX-003 — Location failures are silently transformed into no results

**Severity:** P2

`src/app/core/location-search.ts:76-100` raises meaningful Maps configuration/provider failures, but `src/app/shared/components/controls/location-selector/location-selector-dialog/location-selector-dialog.ts:50-66` catches every search failure as an empty list. Place-detail failures at `:72-79` are unhandled.

**Fix direction:** show a retryable provider/configuration state, preserve diagnostics in logs, and distinguish an empty response from a failed search.

### UI-001 — Semantic success/warning tokens are not consistently bridged into Tailwind

**Severity:** P2

`src/tailwind.css:60-78` maps Material color/shape tokens but does not define the `success`/`warning` names used by components. `src/styles.scss:29-36,254-259` and consumers such as `src/app/shared/components/event-status/event-status.component.ts:5-18` reference undefined semantic tokens.

**Fix direction:** derive one consistent success/warning vocabulary from existing `--app-*` tokens, map it into Tailwind, replace ambiguous spellings, and add visual/token regression coverage.

### A11Y-001 — Reusable controls have keyboard and accessible-name gaps

**Severity:** P2

- `src/app/shared/components/controls/icon-selector/icon-selector-dialog/icon-selector-dialog.component.html:12-22` uses clickable `div` elements rather than buttons.
- `src/app/shared/components/controls/role-select/role-select.component.html:5-10` builds a removal label from an object, which can announce as `[object Object]`.
- Several icon-only actions lack explicit accessible names, including `src/app/events/event-edit/event-edit.html:2-13` and `src/app/events/event-list/event-list.component.html:20-29`.

**Fix direction:** use native buttons, explicit labels, and keyboard/accessible-name tests for all reusable controls.

### TEST-003 — PR quality gates are incomplete and `main` is not protected

**Severity:** P1

The repository-owned E2E workflow at `.github/workflows/e2e-baseline.yml:3-8,163-188`
runs Playwright on pull requests and its Docker image build implicitly runs
`build:app`. It does not invoke `lint`, `test:unit`, or `test:unit:server`.
No tracked workflow validates Knope/change files, and
`.github/workflows/release.yml:3-17` is a placeholder. The GitHub branch-
protection API returned `404 Branch not protected` for `main` during this audit,
so the existing Actions run is not a required merge gate.

**Fix direction:** add a PR quality workflow for lint, the app build, both unit
suites, and Knope/change-file validation; then configure those checks plus the
baseline E2E workflow as required status checks for `main`. Verify the settings
in GitHub after configuration rather than inferring protection from tracked YAML.

### TEST-004 — Tenant operations and Email Outbox lack durable product coverage

**Severity:** P2

`tests/specs/admin/general-settings.spec.ts:48-107` does not persist/assert email sender, Stripe account, or registration limit settings; `tests/docs/admin/general-settings.doc.ts:37-59` only describes them. The discoverable `/global-admin/email-outbox` route in `src/app/global-admin/global-admin.routes.ts:30-36` has no Playwright or generated documentation coverage.

**Fix direction:** add persisted settings readbacks and Email Outbox allow/deny, empty, queued, error, and retry-state coverage.

## Effect and architecture conformance

### EFFECT-001 — Tenant settings RPC uses `Schema.Any` at an API boundary

**Severity:** P3

`src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts:232-256` accepts `defaultLocation` as `Schema.NullOr(Schema.Any)`, even though `src/types/custom/tenant.ts:72-82` already has a typed optional `GoogleLocation` schema. The handler validates its reconstructed tenant later, but the RPC contract should reject malformed input at the boundary.

**Fix direction:** use the `GoogleLocation` schema directly in the RPC input and add malformed-location contract coverage.

### EFFECT-002 — One Effect test bypasses the preferred Effect test runtime

**Severity:** P3

`src/server/integrations/cloudflare-r2.spec.ts:53-65` wraps an Effect with `Effect.runPromise` inside a plain async test while nearby tests use `it.effect`.

**Fix direction:** convert the failure assertion to `it.effect` and retain typed failure/scope behavior.

## Material 3, Angular Material, and Uncodixfy snapshot

Static MD3/UX score: **63/100** (adapted to Angular Material and Tailwind Material system tokens).

| Area              | Score | Evidence                                                                        |
| ----------------- | ----: | ------------------------------------------------------------------------------- |
| Color tokens      |  5/10 | Strong `--mat-sys-*` foundation; semantic success/warning bridge is incomplete. |
| Typography        |  7/10 | Material roles are widely used; a few raw utility-text paths remain.            |
| Shape/elevation   |  8/10 | Token-mapped radii and surface usage are generally consistent.                  |
| Components        |  7/10 | Angular Material fits the application; a few form/conformance gaps remain.      |
| Layout/navigation |  7/10 | Responsive navigation and list/detail patterns are sound.                       |
| Motion            |  6/10 | Conservative behavior; no major static violation found.                         |
| Accessibility     |  3/10 | Camera policy, missing names, and non-button controls are material blockers.    |
| Theming           |  5/10 | The Material/Tailwind bridge exists but semantic states need repair.            |

Uncodixfy assessment: **mostly compliant**. The app avoids decorative gradients, glass panels, faux dashboards, and gratuitous motion. Operational cards and status surfaces generally have a product reason. Minor drift includes a few eyebrow/uppercase labels and generic status-card patterns; these are lower priority than functional/accessibility issues.

## Current strengths to preserve

- Tenant resolution fails closed for unknown hosts; server-generated RPC context overwrites client identity/permission headers.
- Registration writes use tenant-scoped option lookup, role eligibility, and conditional capacity updates.
- QR rendering is owner/organizer-scoped, and the scanner independently enforces tenant-scoped organizer authorization.
- Receipt review queues email through a transactional outbox rather than direct fire-and-forget delivery.
- Template add-on/question authoring and template-to-event copying have generated-doc persistence/readback coverage.
- The skip/fixme inventory guard is strict; intentional credential gates are explicitly recorded.
- Angular Material, system tokens, OnPush components, signals, native control flow, and responsive two-column patterns are broadly established.

## Explicitly deferred scope — not counted as a defect by itself

- Automated custom-domain verification and multi-domain tenant automation.
- An end-user impersonation UI; platform administrators instead use explicit,
  auditable platform authority.
- Automatic event archival behavior, including its retention and data-handling
  rules.
- Budgeting, receipt-category planning, and payout-provider integration.

These remain valid only if product-facing UI and generated documentation
continue to state them honestly.

## Decisions recorded

- The listed customer-facing notifications remain launch scope. Render their
  templates with React Email while retaining transactional outbox delivery.
- Paid transfer/resale, including recipient payment and Stripe refund handling,
  is required before a paid-event production replacement launch.
- The first completed tenant membership becomes a user's home tenant. Users can
  change it only through an explicit profile action.
- Production public links use the HTTPS origin derived from the tenant record's
  normalized primary domain; development uses an explicit loopback runtime
  origin, and only a platform administrator may change the saved tenant host.
- Payments and refunds use the tenant's Stripe Connect account. Evorto attaches
  that account id to the Stripe request and adds only its application fee.
- Waitlist messages are informative and never reserve capacity or hold checkout.
- Cancellation/transfer timing and fee-refund rules default to tenant settings
  and may be overridden per registration option. New tenants default to transfer
  until event start, five-day cancellation, and fee refund enabled.
- Transfer recipients complete the current registration option's full flow and
  eligibility check; they do not inherit price, discount, or answers. Recipient
  confirmation precedes original-registration cancellation/refund.
- A non-fee-refund refund returns the payment less applicable fees so the tenant
  is net zero.
- Tenant currencies are `EUR`, `CZK`, and `AUD`; tenant timezones are IANA
  names with `Europe/Berlin` as the default.
- Every privacy-policy change requires re-acceptance, and required short-text
  or selection-list answers are checked and collected for every tenant user.
- Platform actions have actor, target, action, before/after, reason, and
  timestamp in application/API append-only audit entries.
- Live ESNcard add, refresh, and remove verification is required for release.
- Codex in-app Browser walkthroughs remain the requested manual-review tool and
  complement, rather than replace, Playwright coverage.
- The Effect skill bundle uses the repository's `repos/effect` vendor path.
- Templates and events own independent simple/advanced registration
  configuration. Event creation snapshots template configuration; later template
  edits do not modify existing events.
- Simple configuration remains the default. Advanced configuration is an
  arbitrary named option list, with non-blocking warnings when it lacks an
  organizing or non-organizing option. Every mode change requires explicit
  confirmation; returning to simple mode additionally requires exactly one of
  each.
- Add-ons are advanced, reusable registration-option configuration. An add-on
  can attach to multiple options through explicit multi-selection, with included
  entitlement quantity distinct from optional purchase quantity.
- Included add-ons are automatically granted, stock-reserved, and priced into
  the registration option. Optional units remain purchasable independently,
  including alongside an included quantity.
- Every add-on is redeemable from a scanned registration with immediate undo.
  The organizer scan view supplies the overview; organizer/check-in access
  governs redemption.
- Guests remain a capacity-aware registration feature rather than an ordinary
  stock add-on. They retain option-price and partial-check-in behavior.
- Stock is editable for future registrations without rewriting settled
  entitlement records. A separate unilateral-cancellation capability governs
  registration/add-on cancellation and optional refunds; redeemed and included
  units are never refunded as ordinary add-on purchases.

The headline policy decisions are recorded. CI/release enforcement is an
implementation task: TEST-003 records the verified absence of branch protection
and required quality checks.

## Registration configuration delivery status

The ordinary tenant registration-graph authoring slice is implemented. Templates
and draft events now persist their own simple/advanced mode, use stable option
arrays, model included and optional add-on quantities separately, and expose
typed graph RPCs backed by tenant and permission checks.

The server creates an atomic event-owned snapshot of template mode, options,
discounts, questions, add-ons, and mappings. Mode transitions preserve persisted
option IDs; an advanced graph must first be saved with exactly one organizing
and one non-organizing option before a separate confirmed switch to simple.
Legacy random allocation remains readable but cannot be rewritten through these
authoring RPCs.

The ordinary Angular editors use page-owned Signal Forms with shallow option,
question, and add-on arrays. Advanced graphs allow zero or many options and show
warning-only missing-category diagnostics. Add-ons stay hidden in simple mode
without being deleted. Focused unit, functional Playwright, generated-document
source, and inventory coverage now pin mode confirmation, mapping quantities,
snapshot independence, and legacy-random blocking.

Participant post-registration add-on purchase is now delivered through the
authenticated, tenant-scoped server path: free orders fulfill atomically, while
paid orders reserve stock without exposing an entitlement until the exact
Stripe Checkout completes. The active ticket explains before/during sales
windows, preserves the same pending Checkout across reloads, and blocks
cancellation or transfer while payment is pending. Focused Playwright coverage
pins the mobile/accessibility surface, pending and settled database state, and
production-finalizer settlement; the registration guide documents the same
owner journey from the ordinary event list.

Authentication plus current-user/tenant forwarding is pinned by focused handler
and RPC unit/source evidence. The free Playwright path exercises that page RPC.
For paid initiation, Playwright deliberately calls the production
`purchaseRegistrationAddon` service under the exact fixture owner/tenant and
real Database/Stripe layers rather than claiming a browser-level Stripe launch.
Its fail-closed Stripe client validates the connected-account Checkout POST and
idempotency key, preserves the production-created pending fields, then validates
the completion-session and expanded-charge reads that persist the real fee
snapshot. No test helper writes the paid stock reservation, order, or
transaction directly.

Platform compatibility event mutations are aligned with the ordinary graph
updater: they apply the mapping diff, persist simple mode, enforce the typed
paid-price guard, and record the event mode in audit state. Existing focused
unit and source evidence pins those compatibility guarantees.

Separate follow-up remains only for the broader unilateral
cancellation/refund capability.

## Recommended execution order

1. **Payment/security containment:** SCAN-001 is complete; continue with PAY-001, PAY-002, and SEC-001, with targeted regression tests before any broad refactor.
2. **Product-release commitments:** EVT-001, PROD-001, PROD-002, ESN-001,
   FIN-001, ONB-001, TEN-001, ADMIN-001, and manual-approval coverage.
3. **Truthful release evidence:** CI-001, TEST-001 through TEST-003, including
   the required CI/branch-protection work in TEST-003.
4. **Permission and user-state quality:** UX-001 through UX-003, UI-001, A11Y-001, OPS-001, DATA-001, and TEST-004.
5. **Effect cleanup:** EFFECT-001 and EFFECT-002 alongside the closest touched feature work.

## Validation record

- `git fetch --no-tags origin` and rebase completed; the remediation branch starts from `origin/main` at `df7c2c0143b307bb17d7e763ccf9ef13e6646b30`.
- `gh api repos/evorto-app/app/branches/main/protection` returned `404 Branch not protected`; repository workflow review found E2E and implicit Docker build coverage but no lint, unit, or Knope/change-file gate.
- `bun run test:e2e:docs -- --list` passed: 31 docs/setup tests in 19 files, with finance docs visible locally.
- `bun run lint` and the application/Docker production build passed for the scanner remediation.
- The complete Angular/shared unit suite passed: 52 files and 302 tests.
- The complete server/helper Vitest suite passed after the latest-main rebase: 53 files and 375 tests.
- Focused server clock/scan coverage proves configured-clock eligibility, the exact persisted check-in timestamp, and typed failure for an invalid clock value.
- Scanner functional Playwright passed all 4 cases, including canvas-backed camera success and permission denial.
- The dedicated check-in generated-documentation journey passed and its five screenshots were visually reviewed; the camera view shows only the settled Scanner page.
- Documentation reporter/view-transition coverage passed all 8 focused cases, including a ten-second transition plus an unrelated infinite animation.
- The in-app Browser reached the anonymous event page and Auth0 login. The authenticated scanner walkthrough remains open at the sign-in page for the user to complete before returning control.
