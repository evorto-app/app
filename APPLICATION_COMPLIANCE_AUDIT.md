# Application Production-Readiness Compliance Ledger

Ledger updated: 2026-07-12

Previous fully validated baseline: `codex/production-readiness-compliance` at
`cc5bfff361ed881e4a508113a044dd6ae2cfdd9e`

`origin/main` at that validation point:
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`
(`0` commits behind)

Current candidate: an uncommitted working tree on top of the validated baseline.
It has no candidate commit SHA or complete-suite result yet. The full local gate
must run from a clean worktree at a local candidate commit. If a gate failure
requires any edit, amend or create a new local candidate commit and rerun the
entire gate on that exact commit. Nothing may be pushed or used to update the
draft PR until that clean exact-commit gate is fully green.

Draft review: [PR #91](https://github.com/evorto-app/app/pull/91)

Scope: application, server/runtime, data layer, shared contracts, tests,
generated product documentation, repository-owned CI, and externally configured
release gates.

## Release decision

**Not yet ready to declare a complete production replacement.**

The original audit's broad implementation findings are mostly remediated. Commit
`cc5bfff361ed881e4a508113a044dd6ae2cfdd9e` has a completely green local baseline
and matching repository-owned CI, with zero skipped or otherwise incomplete
collected tests. Those results are the **previous validated baseline**, not a
result for the current uncommitted candidate.

The candidate implements fail-closed organizer participant/receipt loading,
explicit participant/waitlist/organizer cancellation confirmation, and a
substantial page-backed cancellation guide. These are pending the complete local
gate and therefore are not marked resolved yet.

The highest-risk application boundary is paid registration transfer: automatic
paid transfer is deliberately Stripe-only and still rejects separately paid
add-ons, while the product decision for non-Stripe/manual sources is unresolved.
The highest-risk evidence gaps are the unrun live ESNcard and Auth0-backed paths,
unresolved production scope and test contracts for Cloudflare Images and Google
Maps, the incomplete authenticated Browser review queue, and missing organizer/
helper signup evidence. GitHub's current `main` ruleset also does not make the
green checks mandatory.

## How to read this ledger

| Status                | Meaning                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Open**              | Required product behavior or evidence is absent.                                                            |
| **Partial**           | The original failure is substantially remediated, but a narrower release-relevant gap remains.              |
| **External**          | Repository work is present, but completion needs credentials, infrastructure policy, legal approval, or UI. |
| **Candidate**         | Implementation is present only in the uncommitted candidate and still needs the complete local gate.        |
| **Resolved**          | Current source plus focused and broad evidence close the original finding.                                  |
| **Accepted deferral** | Explicitly out of current product scope; it must not be represented as delivered.                           |

| Severity | Meaning                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ |
| P0       | Immediate release stop for a core workflow or direct payment/security harm.                            |
| P1       | Product, payment, integration, or release-evidence failure that blocks a production-replacement claim. |
| P2       | Material correctness, resilience, documentation, or operational gap to close during stabilization.     |

This document distinguishes a green automated baseline from externally gated
release evidence. It does not convert unavailable credentials into skips and it
does not treat source inspection as proof of a live provider or Browser journey.

Server-side Effect authorization remains the source of truth. Row-level security
is not planned as a parallel authorization system. Database tuple constraints
provide data-integrity defense in depth without replacing server tenant and
capability checks.

## Active findings and gates

| ID           | Severity | Status    | Area                  | Remaining work                                                                                                     |
| ------------ | -------- | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PROD-002     | P1       | Partial   | Paid transfer         | Automatic paid transfer is Stripe-only; separately paid add-ons are blocked and manual-source policy is undecided. |
| PROD-003     | P1       | Open      | Organizer signup      | Organizer/helper options exist, but the complete end-user signup, exclusivity, access, and docs journey is absent. |
| DOC-001      | P1       | Partial   | Cancellation/refund   | Candidate docs cover core participant/organizer paths; Stripe, add-on, and refund-state journeys remain.           |
| ESN-001      | P1       | External  | Live ESNcard          | The protected environment, approved identifier secret, and successful candidate certification run are absent.      |
| AUTH-001     | P1       | External  | Auth0 integration     | Credential-backed account creation/integration projects have not passed on the current candidate.                  |
| PROVIDER-001 | P1       | Open      | Conditional providers | Production scope/config is undecided; advertised integration coverage and collected tests are inconsistent.        |
| REL-001      | P1       | Partial   | Release enforcement   | CI and Fly deploy exist, but `main` does not require checks and Knope release automation is a placeholder.         |
| BROWSER-001  | P1       | Partial   | Manual acceptance     | Organizer overview passed authenticated desktop/compact review; the full six-area queue and camera remain open.    |
| LEGAL-001    | P1       | External  | Legal content         | Legal/privacy settings are implemented, but production text and policy approval are not recorded.                  |
| OPS-001      | P2       | Partial   | Email outbox          | Leased delivery is crash-safe and exhausted mail is visible, but there is no supported audited requeue path.       |
| OPS-002      | P2       | Partial   | Neon Local lifecycle  | Active disposable branch expiry is verified at 24 hours; owned deletion remains pending after the full gate.       |
| UX-002       | P2       | Candidate | Load recovery         | Candidate UI makes event, participant, and receipt query failures fail closed with explicit retry.                 |
| UX-004       | P2       | Candidate | Cancellation safety   | Expected-state RPC/locked checks and no-write tests are implemented; the complete local gate remains.              |
| DOC-002      | P2       | Partial   | Product docs          | Waitlist outbox/content is proven; delivered-inbox follow-up and unknown-domain guidance remain.                   |

No known P0 finding remains open in the current tree, but the candidate's full
gate is still pending. The P1 rows above prevent a production-replacement
declaration.

## Active finding details

### PROD-002 — Paid transfer has a bounded Stripe-only source policy

The dedicated transfer state machine now covers private offer credentials,
recipient eligibility and current-price review, recipient Stripe Checkout,
connected-account ownership, source cancellation, persisted refund obligations,
terminal refund failure, and operator requeue. Functional and generated-doc
coverage exercise those states in
[`tests/specs/events/registration-transfer.spec.ts`](tests/specs/events/registration-transfer.spec.ts)
and
[`tests/docs/events/registration-transfer.doc.ts`](tests/docs/events/registration-transfer.doc.ts).

The supported automatic boundary is narrower than “every paid registration”:

- free source registrations can transfer;
- direct organizer reassignment remains free-only; a paid transfer uses the
  recipient's private claim and current-flow eligibility/payment review;
- an automatically paid source transfer requires exactly one supported Stripe
  registration payment source;
- a successful separately paid add-on blocks transfer until every source refund
  can be reconciled safely; and
- a successful non-Stripe registration payment is rejected with **Only
  Stripe-paid registrations can use automatic paid transfer**.

That boundary is explicit in
[`src/server/registrations/registration-transfer.service.ts`](src/server/registrations/registration-transfer.service.ts).
Source guards lock the paid-add-on behavior in
[`src/server/registrations/addon-purchase-mutation-guards.source.spec.ts`](src/server/registrations/addon-purchase-mutation-guards.source.spec.ts).

The current product boundary must be stated as **Stripe-only automatic paid
transfer without separately paid add-ons**, not generic paid transfer. Supporting
separately paid add-ons would require one atomic, auditable plan for the original
registration payment and every successful add-on source, with exact
connected-account refund amounts, fee allocation, idempotency generations,
compensation, terminal failure recovery, and mixed-source tests. A transfer must
never silently drop add-on value.

A separate decision is required for successful non-Stripe/manual registration
payments: either accept them as explicitly unsupported for private paid transfer,
or design a manual settlement workflow with ownership, completion, rollback, and
audit semantics. Do not imply that the existing cancellation manual-refund record
also makes manual-source transfer safe.

### PROD-003 — Organizer/helper signup is not a complete proven journey

The schema and authoring surfaces model organizing registration options, and the
registration page distinguishes participant options from organizer/helper
options. The product requirement is broader: a tenant member must be able to
sign up as an organizer/helper, remain mutually exclusive with participant
registration for the same event, obtain the intended organizer access, and see
the correct ticket/profile/management states.

The current docs mention **Sign up as organizer/helper** in
[`tests/docs/events/register.doc.ts`](tests/docs/events/register.doc.ts), but do
not execute and read back that journey. Add a page-backed functional spec and a
novice generated guide that cover simple and advanced organizer categories,
role eligibility, capacity, participant/organizer exclusivity, confirmed access
to the organizer surface, cancellation, and cleanup.

### DOC-001 — Cancellation and refund documentation is substantial but incomplete

The uncommitted candidate adds
[`tests/docs/events/registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
and links it from the maintained inventory. It executes participant cancellation
of a confirmed paid non-Stripe registration into a pending manual refund,
participant deadline denial, organizer cancellation of a free registration,
guest-capacity release, cancellation and waitlist email creation, persisted
readback, and the visible confirmation flow. This is a meaningful page-backed
novice journey, pending the full local gate.

