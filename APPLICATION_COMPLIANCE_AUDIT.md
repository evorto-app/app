# Application Production-Readiness Compliance Ledger

Ledger updated: 2026-07-12

Current fully validated baseline: `codex/production-readiness-compliance` at
`e3e252768e49a7fc23bd67f0f6174184dd71feb3`

`origin/main` at that validation point:
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`
(`0` commits behind)

A fresh fetch on 2026-07-12 confirmed that the validated baseline remains `0`
commits behind `origin/main` at
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`. The next local candidate exposes
participant-safe cancellation refund progress, operator-safe retry lifecycle
summaries, a fail-closed paid add-on cancellation boundary, and a page-backed
signed Stripe failure/recovery guide. It must be committed and pass the entire
local gate from a clean exact commit before it can be pushed or used to update
the draft PR. If validation requires any edit, create a new candidate commit and
rerun the entire gate from the start.

The same dirty candidate now contains source-aligned implementation for the
binding fixed-bundle transfer and Stripe-only event-payment rules. Its complete
working-tree gate is green: 1,128 server/helper tests, 644 Angular/shared tests,
48 disposable PostgreSQL 17 tests, 150 functional Playwright tests, and 49
generated-documentation Playwright tests all passed with zero incomplete
outcomes. The separate credential-backed provider suite passed 11/11, and live
ESNcard certification passed its 28/28 profile precheck plus 8/8 Playwright
tests, including active and permanently expired provider identities. A clean
candidate commit and an entire exact-commit rerun are still required before any
push or CI attempt.

