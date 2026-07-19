# Application Production-Readiness Compliance Ledger

Ledger updated: 2026-07-17

Last fully validated functional baseline: `codex/production-readiness-compliance` at
`77b5825492112f89f8a32d99400cf9c2a0563136`

Current Scaleway migration candidate: this branch's ledger-bearing working tree.
Its exact commit and complete zero-incomplete-outcome gate are recorded only
after the migration changes are committed and rerun; the historical counts below
must not be attributed to the uncommitted migration candidate.

`origin/main` at that validation point:
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`
(`0` commits behind)

A fresh fetch at the start of migration implementation confirmed that this branch was `0`
commits behind `origin/main` at
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`. The last fully validated baseline
contains sealed fixed-bundle transfer pricing, composite ownership constraints,
exact Stripe refund identity validation, fail-closed legacy-import preflight,
tenant-safe UI state, settled discount-provider save gates, env-key-only
protected test input, and supervised Docker build/up/teardown.

Local verification passes 1,360/1,360 server/helper tests, 799/799
Angular/shared tests, 55/55 disposable PostgreSQL 17 tests, 150/150 functional
Playwright tests, 52/52 documentation Playwright tests, 11/11 Auth0/Google Maps
integration tests, 27/27 live ESNcard unit tests, and 9/9 live ESNcard
Playwright tests. All recorded suites have zero skips, todos, fixmes, expected
failures, retries, flakes, focused tests, interrupted tests, or other incomplete
outcomes. Formatting, lint, the production build, and 19/19 Docker lifecycle
tests also pass. Every Docker-backed run left zero project-labeled containers,
networks, and volumes. Those counts remain historical evidence for the
functional baseline. The Scaleway runtime, provider, infrastructure, and
delivery changes require their own complete local record before any
CI-triggering action.

