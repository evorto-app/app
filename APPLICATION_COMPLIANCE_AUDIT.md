# Application Production-Readiness Compliance Ledger

Ledger updated: 2026-07-15

Current fully validated baseline: `codex/production-readiness-compliance` at
`2f027218b2302724f5b3ca0b984c2eaa3d1c6170`

`origin/main` at that validation point:
`ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`
(`0` commits behind)

A fresh fetch on 2026-07-15 confirmed that this baseline remains `0` commits
behind `origin/main` at `ae92ec96bfa5683a2b3b78ea8c1a2ee48f47ea73`.
The exact commit passed 1,128 server/helper tests, 644 Angular/shared tests, 48
disposable PostgreSQL 17 tests, 150 functional Playwright tests, and 49
generated-documentation Playwright tests with zero incomplete outcomes. The
separate credential-backed Auth0/Google Maps selection passed 11/11, and live
ESNcard certification passed its 28/28 profile precheck plus 8/8 Playwright
tests. Corrected PR CI then passed the full baseline, including all Playwright
tests, in 40m17s.

The working tree after that exact baseline contains the current
production-readiness candidate: sealed fixed-bundle transfer pricing, composite
ownership constraints, exact Stripe refund identity validation, fail-closed
legacy-import preflight, tenant-safe UI state, settled discount-provider save
gates, env-key-only protected test input, and supervised Docker
build/up/teardown. Current working-tree verification passes 1,360/1,360
server/helper tests, 799/799 Angular/shared tests, 55/55 disposable PostgreSQL
17 tests, 150/150 functional Playwright tests, 52/52 documentation Playwright
tests, 11/11 Auth0/Google Maps integration tests, 27/27 live ESNcard unit tests,
and 9/9 live ESNcard Playwright tests, all with zero incomplete outcomes.
Formatting, lint, the production build, and 19/19 Docker lifecycle tests also
pass. Every Docker-backed run left zero project-labeled containers, networks,
and volumes. This is working-tree evidence; it does not supersede the clean
exact-commit baseline above or waive the remaining external release blockers.