The same guide **explains**, but does not independently execute, cross-tenant and
permission denial, repeated-request idempotency, transient retry, live Stripe
refund delivery, or paid add-on allocation recovery. Keep those statements
clearly labeled as policy/recovery guidance unless a focused page-backed case or
provider run supplies the corresponding evidence.

The candidate also adds explicit confirmation for participant, waitlist, and
organizer cancellation via
[`src/app/events/registration-cancellation-confirmation-dialog.component.ts`](src/app/events/registration-cancellation-confirmation-dialog.component.ts).
**Keep registration** receives initial focus and the mutation proceeds only after
an affirmative confirmation.

The remaining documentation/evidence must execute and visibly explain:

1. a real or fail-closed Stripe cancellation refund claim and its provider-side
   outcome, not only the deterministic non-Stripe manual-refund path;
2. registration cancellation with separately paid add-ons, including included,
   redeemed, cancelled, unredeemed, and refundable quantities;
3. participant-visible and operator-visible refund progression through pending,
   retrying, successful, terminal failure, and audited recovery; and
4. the resulting participant profile/ticket state for those refund outcomes.

Keep deterministic database readback and literal recovery language. A queued
claim or pending manual refund must never be documented as money already returned.

### ESN-001 — Live ESNcard certification is configured but not operable