Draft review: [PR #91](https://github.com/evorto-app/app/pull/91)

Scope: application, server/runtime, data layer, shared contracts, tests,
generated product documentation, repository-owned CI, and externally configured
release gates.

## Release decision

**Not yet ready to declare a complete production replacement.**

The original audit's broad implementation findings are mostly remediated. Commit
`e3e252768e49a7fc23bd67f0f6174184dd71feb3` has a completely green local baseline
of 1,758 collected tests with zero skipped or otherwise incomplete outcomes.
That exact commit also passed all nine credential-backed Auth0 integration
tests. Organizer/helper signup, fail-closed organizer and receipt loading,
fail-closed receipt evidence, cancellation confirmation with locked stale-state
checks, and exact Neon Local cleanup are resolved against that baseline.

The uncommitted next-candidate work is not covered by those baseline counts. It keeps
cancelled registrations with refund obligations visible on Profile, exposes
safe queued, retrying, provider-action, stopped, completed, and attention
states to participants and platform operators, and refuses to mutate paid add-on
inventory unless its reconciled payment allocation is complete. The generated
cancellation guide now executes the allocation, signed failure webhook, terminal
attention state, audited requeue, signed success webhook, Profile state, and
direct scanner-result journey. The current working tree passed the complete gate,
but those additions remain candidate work until a new clean exact commit repeats
the same complete result.

The highest-risk application boundary is paid registration transfer. The
binding contract is one inseparable registration, guest, add-on, and fulfillment
bundle with exact refunds for every original Stripe source; its candidate
implementation and page-backed proof passed the complete working-tree gate and
still need the complete clean exact-commit gate. Paid event registration and add-on transactions are Stripe-only, so
legacy/manual paid-event sources are not a supported product branch. The
highest-risk evidence gaps are the unprotected live ESNcard release environment,
the incomplete authenticated Browser review queue, and the absence of a clean
exact-commit rerun. The dirty candidate's complete Auth0/Google Maps integration
and local live ESNcard certification runs are green, but must be repeated on the
final clean exact commit. Cloudflare Images is being removed in the candidate
and is not a provider gate. GitHub's current `main` ruleset also does not make
the green checks mandatory.

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

| ID           | Severity | Status    | Area                 | Remaining work                                                                                                                                        |
| ------------ | -------- | --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-002     | P1       | Candidate | Paid transfer        | The fixed-bundle acquisition ledger passed database, functional, documentation, and complete working-tree gates; exact-commit rerun remains.          |
| PROD-003     | P1       | Resolved  | Organizer signup     | Signup, exclusivity, capability, access, profile, cancellation, docs, and the complete baseline gate are green.                                       |
| SEC-003      | P1       | Resolved  | Receipt evidence     | Upload/finalization/approval fail closed on exact retrievable evidence; focused and complete baseline gates are green.                                |
| DOC-001      | P1       | Candidate | Cancellation/refund  | The Stripe/add-on/refund-state guide passed focused and complete working-tree gates; exact-commit rerun remains.                                      |
| ESN-001      | P1       | External  | Live ESNcard         | Active/expired certification passed 28/28 unit and 8/8 Playwright checks; the protected GitHub environment and secret policy remain absent.           |
| AUTH-001     | P1       | Candidate | Auth0 integration    | The credential-backed 11-test provider suite is green on the working tree; repeat it on the final clean exact commit.                                 |
| PROVIDER-001 | P1       | Candidate | Google Maps          | The canonical credential-backed integration run passed 11/11, including both live Maps journeys; repeat it on the final clean exact commit.           |
| REL-001      | P1       | Partial   | Release enforcement  | `main` does not require checks and Knope release automation is a placeholder; deployment work is tracked separately.                                  |
| BROWSER-001  | P1       | Partial   | Manual acceptance    | Exploratory desktop/compact review covered organizer, guest, unlisted, and recovery slices; refresh the final candidate and finish the broader queue. |
| LEGAL-001    | P1       | External  | Legal content        | Legal/privacy settings are implemented, but production text and policy approval are not recorded.                                                     |
| OPS-001      | P2       | Resolved  | Email outbox         | Leased delivery is crash-safe; exhausted mail intentionally remains stored and read-only with no recovery action.                                     |
| OPS-002      | P2       | Resolved  | Neon Local lifecycle | Exact owned functional, documentation, and Auth0 integration branches were deleted and returned HTTP 404.                                             |
| UX-002       | P2       | Resolved  | Load recovery        | Event, participant, and receipt query failures fail closed with explicit retry; the complete baseline gate is green.                                  |
| UX-004       | P2       | Resolved  | Cancellation safety  | Expected-state RPC/locked checks and no-write tests passed focused and complete baseline gates.                                                       |
| DOC-002      | P2       | Partial   | Product docs         | Unknown-domain recovery is page-backed; live waitlist inbox delivery and recipient follow-up remain.                                                  |

No known P0 finding remains open in the current tree. The open, partial, and
external P1 rows above still prevent a production-replacement declaration; the
next local candidate must also pass the complete exact-commit gate before push.

## Active finding details

### PROD-002 — Binding fixed-bundle paid transfer is in progress

The validated baseline covers private offer credentials, recipient eligibility,
recipient Stripe Checkout, connected-account ownership, source cancellation, a
single persisted source-refund obligation, terminal refund failure, and operator
requeue. Functional and generated-doc coverage exercises that narrower baseline
in
[`tests/specs/events/registration-transfer.spec.ts`](tests/specs/events/registration-transfer.spec.ts)
and
[`tests/docs/events/registration-transfer.doc.ts`](tests/docs/events/registration-transfer.doc.ts).

That baseline is no longer the product boundary. The binding contract is:

- the registration, guest quantity, every included/free/purchased add-on
  quantity, and all check-in/fulfillment history form one inseparable bundle;
- the recipient cannot omit, replace, or re-quantity any settled bundle item;
- recipient pricing starts from current base prices for that fixed bundle and
  applies only the recipient's current eligible discounts; source-user discounts
  do not transfer;
- the recipient payment is calculated independently from source refunds;
- every original Stripe registration and purchased-add-on payment is refunded at
  its exact original amount; and
- database-only completion is allowed only when the whole bundle is free and no
  source refund is required.

Paid registration and add-on transactions are Stripe-only. A tenant without a
connected Stripe account may offer only free registration options and free
add-ons; cash, bank-transfer, manually settled, or otherwise non-Stripe paid
event sources are unsupported, not an undecided transfer branch.

The current dirty candidate models an in-place ownership handoff: one confirmed
registration id keeps its guest/check-in state, add-on purchases, lots,
fulfillment events, refund allocations, capacity, and stock. Sealed bundle rows
prevent recipient omission or re-quantitying. The payment-provenance slice now
uses a full append-only acquisition ledger: immutable
ownership epochs, acquisition-owned payments, priced registration/add-on-lot
components, and refund allocations replace timestamp and current-target-user
inference. Transfer refund plans still account for every original Stripe source,
including prior successful partial refunds, while the recipient payment remains
independently recalculated from current base prices and recipient discounts. A
historical source discount is not carried into the guide's final registration
state. Server authorization and composite tenant foreign keys remain the
boundary; no PostgreSQL RLS is planned for this ledger.

The acquisition schema and finalization API have stabilized. The paid fixture
and generated guide now assert the immutable source epoch, its two exact source
payments, registration/add-on-lot components, prior refund allocation, the
recipient claim-transfer epoch and independently priced components, and exact
refund-plan links back to the source acquisition payments. Strict helper
TypeScript passes, the transfer/provider source guards pass 25/25, and the
targeted documentation project collects all 9 setup and journey tests. The full
working-tree gate then passed 48 PostgreSQL, 150 functional, and 49 generated-
documentation tests with zero incomplete outcomes. PROD-002 is therefore a
green candidate, but it is not resolved until a clean exact candidate commit
repeats the entire gate. The old baseline's separately-paid-add-on rejection and
source-cancellation model are historical evidence of the gap, not acceptable
final behavior.

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
exact-commit local gate at `e3e252768e4` is also green, so PROD-003 is resolved.

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
`e3e252768e4` are green, so SEC-003 is resolved.

### DOC-001 — Cancellation and refund documentation is a green candidate

The validated baseline added
[`tests/docs/events/registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
and links it from the maintained inventory. The current candidate removes its
old paid-cash/manual-refund example because paid event sources are Stripe-only.
The retained ordinary-cancellation journey covers a free confirmed registration,
participant deadline denial, organizer cancellation, guest-capacity release,
cancellation and waitlist email creation, persisted readback, the visible
confirmation flow, and the resulting Profile state.

The next candidate adds a second page-backed beginner journey for a confirmed
free registration with one included and two Stripe-settled optional add-on
units. It redeems the included unit and one paid unit through the production
fulfillment service, cancels through the participant UI, and proves the exact
allocation, inventory, and refund claim. It then executes a valid signed failed
Stripe webhook, the participant and scanner attention states, an audited
platform-admin requeue, a generation-one signed success webhook, and the final
Profile and scanner-result states. Literal recovery guidance distinguishes
retrying, attention, and successful outcomes without claiming that a
queued claim has already returned money.

The validated baseline also adds explicit confirmation for participant, waitlist, and
organizer cancellation via
[`src/app/events/registration-cancellation-confirmation-dialog.component.ts`](src/app/events/registration-cancellation-confirmation-dialog.component.ts).
**Keep registration** receives initial focus and the mutation proceeds only after
an affirmative confirmation.

The two affected focused documentation files pass 12/12 with zero incomplete
outcomes, and the complete 49-test documentation project is green. The candidate
still needs the complete clean exact-commit rerun before this finding becomes
resolved. The deterministic signed-webhook journey
validates our handler and product behavior; it is not a claim of live Stripe
network or bank settlement. Cross-tenant and permission denial remain supported
by server coverage and policy text rather than a second Browser journey. Keep
deterministic database readback and literal recovery language: a queued Stripe
refund claim must never be documented as money already returned.

### ESN-001 — Live ESNcard certification passes locally but lacks protected release policy

The repository contains a fail-closed reusable workflow at
[`.github/workflows/esncard-release-certification.yml`](.github/workflows/esncard-release-certification.yml)
and the provider test at
[`tests/specs/profile/user-profile-live-esncard.spec.ts`](tests/specs/profile/user-profile-live-esncard.spec.ts).
The release workflow calls the certification job; deployment orchestration is
owned by a separate change.

On 2026-07-12 the local release command passed its complete 28-test Profile
precheck and all 8 Playwright dependency/provider tests with zero skips,
retries, or incomplete outcomes. It proved the active-card add/refresh/remove
lifecycle and the permanently expired provider, UI, RPC, and persisted state.
The live path exposed and fixed a contradictory handler branch that persisted an
expired card and then returned an error instead of the modeled readable state.
Both approved identifiers were supplied only as process-local environment
variables, traces were disabled, and no identifier value was written to tracked
files or this ledger.

The GitHub environment `esncard-release-certification` still does not exist, so
there are no protected identifier secrets, reviewer policy, or recorded
release-commit run.
Completion requires provisioning that environment, documenting credential
ownership and rotation, and repeating the green certification on the final
exact release commit.

### AUTH-001 — Auth0-backed integration evidence is validated

Baseline authentication and session behavior has unit and Playwright coverage.
The credential-backed integration projects remain intentionally separate from
the baseline. The account-creation path in
[`tests/specs/profile/create-account.spec.ts`](tests/specs/profile/create-account.spec.ts)
requires Auth0 Management credentials and fails preflight when they are absent.
On exact validated baseline `e3e252768e4`, `bun run test:e2e:integration`
passed all 9 collected Auth0 functional and documentation tests with zero
incomplete outcomes. Its owned Neon branch `br-orange-sun-a9oheq9u` was then
deleted, returned HTTP 404, and left zero project-labeled containers. Repeat the
same credential-backed suite on any later release candidate before CI or
release; missing credentials remain a local blocker rather than a skip.

### PROVIDER-001 — Google Maps live candidate verification passed

Google Maps location search and place details are required production
functionality. Unit coverage validates configuration plus initialization,
search, empty-result, and error mapping in
[`src/server/config/server-config.spec.ts`](src/server/config/server-config.spec.ts)
and [`src/app/core/location-search.spec.ts`](src/app/core/location-search.spec.ts),
and the current candidate adds credential-gated Playwright journeys in
[`tests/specs/admin/google-maps-location.spec.ts`](tests/specs/admin/google-maps-location.spec.ts)
and
[`tests/docs/admin/google-maps-location.doc.ts`](tests/docs/admin/google-maps-location.doc.ts).
They are collected by both integration projects and exercise the live loader,
autocomplete/search, place details and coordinates, persisted readback, and the
beginner operator flow. The candidate reusable release workflow now validates
Auth0 Management and Google Maps credentials and runs the canonical integration
projects before the unchanged live ESNcard certification; both Maps journeys
have 90-second provider timeouts. The hardened workflow validates required
values before checkout/setup, keeps provider/database secrets out of job-level
environment, pins external actions to reviewed commit SHAs, and accepts only an
explicit reusable-workflow secret allowlist. The same candidate pins every
repository-owned workflow action and adds a
source guard that rejects mutable external refs or secrets in broad
workflow/job environment blocks; baseline and PR workflows now inject secrets
only into their validation/install/runtime steps.

The worktree now resolves `PUBLIC_GOOGLE_MAPS_API_KEY` from the developer's
untracked local secret without exposing the value. The first credential-backed
attempt exposed a deterministic-clock defect: freezing `Date.now()` prevented
the debounced Places request from ever becoming due. The candidate now keeps a
fixed test epoch while allowing elapsed time to advance, keeps the input value
independent of Signal Forms' delayed control writeback, and retains redacted
failure traces for the two provider journeys. The focused location-dialog suite
passed 8/8 and the canonical `bun run test:e2e:integration` run passed 11/11,
including live Maps loader, autocomplete, place details, persisted coordinates,
and both the functional and generated-documentation journeys, with zero skips
or retries. This is dirty-candidate evidence: repeat it on the final clean exact
commit before CI or release. Production provider provisioning remains an
out-of-band deployment requirement.

Cloudflare Images is not production scope or a release gate. The current
candidate removes its editor upload RPC, configuration, handler, integration,
cleanup tooling, dependencies, Compose variables, and test-gate language while
preserving the separate S3-compatible receipt/object-storage boundary. The
provider-scope source guard passes 2/2, but the removal still belongs to the
unvalidated candidate until the complete exact-commit local gate passes. The
repository still has a dormant `CLOUDFLARE_IMAGES_API_TOKEN` secret name to
remove out of band after confirming no external consumer; R2 credentials remain
in scope and must not be removed.

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

Fly deployment behavior and environment hardening are intentionally excluded
from this candidate because a separate deployment change is planned. The only
Fly workflow edits retained here are repository-wide neutral security hygiene:
read-only permissions and immutable action/tool pins. This audit makes no claim
that the separate deployment work is complete.

The separate
[`.github/workflows/release.yml`](.github/workflows/release.yml) correctly
depends on live ESNcard certification, but its Knope release job only echoes **Add
publish/deploy steps for Knope releases.** Treat that as missing version,
changelog, and GitHub-release automation. Replace it with the agreed Knope
release actions and verify the resulting version/changelog/release artifacts.

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
in-app Browser after any later edit before release. This is meaningful exploratory slice evidence,
not a complete pass through every state, destructive mutation, or remaining
application area.

The cancellation/refund candidate was reopened against the current host-run app
at desktop and 390×844. Signed-out event discovery, a paid event detail, pricing,
login guidance, compact navigation, and the direct event route rendered without
console warning or error. Authenticated Profile, platform finance, and scanner
result states are page-backed in the focused 12/12 generated guides; they remain
Playwright rather than in-app Browser evidence because the in-app Browser has no
authenticated Auth0 handoff for the test identities.

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
`/scan/registration/:id` result journeys. The cancellation candidate also opens
the direct scanner-result URL after retry failure and success. This is the
reliable simulated-camera/result path selected for this release effort; it
covers the requested scanner integration without claiming physical-device
hardware certification. The broader manual Browser queue above remains open.

### LEGAL-001 — Legal approval is outside automated proof

Tenant-hosted legal/privacy fields and routes have implementation and test
coverage. Production readiness still requires an authorized owner to approve
the actual terms, privacy text, re-acceptance policy, company/controller details,
and jurisdiction-specific obligations. Record the approved version and effective
date; a passing UI test proves rendering and persistence, not legal sufficiency.

### OPS-001 — Exhausted email is intentionally stored and read-only

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

The binding product decision is to keep exhausted rows stored and read-only.
There is no supported requeue/edit RPC and none is required for the current
scope. Operators use the tenant, recipient, attempts, timestamp, and last error
as incident evidence; stale in-flight lease reclamation remains automatic and is
not an exhausted-email recovery action. OPS-001 is resolved against that scope.

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

The complete exact-commit gate at `e3e252768e4` created and removed its owned
functional branch `br-snowy-truth-a9i0qqtw` and documentation branch
`br-bold-recipe-a9pbrnrm`; both exact endpoints returned HTTP 404 afterward and
no project-labeled container remained. The later Auth0 integration run repeated
that result for `br-orange-sun-a9oheq9u`. OPS-002 is therefore resolved for the
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
at `e3e252768e4` is green, so UX-002 is resolved.

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
complete exact-commit gate at `e3e252768e4` are green, so UX-004 is resolved.

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
- Unknown-tenant/domain failure now renders a public, non-indexed 404 recovery
  page. The generated guide opens an unknown-domain scanner-result path, proves
  the explicit no-mutation state, and gives beginner-safe link recovery steps.
- Transfer and event-management guides are being updated to the binding
  fixed-bundle and Stripe-only rules. Their old separately-paid-add-on and
  manual-source limitation text is not current product guidance.

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
| PROD-003               | Organizer/helper signup, capability, exclusivity, access, cancellation, profile state, and novice guidance passed focused coverage and the complete `e3e252768e4` baseline gate.                                                                                                                                                                                                          |
| SEC-003                | Receipt upload, finalization, and approval fail closed unless the exact evidence object is retrievable; focused coverage and the complete `e3e252768e4` baseline gate passed.                                                                                                                                                                                                             |
| AUTH-001               | All 9 credential-backed Auth0 functional and documentation integration tests passed on `e3e252768e4`, followed by exact Neon branch deletion and container cleanup.                                                                                                                                                                                                                       |
| OPS-002                | The full functional, documentation, and Auth0 integration runs each captured their owned Neon branch; the exact endpoints returned HTTP 404 after cleanup and no project-labeled containers remained.                                                                                                                                                                                     |
| UX-002                 | Organizer, receipt, user-list, transaction-list, and template-load failures render explicit retryable states; focused coverage and the complete `e3e252768e4` gate passed.                                                                                                                                                                                                                |
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

The original TEST-003 and PROD-002 findings remain open or partial under their
current narrower statements. OPS-001 is resolved by the binding stored/read-only
exhausted-email scope.

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
map. The validated `e3e252768e4` baseline collected 46 documentation tests from
the then-current documentation sources. List-only collection on the dirty next
candidate reports 49 tests in 30 files for `docs-baseline` and 9 tests in 4 files
for `docs-integration`. Each project count includes the shared seven setup tests;
the combined selection deduplicates those dependencies and reports 51 tests in
31 files. That is 42 baseline documentation journeys plus two credential-gated
documentation journeys: Auth0 account creation and the new required Google Maps
flow. The 49-test baseline documentation project and 11-test credential-backed
integration selection are candidate-green. The complete clean exact-commit gate
and a repeat of that integration run remain required. This ledger remains the
source of truth for release gaps; the inventory does not waive the open rows
above.

## Recorded decisions and accepted deferrals

### Decisions that remain binding

- Server Effect authorization is authoritative; no RLS layer is planned.
- A transfer is one inseparable registration/add-on bundle. Guest and add-on
  quantities plus check-in/fulfillment history transfer unchanged; the recipient
  cannot omit bundle contents. Current base prices and recipient discounts set
  the independent recipient payment, while every original Stripe source is
  refunded exactly. Database-only completion is allowed only for an entirely
  free bundle with no refund obligation.
- Paid event registrations and add-ons are Stripe-only. Without a connected
  tenant Stripe account, their configuration and execution must remain free.
- Customer-facing email templates use React Email and the transactional outbox.
- Exhausted outbox rows remain stored/read-only; no recovery action is required.
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
- Live ESNcard active-card add/refresh/remove, permanently expired-card status,
  and provider-error verification is a release gate, not an optional skipped
  project.
- Google Maps is required production functionality and needs live provider
  evidence. Cloudflare Images is being removed and is not a release gate.
- Templates and events own independent simple/advanced registration graphs;
  event creation snapshots the template and later template edits do not rewrite
  the event.

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

1. Finish the cancellation/refund candidate, create a local candidate commit,
   and require a clean worktree. Run the complete local gate on that exact
   commit. If any failure requires an edit, amend or create a new local candidate
   commit and rerun the entire gate from the start. Do not push or trigger CI
   until the clean exact-commit run is fully green with zero incomplete outcomes.
2. Promote DOC-001 from Candidate to Resolved only after that complete local
   gate. Keep live Stripe settlement evidence separate from the deterministic
   signed-webhook product guide.
3. Complete runtime and full-gate proof for the binding fixed-bundle transfer
   contract: unchanged
   guest/add-on quantities and fulfillment history, current recipient pricing,
   exact multi-source Stripe refunds, and database-only completion solely for a
   completely free/no-refund bundle.
4. Complete runtime and full-gate proof for Stripe-only paid event/add-on
   configuration and execution, including Stripe disconnection and database
   constraints.
5. Prove waitlist email delivery into a recipient inbox and the recipient's
   follow-up registration path. Keep the now page-backed unknown-domain scanner
   recovery guide current.
6. Repeat the now-green credential-backed Google Maps and Auth0 integration
   journeys on the final clean exact commit. Validate the candidate's Cloudflare
   Images removal without disturbing receipt object storage.
7. Complete the remaining authenticated in-app Browser queue at desktop and
   compact widths. Scanner camera and result integration already have
   deterministic Playwright coverage. Convert any newly discovered defect into
   Playwright/docs coverage.
8. Provision and approve the live ESNcard environment with protected active and
   permanently expired identifier secrets, execute exact-candidate certification,
   approve production legal text, require the verified checks and review policy
   on `main`, and replace the Knope placeholder with tested version, changelog,
   and GitHub-release automation. Keep deployment work in its separate change.
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
`e3e252768e49a7fc23bd67f0f6174184dd71feb3`:

| Suite                              |    Passed | Incomplete outcomes |
| ---------------------------------- | --------: | ------------------: |
| Server/helper Vitest               |       933 |                   0 |
| Angular/shared Vitest              |       594 |                   0 |
| PostgreSQL 17 integration          |        35 |                   0 |
| Functional Playwright baseline     |       150 |                   0 |
| Generated-documentation Playwright |        46 |                   0 |
| **Total**                          | **1,758** |               **0** |

Frozen dependency installation, Knope validation, formatting, lint/clean-tree
check, and the production application build also passed. The exact functional
and documentation Neon branches returned HTTP 404 after teardown and no
project-labeled containers remained.

The credential-backed integration projects are intentionally separate from the
1,758 baseline total. On the same exact commit, `bun run test:e2e:integration`
passed 9/9 Auth0 functional and documentation tests with zero incomplete
outcomes. Its exact Neon branch also returned HTTP 404 after cleanup.

### Validated-baseline CI confirmation

The previous pushed baseline `399fd1ed429` has green GitHub results for CodeQL analysis and
aggregate, CodeRabbit, Git Town, Knope/change files, PostgreSQL integration, and
lint/unit/build. The aggregate Playwright E2E job also completed green after
recording all 149 functional and 46 documentation tests. CI confirms an
already-green local baseline and does not close REL-001 until GitHub requires the
checks. It does not validate local baseline `e3e252768e4` or the next local
candidate, and no new CI run may be attempted before the new exact candidate is
entirely green locally.

### Current working-tree candidate

The next candidate contains changes after `e3e252768e4`. Cancelled Profile cards
now retain refund-bearing registrations and show participant-safe lifecycle,
source, amount, and recovery guidance. Platform finance exposes only a safe
summary of refund lifecycle and retry progress, including provider-action and
stopped states. Paid add-on cancellation refuses to mutate fulfillment or
inventory when the selected payment lot lacks a reconciled source or allocation.
The generated guide executes included and paid fulfillment, exact cancellation
allocation, signed failure, terminal attention, audited requeue, signed success,
Profile, and direct scanner-result states.

The complete working-tree candidate passed the following unfiltered local gate:

| Suite                              |    Passed | Incomplete outcomes |
| ---------------------------------- | --------: | ------------------: |
| Server/helper Vitest               |     1,128 |                   0 |
| Angular/shared Vitest              |       644 |                   0 |
| PostgreSQL 17 integration          |        48 |                   0 |
| Functional Playwright baseline     |       150 |                   0 |
| Generated-documentation Playwright |        49 |                   0 |
| **Total**                          | **2,019** |               **0** |

The production build, lint, formatting, and diff checks are green. The separate
credential-backed integration project passed 11/11 with both Google Maps
journeys. Live ESNcard release certification passed a complete 28-test Profile
precheck and all 8 active/expired Playwright dependency/provider tests. The functional,
documentation, provider, and live-provider Compose wrappers removed their exact
owned project containers and networks.

This is strong candidate evidence, but it is not yet exact-commit evidence: the
tree remains uncommitted. Before any push or CI-triggering action, create the
candidate commit and repeat the entire affected local gate on that clean exact
commit. If validation causes another edit, recommit and restart that gate.

Focused next-candidate evidence is green but is not a release total:

| Focused run                                      | Passed | Incomplete outcomes |
| ------------------------------------------------ | -----: | ------------------: |
| Cancellation/refund server and source coverage   |     87 |                   0 |
| Cancellation/refund Angular and shared contracts |    106 |                   0 |
| Paid add-on PostgreSQL success/no-write boundary |      5 |                   0 |
| Page-backed cancellation documentation           |     12 |                   0 |
| Transfer/provider documentation source guards    |     25 |                   0 |

The focused generated guide initially exposed one literal copy mismatch after
the product wording became more explicit. The assertion now follows the visible
copy and the two complete focused files pass 12/12. The production application
build also passes. The current in-app Browser pass opened the rebuilt host-run
candidate at desktop and 390×844 with no console warning or error, but it
predates the final provider-action/stopped-state refinements. The focused
PostgreSQL and documentation runs used disposable branch
`br-lucky-thunder-a9msks8n` (expiry `2026-07-12T13:17:12Z`); teardown deleted it,
its exact API lookup returned HTTP 404, and it was absent from the project branch
list. Only the complete clean-commit gate and a post-edit Browser refresh can
validate the slice for push and release evidence.

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
create-from-template recovery, and the current public paid event detail at
desktop and compact widths. It does not constitute the complete six-area Browser
queue. Scanner simulation and deterministic result evidence are recorded
separately above.

### Explicitly not claimed

- The current 11/11 Auth0/Google Maps integration result belongs to the dirty
  candidate, not a final clean exact commit.
- Cloudflare Images removal passed the working-tree gate, but not an exact-commit
  rerun. No live Cloudflare Images evidence is required because the provider is
  not production scope or a release gate.
- Google Maps live loader/search/place-details verification is recorded for the
  dirty candidate, but not yet for a final clean exact commit.
- Local live ESNcard certification is green, but no protected GitHub environment,
  reviewer policy, or exact-release-commit run is recorded.
- No authenticated six-area in-app Browser walkthrough is recorded.
- No physical-device camera certification is claimed; the accepted candidate
  integration evidence uses deterministic Playwright camera and result journeys.
- No production legal approval is recorded.
- No required-check/review/thread-resolution policy is configured on `main`.
- No real Knope version/changelog/GitHub-release action has replaced the release
  placeholder. Deployment work exists separately.
- No clean exact-commit local gate is recorded for the candidate.

These are open release-evidence or policy items, not skipped tests and not implied
by the 2,019-test working-tree result. Google Maps is required production
functionality and therefore requires approved live-provider evidence.
Cloudflare Images is being removed and is not a release gate.