Draft review: [PR #91](https://github.com/evorto-app/app/pull/91)

Scope: application, server/runtime, data layer, shared contracts, tests,
generated product documentation, repository-owned CI, and externally configured
release gates.

## Release decision

**Not yet ready to declare a complete production replacement.**

The original audit's broad implementation findings are mostly remediated.
Commit `2f027218b2302724f5b3ca0b984c2eaa3d1c6170` has a completely
green local baseline of 2,019 collected tests with zero skipped or otherwise
incomplete outcomes. The same exact commit passed all 11 credential-backed
Auth0/Google Maps tests and the active/expired live ESNcard certification.
Organizer/helper signup, fixed-bundle transfer, Stripe-only paid configuration,
fail-closed receipt evidence/loading, cancellation/refund recovery,
confirmation with locked stale-state checks, and exact owned Neon Local cleanup
are proven against that baseline.

The uncommitted next-candidate work is not covered by those baseline counts. It
closes newly discovered transfer-validity/arithmetic, mobile platform navigation,
generated-documentation isolation, beginner-guide, screen-reader, authorization,
import, secret-custody, and container-lifecycle gaps. The complete current
server/helper suite passes 1,360/1,360, the complete Angular/shared suite passes
799/799, and the production build passes. PostgreSQL passes 55/55, functional
Playwright passes 150/150, the documentation baseline passes 52/52, the
Auth0/Google Maps selection passes 11/11, and live ESNcard certification passes
27/27 unit plus 9/9 Playwright tests, all without incomplete outcomes. Combined
documentation discovery still lists 55 tests in 32 files for the staged
publisher. The cross-repository publication contract is repaired in source,
but the combined publisher, real Pages synchronization/build, and a clean
exact-commit gate remain pending.

The leading release blocker is MIG-001: production cutover would lose unsupported
legacy registration, payment, add-on, fulfillment, reimbursement, and submitted-
answer history, so the preflight correctly stops before destructive work. The
highest-risk implemented application boundary is paid registration transfer. The
binding contract is one inseparable registration, guest, add-on, and fulfillment
bundle with exact refunds for every original Stripe source; its implementation
and page-backed proof passed the exact baseline gate. The new validity-window
and amount-bound hardening still needs the next exact-commit gate. Paid event
registration and add-on transactions are Stripe-only, so legacy/manual
paid-event sources are not a supported product branch. The remaining high-risk
evidence gaps include the six historical Auth0 E2E passwords that require
external rotation and release-safe provisioning, the unprotected live ESNcard
release environment, the incomplete authenticated Browser review queue, the
currently incomplete generated publication artifact, and the absence of a new
clean exact-commit rerun. Cloudflare Images is removed and is not a provider
gate. GitHub's current `main` ruleset also does not make
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

| ID           | Severity | Status    | Area                  | Remaining work                                                                                                                                                                                |
| ------------ | -------- | --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-002     | P1       | Candidate | Paid transfer         | Fixed-bundle provenance, validity/bounds, refund identity, and recipient-owned question handling pass current PostgreSQL, functional, and docs coverage; the clean exact-commit gate remains. |
| PROD-003     | P1       | Resolved  | Organizer signup      | Signup, exclusivity, capability, access, profile, cancellation, docs, and the complete baseline gate are green.                                                                               |
| SEC-003      | P1       | Resolved  | Receipt evidence      | Upload/finalization/approval fail closed on exact retrievable evidence; focused and complete baseline gates are green.                                                                        |
| DOC-001      | P1       | Resolved  | Cancellation/refund   | The Stripe/add-on/refund-state guide passed the complete exact-commit gate at `2f027218b23`.                                                                                                  |
| ESN-001      | P1       | External  | Live ESNcard          | Current active/expired certification passed 27/27 unit and 9/9 Playwright checks; the protected GitHub environment and secret policy remain absent.                                           |
| AUTH-001     | P1       | Resolved  | Auth0 integration     | The current credential-backed provider suite passed 11/11 with zero incomplete outcomes; repeat it on the final exact commit.                                                                 |
| AUTH-002     | P1       | External  | E2E credentials       | Plaintext passwords are removed and auth traces disabled; rotate all six historical passwords and provision local/protected secret values.                                                    |
| AUTH-003     | P2       | Open      | CI identity custody   | Do not give long-lived Auth0 passwords to PR-controlled code; choose an approved trusted workflow or ephemeral-account design before CI provisioning.                                         |
| MIG-001      | P0       | Open      | Production cutover    | The guarded direct-schema ETL still lacks registration, payment/refund, add-on, fulfillment, receipt, and submission-history import/reconciliation.                                           |
| PROVIDER-001 | P1       | Resolved  | Google Maps           | The current Auth0/Google Maps integration selection passed 11/11 with zero skips, retries, flakes, or other incomplete outcomes.                                                              |
| REL-001      | P1       | Candidate | Release automation    | Knope draft preparation and exact-tag certified publication are implemented; exact gate and a regenerated first release remain unproven.                                                      |
| REL-002      | P1       | External  | Main enforcement      | `main` still requires no checks, approval, or thread resolution; the one-seat review/bypass policy needs an explicit owner decision.                                                          |
| BROWSER-001  | P1       | Partial   | Manual acceptance     | Exploratory desktop/compact review covered organizer, guest, unlisted, and recovery slices; refresh the final candidate and finish the broader queue.                                         |
| LEGAL-001    | P1       | External  | Legal content         | Legal/privacy settings are implemented, but production text and policy approval are not recorded.                                                                                             |
| OPS-001      | P2       | Resolved  | Email outbox          | Leased delivery is crash-safe; exhausted mail intentionally remains stored and read-only with no recovery action.                                                                             |
| OPS-002      | P2       | Resolved  | Neon Local lifecycle  | Exact owned functional, documentation, and Auth0 integration branches were deleted and returned HTTP 404.                                                                                     |
| OPS-003      | P2       | Resolved  | Local containers      | Process-group teardown passes 19/19; every Docker-backed suite ended with zero project-labeled containers, networks, and volumes.                                                             |
| UX-002       | P2       | Resolved  | Load recovery         | Event, participant, and receipt query failures fail closed with explicit retry; the complete baseline gate is green.                                                                          |
| UX-004       | P2       | Resolved  | Cancellation safety   | Expected-state RPC/locked checks and no-write tests passed focused and complete baseline gates.                                                                                               |
| DOC-002      | P2       | Resolved  | Product docs          | The complete documentation baseline passed 52/52 with zero incomplete outcomes; live inbox acceptance remains separately tracked under EMAIL-001.                                             |
| DOC-003      | P1       | Candidate | Generated publication | Separate docs/provider/live runtime inputs are green; the combined publisher, real Pages sync/build, and clean exact-commit gate remain.                                                      |
| EMAIL-001    | P1       | External  | Live email acceptance | Deterministic outbox behavior is covered, but live Resend delivery to an owned inbox has no credential, domain, or acceptance evidence in this run.                                           |

MIG-001 is the known P0 release blocker: production cutover is prohibited until
legacy history import and reconciliation are complete. The open, partial, and
external P1 rows above also prevent a production-replacement declaration, as do
the P1 candidate rows until their complete exact-commit gate passes.

## Active finding details

### PROD-002 — Fixed-bundle transfer is baseline-green; hardening is candidate

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

Exact baseline `2f027218b23` models an in-place ownership handoff: one confirmed
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

The acquisition schema and finalization API have stabilized. The current
candidate checks the complete recipient discount validity window, bounds derived
amounts before PostgreSQL writes, and freezes current base-price, recipient-
discount, and fixed add-on totals once recipient Checkout begins. It validates a
metadata-less provider refund against exact connected-account and payment
identity, makes a terminal identity mismatch non-retryable, and enforces full
tenant/event/registration owner tuples for the source registration and every
transferred answer. The complete server/helper suite passes 1,360/1,360 with
zero incomplete outcomes. Current PostgreSQL coverage passes 55/55, functional
Playwright passes 150/150, and the documentation baseline passes 52/52. PROD-002
remains Candidate only because this working-tree evidence must be repeated on a
clean exact commit. The old baseline's separately-paid-add-on rejection and
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

### DOC-001 — Cancellation and refund documentation is resolved

The validated baseline added
[`tests/docs/events/registration-cancellation.doc.ts`](tests/docs/events/registration-cancellation.doc.ts)
and links it from the maintained inventory. That baseline also removed the old
paid-cash/manual-refund example because paid event sources are Stripe-only.
The retained ordinary-cancellation journey covers a free confirmed registration,
participant deadline denial, organizer cancellation, guest-capacity release,
cancellation and waitlist email creation, persisted readback, the visible
confirmation flow, and the resulting Profile state.

Exact baseline `2f027218b23` adds a second page-backed beginner journey for a confirmed
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

The current candidate extends the free-cancellation guide through the recipient
side of the waitlist message. It opens the exact event path rendered into the
queued email under the waitlisted account, proves that the message did not
reserve capacity, leaves the old waitlist row through its focused confirmation,
registers while capacity remains, and reads back the cancelled waitlist row, new
confirmed registration, counters, and confirmation email. This closes the
source-addressable beginner follow-up gap. Real Resend delivery to an owned
inbox is external acceptance evidence and is not claimed by the deterministic
outbox journey.

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

On 2026-07-15 the current candidate release command passed its complete 27-test
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
On exact validated baseline `2f027218b23`, `bun run test:e2e:integration`
passed all 11 Auth0/Google Maps functional and documentation tests with zero
incomplete outcomes. Its owned Neon branch was deleted and left zero
project-labeled containers. On 2026-07-15 the current candidate repeated the
canonical selection at 11/11 with zero incomplete outcomes and a clean
container teardown. Repeat the same credential-backed suite on the final exact
release commit before CI or release; missing credentials remain a local blocker
rather than a skip.

### AUTH-002 — Tracked E2E passwords require rotation

The six long-lived Auth0 Playwright account passwords were stored as literals in
[`helpers/user-data.ts`](helpers/user-data.ts) on both `origin/main` and the
validated baseline. The current candidate removes every password value from the
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

### MIG-001 — Production cutover remains blocked on history preservation

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
and reconciled. Production cutover remains blocked until that dedicated history
importer and count/ownership/Stripe-provenance reconciliation are implemented,
reviewed, and proven during an externally coordinated maintenance window. See
[`migration/README.md`](migration/README.md) and
[`migration/cutover-guard.ts`](migration/cutover-guard.ts).

### PROVIDER-001 — Current-candidate Google Maps verification passed

Google Maps location search and place details are required production
functionality. Unit coverage validates configuration plus initialization,
search, empty-result, and error mapping in
[`src/server/config/server-config.spec.ts`](src/server/config/server-config.spec.ts)
and [`src/app/core/location-search.spec.ts`](src/app/core/location-search.spec.ts),
and exact baseline `2f027218b23` adds credential-gated Playwright journeys in
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
or retries. This is exact-commit evidence at `2f027218b23`; repeat it after the
next candidate changes. On the current candidate, the focused Google Maps rerun
passed 8/8 with zero skips, retries, or flakes after adding the hydration wait.
The current candidate then passed the complete canonical 11-test Auth0/Google
Maps provider selection with zero skips, retries, flakes, or other incomplete
outcomes. Repeat it on the final exact release commit. Production provider
provisioning remains an out-of-band deployment requirement.

Cloudflare Images is not production scope or a release gate. Exact baseline
`2f027218b23` removed its editor upload RPC, configuration, handler, integration,
cleanup tooling, dependencies, Compose variables, and test-gate language while
preserving the separate S3-compatible receipt/object-storage boundary. The
provider-scope source guard passes 2/2. Any dormant external
`CLOUDFLARE_IMAGES_API_TOKEN` secret may be removed after confirming no external
consumer; R2 credentials remain in scope and must not be removed.

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

Fly deployment behavior and environment hardening are intentionally excluded
from this candidate because a separate deployment change is planned. The
current working-tree candidate does not modify the Fly workflow, and this audit
makes no claim that the separate deployment work is complete.

The current candidate removes the release placeholder. Knope now uses
regex-backed package versioning, single-package `default` change files, and an
empty asset list so Knope Bot prepares a reviewable version/changelog update and
draft GitHub release. After the `knope/release` pull request merges,
[`release.yml`](.github/workflows/release.yml) runs provider certification,
requires a semver package version and matching changelog section, verifies that
the non-prerelease draft's `v<version>` tag points to the exact merge commit, and
only then publishes it with job-scoped `contents: write`.

This is Candidate source behavior, not release evidence. Open PR #60 predates
the repair, drops the final `package.json` newline, and has only four checks; do
not merge it as-is. After this candidate lands, require Knope Bot to regenerate
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

The latest working-tree candidate was also opened from its isolated Compose
runtime at desktop and 320×800. The signed-out Events list and a seeded event
detail rendered the registration option and explicit login requirement. At 320
CSS pixels the document, body, and bottom navigation each measured exactly 320
pixels wide, with no horizontal overflow, and Browser diagnostics contained no
warning or error. This current-candidate slice proves signed-out discovery and
two-destination compact navigation; it does not stand in for the blocked
authenticated five-destination navigation review.

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

At that validated baseline, two named cache volumes remained and did not keep a
container or remote branch running. The current disposable wrapper instead
removes project-labeled volumes as part of verified teardown. An inventory also
found two older ready branches without expiry. Their ownership is not
established after their source metadata was cleared, so they were not deleted
and are not attributed to another checkout by guesswork.

The complete exact-commit gate at `e3e252768e4` created and removed its owned
functional branch `br-snowy-truth-a9i0qqtw` and documentation branch
`br-bold-recipe-a9pbrnrm`; both exact endpoints returned HTTP 404 afterward and
no project-labeled container remained. The later Auth0 integration run repeated
that result for `br-orange-sun-a9oheq9u`. OPS-002 is therefore resolved for the
validated baseline. Every later full gate must still capture and verify its own
exact branch IDs. Inventory any older project or branch separately and delete it
only after confirming ownership; never use broad cleanup that could affect
another checkout or user-owned stack.

### OPS-003 — Local Compose teardown is runtime-validated

The current candidate fixes a cleanup lock inversion discovered when Playwright
timed out during web-server startup: the wrapper previously attempted `compose
down` while its foreground `compose up` process could still hold the project
lock. Compose build and startup now run in a detached supervised process group,
cleanup applies a bounded TERM/KILL sequence to the complete group, waits for it
to exit, and only then performs verified project-scoped teardown. Build and
startup are separate commands, and the Playwright startup allowance matches
CI's 12-minute build plus 5-minute startup bounds. Ordinary Compose starts no
longer force Playwright runtime mode, while Playwright-owned and CI starts opt in
explicitly. Resume starts Stripe first, requires its signing-secret healthcheck
to pass, and only then starts the app. Lifecycle coverage passes 19/19,
including a TERM-ignoring descendant, termination-before-teardown ordering, and
refusal of retained Stripe containers without the required healthcheck.

After Docker Desktop was reset, the canonical PostgreSQL, functional,
documentation, provider, and live ESNcard suites all completed. Every
Docker-backed run performed project-scoped teardown; post-run inspection found
zero project-labeled containers, networks, and volumes. OPS-003 is therefore
resolved for the current candidate. The final exact-commit gate must retain the
same teardown proof.

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

On 2026-07-15 the complete documentation baseline passed 52/52 with zero skips,
retries, flakes, or other incomplete outcomes. DOC-002 is resolved for the
current candidate; publication remains separately tracked under DOC-003.

### DOC-003 — Generated publication is aligned with the tracked consumer

The local developer `.env` intentionally points documentation output at the
documentation-site checkout. Previously every non-list Playwright invocation
emptied that location before it knew which documentation project was selected.
Running `docs-integration` after `docs-baseline` therefore erased the baseline
publication and left only the Auth0 and Google Maps pages.

All non-publishing package scripts now force ignored `test-results/docs` paths.
The candidate `bun run test:e2e:docs:publish` command runs `docs-baseline`,
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
provider identifiers, and Maps, Stripe, and Neon values are not inherited.

Focused unit/source verification and TypeScript pass, and the exact
artifact produced by the Evorto adapter was accepted by the current
`origin/master` Pages sync implementation against a disposable repository: 13
guides and one fixture asset copied, no real Pages checkout modified. The full
55-test runtime generation, real Pages sync/build, and clean exact-commit gate
remain. The separate 52-test docs baseline, 11-test provider suite, and 9-test
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
map. Exact baseline `2f027218b23` passed the 49-test `docs-baseline` project and
the 11-test credential-backed functional/documentation selection. Current
combined documentation discovery selects `docs-baseline`, `docs-integration`,
and `docs-live-esncard` in one run and reports 55 tests in 32 files. That is the
shared seven-test setup, 45 baseline journeys, Auth0 account creation, required
Google Maps, and the secret-safe active/expired ESNcard lifecycle. The separate
current runtime selections pass 52/52 documentation baseline tests, 11/11
Auth0/Google Maps tests, and 9/9 live ESNcard Playwright tests. They still need
the next complete clean exact-commit gate and rollback-backed combined
publication. This ledger remains the source of truth for release gaps; the
inventory does not waive the open rows above.

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
- In-app Browser review complements Playwright. For the scanner candidate,
  deterministic Playwright camera input plus scan-result journeys are the
  accepted integration evidence; they do not claim physical-device hardware
  certification.
- Live ESNcard active-card add/refresh/remove, permanently expired-card status,
  and provider-error verification is a release gate, not an optional skipped
  project.
- Google Maps is required production functionality and needs live provider
  evidence. Cloudflare Images is removed and is not a release gate.
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

1. Close MIG-001 with a dedicated legacy history importer and reconciliation
   proof. Keep the direct current-schema target, separate read-only source, and
   fail-closed cutover guard; do not bypass the preflight or clear production
   target data while unsupported history exists.
2. Rotate all six historical Auth0 Playwright passwords and put the rotated
   values in the ignored local `.env`. Do not reuse the values still present in
   Git history. Before any GitHub provisioning, resolve AUTH-003 with a trusted
   workflow or disposable-account design; do not expose the long-lived values
   to pull-request-controlled code.
3. Complete the remaining desktop/compact in-app Browser queue. Scanner
   camera/result integration already has accepted deterministic Playwright
   coverage. Convert any defect into durable Playwright/docs coverage.
4. Create a local candidate commit and require a clean worktree. Run the entire
   local gate on that exact commit, including the 55-test combined documentation
   selection, Auth0/Google Maps, active/expired live ESNcard certification, and
   exact Neon branch deletion. If any failure requires an edit, recommit and
   restart the complete gate.
5. Run the staged documentation publisher from that exact green candidate and
   an explicit current Pages checkout. Verify the 13 generated guide routes,
   page/image inventory, preserved curated routes/assets, and complete Pages site
   build instead of relying on the current two-page partial artifact.
6. Prove live waitlist email delivery into an owned recipient inbox. The
   recipient's in-app leave-and-register follow-up is now deterministic and
   page-backed; keep it and the unknown-domain scanner recovery guide current.
7. Provision and approve the live ESNcard environment with protected active and
   permanently expired identifier secrets, execute exact-candidate certification,
   approve production legal text, require the verified checks and review policy
   on `main`, regenerate the stale Knope release pull request, and verify the
   first exact-tag certified draft publication. Keep deployment work in its
   separate change.

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
`2f027218b2302724f5b3ca0b984c2eaa3d1c6170`:

| Suite                              |    Passed | Incomplete outcomes |
| ---------------------------------- | --------: | ------------------: |
| Server/helper Vitest               |     1,128 |                   0 |
| Angular/shared Vitest              |       644 |                   0 |
| PostgreSQL 17 integration          |        48 |                   0 |
| Functional Playwright baseline     |       150 |                   0 |
| Generated-documentation Playwright |        49 |                   0 |
| **Total**                          | **2,019** |               **0** |

Frozen dependency installation, Knope validation, formatting, lint/clean-tree
check, and the production application build also passed. The exact functional
and documentation Neon branches returned HTTP 404 after teardown and no
project-labeled containers remained.

The credential-backed integration projects are intentionally separate from the
2,019 baseline total. On the same exact commit, `bun run test:e2e:integration`
passed 11/11 Auth0/Google Maps functional and documentation tests with zero
incomplete outcomes. Live ESNcard certification also passed 28/28 profile tests
and 8/8 provider Playwright tests. Their exact Neon branches returned HTTP 404
after cleanup.

### Validated-baseline CI confirmation

Pushed baseline `2f027218b23` has green GitHub results for CodeQL, CodeRabbit,
Git Town, Knope/change files, PostgreSQL integration, lint/unit/build, and the
complete E2E Baseline. After the missing repository secrets were configured,
the corrected E2E run completed in 40m17s. CI confirms an already-green local
baseline and does not close REL-001 until GitHub requires the checks. It does not
validate the new working-tree candidate, and no new CI run may be attempted
before that candidate is entirely green locally on its exact commit.

### Current working-tree candidate

The next candidate contains changes after `2f027218b23`. It hardens transfer
discount validity and monetary bounds, seals bundle pricing after recipient
Checkout begins, validates exact provider refund identity, enforces composite
tenant/event/registration ownership, fails legacy import closed before data
loss, restores tenant-safe UI state and mobile platform navigation, makes
documentation publication contract-compatible and rollback-backed, adds the
live active/expired ESNcard guide, and removes tracked Auth0 test-account
passwords and persistent Playwright reports. Protected-value entry is env-key
only and redacted before output forwarding. Compose startup and teardown now
supervise complete process groups and separate image building from runtime
orchestration.

Current working-tree evidence passes:

| Focused selection                                    | Passed | Incomplete outcomes |
| ---------------------------------------------------- | -----: | ------------------: |
| Complete current server/helper Vitest                |  1,360 |                   0 |
| Complete current Angular/shared Vitest               |    799 |                   0 |
| Current PostgreSQL 17 integration                    |     55 |                   0 |
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

The production build, release validation, lint, formatting, Docker Compose
configuration, shell syntax, workflow lint, and diff checks pass. The combined
documentation selection is seven setup tests, 45 baseline journeys, two
Auth0/Maps journeys, and one live ESNcard journey.

This is working-tree evidence, not a clean exact-commit gate. All five runtime
selections passed with zero incomplete outcomes, and post-run Docker inspection
found no project-labeled containers, networks, or volumes. Before any push or
CI-triggering action, create the candidate commit, repeat the entire local gate
on that exact commit, and require every collected outcome to pass with zero
incomplete results.

Prior focused evidence incorporated into exact baseline `2f027218b23`:

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
390×844, the current isolated candidate was opened at desktop and 320×800 with
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

- Production cutover is not ready. MIG-001 remains open until legacy
  registration, financial, add-on, fulfillment, reimbursement, and submitted-
  answer history is imported and reconciled without loss.
- The 11/11 Auth0/Google Maps result and Cloudflare Images removal are exact on
  `2f027218b23`. The current candidate also passed the full 11-test provider
  suite with zero skips, retries, flakes, or other incomplete outcomes; a
  protected final exact-release-commit run remains outstanding.
  No live Cloudflare Images evidence is required because that provider is not
  production scope or a release gate.
- Local active/expired ESNcard certification is exact-green on `2f027218b23`.
  The current candidate passed 27/27 unit/Profile tests and 9/9 live Playwright
  tests, but no protected GitHub environment, reviewer policy, or exact-release-
  commit run is recorded.
- The six historical Auth0 E2E passwords are not rotated or release-provisioned.
  They were recovered from the merge-base blob and used only as child-process
  environment values for local harness verification; they were not printed,
  written to `.env`, or tracked. This does not close rotation or the AUTH-003
  custody design.
- The contract-aligned documentation publisher has not replaced the current
  two-page external artifact. The unified publisher still needs release-safe
  Auth0 values, an explicit current Pages checkout, real synchronization, and a
  complete site build.
- No authenticated six-area in-app Browser walkthrough is recorded.
- No physical-device camera certification is claimed; the accepted candidate
  integration evidence uses deterministic Playwright camera and result journeys.
- No production legal approval is recorded.
- No required-check/review/thread-resolution policy is configured on `main`.
- The Knope source path is implemented but has not regenerated PR #60 or proved
  a real exact-tag draft publication. Deployment work exists separately.
- No clean exact-commit local gate is recorded for the candidate.

These are open release-evidence or policy items, not skipped tests and not implied
by the 2,019-test exact baseline. Google Maps is required production
functionality and therefore requires approved live-provider evidence.
Cloudflare Images is removed and is not a release gate.