Draft review: [PR #91](https://github.com/evorto-app/app/pull/91)

Scope: application, server/runtime, data layer, shared contracts, tests,
generated product documentation, repository-owned CI, and externally configured
release gates.

## Release decision

**Not yet ready to declare a complete production replacement.**

The original audit's broad application findings are mostly remediated. Last
fully validated functional baseline `77b58254921` is locally green across the
application, server/helper, PostgreSQL, functional, documentation, Auth0/Google
Maps, and active/expired live ESNcard gates. Organizer/helper signup,
fixed-bundle transfer, Stripe-only paid configuration, fail-closed receipt
evidence/loading, cancellation/refund recovery, locked stale-state checks,
tenant isolation, and owned Docker cleanup are proven against that source tree.

The application is nevertheless not ready to be declared the production
replacement. The Scaleway staging-first migration is now implemented in source:
one immutable image starts as web/worker/ops, Terraform defines private
PostgreSQL 17, registry, buckets, IAM, Secret Manager metadata, Cockpit,
containers and CRON triggers, and protected workflows define exact-digest
staging deployment plus disabled production promotion. It is not yet provisioned
or externally accepted. The next release phase is to bootstrap and deploy
`staging.evorto.app`, execute restore/drift/rollback drills, and complete the
authenticated desktop/compact manual Browser acceptance pass there. Any defect
found must be fixed, covered durably where
practical, and retested locally before a CI-triggering action. Fly-related work
is no longer a parallel dependency: the legacy Fly app, workflow, token, and
tracked configuration were retired before the Scaleway staging cutover.

Legacy data migration is not a prerequisite for functional completion. MIG-001
is an accepted sequencing decision: after the new staging environment is
functionally accepted, plan the legacy import as a separate best-effort effort
with explicit supported scope, exclusions, reconciliation, and rollback/cutover
criteria. The existing direct-schema importer must continue to fail closed
before destructive work when unsupported history is present. Until that later
plan is executed, no claim is made that historical registration, payment,
add-on, fulfillment, reimbursement, or submitted-answer data can be migrated
without loss.

Other remaining release gates are external or operational: rotate and safely
provision the six historical Auth0 E2E credentials, protect the live ESNcard
release environment, publish and build the real Pages documentation artifact,
prove live Scaleway Transactional Email delivery and DNS health, approve
production legal content, configure the
chosen `main` protection policy, and prove the first exact-tag release. Google
Maps remains required production functionality. Cloudflare Images is removed
and is not a release gate.

## Scaleway migration status

Implemented in the current candidate:

- staging-only default provisioning in `fr-par`, with production absent behind
  `production_enabled = false` and `PRODUCTION_ENABLED != true`;
- a single Linux/amd64 image with isolated public web, private bounded worker,
  and private bounded ops roles;
- DB-free health, configured-host behavioral readiness, immutable version
  identity, real-Host tenant resolution, platform-boundary proxy trust, and a
  bounded/redacted browser-error intake;
- plain PostgreSQL 17 locally and managed private PostgreSQL 17 in Terraform,
  verified TLS, bounded pools, separate runtime/schema users, and no RLS;
- generic Effect ObjectStorage with Scaleway S3, MinIO, and fake providers plus
  signed receipt upload/finalize/consume/orphan state;
- generic Effect EmailDelivery with TEM, Mailpit, and fake providers plus
  terminal `deliveryUnknown` and staging `suppressed` states;
- Cockpit OTLP traces, structured release-aware logs, private source-map export,
  SBOM/vulnerability/image-size checks, role-scoped secret reconciliation, and
  append-only deployment manifests;
- exact-SHA release gates, safe schema explain/apply, same-digest worker/web
  deploy, smoke verification, prior-digest image rollback, and a production
  workflow that cannot provision while disabled; and
- operator runbooks for bootstrap, DNS/email, rotation, restore, drift,
  rollback, and full staging Browser acceptance.

Not yet evidenced: a real Scaleway apply, DNS/TEM verification, staging restore,
drift and rollback drills, live alert delivery, exact staged revision/digest
proof, or the staged Browser queue. Production resources and traffic remain
disabled. These are explicit external acceptance gates, not skipped tests.

## How to read this ledger

| Status                | Meaning                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Open**              | Required product behavior or evidence is absent.                                                            |
| **Partial**           | The original failure is substantially remediated, but a narrower release-relevant gap remains.              |
| **External**          | Repository work is present, but completion needs credentials, infrastructure policy, legal approval, or UI. |
| **Candidate**         | Implementation exists, but a named release artifact or external proof is still pending.                     |
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

| ID           | Severity | Status            | Area                    | Remaining work                                                                                                                                                                              |
| ------------ | -------- | ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-002     | P1       | Resolved          | Paid transfer           | Fixed-bundle provenance, validity/bounds, refund identity, and recipient-owned question handling pass PostgreSQL, functional, and documentation coverage.                                   |
| PROD-003     | P1       | Resolved          | Organizer signup        | Signup, exclusivity, capability, access, profile, cancellation, docs, and the complete baseline gate are green.                                                                             |
| SEC-003      | P1       | Resolved          | Receipt evidence        | Upload/finalization/approval fail closed on exact retrievable evidence; focused and complete baseline gates are green.                                                                      |
| DOC-001      | P1       | Resolved          | Cancellation/refund     | The Stripe/add-on/refund-state guide passed the complete local implementation gate.                                                                                                         |
| ESN-001      | P1       | External          | Live ESNcard            | Current active/expired certification passed 27/27 unit and 9/9 Playwright checks; the protected GitHub environment and secret policy remain absent.                                         |
| AUTH-001     | P1       | Resolved          | Auth0 integration       | The credential-backed provider suite passed 11/11 with zero incomplete outcomes on the unified implementation baseline.                                                                     |
| AUTH-002     | P1       | External          | E2E credentials         | Plaintext passwords are removed and auth traces disabled; rotate all six historical passwords and provision local/protected secret values.                                                  |
| AUTH-003     | P2       | Open              | CI identity custody     | Do not give long-lived Auth0 passwords to PR-controlled code; choose an approved trusted workflow or ephemeral-account design before CI provisioning.                                       |
| MIG-001      | P1       | Accepted deferral | Legacy migration        | Plan best-effort legacy import only after functional completion and staging acceptance; retain fail-closed preflight and document supported scope, exclusions, reconciliation, and cutover. |
| PROVIDER-001 | P1       | Resolved          | Google Maps             | The current Auth0/Google Maps integration selection passed 11/11 with zero skips, retries, flakes, or other incomplete outcomes.                                                            |
| REL-001      | P1       | Candidate         | Release automation      | Knope draft preparation and exact-tag certified publication are implemented; a regenerated first release remains unproven.                                                                  |
| REL-002      | P1       | External          | Main enforcement        | `main` still requires no checks, approval, or thread resolution; the one-seat review/bypass policy needs an explicit owner decision.                                                        |
| HOST-001     | P1       | Candidate         | Scaleway implementation | Runtime roles, Terraform, deployment workflows, providers, local stack, security/image gates, and runbooks are implemented; the new exact-commit local gate is pending.                     |
| HOST-002     | P1       | External          | Scaleway acceptance     | Bootstrap/provision staging, configure DNS/TEM, prove restore/drift/rollback/alerts/revision identity, and complete the staged Browser checklist.                                           |
| BROWSER-001  | P1       | Partial           | Manual acceptance       | Local exploratory slices are recorded; complete authenticated desktop/compact acceptance is intentionally sequenced to the new-provider staging environment.                                |
| LEGAL-001    | P1       | External          | Legal content           | Legal/privacy settings are implemented, but production text and policy approval are not recorded.                                                                                           |
| OPS-001      | P2       | Resolved          | Email outbox            | Leased delivery is crash-safe; exhausted mail intentionally remains stored and read-only with no recovery action.                                                                           |
| OPS-002      | P2       | Resolved          | Local PostgreSQL        | Neon Local plumbing is removed; pinned plain PostgreSQL 17 now uses isolated loopback ports/volumes, guarded reset, resumable initialized state, and disposable Playwright teardown.        |
| OPS-003      | P2       | Resolved          | Local containers        | Process-group teardown passes 19/19; every Docker-backed suite ended with zero project-labeled containers, networks, and volumes.                                                           |
| UX-002       | P2       | Resolved          | Load recovery           | Event, participant, and receipt query failures fail closed with explicit retry; the complete baseline gate is green.                                                                        |
| UX-004       | P2       | Resolved          | Cancellation safety     | Expected-state RPC/locked checks and no-write tests passed focused and complete baseline gates.                                                                                             |
| DOC-002      | P2       | Resolved          | Product docs            | The complete documentation baseline passed 52/52 with zero incomplete outcomes; live inbox acceptance remains separately tracked under EMAIL-001.                                           |
| DOC-003      | P1       | Candidate         | Generated publication   | Separate docs/provider/live runtime inputs are green; the combined publisher and real Pages synchronization/build remain.                                                                   |
| EMAIL-001    | P1       | External          | Live email acceptance   | TEM/Mailpit/fake delivery and terminal unknown/suppressed states are implemented; DNS health and live allowlisted TEM delivery to an owned inbox remain unproven.                           |

MIG-001 is not a blocker to functional completion or new-provider staging. It is
an accepted post-completion planning item and must not be represented as a
completed or lossless migration. The open, partial, external, and candidate P1
rows above still prevent a production-replacement declaration.

## Active finding details

### PROD-002 — Fixed-bundle transfer is implementation-baseline green

The original audit covered private offer credentials, recipient eligibility,
recipient Stripe Checkout, connected-account ownership, source cancellation, a
single persisted source-refund obligation, terminal refund failure, and operator
requeue. Functional and generated-doc coverage still retains that historical
path in
[`tests/specs/events/registration-transfer.spec.ts`](tests/specs/events/registration-transfer.spec.ts)
and
[`tests/docs/events/registration-transfer.doc.ts`](tests/docs/events/registration-transfer.doc.ts).

The exact validated baseline has since moved to the binding product contract:

- the registration, guest quantity, every included/free/purchased add-on
  quantity, and all check-in/fulfillment history form one inseparable bundle;
- the recipient cannot omit, replace, or re-quantity any settled bundle item;
- recipient pricing starts from current base prices for that fixed bundle and
  applies only the recipient's current eligible discounts; source-user discounts
  do not transfer;
- the recipient payment is calculated independently from source refunds;
- each original Stripe registration and purchased-add-on payment is refunded for
  its exact remaining refundable amount after prior successful refunds; and
- database-only completion is allowed only when the whole bundle is free and no
  source refund is required.

Paid registration and add-on transactions are Stripe-only. A tenant without a
connected Stripe account may offer only free registration options and free
add-ons; cash, bank-transfer, manually settled, or otherwise non-Stripe paid
event sources are unsupported, not an undecided transfer branch.

Unified baseline `77b58254921` models an in-place ownership handoff: one confirmed
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

The acquisition schema and finalization API have stabilized. The implementation
checks the complete recipient discount validity window, bounds derived
amounts before PostgreSQL writes, and freezes current base-price, recipient-
discount, and fixed add-on totals once recipient Checkout begins. It validates a
metadata-less provider refund against exact connected-account and payment
identity, makes a terminal identity mismatch non-retryable, and enforces full
tenant/event/registration owner tuples for the source registration and every
transferred answer. The complete server/helper suite passes 1,360/1,360 with
zero incomplete outcomes. Current PostgreSQL coverage passes 55/55, functional
Playwright passes 150/150, and the documentation baseline passes 52/52. The old
separately-paid-add-on rejection and source-cancellation model are historical
evidence of the gap, not acceptable final behavior.

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
local implementation gate is also green, so PROD-003 is resolved.

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
documentation evidence and the complete local implementation gate are green, so
SEC-003 is resolved.

### DOC-001 — Cancellation and refund documentation is resolved

The validated baseline added
[`tests/docs/events/registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
and links it from the maintained inventory. That baseline also removed the old
paid-cash/manual-refund example because paid event sources are Stripe-only.
The retained ordinary-cancellation journey covers a free confirmed registration,
participant deadline denial, organizer cancellation, guest-capacity release,
cancellation and waitlist email creation, persisted readback, the visible
confirmation flow, and the resulting Profile state.

The implementation adds a second page-backed beginner journey for a confirmed
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
outcomes, and the complete 49-test documentation project is green on that exact
commit. DOC-001 is resolved. The deterministic signed-webhook journey
validates our handler and product behavior; it is not a claim of live Stripe
network or bank settlement. Cross-tenant and permission denial remain supported
by server coverage and policy text rather than a second Browser journey. Keep
deterministic database readback and literal recovery language: a queued Stripe
refund claim must never be documented as money already returned.

The unified implementation extends the free-cancellation guide through the recipient
side of the waitlist message. It opens the exact event path rendered into the
queued email under the waitlisted account, proves that the message did not
reserve capacity, leaves the old waitlist row through its focused confirmation,
registers while capacity remains, and reads back the cancelled waitlist row, new
confirmed registration, counters, and confirmation email. This closes the
source-addressable beginner follow-up gap. Real TEM delivery from the verified
`notifications.evorto.app` domain to an allowlisted owned inbox is external
acceptance evidence and is not claimed by the deterministic outbox journey.

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

On 2026-07-16 the unified implementation baseline release command passed its complete 27-test
Profile precheck and all 9 live Playwright tests with zero skips, retries,
flakes, or other incomplete outcomes. The protected-value sanitizer remained
active and post-run inspection found no project-labeled containers, networks,
or volumes.

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
On 2026-07-16 unified implementation baseline `77b58254921`,
`bun run test:e2e:integration` passed all 11 Auth0/Google Maps functional and
documentation tests with zero incomplete outcomes and a clean container
teardown. Repeat the same credential-backed suite on any later release commit;
missing credentials remain a local blocker rather than a skip.

### AUTH-002 — Tracked E2E passwords require rotation

The six long-lived Auth0 Playwright account passwords were stored as literals in
[`helpers/user-data.ts`](helpers/user-data.ts) on both `origin/main` and the
historical baseline. The unified implementation removes every password value from the
tracked account matrix, resolves one dedicated environment variable per account
only when the authentication setup submits the login form, and fails closed when
any value is absent or blank. The authentication setup project disables traces,
screenshots, and video so retries cannot upload a password-filled Auth0 action.
Baseline and provider workflows now validate and map the six explicit secrets;
the documentation publisher validates them before starting authenticated
projects. Source/runtime coverage and the complete 1,360-test server/helper
suite are green.

Removing the literals from the current tree does not remove them from Git
history. Treat all six historical values as compromised: rotate every Auth0 test
account password and add only the rotated values to the ignored local `.env` for
the next authenticated local run. No old password was copied into `.env`, and no
password value is recorded in this ledger.

For the current local verification only, the six historical literals were read
from the merge-base test source and injected directly into the Playwright child
process. They were not written to `.env`, a tracked file, a report, or this
ledger. The protected-value reporter now redacts live output before forwarding
it and fails closed when an attachment cannot be inspected. Protected input is
enabled only when every reporter-looking command-line candidate is an approved
sanitizer-first chain and any additive `PW_TEST_REPORTER` sink is separately
allowlisted. Ambiguous raw arguments, including reporter text after `--` or as
another option's value, fail closed so a safe-looking token cannot mask an
unsafe persistent reporter. This enables local diagnosis without changing the
binding requirement to rotate every historical value before release use.

Do not provision the six values as repository-level Actions secrets yet. The
baseline workflow executes pull-request-controlled application and test code, so
a same-repository writer or compromised writer could extract any long-lived
password exposed to that job. Before CI provisioning, choose and implement an
independently approved trusted-workflow boundary or short-lived, disposable
Auth0 test accounts. The protected-main provider workflow is separately guarded
in source, but its referenced GitHub environment must also exist with reviewers
and a deployment-branch policy before it receives credentials.

### MIG-001 — Legacy migration is sequenced after functional completion

The relaunch intentionally targets the current Drizzle schema directly; it does
not mutate the legacy schema or add an application compatibility layer. The
TypeScript ETL requires separate source and target PostgreSQL databases and
fails closed before destructive cutover unless the operator explicitly selects
all features, all tenants, target clearing, and the direct-schema confirmation.

That guard is not a completed migration. The current importer deliberately
blocks any source tenant containing registrations, transactions, purchased
product lines, collected fees, costs, receipts, or event-submission items because
registration/payment/refund history, add-on quantities, acquisition snapshots,
fulfillment history, reimbursements, and submitted answers are not yet imported
and reconciled.

The binding sequence is now explicit: finish the application, deploy it to the
new-provider staging environment, and complete manual Browser acceptance first.
Only then create a separate best-effort legacy migration plan. That plan must
name the supported source scope and exclusions, reconciliation checks,
Stripe-provenance constraints, rollback strategy, and whether any maintenance
window or cutover is justified. Functional completion does not depend on that
later plan, and no lossless legacy replacement is claimed in the meantime. See
[`migration/README.md`](migration/README.md) and
[`migration/cutover-guard.ts`](migration/cutover-guard.ts).

### PROVIDER-001 — Google Maps verification passed

Google Maps location search and place details are required production
functionality. Unit coverage validates configuration plus initialization,
search, empty-result, and error mapping in
[`src/server/config/server-config.spec.ts`](src/server/config/server-config.spec.ts)
and [`src/app/core/location-search.spec.ts`](src/app/core/location-search.spec.ts),
and the unified baseline includes credential-gated Playwright journeys in
[`tests/specs/admin/google-maps-location.spec.ts`](tests/specs/admin/google-maps-location.spec.ts)
and
[`tests/docs/admin/google-maps-location.doc.ts`](tests/docs/admin/google-maps-location.doc.ts).
They are collected by both integration projects and exercise the live loader,
autocomplete/search, place details and coordinates, persisted readback, and the
beginner operator flow. The validated reusable release workflow now validates
Auth0 Management and Google Maps credentials and runs the canonical integration
projects before the unchanged live ESNcard certification; both Maps journeys
have 90-second provider timeouts. The hardened workflow validates required
values before checkout/setup, keeps provider/database secrets out of job-level
environment, pins external actions to reviewed commit SHAs, and accepts only an
explicit reusable-workflow secret allowlist. The same validated baseline pins every
repository-owned workflow action and adds a
source guard that rejects mutable external refs or secrets in broad
workflow/job environment blocks; baseline and PR workflows now inject secrets
only into their validation/install/runtime steps.

The worktree now resolves `PUBLIC_GOOGLE_MAPS_API_KEY` from the developer's
untracked local secret without exposing the value. The first credential-backed
attempt exposed a deterministic-clock defect: freezing `Date.now()` prevented
the debounced Places request from ever becoming due. The validated baseline now keeps a
fixed test epoch while allowing elapsed time to advance, keeps the input value
independent of Signal Forms' delayed control writeback, and retains redacted
failure traces for the two provider journeys. The focused location-dialog suite
passed 8/8 and the canonical `bun run test:e2e:integration` run passed 11/11,
including live Maps loader, autocomplete, place details, persisted coordinates,
and both the functional and generated-documentation journeys, with zero skips
or retries. The focused Google Maps rerun passed 8/8 with zero skips, retries,
or flakes after adding the hydration wait. Unified implementation baseline
`77b58254921` then passed the complete canonical 11-test Auth0/Google Maps
provider selection with zero skips, retries, flakes, or other incomplete
outcomes. Production provider
provisioning remains an out-of-band deployment requirement.

Cloudflare Images is not production scope or a release gate. The implementation
removed its editor upload RPC, configuration, handler, integration,
cleanup tooling, dependencies, Compose variables, and test-gate language while
preserving the separate S3-compatible receipt/object-storage boundary. The
provider-scope source guard passes 2/2. Any dormant external
`CLOUDFLARE_IMAGES_API_TOKEN` secret may be removed after confirming no external
consumer. Cloudflare R2 credentials are also outside the new runtime; Scaleway
S3 role credentials replace them through protected deployment secrets.

### REL-001 / REL-002 — Release automation is candidate; enforcement is external

Repository-owned quality workflows now run Knope/change-file validation,
PostgreSQL 17 integration tests, lint, server and Angular unit suites, the build,
functional Playwright, and generated docs. See
[`.github/workflows/pr-quality.yml`](.github/workflows/pr-quality.yml) and
[`.github/workflows/e2e-baseline.yml`](.github/workflows/e2e-baseline.yml).

External inspection on 2026-07-13 found GitHub ruleset
[`13125535`](https://github.com/evorto-app/app/settings/rules/13125535) active for
the default branch. It protects linear history and destructive updates and
enforces squash-only pull requests, but it does not require the quality/E2E/
security checks, an approving review, or resolved review threads. The
organization currently reports one occupied seat and the ruleset grants an
always-allowed repository-role bypass, so a required human approval cannot be
enabled mechanically without deciding reviewer/team ownership and bypass
policy. Configure and verify the chosen requirements in GitHub rather than
inferring them from workflow YAML.

The legacy Fly deployment is retired. The `evorto` app was destroyed after
confirming it had no volumes or managed PostgreSQL cluster, the GitHub workflow
was disabled and removed, and the Fly deployment token was deleted. Scaleway is
the only application hosting path defined by this repository. The legacy
Cloudflare A, AAAA, and ACME records for `alpha.evorto.app` were removed on
2026-07-19 after preserving a zone export. Alpha intentionally has no DNS record
while production remains disabled.

The unified implementation removes the release placeholder. Knope now uses
regex-backed package versioning, single-package `default` change files, and an
empty asset list so Knope Bot prepares a reviewable version/changelog update and
draft GitHub release. After the `knope/release` pull request merges,
[`release.yml`](.github/workflows/release.yml) runs provider certification,
requires a semver package version and matching changelog section, verifies that
the non-prerelease draft's `v<version>` tag points to the exact merge commit, and
only then publishes it with job-scoped `contents: write`.

This is Candidate source behavior, not release evidence. Open PR #60 predates
the repair, drops the final `package.json` newline, and has only four checks; do
not merge it as-is. Before release, require Knope Bot to regenerate
that pull request, inspect its version/changelog/draft, repeat the exact local
and provider gates, and verify the first certified tag and published release.

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
cover the final wording, including transient retry and stale-template restart.
This is meaningful exploratory slice evidence, not a complete pass through every
state, destructive mutation, or remaining application area.

The cancellation/refund candidate was reopened against the current host-run app
at desktop and 390×844. Signed-out event discovery, a paid event detail, pricing,
login guidance, compact navigation, and the direct event route rendered without
console warning or error. Authenticated Profile, platform finance, and scanner
result states are page-backed in the focused 12/12 generated guides; they remain
Playwright rather than in-app Browser evidence because the in-app Browser has no
authenticated Auth0 handoff for the test identities.

The unified implementation was also opened from its isolated Compose
runtime at desktop and 320×800. The signed-out Events list and a seeded event
detail rendered the registration option and explicit login requirement. At 320
CSS pixels the document, body, and bottom navigation each measured exactly 320
pixels wide, with no horizontal overflow, and Browser diagnostics contained no
warning or error. This local slice proves signed-out discovery and
two-destination compact navigation; it does not stand in for the blocked
authenticated five-destination navigation review.

The remaining manual queue is intentionally deferred to the new hosting
provider's staging environment, where deployment configuration, routing,
provider connectivity, and the actual staged build can be accepted together.
There is still no recorded complete staged pass through:

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
hardware certification. The broader manual Browser queue above remains open
until the new staging environment exists.

### LEGAL-001 — Legal approval is outside automated proof

Tenant-hosted legal/privacy fields and routes have implementation and test
coverage. Production readiness still requires an authorized owner to approve
the actual terms, privacy text, re-acceptance policy, company/controller details,
and jurisdiction-specific obligations. Record the approved version and effective
date; a passing UI test proves rendering and persistence, not legal sufficiency.
The current local Browser route explicitly identifies its text as development
and test tenant content that must not be used as production legal text.

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

### OPS-002 — Plain PostgreSQL replaces Neon Local

The current candidate removes the Neon API, proxy, branch-expiration helper,
metadata volume, and `NEON_*` runtime contract. Docker Compose instead pins
PostgreSQL 17 with a worktree-isolated loopback port and project volume. A
one-shot setup service drops/recreates only the guarded local `public` schema,
applies Drizzle, and seeds deterministic data.

`docker:resume` refuses missing or unsuccessfully initialized stacks and starts
only the retained PostgreSQL, MinIO, Mailpit, Stripe, worker, and web container
IDs without rerunning setup. Playwright's disposable wrapper refuses an existing
database container, supervises the stack, and removes its project containers,
network, and volumes on exit. PostgreSQL integration tests accept only the exact
loopback `evorto_postgres_integration` database with an explicit disposable
flag; remote databases are rejected before reset. The older exact Neon branch
deletion evidence remains historical only and is no longer an operational
requirement or dependency.

### OPS-003 — Local Compose teardown is runtime-validated

The unified implementation fixes a cleanup lock inversion discovered when Playwright
timed out during web-server startup: the wrapper previously attempted `compose
down` while its foreground `compose up` process could still hold the project
lock. Compose build and startup now run in a detached supervised process group,
cleanup applies a bounded TERM/KILL sequence to the complete group, waits for it
to exit, and only then performs verified project-scoped teardown. Build and
startup are separate commands, and the Playwright startup allowance matches
CI's 12-minute build plus 5-minute startup bounds. Ordinary Compose starts no
longer force Playwright runtime mode, while Playwright-owned and CI starts opt in
explicitly. Resume starts PostgreSQL, MinIO, and Mailpit first, then Stripe with
its signing-secret healthcheck, and only then worker and web. Historical
lifecycle coverage passes 19/19,
including a TERM-ignoring descendant, termination-before-teardown ordering, and
refusal of retained Stripe containers without the required healthcheck.

After Docker Desktop was reset, the canonical PostgreSQL, functional,
documentation, provider, and live ESNcard suites all completed. Every
Docker-backed run performed project-scoped teardown; post-run inspection found
zero project-labeled containers, networks, and volumes. OPS-003 is therefore
resolved for the unified implementation. Every later release commit must retain
the same teardown proof.

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
generated event-management coverage are present. The complete local
implementation gate is green, so UX-002 is resolved.

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
complete local implementation gate are green, so UX-004 is resolved.

### DOC-002 — Product documentation baseline is runtime-validated

- The validated baseline
  [`registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
  page-backs the capacity-releasing action and proves the **waitlist spot
  available** outbox row, recipient, rendered content, and non-reservation
  wording. Existing
  [`email-outbox-kind-source.spec.ts`](helpers/testing/email-outbox-kind-source.spec.ts)
  coverage also pins its transactional producer. Provider delivery into a real
  recipient inbox remains the separately tracked EMAIL-001 external acceptance
  gap, not an incomplete product-documentation journey.
- Unknown-tenant/domain failure now renders a public, non-indexed 404 recovery
  page. The generated guide opens an unknown-domain scanner-result path, proves
  the explicit no-mutation state, and gives beginner-safe link recovery steps.
- Transfer, cancellation, and event-management guides state the binding
  fixed-bundle and Stripe-only rules. Event approval now separates the creator
  from a review-only account and uses normal **Admin Tools** queue navigation.
  Receipt review now documents exact capabilities, missing-evidence rejection,
  notification readback, and the separate manual reimbursement step.

On 2026-07-16 the complete documentation baseline passed 52/52 with zero skips,
retries, flakes, or other incomplete outcomes. DOC-002 is resolved for the
unified implementation; publication remains separately tracked under DOC-003.

### DOC-003 — Generated publication is aligned with the tracked consumer

The local developer `.env` intentionally points documentation output at the
documentation-site checkout. Previously every non-list Playwright invocation
emptied that location before it knew which documentation project was selected.
Running `docs-integration` after `docs-baseline` therefore erased the baseline
publication and left only the Auth0 and Google Maps pages.

All non-publishing package scripts now force ignored `test-results/docs` paths.
The `bun run test:e2e:docs:publish` command runs `docs-baseline`,
`docs-integration`, and `docs-live-esncard` together into staging, and the
reporter fails a selected documentation group that produces no
product-documentation attachment. Combined list discovery reports 55 tests in
32 files: seven shared setup tests, 45 baseline journeys, two Auth0/Maps
integration journeys, and one secret-safe active/expired live ESNcard journey.

The current external artifact still contains only two pages, but the source
contract is repaired. Publication no longer hard-codes or directly replaces a
developer checkout. `EVORTO_PAGES_ROOT` must identify a current tracked Pages
checkout containing `apps/documentation-page` and the authoritative
`tools/docs/sync-generated-docs.mjs` consumer. The publisher maps every current
generated page into that consumer's fixed 13-guide lifecycle catalog, emits
`docs-tests.bundle/v1alpha1` and
`docs-tests.output-manifest/v1alpha1` inventories with SHA-256 integrity, and
fails before synchronization if a guide is new, renamed, missing, or unmapped.
The Pages tool then validates the artifact and performs rollback-backed
replacement of only the generated route and asset trees, preserving curated
content. Before executing that cross-repository tool, the publisher requires a
clean Git repository root, a tracked sync tool and documentation consumer, and
a HEAD matching the configured upstream tip. The consumer subprocess receives
only a minimal non-secret environment; Auth0 passwords, management credentials,
provider identifiers, and Maps, Stripe, database, storage, and email values are
not inherited.

Focused unit/source verification and TypeScript pass, and the exact
artifact produced by the Evorto adapter was accepted by the current
`origin/master` Pages sync implementation against a disposable repository: 13
guides and one fixture asset copied, no real Pages checkout modified. The full
55-test combined runtime generation and real Pages sync/build remain. The
separate 52-test docs baseline, 11-test provider suite, and 9-test
live-provider suite are runtime-green; the remaining gap is the unified
publisher plus real Pages synchronization/build, not Docker recovery.

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
| AUTH-001               | All 9 credential-backed Auth0 functional and documentation integration tests passed on `e3e252768e4`; this remains historical provider evidence while the current plain-PostgreSQL candidate awaits its new exact gate.                                                                                                                                                                   |
| OPS-002                | Plain PostgreSQL 17 replaces Neon Local with guarded loopback-only resets, resumable initialized Compose state, and verified disposable Playwright ownership/teardown.                                                                                                                                                                                                                    |
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
| EFFECT-001, EFFECT-002 | `Schema.Any` is removed from the tenant settings boundary; generic ObjectStorage has Effect-native Scaleway S3/MinIO/fake coverage in [`object-storage.spec.ts`](src/server/integrations/object-storage.spec.ts).                                                                                                                                                                         |

The original TEST-003 gap is covered by the current baseline evidence. PROD-002
is Candidate only for the new validity-window and bounded-arithmetic hardening.
OPS-001 is resolved by the binding stored/read-only exhausted-email scope.

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
map. Unified implementation baseline `77b58254921` passed the 52-test
`docs-baseline` project and the 11-test credential-backed
functional/documentation selection. Combined documentation discovery selects
`docs-baseline`, `docs-integration`,
and `docs-live-esncard` in one run and reports 55 tests in 32 files. That is the
shared seven-test setup, 45 baseline journeys, Auth0 account creation, required
Google Maps, and the secret-safe active/expired ESNcard lifecycle. The separate
runtime selections pass 52/52 documentation baseline tests, 11/11 Auth0/Google
Maps tests, and 9/9 live ESNcard Playwright tests. Rollback-backed combined
publication remains pending. This ledger remains the source of truth for
release gaps; the inventory does not waive the open rows above.

## Recorded decisions and accepted deferrals

### Decisions that remain binding

- Authorization remains server-side in Effect RPC handlers. PostgreSQL RLS is
  intentionally not part of this architecture; composite foreign keys and
  checks are integrity defense in depth, not authorization.
- Paid event registrations and add-ons are Stripe-only. Without a connected
  tenant Stripe account, every registration option and add-on must be free.
- A transfer is one inseparable registration plus included, free, and purchased
  add-on bundle. All quantities and check-in/fulfillment history transfer
  unchanged; the recipient cannot omit or alter bundle contents. Price the fixed
  bundle from current base prices, then apply only the recipient's currently
  eligible discounts; source-user discounts do not transfer. Refund the exact
  remaining refundable amount from every original Stripe payment after prior
  successful refunds, and calculate the recipient's payment independently.
  Database-only completion is allowed only when the complete bundle is free and
  no refund is required.
- The paid-cash cancellation guide is removed and must not return because it
  conflicts with the Stripe-only paid-event rule.
- Customer-facing email templates use React Email and the transactional outbox.
- Exhausted outbox rows remain stored/read-only; no recovery action is required.
- Waitlist availability messages are informative and never reserve capacity.
- The first completed tenant membership becomes the home tenant; privacy-policy
  changes require current required answers and re-acceptance.
- Tenant currencies are EUR, CZK, and AUD; dates use fixed `de-DE` formatting and
  tenant IANA timezone.
- Platform operations require an explicit target, reason, actor, before/after
  state, and append-only audit entry.
- In-app Browser review complements Playwright. For the scanner integration,
  deterministic Playwright camera input plus scan-result journeys are the
  accepted integration evidence; they do not claim physical-device hardware
  certification.
- Live ESNcard active-card add/refresh/remove, permanently expired-card status,
  and provider-error verification is a release gate, not an optional skipped
  project.
- Google Maps is required production functionality and needs live provider
  evidence. Cloudflare Images is removed and is not a release gate.
- Legacy migration is planned only after functional completion and new-staging
  acceptance, on a best-effort basis with explicit supported scope and
  exclusions. The fail-closed importer guard remains binding until then.
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

1. Treat `77b58254921` as the last functionally verified historical baseline,
   not proof for the Scaleway candidate. Commit the unified migration only after
   its complete local application, provider, Terraform, Linux/amd64 image,
   security, and zero-incomplete-outcome gate is green. Do not trigger CI first.
2. Bootstrap the versioned private Terraform state bucket and staging Scaleway
   project, create deployer/role API keys outside Terraform state, protect the
   GitHub environments, and add the emitted CNAME plus TEM SPF/DKIM/MX/DMARC
   records at the retained DNS provider. Keep production disabled; the retired
   Fly deployment must not be restored as an alternate release path.
3. Deploy the exact accepted main digest to `staging.evorto.app`, then prove
   release identity, health/readiness, private database/TLS/user separation,
   alerts, TEM allowlisting, signed receipt uploads, and the documented
   restore/drift/image-rollback drills. Store append-only evidence.
4. Complete the durable
   authenticated desktop/compact Browser queue there. Convert defects into
   fixes and regression coverage, rerun the affected complete local gates, and
   redeploy/retest until staged acceptance is recorded. Scanner camera/result
   integration already has accepted deterministic Playwright coverage.
5. Rotate all six historical Auth0 Playwright passwords and put the rotated
   values in the ignored local `.env`. Do not reuse the values still present in
   Git history. Before any GitHub provisioning, resolve AUTH-003 with a trusted
   workflow or disposable-account design; do not expose the long-lived values
   to pull-request-controlled code.
6. Run the staged documentation publisher from the green implementation and
   an explicit current Pages checkout. Verify the 13 generated guide routes,
   page/image inventory, preserved curated routes/assets, and complete Pages site
   build instead of relying on the current two-page partial artifact.
7. Prove live allowlisted TEM waitlist delivery from the verified
   `notifications.evorto.app` domain into an owned recipient inbox. The
   recipient's in-app leave-and-register follow-up is now deterministic and
   page-backed; keep it and the unknown-domain scanner recovery guide current.
8. Provision and approve the live ESNcard environment with protected active and
   permanently expired identifier secrets, execute exact-commit certification,
   approve production legal text, require the verified checks and review policy
   on `main`, regenerate the stale Knope release pull request, and verify the
   first exact-tag certified draft publication.
9. Only after functional completion and new-staging Browser acceptance, create
   the separate best-effort legacy migration plan. Keep the direct current-schema
   target, separate read-only source, and fail-closed preflight. Define what can
   be imported and reconciled honestly; do not bypass the guard or imply complete
   historical continuity where the source cannot support it.

CI speed work may continue after correctness is preserved—for example, caching
or safe job decomposition—but it is an optimization, not a substitute for any
release gate and must not reduce test collection.

Before any push, PR update, or other CI-triggering action: finish edits, make a
local commit, require a clean worktree, and run the complete local
equivalent of every affected CI suite on that exact commit. Every collected test
must pass with zero incomplete outcomes. If anything changes afterward, amend or
recommit and rerun the complete gate on the new exact commit. Missing services or
credentials are blockers to resolve locally, not reasons to let CI try first.
No push is allowed before that exact-commit run is green. No push or CI run was
attempted during this audit consolidation.

## Validation record

### Last fully validated functional baseline

Commit `77b5825492112f89f8a32d99400cf9c2a0563136` is the last fully validated
functional baseline and predates the current Scaleway migration. It hardens transfer
discount validity and monetary bounds, seals bundle pricing after recipient
Checkout begins, validates exact provider refund identity, enforces composite
tenant/event/registration ownership, fails legacy import closed before data
loss, restores tenant-safe UI state and mobile platform navigation, makes
documentation publication contract-compatible and rollback-backed, adds the
live active/expired ESNcard guide, and removes tracked Auth0 test-account
passwords and persistent Playwright reports. Protected-value entry is env-key
only and redacted before output forwarding. Compose startup and teardown now
supervise complete process groups and separate image building from runtime
orchestration. A 60-second docs-project timeout exposed one late page-fixture
setup failure after parallel tenant seeding; the email-outbox guide now has an
explicit 120-second test budget, and the complete docs matrix then passed
52/52.

Local evidence for this implementation baseline passes:

| Focused selection                                    | Passed | Incomplete outcomes |
| ---------------------------------------------------- | -----: | ------------------: |
| Complete server/helper Vitest                        |  1,360 |                   0 |
| Complete Angular/shared Vitest                       |    799 |                   0 |
| PostgreSQL 17 integration                            |     55 |                   0 |
| Functional Playwright                                |    150 |                   0 |
| Documentation baseline Playwright                    |     52 |                   0 |
| Auth0/Google Maps integration Playwright             |     11 |                   0 |
| Live ESNcard unit/Profile                            |     27 |                   0 |
| Live ESNcard Playwright                              |      9 |                   0 |
| Docker lifecycle/process-group Vitest                |     19 |                   0 |
| Transfer pricing/allocation/handler/service          |    108 |                   0 |
| Credential/workflow/runtime source guards            |     65 |                   0 |
| Publication contract/runtime source guards           |     53 |                   0 |
| Mobile navigation and transfer accessibility Angular |     16 |                   0 |
| Combined documentation list discovery                |     55 |                   — |

These suites overlap and are not summed into a misleading aggregate total. The
production build, release validation, lint, formatting, Docker Compose
configuration, shell syntax, workflow lint, and diff checks pass. The combined
documentation selection is seven setup tests, 45 baseline journeys, two
Auth0/Maps journeys, and one live ESNcard journey.

All runtime selections passed with zero incomplete outcomes, and post-run Docker
inspection found no project-labeled containers, networks, or volumes. The six
historical passwords and two ESNcard identifiers were process-local only and
were neither printed nor written to tracked files. The following audit
consolidation commit changes documentation only.

### Scaleway migration candidate

The current candidate changes runtime and infrastructure and therefore does not
inherit the counts above. Migration-specific source checks, focused role/provider
tests, Terraform validation/static scanning, shell syntax, workflow lint, and
the Linux/amd64 runtime image/security/size gate are part of the required local
record. The final candidate record must also rerun every application,
PostgreSQL, Playwright baseline/docs/provider, and live ESNcard command listed in
the root README with zero incomplete outcomes. Until that exact record exists,
HOST-001 remains Candidate and no CI-triggering action is permitted.

### Historical baseline and CI confirmation

Earlier pushed baseline `2f027218b23` has green GitHub results for CodeQL,
CodeRabbit, Git Town, Knope/change files, PostgreSQL integration,
lint/unit/build, and the complete E2E Baseline. After the missing repository
secrets were configured, the corrected E2E run completed in 40m17s. This is
historical confirmation, not evidence for later source. No new CI run was
attempted during consolidation; local verification remains mandatory first.

Prior focused evidence incorporated into the implementation baseline:

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
build also passes. In addition to the earlier host-run baseline at desktop and
390×844, the isolated implementation was opened at desktop and 320×800 with
no console warning, error, or horizontal overflow in the signed-out slice. The focused
PostgreSQL and documentation runs used disposable branch
`br-lucky-thunder-a9msks8n` (expiry `2026-07-12T13:17:12Z`); teardown deleted it,
its exact API lookup returned HTTP 404, and it was absent from the project branch
list. Authenticated Browser coverage remains incomplete; historical credentials
were used only inside a protected test child process and are not release-safe
Browser credentials.

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

- Production replacement is not ready. The Scaleway migration is implemented in
  source, but infrastructure bootstrap/apply, DNS/TEM validation, staging
  deployment, restore/drift/rollback drills, alert proof, and complete staged
  Browser acceptance have not happened. Production remains disabled and
  unprovisioned.
- Legacy migration is neither complete nor a current functional-completion
  gate. It will be planned only after staged functional acceptance, on a
  best-effort basis; no lossless-history claim is made.
- The unified implementation passed the full 11-test Auth0/Google Maps provider
  suite with zero skips, retries, flakes, or other incomplete outcomes; a
  protected final release-commit run remains outstanding.
  No live Cloudflare Images evidence is required because that provider is not
  production scope or a release gate.
- The unified implementation passed 27/27 unit/Profile tests and 9/9 live
  ESNcard Playwright tests, but no protected GitHub environment, reviewer
  policy, or final release-commit run is recorded.
- The six historical Auth0 E2E passwords are not rotated or release-provisioned.
  They were recovered from the merge-base blob and used only as child-process
  environment values for local harness verification; they were not printed,
  written to `.env`, or tracked. This does not close rotation or the AUTH-003
  custody design.
- The contract-aligned documentation publisher has not replaced the current
  two-page external artifact. The unified publisher still needs release-safe
  Auth0 values, an explicit current Pages checkout, real synchronization, and a
  complete site build.
- No authenticated six-area Browser walkthrough in the new staging environment
  is recorded.
- No physical-device camera certification is claimed; the accepted
  integration evidence uses deterministic Playwright camera and result journeys.
- No production legal approval is recorded.
- No required-check/review/thread-resolution policy is configured on `main`.
- The Knope source path is implemented but has not regenerated PR #60 or proved
  a real exact-tag draft publication.

These are open release-evidence or policy items, not skipped tests and not
implied by the green local implementation baseline. Google Maps is required production
functionality and therefore requires approved live-provider evidence.
Cloudflare Images is removed and is not a release gate.