The repository contains a fail-closed reusable workflow at
[`.github/workflows/esncard-release-certification.yml`](.github/workflows/esncard-release-certification.yml)
and the provider test at
[`tests/specs/profile/user-profile-live-esncard.spec.ts`](tests/specs/profile/user-profile-live-esncard.spec.ts).
The Release and Fly deploy workflows call the certification job.

As inspected on 2026-07-11, the GitHub environment
`esncard-release-certification` does not exist, so there is no approved
non-production `E2E_LIVE_ESN_CARD_IDENTIFIER`, reviewer policy, or successful
certification run. Completion requires the environment and secret to be
provisioned, the add/refresh/remove/provider-error flow to pass at the exact
release commit, and credential ownership/rotation to be documented. No secret or
identifier value belongs in this ledger or test artifacts.

### AUTH-001 — Auth0-backed integration evidence is not candidate-green

Baseline authentication and session behavior has unit and Playwright coverage,
but the credential-backed integration projects are intentionally separate from
the baseline. The account-creation path in
[`tests/specs/profile/create-account.spec.ts`](tests/specs/profile/create-account.spec.ts)
requires Auth0 Management credentials and fails preflight when they are absent.

Run `bun run test:e2e:integration` locally with the approved provider credentials
on the exact release candidate. Every collected integration test must pass with
the same zero-incomplete-outcome rule as the baseline before CI or release is
attempted.

### PROVIDER-001 — Provider evidence depends on the production configuration

Cloudflare Images and Google Maps integration code exists, but live evidence is
a release gate only when the approved production configuration enables those
providers or the release product scope depends on their workflows. The previous
1,677-test baseline does not prove either provider. Current unit coverage
validates Cloudflare configuration and Google Maps initialization/search/error
mapping in
[`src/server/config/cloudflare-images-config.spec.ts`](src/server/config/cloudflare-images-config.spec.ts)
and
[`src/app/core/location-search.spec.ts`](src/app/core/location-search.spec.ts).
That is not provider-side proof.

[`tests/README.md`](tests/README.md) documents an `@needs-cloudflare`
integration tag and provider credentials, but no current Playwright source uses
that tag. That advertised-but-uncollected tag is a test-contract defect regardless
of whether Cloudflare is enabled: either add the promised test or correct the
documentation/preflight contract.

First record the intended production configuration and product scope. If
Cloudflare Images is enabled, add a credential-gated journey that proves direct
upload, delivery, persisted reference, and owned test-asset cleanup. If Google
Maps-backed location search is enabled, add a credential-gated provider journey
that proves loader initialization, autocomplete, place details, coordinates,
empty results, and provider failure, then record the matching Browser
walkthrough. If either provider is deliberately disabled, document the supported
fallback and remove claims that its live path is required. Never convert a
required enabled-provider run into skips because credentials are unavailable.

### REL-001 — Green checks are not yet enforced release policy

Repository-owned quality workflows now run Knope/change-file validation,
PostgreSQL 17 integration tests, lint, server and Angular unit suites, the build,
functional Playwright, and generated docs. See
[`.github/workflows/pr-quality.yml`](.github/workflows/pr-quality.yml) and
[`.github/workflows/e2e-baseline.yml`](.github/workflows/e2e-baseline.yml).

