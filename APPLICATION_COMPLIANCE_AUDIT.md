# Application Production-Readiness Compliance Ledger

Ledger updated: 2026-07-12

Current fully validated baseline: `codex/production-readiness-compliance` at
`399fd1ed4295ce14573706bf1a50ac93602c20ee`

`origin/main` at that validation point:
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`
(`0` commits behind)

A fresh fetch on 2026-07-12 confirmed that the validated baseline remains `0`
commits behind `origin/main` at
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`. The next local candidate contains
additional participant guest guidance, a page-backed unlisted-event journey,
and fail-visible create-from-template recovery on top of that baseline. It must
be committed and pass the entire local gate from a clean exact commit before it
can be pushed or used to update the draft PR. If validation requires any edit,
create a new candidate commit and rerun the entire gate from the start.

Draft review: [PR #91](https://github.com/evorto-app/app/pull/91)

Scope: application, server/runtime, data layer, shared contracts, tests,
generated product documentation, repository-owned CI, and externally configured
release gates.

## Release decision

**Not yet ready to declare a complete production replacement.**

The original audit's broad implementation findings are mostly remediated. Commit
`399fd1ed4295ce14573706bf1a50ac93602c20ee` has a completely green local baseline
of 1,749 collected tests with zero skipped or otherwise incomplete outcomes.
That exact commit also passed all nine credential-backed Auth0 integration
tests. Organizer/helper signup, fail-closed organizer and receipt loading,
fail-closed receipt evidence, cancellation confirmation with locked stale-state
checks, and exact Neon Local cleanup are resolved against that baseline.

The uncommitted next-candidate work is not covered by those counts. It adds
participant guest guidance and assertions, proves unlisted-event direct-link
behavior, and makes create-from-template mutation failures visible and retryable
without clearing form entries when the failure is transient. A stale template
instead gets explicit restart guidance and an unsaved-entry warning, while a
legacy-random template requires migration to a supported mode. Those additions
remain candidate work until a new clean exact commit passes the complete local
gate.

The highest-risk application boundary is paid registration transfer: automatic
paid transfer is deliberately Stripe-only and still rejects separately paid
add-ons, while the product decision for non-Stripe/manual sources is unresolved.
The highest-risk evidence gaps are the unrun live ESNcard path, unresolved
production scope and test contracts for Cloudflare Images and Google Maps, and
the incomplete authenticated Browser review queue. GitHub's current `main`
ruleset also does not make the green checks mandatory.

## How to read this ledger

| Status                | Meaning                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Open**              | Required product behavior or evidence is absent.                                                            |
| **Partial**           | The original failure is substantially remediated, but a narrower release-relevant gap remains.              |
| **External**          | Repository work is present, but completion needs credentials, infrastructure policy, legal approval, or UI. |
| **Candidate**         | Implementation is present in the current candidate and still needs the complete exact-commit local gate.    |
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

## Finding and gate status

| ID           | Severity | Status   | Area                  | Remaining work                                                                                                                                        |
| ------------ | -------- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-002     | P1       | Partial  | Paid transfer         | Automatic paid transfer is Stripe-only; separately paid add-ons are blocked and manual-source policy is undecided.                                    |
| PROD-003     | P1       | Resolved | Organizer signup      | Signup, exclusivity, capability, access, profile, cancellation, docs, and the complete baseline gate are green.                                       |
| SEC-003      | P1       | Resolved | Receipt evidence      | Upload/finalization/approval fail closed on exact retrievable evidence; focused and complete baseline gates are green.                                |
| DOC-001      | P1       | Partial  | Cancellation/refund   | Validated docs cover core participant/organizer paths; Stripe, add-on, and refund-state journeys remain.                                              |
| ESN-001      | P1       | External | Live ESNcard          | The protected environment, approved identifier secret, and successful candidate certification run are absent.                                         |
| AUTH-001     | P1       | Resolved | Auth0 integration     | All 9 credential-backed integration tests passed on exact validated baseline `399fd1ed429`.                                                           |
| PROVIDER-001 | P1       | Open     | Conditional providers | Production scope/config is undecided; advertised integration coverage and collected tests are inconsistent.                                           |
| REL-001      | P1       | Partial  | Release enforcement   | CI and Fly deploy exist, but `main` does not require checks and Knope release automation is a placeholder.                                            |
| BROWSER-001  | P1       | Partial  | Manual acceptance     | Exploratory desktop/compact review covered organizer, guest, unlisted, and recovery slices; refresh the final candidate and finish the broader queue. |
| LEGAL-001    | P1       | External | Legal content         | Legal/privacy settings are implemented, but production text and policy approval are not recorded.                                                     |
| OPS-001      | P2       | Partial  | Email outbox          | Leased delivery is crash-safe and exhausted mail is visible, but there is no supported audited requeue path.                                          |
| OPS-002      | P2       | Resolved | Neon Local lifecycle  | Exact owned functional, documentation, and Auth0 integration branches were deleted and returned HTTP 404.                                             |
| UX-002       | P2       | Resolved | Load recovery         | Event, participant, and receipt query failures fail closed with explicit retry; the complete baseline gate is green.                                  |
| UX-004       | P2       | Resolved | Cancellation safety   | Expected-state RPC/locked checks and no-write tests passed focused and complete baseline gates.                                                       |
| DOC-002      | P2       | Partial  | Product docs          | Waitlist outbox/content is proven; delivered-inbox follow-up and unknown-domain guidance remain.                                                      |

No known P0 finding remains open in the current tree. The open, partial, and
external P1 rows above still prevent a production-replacement declaration; the
next local candidate must also pass the complete exact-commit gate before push.

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

### PROD-003 — Organizer/helper signup is validated

The application exposes organizing registration options separately from
participant options and derives organizer capability from the event-specific
organizing registration plus tenant permissions. Participant and organizer
registration remain mutually exclusive. The organizer overview uses
server-derived, tenant-scoped option aggregates, including hidden options and
options with zero registrations, while approve, transfer, and cancellation
controls are capability-gated. Cancellation availability and its checked-in,
event-started, and deadline-blocked explanations are server-derived.

The page-backed functional journey in
[`tests/specs/events/organizer-signup.spec.ts`](tests/specs/events/organizer-signup.spec.ts)
and novice guide in
[`tests/docs/events/organizer-signup.doc.ts`](tests/docs/events/organizer-signup.doc.ts)
exercise eligibility, participant/organizer exclusivity, signup, organizer
access, passes/profile state, cancellation, and cleanup for the supported free
organizer/helper path. The advanced journey also proves role-filtered visibility,
a pending application without organizer access or capacity reservation,
administrator approval, notification, and post-approval access. The guide does
not claim paid organizer checkout or a pending-withdrawal workflow that the
product does not implement.

Focused local evidence is green, including the combined organizer/receipt
functional run (`13/13`) and generated-documentation run (`10/10`). The complete
exact-commit local gate at `399fd1ed429` is also green, so PROD-003 is resolved.

### SEC-003 — Receipt approval requires retrievable, exactly bound evidence

The previous fallback could finalize an upload with a
`local-unavailable://receipt` placeholder when object storage was unavailable.
That allowed a receipt row to exist without retrievable evidence. Approval also
did not prove that the exact object still existed.

The validated implementation fails upload creation/finalization when storage is unavailable,
requires the receipt's tenant, event, user, upload ID, and storage key to match,
and requires both an object-store HEAD check and successful preview-URL signing
before approval. The transaction then locks and revalidates the exact
receipt/upload binding before the predicate update. Both tenant and platform
approval fail closed. Rejection remains available when evidence is missing so an
operator can safely clear the bad submission. The UI exposes
`receiptEvidenceAvailable`, explains the blocked approval, disables only
approval, and leaves rejection available.

The functional and documentation journeys upload a real PDF to local MinIO and
prove the browser receives a successful PDF document response. A negative
functional case removes the object, proves approval is unavailable, and proves
rejection still succeeds. Focused server, component, functional, and generated-
documentation evidence and the complete exact-commit local gate at
`399fd1ed429` are green, so SEC-003 is resolved.

### DOC-001 — Cancellation and refund documentation is substantial but incomplete

The validated baseline adds
[`tests/docs/events/registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
and links it from the maintained inventory. It executes participant cancellation
of a confirmed paid non-Stripe registration into a pending manual refund,
participant deadline denial, organizer cancellation of a free registration,
guest-capacity release, cancellation and waitlist email creation, persisted
readback, and the visible confirmation flow. This meaningful page-backed novice
journey passed the complete local gate; the finding remains partial only for the
narrower provider/refund paths below.

The same guide **explains**, but does not independently execute, cross-tenant and
permission denial, repeated-request idempotency, transient retry, live Stripe
refund delivery, or paid add-on allocation recovery. Keep those statements
clearly labeled as policy/recovery guidance unless a focused page-backed case or
provider run supplies the corresponding evidence.

The validated baseline also adds explicit confirmation for participant, waitlist, and
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

### AUTH-001 — Auth0-backed integration evidence is validated

Baseline authentication and session behavior has unit and Playwright coverage.
The credential-backed integration projects remain intentionally separate from
the baseline. The account-creation path in
[`tests/specs/profile/create-account.spec.ts`](tests/specs/profile/create-account.spec.ts)
requires Auth0 Management credentials and fails preflight when they are absent.
On exact validated baseline `399fd1ed429`, `bun run test:e2e:integration`
passed all 9 collected Auth0 functional and documentation tests with zero
incomplete outcomes. Its owned Neon branch `br-late-thunder-a9upx32a` was then
deleted, returned HTTP 404, and left zero project-labeled containers. Repeat the
same credential-backed suite on any later release candidate before CI or
release; missing credentials remain a local blocker rather than a skip.

### PROVIDER-001 — Provider evidence depends on the production configuration

Cloudflare Images and Google Maps integration code exists, but live evidence is
a release gate only when the approved production configuration enables those
providers or the release product scope depends on their workflows. The 1,749-test
baseline does not prove either provider. Current unit coverage
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
External inspection on 2026-07-12 found that the deploy job does not declare the
existing `production` GitHub environment, while that environment has no reviewer,
branch, secret, or variable protection. The latest `main` Fly run failed schema
application with PostgreSQL `28P01` authentication failure. `DATABASE_URL` was
updated afterward, but no later successful run proves recovery. Bind the deploy
job to the protected production environment and verify a controlled recovery
run before treating deployment as release-ready.

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
An exploratory in-app Browser pass opened the authenticated organizer overview,
paid guest selection, unlisted direct-link access, and create-from-template
mutation recovery at desktop and compact widths. The guest flow showed one guest
becoming two spots and a €50 total; this review found and fixed a clipped
multi-line Material hint by enabling dynamic subscript sizing. A stale-template
submission showed the server reason and retained the edited title. The signed-
out event list hid the unlisted event while its direct link remained readable
with **Log in now**. Browser diagnostics contained no warning or error.

Review-driven copy and live-region grammar refinements followed that Browser
session. Current automated component, Axe, functional, and documentation checks
cover the final wording, including transient retry, stale-template restart, and
legacy-mode migration, but the clean exact candidate must be reopened in the
in-app Browser before release. This is meaningful exploratory slice evidence,
not a complete pass through every state, destructive mutation, or remaining
application area.

There is still no recorded complete pass through:

1. the rest of anonymous discovery beyond the validated unlisted-link slice;
2. the rest of participant registration/profile states beyond guest selection;
3. organizer authoring, event management, check-in, and add-on redemption/undo
   beyond the validated create-recovery and guest slices;
4. tenant administration and finance;
5. platform tenant-scoped operations;
6. live ESNcard provider states.

The scanner's complete Playwright file is baseline-green (`13/13`). It installs
a deterministic camera stream, proves camera-allowed readiness, proves the
denied-permission alert and retry state, and exercises deterministic
`/scan/registration/:id` result journeys. This is the reliable simulated-camera
path selected for this release effort; it covers the requested scanner integration
without claiming physical-device hardware certification. The broader manual
Browser queue above remains open.

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

### OPS-002 — Exact ephemeral branch cleanup is validated

Playwright-owned Compose stacks now have bounded shutdown and provenance rules,
`docker:resume` refuses incomplete initialization, and the Neon expiration helper
fails more visibly. Lifecycle behavior is covered in
[`helpers/testing/docker-lifecycle.spec.ts`](helpers/testing/docker-lifecycle.spec.ts).

A controlled project-scoped reproduction on 2026-07-12 captured Neon Local
branch `br-frosty-queen-a91tfjko` from the running container metadata. The Neon
API reported that exact branch ready with expiry
`2026-07-13T06:35:23Z`, 24 hours after creation. The normal project-scoped
`docker:stop` then removed every `evorto-f907c8db` container and its network;
the same exact branch endpoint returned HTTP `404` afterward. This proves that
the current stop path deletes the branch rather than merely clearing metadata.

The two named cache volumes remain by design and do not keep a container or
remote branch running. An inventory also found two older ready branches without
expiry. Their ownership is not established after their source metadata was
cleared, so they were not deleted and are not attributed to another checkout by
guesswork.

The complete exact-commit gate at `399fd1ed429` created and removed its owned
functional branch `br-muddy-pond-a977lvx7` and documentation branch
`br-rough-field-a9r305fg`; both exact endpoints returned HTTP 404 afterward and
no project-labeled container remained. The later Auth0 integration run repeated
that result for `br-late-thunder-a9upx32a`. OPS-002 is therefore resolved for the
validated baseline. Every later full gate must still capture and verify its own
exact branch IDs. Inventory any older project or branch separately and delete it
only after confirming ownership; never use broad cleanup that could affect
another checkout or user-owned stack.

### UX-002 — Organizer and receipt query failures are fail-closed

The user list, finance transaction list, and template-to-event creation paths now
have explicit first-load error and retry behavior with durable coverage in
[`tests/specs/resilience/core-load-recovery.spec.ts`](tests/specs/resilience/core-load-recovery.spec.ts).

The validated implementation updates
[`src/app/events/event-organize/event-organize.html`](src/app/events/event-organize/event-organize.html)
to gate counts and participant actions on successful event/overview data. Event,
participant, and receipt failures now use explicit `role="alert"` states and
retry actions; the participant message says missing counts are not zero, and the
receipt message says existing records may still be present. The back action has
an accessible name. Focused component, fail-once functional Playwright, and
generated event-management coverage are present. The complete exact-commit gate
at `399fd1ed429` is green, so UX-002 is resolved. The next candidate extends this
same recovery contract to create-from-template mutation failures and requires a
new complete gate before that extension is claimed as validated.

### UX-004 — Destructive registration cancellation requires confirmation

The validated implementation routes participant cancellation, leaving a waitlist,
and organizer cancellation through the shared Material dialog in
[`src/app/events/registration-cancellation-confirmation-dialog.component.ts`](src/app/events/registration-cancellation-confirmation-dialog.component.ts).
The copy distinguishes pending applications, pending payment reservations,
confirmed tickets, waitlists, and organizer context; **Keep registration** is the
initial focus, and current client-side in-flight guards are checked again after
confirmation.

The validated implementation carries the stale-state precondition end to end. The typed
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
error so the user can review current state. Focused no-write evidence and the
complete exact-commit gate at `399fd1ed429` are green, so UX-004 is resolved.

### DOC-002 — Smaller documentation truth gaps remain

- The validated baseline
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
- The validated baseline corrects
  [`tests/docs/events/event-management.doc.ts`](tests/docs/events/event-management.doc.ts)
  to say automatic paid transfer is limited to supported Stripe sources and is
  blocked by a separately paid add-on or non-Stripe source. That correction is
  validated; the narrower non-Stripe/manual-source product decision remains
  open.

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
| PROD-003               | Organizer/helper signup, capability, exclusivity, access, cancellation, profile state, and novice guidance passed focused coverage and the complete `399fd1ed429` baseline gate.                                                                                                                                                                                                          |
| SEC-003                | Receipt upload, finalization, and approval fail closed unless the exact evidence object is retrievable; focused coverage and the complete `399fd1ed429` baseline gate passed.                                                                                                                                                                                                             |
| AUTH-001               | All 9 credential-backed Auth0 functional and documentation integration tests passed on `399fd1ed429`, followed by exact Neon branch deletion and container cleanup.                                                                                                                                                                                                                       |
| OPS-002                | The full functional, documentation, and Auth0 integration runs each captured their owned Neon branch; the exact endpoints returned HTTP 404 after cleanup and no project-labeled containers remained.                                                                                                                                                                                     |
| UX-002                 | Organizer, receipt, user-list, transaction-list, and template-load failures render explicit retryable states; focused coverage and the complete `399fd1ed429` gate passed.                                                                                                                                                                                                                |
| UX-004                 | Participant, waitlist, and organizer cancellation require confirmation and carry locked expected-state checks that leave protected state unchanged on conflicts; focused and complete gates passed.                                                                                                                                                                                       |
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

The original TEST-003, PROD-002, and OPS-001 findings are only partially closed
and therefore remain in the status ledger under their current narrower
statements.

## Material 3, Angular, Effect, and Uncodixfy snapshot

The previous static numeric score is retired because it no longer describes the
remediated branch and implied more precision than the audit supported.

- Angular Material, Material system tokens, OnPush components, signals, native
  control flow, and responsive list/detail layouts are broadly established.
- The semantic success/warning bridge and the original reusable-control
  accessibility defects are resolved.
- The validated organizer and receipt load states use restrained Material
  error containers, ordinary controls, truthful copy, and retry actions. They are
  not an invitation for visual restyling. Continue to avoid decorative
  dashboards, gradients, glass panels, excessive card nesting, or gratuitous
  motion.
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
map. The validated `399fd1ed429` baseline collected 46 documentation tests from
the current documentation sources. The next candidate deepens guest,
unlisted-event, and create-from-template recovery guidance without adding a
complete-suite count yet. This ledger remains the source of truth for release
gaps; the inventory does not waive the open rows above.

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
- In-app Browser review complements Playwright. For the scanner candidate,
  deterministic Playwright camera input plus scan-result journeys are the
  accepted integration evidence; they do not claim physical-device hardware
  certification.
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

1. Finish the next-candidate guest, unlisted-event, and create-from-template
   recovery edits, create a local candidate commit, and
   require a clean worktree. Run the complete local gate on that exact commit. If
   any failure requires an edit, amend or create a new local candidate commit and
   rerun the entire gate from the start. Do not push or trigger CI until the
   clean exact-commit run is fully green with zero incomplete outcomes.
2. Run the candidate's complete exact-commit local gate. The remaining broader
   product-doc work is the Stripe, add-on, and refund-state cancellation
   journeys.
3. Record the non-Stripe/manual-source transfer decision. If separately paid
   add-ons enter the supported boundary, implement multi-source refunds with
   terminal recovery and PostgreSQL concurrency evidence first.
4. Resolve the exhausted-email recipient decision, then add a platform-authorized,
   reasoned, audited requeue operation and page-backed coverage.
5. Prove waitlist email delivery into a recipient inbox and the recipient's
   follow-up registration path; add the unknown-domain guidance.
6. Record the production Cloudflare Images and Google Maps configuration. Close
   the advertised `@needs-cloudflare` test-contract gap and, for every enabled
   provider, add live evidence. Repeat the already-green Auth0 integration suite
   and all required-provider projects on the exact later candidate with approved
   credentials before CI.
7. Complete the remaining authenticated in-app Browser queue at desktop and
   compact widths. Scanner camera and result integration already have
   deterministic Playwright coverage. Convert any newly discovered defect into
   Playwright/docs coverage.
8. Provision and approve the live ESNcard environment/secret, execute exact-candidate
   certification, approve production legal text, require the verified checks and
   review policy on `main`, and replace the Knope placeholder with tested version,
   changelog, and GitHub-release automation. Keep the existing Fly deploy path
   distinct.
9. During the full gate, capture the exact Neon branch ID and expiry. Afterward,
   repeat the proven project-scoped stop, verify Compose cleanup, and prove that
   exact remote branch is gone. Inventory and deliberately clean only confirmed
   stale resources.

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

### Current fully validated baseline

The canonical local baseline passed on exact commit
`399fd1ed4295ce14573706bf1a50ac93602c20ee`:

| Suite                              |    Passed | Incomplete outcomes |
| ---------------------------------- | --------: | ------------------: |
| Server/helper Vitest               |       929 |                   0 |
| Angular/shared Vitest              |       591 |                   0 |
| PostgreSQL 17 integration          |        34 |                   0 |
| Functional Playwright baseline     |       149 |                   0 |
| Generated-documentation Playwright |        46 |                   0 |
| **Total**                          | **1,749** |               **0** |

Frozen dependency installation, Knope validation, formatting, lint/clean-tree
check, and the production application build also passed. The exact functional
and documentation Neon branches returned HTTP 404 after teardown and no
project-labeled containers remained.

The credential-backed integration projects are intentionally separate from the
1,749 baseline total. On the same exact commit, `bun run test:e2e:integration`
passed 9/9 Auth0 functional and documentation tests with zero incomplete
outcomes. Its exact Neon branch also returned HTTP 404 after cleanup.

### Validated-baseline CI confirmation

The same pushed commit has green GitHub results for CodeQL analysis and
aggregate, CodeRabbit, Git Town, Knope/change files, PostgreSQL integration, and
lint/unit/build. The aggregate Playwright E2E job also completed green after
recording all 149 functional and 46 documentation tests. CI confirms an
already-green local baseline and does not close REL-001 until GitHub requires the
checks. It also does not validate the next local candidate.

### Next local candidate pending complete local gate

The next candidate contains changes after `399fd1ed429`, including guest-count
guidance and paid/free capacity assertions, page-backed participant unlisted-
event guidance, and fail-visible create-from-template mutation recovery that
retains form entries for transient retries while directing stale-template cases
to restart from the latest template after copying needed entries and legacy-
random templates to migrate before retrying. Its exact SHA is the clean local
commit identified in the validation handoff. It has no
complete-suite pass count or CI result in this pre-gate ledger state. Do not copy
the 1,749 count onto it. Run and record the entire local gate only from the clean
local commit. If validation causes another edit, create a new commit and rerun
the entire gate for the resulting exact commit before any push.

Focused next-candidate evidence is green but is not a release total:

| Focused run                                                 | Passed | Incomplete outcomes |
| ----------------------------------------------------------- | -----: | ------------------: |
| Guest registration-option Angular                           |     29 |                   0 |
| Create-from-template recovery Angular                       |      7 |                   0 |
| Generated-documentation source guards                       |     21 |                   0 |
| Final-tree selected functional and documentation Playwright |     19 |                   0 |
| Template-category hydration functional Playwright           |      9 |                   0 |
| Template-category hydration documentation Playwright        |      8 |                   0 |
| Cancellation/transfer deadlock documentation Playwright     |     12 |                   0 |
| PostgreSQL 17 integration with inverse user-lock regression |     35 |                   0 |

The local gate stopped twice instead of delegating diagnosis to CI. The first
functional pass exposed one server-rendered template-category action clicked
before Angular hydration; deterministic event-replay readiness waits now cover
both functional and documentation actions. The next documentation pass exposed
a PostgreSQL foreign-key deadlock between cancellation fixture setup and a
concurrent registration transfer. Transfer notification-address reads no longer
take global user-row write locks, the fixture does not hold two shared-user FK
locks in one transaction, and a bounded PostgreSQL concurrency regression plus
the exact conflicting guide pair both pass. Because these repairs changed the
candidate, the complete exact-commit gate must still restart before any push.

The final-tree combined focused branch `br-shy-bread-a9zt800v` returned HTTP 404
after teardown and left no project-labeled container. Earlier focused branches
`br-curly-sound-a9zz0uy2` and `br-raspy-dawn-a9swoqb7` also returned HTTP 404.
The Browser review's
initial and rebuilt branches, `br-rough-darkness-a9yipq6h` and
`br-dry-truth-a9y30fpe`, also returned HTTP 404 after the restart and final
project-scoped stop. No project-labeled container remained. That Browser session
covered the guest total/hint, signed-out unlisted direct link, and fail-visible
template-change recovery at desktop and 390×844 with no console warning or
error, but it predates the final copy-only refinements and remains exploratory.
Only the complete clean-commit gate and final Browser refresh can validate the
slice for push and release evidence.

Focused evidence incorporated into the validated baseline:

| Focused run                                 | Passed | Incomplete outcomes |
| ------------------------------------------- | -----: | ------------------: |
| Organizer/random Angular                    |     45 |                   0 |
| Cancellation/profile Angular                |     71 |                   0 |
| Organizer registration server               |     82 |                   0 |
| Organizer aggregate/schema/document guards  |     50 |                   0 |
| Receipt server/config                       |     85 |                   0 |
| Receipt Angular                             |      8 |                   0 |
| Receipt/cancellation regression review      |    138 |                   0 |
| Organizer/receipt functional Playwright     |     13 |                   0 |
| Organizer/receipt documentation Playwright  |     10 |                   0 |
| Scanner camera/result functional Playwright |     13 |                   0 |

These focused runs overlap the canonical suites and are not summed as a release
total. The unfiltered complete local gate is the evidence that promoted the
associated findings to resolved baseline status.

Exploratory manual Browser evidence covers the authenticated organizer overview,
paid guest pricing and capacity copy, signed-out unlisted direct-link behavior,
and create-from-template recovery at desktop and compact widths. It needs a
final exact-candidate refresh and does not constitute the complete six-area
Browser queue. Scanner simulation and deterministic result evidence are recorded
separately above.

### Explicitly not claimed

- The 9/9 Auth0 integration result belongs to exact baseline `399fd1ed429`; it
  does not cover a later unvalidated candidate until repeated there.
- No Cloudflare Images live upload/delivery/cleanup path is currently collected.
- No Google Maps live loader/search/place-details verification is recorded.
- No live `bun run test:e2e:live-esncard:release` pass is recorded.
- No authenticated six-area in-app Browser walkthrough is recorded.
- No physical-device camera certification is claimed; the accepted candidate
  integration evidence uses deterministic Playwright camera and result journeys.
- No production legal approval is recorded.
- No required-check/review/thread-resolution policy is configured on `main`.
- No real Knope version/changelog/GitHub-release action has replaced the release
  placeholder. Fly deployment exists separately.
- No full local gate for the next candidate is recorded in this pre-gate
  ledger state.

These are open release-evidence or policy items, not skipped tests and not implied
by the 1,749 green baseline results. Cloudflare Images and Google Maps
become live-provider release gates only when the approved production
configuration enables them; the advertised-but-uncollected test contract still
must be reconciled either way.