External inspection on 2026-07-11 found GitHub ruleset
[`13125535`](https://github.com/evorto-app/app/settings/rules/13125535) active for
the default branch. It protects linear history and destructive updates and
enforces squash-only pull requests, but it does not require the quality/E2E/
security checks, an approving review, or resolved review threads. Configure and
verify those requirements in GitHub rather than inferring them from workflow
YAML.

Application deployment is not a placeholder:
[`.github/workflows/fly-deploy.yml`](.github/workflows/fly-deploy.yml) applies
the schema and deploys to Fly after live ESNcard certification on `main`.

The separate
[`.github/workflows/release.yml`](.github/workflows/release.yml) correctly
depends on live ESNcard certification, but its Knope release job only echoes **Add
publish/deploy steps for Knope releases.** Treat that as missing version,
changelog, and GitHub-release automation—not as evidence that Fly deployment is
absent. Replace it with the agreed Knope release actions and verify the resulting
version/changelog/release artifacts.

### BROWSER-001 — Manual in-app Browser acceptance remains incomplete

The durable queue is defined in [`QUALITY.md`](QUALITY.md). The completed
Playwright flows do not replace the explicitly requested in-app Browser review.
Partial evidence is recorded: the authenticated organizer overview was opened and
reviewed at desktop and compact widths. That proves the page's basic responsive
happy-path presentation, not the fail-once network states, destructive mutations,
or the rest of the application.

There is still no recorded complete pass through:

1. anonymous event discovery and a direct unlisted link;
2. participant registration/profile states;
3. organizer authoring, event management, check-in, guest handling, and add-on
   redemption/undo;
4. tenant administration and finance;
5. platform tenant-scoped operations;
6. live ESNcard provider states.

The camera policy and synthetic Playwright media stream are valuable regression
evidence, but are not real-device proof. Complete one real phone/tablet camera
permission, scan, denied-permission recovery, and persisted-result walkthrough.
When camera emulation is unreliable, use a deterministic scanner-result URL for
the rest of the organizer integration review, as recorded in `QUALITY.md`.

### LEGAL-001 — Legal approval is outside automated proof

Tenant-hosted legal/privacy fields and routes have implementation and test
coverage. Production readiness still requires an authorized owner to approve
the actual terms, privacy text, re-acceptance policy, company/controller details,
and jurisdiction-specific obligations. Record the approved version and effective
date; a passing UI test proves rendering and persistence, not legal sufficiency.

### OPS-001 — Exhausted email has no supported recovery mutation

The original crash-loss issue is resolved. Delivery claims now have leases,
expired `sending` rows are reclaimable without consuming another attempt, and
retry/exhaustion metadata is tested in
[`src/server/notifications/email-outbox-lease.spec.ts`](src/server/notifications/email-outbox-lease.spec.ts)
and
[`src/server/notifications/email-delivery.spec.ts`](src/server/notifications/email-delivery.spec.ts).
The global UI and generated guide make exhausted rows observable in
[`tests/specs/admin/email-outbox.spec.ts`](tests/specs/admin/email-outbox.spec.ts)
and
[`tests/docs/admin/email-outbox.doc.ts`](tests/docs/admin/email-outbox.doc.ts).

The UI is intentionally read-only and there is no supported RPC/operation to
requeue exhausted email. Add a platform-authorized mutation with required reason,
tenant/row targeting, idempotent state transition, append-only audit evidence,
and page-backed allow/deny/retry coverage.

One product/security decision is still required before implementation: should a
requeue preserve the immutable original recipient, or may an operator correct
the recipient on the exhausted record? Do not infer that authority. If
correction is allowed, preserve the original value in the audit record and
define which identity/profile source is authoritative.

### OPS-002 — Neon expiry is verified; owned deletion remains pending

Playwright-owned Compose stacks now have bounded shutdown and provenance rules,
`docker:resume` refuses incomplete initialization, and the Neon expiration helper
fails more visibly. Lifecycle behavior is covered in
[`helpers/testing/docker-lifecycle.spec.ts`](helpers/testing/docker-lifecycle.spec.ts).

Runtime inspection on 2026-07-12 verifies that the active disposable Neon branch
has a 24-hour expiration. That closes the expiration uncertainty for this branch,
but does not prove end-of-run deletion. The branch and current project resources
are intentionally still present while the full local gate is pending.

After the clean exact-commit full gate completes, stop the owned project and
confirm project-scoped container, network, volume, and remote Neon branch
deletion. Inventory any older project or branch separately and delete it only
after confirming ownership. Do not use broad Docker or Neon cleanup that could
affect another checkout or user-owned stack.

### UX-002 — Organizer and receipt query failures are fail-closed in the candidate

The user list, finance transaction list, and template-to-event creation paths now
have explicit first-load error and retry behavior with durable coverage in
[`tests/specs/resilience/core-load-recovery.spec.ts`](tests/specs/resilience/core-load-recovery.spec.ts).

The uncommitted candidate updates
[`src/app/events/event-organize/event-organize.html`](src/app/events/event-organize/event-organize.html)
to gate counts and participant actions on successful event/overview data. Event,
participant, and receipt failures now use explicit `role="alert"` states and
retry actions; the participant message says missing counts are not zero, and the
receipt message says existing records may still be present. The back action has
an accessible name. Focused component, fail-once functional Playwright, and
generated event-management coverage are present in the working tree.

This implementation is **pending the complete local gate**. Until that gate
passes, keep UX-002 as Candidate rather than Resolved and do not inherit the
previous 1,677-test result.

### UX-004 — Destructive registration cancellation requires confirmation

The uncommitted candidate routes participant cancellation, leaving a waitlist,
and organizer cancellation through the shared Material dialog in
[`src/app/events/registration-cancellation-confirmation-dialog.component.ts`](src/app/events/registration-cancellation-confirmation-dialog.component.ts).
The copy distinguishes pending applications, pending payment reservations,
confirmed tickets, waitlists, and organizer context; **Keep registration** is the
initial focus, and current client-side in-flight guards are checked again after
confirmation.

The candidate now implements the stale-state precondition end to end. The typed
participant and organizer RPC payloads in
[`src/shared/rpc-contracts/app-rpcs/events.rpcs.ts`](src/shared/rpc-contracts/app-rpcs/events.rpcs.ts)
carry `expectedStatus` and `expectedPaymentPending`. The handlers in
[`src/server/effect/rpc/handlers/events/events-registration.handlers.ts`](src/server/effect/rpc/handlers/events/events-registration.handlers.ts)
fast-fail input that is already stale before reconciliation, then compare it
authoritatively after locking the registration and its payment transactions. A
precondition conflict leaves registration, capacity, inventory, refund, and
email state unchanged. In the pending-Checkout race, the handler may first
persist the durable Checkout-cancellation marker and attempt Stripe expiry before
the second locked pass observes that payment completed; it still does not cancel
the registration or release/refund anything. Focused no-write coverage is present in
[`src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts`](src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts),
and schema coverage pins the payload contract in
[`src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts`](src/server/effect/rpc/handlers/events/events-rpcs.schema.spec.ts).

Participant and organizer callers preserve the reviewed values across a delayed
dialog, send them with the mutation, and invalidate the relevant queries on an
error so the user can review current state. This is implemented **as Candidate
evidence pending the clean exact-commit full gate**; it is not yet a resolved
validated-baseline claim.

### DOC-002 — Smaller documentation truth gaps remain

- The candidate
  [`registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
  page-backs the capacity-releasing action and proves the **waitlist spot
  available** outbox row, recipient, rendered content, and non-reservation
  wording. Existing
  [`email-outbox-kind-source.spec.ts`](helpers/testing/email-outbox-kind-source.spec.ts)
  coverage also pins its transactional producer. The narrower remaining gap is
  provider delivery into a real recipient inbox followed by that recipient
  opening the event, leaving the waitlist, and successfully registering while
  capacity is still available.
- Unknown-tenant/domain failure is fail-closed in server context resolution, but
  no novice-facing generated guide explains the result or next action.
- The candidate corrects
  [`tests/docs/events/event-management.doc.ts`](tests/docs/events/event-management.doc.ts)
  to say automatic paid transfer is limited to supported Stripe sources and is
  blocked by a separately paid add-on or non-Stripe source. Keep that correction
  pending validation rather than carrying the old “all paid transfer is
  unavailable” statement forward.

## Resolved original findings

The following rows close the stale claims from the 2026-07-09 audit. A resolved
row is not an assertion that every adjacent product area is perfect; narrower
remaining gaps are retained above.

| ID                     | Resolution evidence                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCAN-001               | First-party camera policy, accessible scanner states, deterministic media tests, and generated guide: [`security-headers.spec.ts`](src/server/http/security-headers.spec.ts), [`scanner.test.ts`](tests/specs/scanning/scanner.test.ts), [`check-in.doc.ts`](tests/docs/scanning/check-in.doc.ts).                                                                                        |
| PAY-001                | Manual approval has a durable single-payment claim and concurrency coverage: [`registration-concurrency.postgres.spec.ts`](src/db/schema/registration-concurrency.postgres.spec.ts), [`manual-approval.spec.ts`](tests/specs/events/manual-approval.spec.ts).                                                                                                                             |
| PAY-002                | Webhook completion/expiry is correlated to local payment ownership with negative/replay coverage: [`stripe-webhook.web-handler.spec.ts`](src/server/http/stripe-webhook.web-handler.spec.ts), [`stripe-webhook-replay.spec.ts`](tests/specs/finance/stripe-webhook-replay.spec.ts).                                                                                                       |
| SEC-001                | RPC and webhook bodies are bounded before full buffering, including misleading/missing length cases: [`request-body.ts`](src/server/http/request-body.ts), [`request-body.spec.ts`](src/server/http/request-body.spec.ts).                                                                                                                                                                |
| EVT-001                | Negative event review returns to draft with feedback; `REJECTED` is absent from the runtime contract: [`events-review.handlers.spec.ts`](src/server/effect/rpc/handlers/events/events-review.handlers.spec.ts), [`event-approval.doc.ts`](tests/docs/events/event-approval.doc.ts).                                                                                                       |
| PROD-001               | Typed transactional outbox kinds/producers cover registration confirmation, cancellation, transfer, waitlist availability, manual approval, and receipt review: [`email-outbox.ts`](src/db/schema/email-outbox.ts), [`email-outbox-kind-source.spec.ts`](helpers/testing/email-outbox-kind-source.spec.ts).                                                                               |
| FIN-001                | Receipt and transaction amounts use stored/tenant currency with EUR/CZK/AUD coverage: [`tenant-currency-integrity.postgres.spec.ts`](src/server/tenant-currency-integrity.postgres.spec.ts), [`receipts-flows.spec.ts`](tests/specs/finance/receipts-flows.spec.ts).                                                                                                                      |
| ONB-001                | Versioned privacy answers, home tenant, routes, service rules, specs, and generated docs are present: [`tenant-onboarding.service.ts`](src/server/onboarding/tenant-onboarding.service.ts), [`tenant-onboarding.spec.ts`](tests/specs/profile/tenant-onboarding.spec.ts), [`tenant-onboarding.doc.ts`](tests/docs/users/tenant-onboarding.doc.ts).                                        |
| TEN-001                | Fixed `de-DE`, tenant IANA timezone, and EUR/CZK/AUD runtime formatting are centralized and tested: [`tenant-runtime.ts`](src/app/core/tenant-runtime.ts), [`tenant-runtime.spec.ts`](src/app/core/tenant-runtime.spec.ts).                                                                                                                                                               |
| ADMIN-001              | Platform authority uses explicit target-scoped operations and append-only audit entries rather than implicit tenant membership: [`platform-operation.service.ts`](src/server/effect/rpc/handlers/shared/platform-operation.service.ts), [`platform-tenant-operations.spec.ts`](tests/specs/admin/platform-tenant-operations.spec.ts).                                                     |
| CI-001                 | Finance docs are no longer filtered; the baseline runs the full documentation project and completeness reporter: [`e2e-baseline.yml`](.github/workflows/e2e-baseline.yml), [`generated-docs-source.spec.ts`](helpers/testing/generated-docs-source.spec.ts).                                                                                                                              |
| TEST-001               | Manual approval now has full free/paid/retry page-backed coverage and a generated guide: [`manual-approval.spec.ts`](tests/specs/events/manual-approval.spec.ts), [`manual-approval.doc.ts`](tests/docs/events/manual-approval.doc.ts).                                                                                                                                                   |
| TEST-002               | Existing-user role assignment/removal has permission, UI, database-readback, and docs coverage: [`user-role-assignment.spec.ts`](tests/specs/admin/user-role-assignment.spec.ts), [`roles.doc.ts`](tests/docs/roles/roles.doc.ts).                                                                                                                                                        |
| SEC-002                | Public links and Stripe returns use validated tenant-derived origins rather than caller `Origin`: [`tenant-outbound-url.ts`](src/server/tenant-outbound-url.ts), [`tenant-outbound-url.spec.ts`](src/server/tenant-outbound-url.spec.ts).                                                                                                                                                 |
| DATA-001               | Tenant-aware role/registration tuple constraints have PostgreSQL integration coverage: [`tenant-boundary-constraints.postgres.spec.ts`](src/db/schema/tenant-boundary-constraints.postgres.spec.ts).                                                                                                                                                                                      |
| UX-001                 | Template/category actions are capability-gated and read-only users get deliberate states: [`template-actions-permissions.spec.ts`](tests/specs/templates/template-actions-permissions.spec.ts).                                                                                                                                                                                           |
| UX-003                 | Location search distinguishes empty results from provider/config failures and supports retryable errors: [`location-search.ts`](src/app/core/location-search.ts), [`location-search.spec.ts`](src/app/core/location-search.spec.ts).                                                                                                                                                      |
| UI-001                 | Success/warning roles are bridged through semantic Material/Tailwind tokens and rendered across themes/contrast modes: [`_semantic-state-colors.scss`](src/_semantic-state-colors.scss), [`semantic-theme-colors.test.ts`](tests/specs/smoke/semantic-theme-colors.test.ts).                                                                                                              |
| A11Y-001               | Original icon selector, role chip, and icon-action name gaps have native control and accessible-name coverage: [`icon-selector-dialog.component.spec.ts`](src/app/shared/components/controls/icon-selector/icon-selector-dialog/icon-selector-dialog.component.spec.ts), [`role-select.component.spec.ts`](src/app/shared/components/controls/role-select/role-select.component.spec.ts). |
| TEST-004               | Tenant operation settings and global Email Outbox have persisted readbacks, access states, functional tests, and guides: [`general-settings.spec.ts`](tests/specs/admin/general-settings.spec.ts), [`email-outbox.spec.ts`](tests/specs/admin/email-outbox.spec.ts), [`email-outbox.doc.ts`](tests/docs/admin/email-outbox.doc.ts).                                                       |
| EFFECT-001, EFFECT-002 | `Schema.Any` is removed from the tenant settings boundary and the Cloudflare R2 Effect test uses the project runtime: [`admin.rpcs.ts`](src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts), [`cloudflare-r2.spec.ts`](src/server/integrations/cloudflare-r2.spec.ts).                                                                                                                       |

The original TEST-003, PROD-002, OPS-001, OPS-002, and UX-002 findings are only
partially closed and therefore remain in the active ledger under their current
narrower statements.

## Material 3, Angular, Effect, and Uncodixfy snapshot

The previous static numeric score is retired because it no longer describes the
remediated branch and implied more precision than the audit supported.

- Angular Material, Material system tokens, OnPush components, signals, native
  control flow, and responsive list/detail layouts are broadly established.
- The semantic success/warning bridge and the original reusable-control
  accessibility defects are resolved.
- The candidate's organizer and receipt load states use restrained Material
  error containers, ordinary controls, truthful copy, and retry actions. They are
  implemented pending full validation, not an invitation for visual restyling.
  Continue to avoid decorative dashboards, gradients, glass panels, excessive
  card nesting, or gratuitous motion.
- Effect RPC and Schema boundaries are typed, expected failures use tagged error
  channels, and payment/notification services retain explicit ownership and
  idempotency. The remaining outbox work is an authorized/audited product
  operation, not a reason to bypass the service boundary.

## Delivered capability and documentation evidence

The current branch includes production-shaped implementations and durable
coverage for:

- simple and advanced template/event registration graphs with stable option IDs,
  organizer/participant categories, questions, discounts, add-ons, and atomic
  template-to-event snapshots;
- free and paid registrations, manual approval, waitlists, cancellation,
  transfer/refund recovery for supported sources, guests, registration-time and
  post-registration add-ons, scanner check-in, fulfillment, and undo;
- tenant onboarding/home tenant, settings, roles, finance, receipts, currencies,
  platform target-scoped operations, and audit entries;
- transactional customer notifications, leased delivery, retry/exhaustion
  observability, and product-facing Email Outbox documentation;
- full repository-owned baseline test collection with runtime enforcement against
  skips, fixmes, todos, focused tests, expected failures, retries/flakes, and
  interrupted tests.

[`tests/test-inventory.md`](tests/test-inventory.md) is the maintained coverage
map. The previous validated baseline collected 41 documentation tests from the
then-current documentation sources. The candidate adds a cancellation guide,
but no new candidate collection or pass count is claimed until the complete
local gate runs. This ledger remains the source of truth for release gaps; the
inventory does not waive the active rows above.

## Recorded decisions and accepted deferrals

### Decisions that remain binding

- Server Effect authorization is authoritative; no RLS layer is planned.
- The current supported automatic transfer boundary is a free registration or
  one Stripe-paid registration source with no successful separately paid add-on.
  Connected-account refund ownership and operator recovery remain mandatory;
  add-on value must never be discarded or silently excluded.
- Customer-facing email templates use React Email and the transactional outbox.
- Waitlist availability messages are informative and never reserve capacity.
- The first completed tenant membership becomes the home tenant; privacy-policy
  changes require current required answers and re-acceptance.
- Tenant currencies are EUR, CZK, and AUD; dates use fixed `de-DE` formatting and
  tenant IANA timezone.
- Platform operations require an explicit target, reason, actor, before/after
  state, and append-only audit entry.
- In-app Browser review complements Playwright; synthetic camera input does not
  replace real-device verification.
- Live ESNcard add, refresh, remove, and provider-error verification is a release
  gate, not an optional skipped project.
- Templates and events own independent simple/advanced registration graphs;
  event creation snapshots the template and later template edits do not rewrite
  the event.

### Decision still required

- For exhausted email recovery, choose whether operators may correct the
  recipient on the original outbox record or may only requeue its immutable
  recipient. Record the security, audit, and idempotency consequences before
  implementing the mutation.
- For a successful non-Stripe/manual registration payment, choose whether paid
  transfer remains explicitly unsupported or receives a dedicated manual
  settlement workflow. A cancellation manual-refund record is not, by itself, a
  safe transfer settlement protocol.

### Accepted deferrals

The following remain explicitly out of current scope and are not defects by
themselves:

- anonymous/guest registration without an account;
- private invite-only events;
- strict reservation-queue waitlists;
- automatic event archival;
- push notifications;
- sophisticated budgeting and receipt-category planning;
- automated custom-domain verification and multi-domain tenant automation;
- an end-user impersonation UI; platform administrators use explicit audited
  target-scoped authority instead;
- payout-provider integration beyond the current Stripe-connected payment and
  refund boundary.

Product UI and docs must continue to state these boundaries honestly.

## Execution order

1. Finish the remaining candidate edits, create a local candidate commit, and
   require a clean worktree. Run the complete local gate on that exact commit. If
   any failure requires an edit, amend or create a new local candidate commit and
   rerun the entire gate from the start. Do not push or trigger CI until the
   clean exact-commit run is fully green with zero incomplete outcomes.
2. Complete organizer/helper signup coverage and the remaining Stripe, add-on,
   and refund-state cancellation documentation journeys.
3. Record the non-Stripe/manual-source transfer decision. If separately paid
   add-ons enter the supported boundary, implement multi-source refunds with
   terminal recovery and PostgreSQL concurrency evidence first.
4. Resolve the exhausted-email recipient decision, then add a platform-authorized,
   reasoned, audited requeue operation and page-backed coverage.
5. Prove waitlist email delivery into a recipient inbox and the recipient's
   follow-up registration path; add the unknown-domain guidance.
6. Record the production Cloudflare Images and Google Maps configuration. Close
   the advertised `@needs-cloudflare` test-contract gap and, for every enabled
   provider, add live evidence. Then run the exact-candidate Auth0/required-
   provider projects locally with approved credentials before CI.
7. Complete the authenticated in-app Browser queue at desktop and compact widths,
   followed by real-device camera verification. Convert any discovered defect
   into Playwright/docs coverage.
8. Provision and approve the live ESNcard environment/secret, execute exact-candidate
   certification, approve production legal text, require the verified checks and
   review policy on `main`, and replace the Knope placeholder with tested version,
   changelog, and GitHub-release automation. Keep the existing Fly deploy path
   distinct.
9. After the full gate, stop the owned stack and verify Compose plus remote Neon
   branch deletion, then inventory and deliberately clean only confirmed stale
   resources. The active branch's 24-hour expiration is already verified.

CI speed work may continue after correctness is preserved—for example, caching
or safe job decomposition—but it is an optimization, not a substitute for any
release gate and must not reduce test collection.

Before any push, PR update, or other CI-triggering action: finish edits, make a
local candidate commit, require a clean worktree, and run the complete local
equivalent of every affected CI suite on that exact commit. Every collected test
must pass with zero incomplete outcomes. If anything changes afterward, amend or
recommit and rerun the complete gate on the new exact commit. Missing services or
credentials are blockers to resolve locally, not reasons to let CI try first.
No push is allowed before that exact-commit run is green.

## Validation record

### Previous fully validated baseline

The canonical local baseline passed on commit
`cc5bfff361ed881e4a508113a044dd6ae2cfdd9e`:

| Suite                              |    Passed | Incomplete outcomes |
| ---------------------------------- | --------: | ------------------: |
| Server/helper Vitest               |       898 |                   0 |
| Angular/shared Vitest              |       559 |                   0 |
| PostgreSQL 17 integration          |        34 |                   0 |
| Functional Playwright baseline     |       145 |                   0 |
| Generated-documentation Playwright |        41 |                   0 |
| **Total**                          | **1,677** |               **0** |

Frozen dependency installation, Knope validation, formatting, lint/clean-tree
check, and the production application build also passed. Worktree-owned runtime
resources were removed after the run; that does not claim historical OPS-002
cleanup.

### Previous-baseline CI confirmation

The same pushed commit has green GitHub results for CodeQL analysis and aggregate,
CodeRabbit, Git Town, Knope/change files, PostgreSQL integration, lint/unit/build,
and Playwright E2E. CI recorded all 145 functional and 41 documentation tests and
green cleanup. These checks confirm the already-green local baseline; they do not
close REL-001 until GitHub requires them. They also do not validate the current
uncommitted candidate.

### Current uncommitted candidate

The working tree contains candidate changes after `cc5bfff361e`, including
organizer/receipt fail-closed recovery, cancellation confirmation with a locked
expected-state server guard, and the cancellation guide. It has no candidate
commit SHA, complete-suite pass count, or CI result. Do not copy the previous
1,677 count onto this candidate. Run and
record the entire local gate only after the edits are committed locally and the
worktree is clean. If validation causes another edit, amend/recommit and rerun the
entire gate for the resulting exact commit before any push.

Partial manual Browser evidence exists for the authenticated organizer overview
at desktop and compact widths. It does not constitute the complete six-area
Browser queue or real-device camera evidence.

### Explicitly not claimed

- No current-candidate `bun run test:e2e:integration` Auth0-backed pass is
  recorded.
- No Cloudflare Images live upload/delivery/cleanup path is currently collected.
- No Google Maps live loader/search/place-details verification is recorded.
- No live `bun run test:e2e:live-esncard:release` pass is recorded.
- No authenticated six-area in-app Browser walkthrough is recorded.
- No real-device camera walkthrough is recorded.
- No production legal approval is recorded.
- No required-check/review/thread-resolution policy is configured on `main`.
- No real Knope version/changelog/GitHub-release action has replaced the release
  placeholder. Fly deployment exists separately.
- No full local gate for the current uncommitted candidate is recorded.

These are open release-evidence or policy items, not skipped tests and not implied
by the previous 1,677 green baseline results. Cloudflare Images and Google Maps
become live-provider release gates only when the approved production
configuration enables them; the advertised-but-uncollected test contract still
must be reconciled either way.
