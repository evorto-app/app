# Behavior-focused test review

The current cleanup applies the rule in `QUALITY.md`: exercise behavior, use
ESLint for important structural constraints, and keep editorial preferences in
review. This is an audit record, not another automated coverage gate.

## Reviewed removals and retained proof

| Removed check                                                          | Disposition and retained coverage                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server and documentation word blacklists; administrator copy assertion | Editorial policy belongs in guidance. Public-error sanitization, email behavior, and publication integrity remain executable tests.                                                                                                                                                                                                                                                                                                                             |
| `generated-docs-source.spec.ts`                                        | Reading documentation-test source does not execute a journey. The Playwright documentation journeys remain, along with `publish-documentation.spec.ts` output, link, asset, and cleanup checks.                                                                                                                                                                                                                                                                 |
| `quality-source.spec.ts`                                               | Preferred query-narrowing spelling belongs in `src/app/AGENTS.md`; TypeScript and rendered query-state tests verify correctness.                                                                                                                                                                                                                                                                                                                                |
| `authorization-source.spec.ts`                                         | Raw permission-array membership checks move to ESLint for server HTTP/RPC code. `roles.handlers.spec.ts` executes lookup authorization and checks the returned catalog excludes role authority; shared permission tests cover wildcard/dependency semantics.                                                                                                                                                                                                    |
| `permission-matrix-source.spec.ts`                                     | Removed tests of the matrix itself and a regex parser of route source. `finance.routes.spec.ts`, `permission.guard.spec.ts`, and the actual Playwright permission matrix remain.                                                                                                                                                                                                                                                                                |
| `user-list-source.spec.ts`                                             | Removed UI/copy/source-order assertions and tests checking that other tests exist. `user-list.component.spec.ts`, `users.handlers.spec.ts`, and `tests/specs/admin/user-role-assignment.spec.ts` execute recovery, tenant-scoped reads, denied writes, and persisted role changes.                                                                                                                                                                              |
| Authoring-source half of `registration-mode-source.spec.ts`            | The retained `registration-modes.spec.ts` checks the imported storage/UI contract. Shared label tests and real authoring journeys remain.                                                                                                                                                                                                                                                                                                                       |
| `test-control-source.spec.ts` and `playwright-skip-inventory.spec.ts`  | Removed the parallel test-control parser, text inventory comparison, placeholder-title blacklist, and fixed-wait string ban. Native focused-test rejection and complete-run reporters remain. `complete-vitest-run-reporter.spec.ts` and `complete-playwright-run-reporter.spec.ts` invoke real runners with incomplete fixtures and require failure. The separate ownership scanner is also removed; the PostgreSQL runner collection/isolation check remains. |

## UI and naming checks

- Removed the template-authoring source tests: actual template-create/edit
  component tests already exercise failed role/tax reads, retries, preserved
  drafts, paid values, and unavailable accounts.
- Removed the date-hint text search. Tenant date-adapter tests verify actual
  parsing, formatting, timezone isolation, and missing configuration.
- Moved the Font Awesome component constraint to ESLint's standard restricted
  imports rule for `MatIcon` and `MatIconModule`. `MatIconRegistry` remains
  usable for the existing bootstrap integration; its file location is not an
  application behavior test.
- Removed the icon-selector template-string check. The existing event-form
  Playwright journey opens the dialog by keyboard, finds named buttons, runs
  axe against the dialog, and selects an icon with Enter. Error mapping and
  public-error protection unit tests remain.
- Removed the registration-settings template-spelling assertion while retaining
  actual Signal Form required/integer/range validation and unchanged-value tests.
- Removed the `Effect.fn` spelling assertion for tax lookup. Its real selector
  and validation tests remain; the Effect runtime-boundary lint rule is retained.

## Behavioral replacement and fixture timing

The platform question-history source assertion is replaced by a PostgreSQL
handler test in `src/db/schema/registration-answer-integrity.postgres.spec.ts`.
It proves answered questions cannot be changed or removed, unrelated event
changes roll back, answers remain intact, and denied operations create no audit
entry. An unanswered question can still be updated and its text is normalized.
A diagnostic run that bypassed the shared guard made the test fail at the denied
operation, without changing production source.

The lifecycle fixture uses one second rather than two for four positive-grace
signal/timeout scenarios. All 38 cases and their exit, diagnostic, and cleanup
assertions remain, including the separate timing-precedence cases. A single
same-toolchain focused pair took 38.46s before and 34.87s after; this is local
fixture evidence, not a hosted-CI timing claim. Production timeouts are unchanged.

## Refund recovery and transfer ownership

The refund-reconciliation source-only block is removed. Its existing PostgreSQL
acquisition test now proves the linked transfer row rejects a competing
`FOR UPDATE NOWAIT`, another tenant cannot resolve the link, and mismatched
transfer kind or identity cannot requeue it or change its status. Ambiguous
source/compensation linkage still fails closed. Aggregation unit tests and
actual paid-transfer/refund-acquisition tests remain.

The transfer-mutation source/query-spelling tests are redundant with the real
add-on fulfillment PostgreSQL cases: open and checkout-pending transfers block
access without changing state, while completed/refund-pending/refund-failed
handoffs permit the recipient's actions. Existing fulfillment concurrency tests
remain for the later lock-order audit.

Removed semantic-theme source-token assertions and finance `Effect.fn`/constructor
spelling assertions. Theme choices remain guidance; compiler checks, rendered
accessibility journeys, finance schema encoding, and actual finance flows remain.
No new syntax scanner replaces these tests.

## Platform authority

Removed `platform-authority-source.spec.ts`. The request-context resolver tests
prove identity alone and the retired metadata alias grant no authority.
`rpc-access.service.spec.ts` and `platform-operation.service.spec.ts` execute
permission dependency/wildcard checks, target scoping, and delegation without a
tenant user. The actual platform guard, global-admin handler tests, and
Playwright route-denial journeys remain. Tenant URL migration PostgreSQL races
protect pending payments/transfers; actual audit and tenant-creation tests cover
recorded outcomes and required reasons/privacy policy.

Two existing structural restrictions move to ESLint: shared administrator setup
cannot call Auth0 user/metadata update methods, and server HTTP/RPC handlers
cannot use Drizzle update/delete on platform audit entries. These are bounded
syntax checks, not a claim of whole-program data-flow enforcement. The real
claim-fixture tests still prove missing claims and read errors fail without
attempted writes, including concurrent setup.

The email-kind source inventory is removed, including the assertion that the
inventory mentions its own guard. Email delivery/template tests execute the
supported kinds, checkout-completion PostgreSQL tests inspect confirmations and
cancellations, and free-registration/transfer journeys inspect persisted outbox
records. Existing enqueue/dispatcher/provider tests retain idempotency and
failure behavior. Exhaustive label typing remains compiler-enforced.

## Workflow structure lint

The action pinning/secret-scope source test and its custom line/block parser are
removed. ESLint now uses `yaml-eslint-parser` for workflow YAML and checks
immutable action/reusable-workflow references, permissions declarations, and
secret placement. Valid/invalid probes cover quoted and flow-style
YAML, local and self-repository actions, reusable-workflow secret forwarding, Docker digests,
workflow/job/run-step environments, and external-action inputs. All eleven
current workflows pass. Input/output tests in
`eslint-structural-rules.spec.ts` exercise the actual ESLint engine against valid
and invalid workflow, authorization, audit, identity-fixture, and import inputs.
They verify lint diagnostics rather than inspecting application source. The self-test that compared ESLint configuration source
and an exact list of file globs is also removed; the real lint command runs the
checks. Permissions must be declared directly on the workflow or on each job.
Cloud configuration remains unchanged; the image job now runs its synthetic
build-context check before building the real repository image.

## Database entrypoints and seeding

Removed `fail-loud-database-source.spec.ts`. Actual database-preflight and
runtime-environment invocation tests already refuse unsafe targets and missing
Stripe configuration before connecting; seed-requirement and finance-receipt
fixtures check required users/roles before side effects.

`setup-database.postgres.spec.ts` now calls the real reset and transaction against
an explicitly disposable, initially empty PostgreSQL database. Only the leaf seed
functions are replaced with controlled inserts/failure. The case proves a failed
seed restores the pre-reset tenant and leaves no partial users or completion
marker, then proves a successful retry commits all marker rows. It does not claim
to replace full graph-seeding or application journeys. Cleanup preserves failures
and leaves the disposable database empty. A diagnostic run that bypasses the
transaction fails the original-tenant readback, confirming the test detects
non-atomic reset/seeding without changing production source.

The PostgreSQL collection test now evaluates the imported runner configuration
and real glob results. It retains serial execution and suite isolation checks,
while removing assertions about config-file spelling, guard error text, and
where each test puts its environment check. Native run-completeness reporters
continue rejecting skipped/incomplete outcomes.

## Suite ownership, tenant URLs, and documentation assertions

Removed the suite-ownership scanner and its private recursive file inventory.
It reconstructed runner rules, parsed config strings and test titles, and tested
its own classifier. Native runner collection, focused-test rejection, complete
run reporters, and credential preflights remain; the PostgreSQL configuration
check verifies its actual collection and isolation. Provider tags and placement
stay in the documented authoring/review workflow.

Removed `tenant-outbound-url-source.spec.ts`. Existing URL helper tests reject
absolute-origin overrides and invalid domains. Registration handlers prove
hostile Host/Origin/forwarded headers cannot change Stripe return URLs; QR
handler tests prove the generated code uses the tenant origin. Email and transfer
behavior tests retain tenant event-link assertions. The compiler and shared RPC
schemas remain the contract boundary rather than a search for retired fields.

Removed the provider-certification test that required exact custody/rotation
paragraphs and provider implementation spelling. Credential custody remains
operational guidance; live-provider certification and protected-value handling
remain tested. Updated the client/server import lint diagnostic to reference
Effect RPC and removed its unused legacy `AppRouter` exception.

Removed the release-note word blacklist and retired-provider/placeholder word
checks in release workflow source. Release wording is reviewed with the change;
release execution and credential gates remain separate audit items.

The Playwright fail-loud source test is also removed. Real runtime-state tests
check malformed/missing state and routing tests check propagated setup/cleanup
errors. A bounded ESLint rule rejects literal TLS-verification disabling in the
two shared browser setup entrypoints; valid/invalid lint inputs verify its
diagnostic, including quoted/computed keys and an explicitly false setting.

## CI configuration and diagnostic output

Removed `ci-quality-source.spec.ts` and its indentation-based step parser. Actual
readiness tests check the SSR response and exact success status; configuration
and preflight tests check missing inputs; complete runner/wrapper tests cover
suite execution. Clock constants, exact tool versions, job names, Copilot setup,
and workflow spelling are reviewed as configuration rather than copied into
unit-test assertions. Native workflow lint retains action pinning, explicit
permissions and secret-boundary checks.

The log allowlist moves into `collect-docker-diagnostics.sh`, used by both E2E
workflows. Its behavior tests invoke the real script with a fake Docker CLI and
prove caller arguments cannot add database/Stripe logs, supported tail/follow
options work, and output/errors/exit status survive. Shared browser setup and
documentation trace configuration now has a native ESLint restriction, with
valid/invalid probes. This found five documentation journeys with enabled
failure/retry traces; their overrides now keep tracing off. Existing protected-input and sanitizer tests execute real
browser/runner failures, including a CLI trace override, and inspect actual
artifacts. They replace the provider test that searched for safe assertion
spelling. Workflow artifact exclusions and trace-off invocation stay intact.

## Rendered administrator recovery

Removed the remaining `admin-form-accessibility.spec.ts` source assertions.
Existing role-details tests already render sanitized read errors and click retry;
new tests render role list/edit and tax-rate read recovery, and submit real
create/edit forms through private and expected write failures, preserved drafts,
and successful retry/navigation. Icon-label source searches are redundant with
rendered accessibility journeys and template lint. The role-form validation test now edits and blurs rendered fields and checks
visible required/length errors, replacing schema-plus-template-spelling checks.
The remaining template-create/edit payment-connection string assertions are
removed; both components already exercise lost tax catalogs, unavailable accounts,
retained paid values, retry, and restored save availability.

## Event and transfer template assertions

Removed 28 source-only cases from event editing, registration choices, active
registration, organizer overview, event details, and transfer-claim tests, plus
source-string tails from three retained event-edit predicate tests. Existing
rendered event-edit tests exercise preserved paid graphs through failed catalogs
and unavailable accounts. Registration-choice tests actually keep guest/answer
inputs through a failed sign-in check and retry without submitting. Active
registration tests render cancellation/transfer/add-on failures and mutation
controls; organizer tests retain exact cache invalidation behavior, confirmed
cancellation state and receipt submission/readback recovery.

The organizer/manual-approval and registration-transfer Playwright journeys
continue verifying granted/absent actions, persisted outcomes, current recipient
prices, fixed add-on quantities and check-in/fulfillment history. Transfer-claim
answer tests render actual validation; error-copy functions still verify safe
recovery outcomes. The deleted assertions checked template syntax, class/layout
choices, exact explanatory copy, or the presence of helper names. They do not
need a second copy of those journeys.

## Remaining application source checks

Removed source-only navigation, onboarding, transaction-list, platform audit,
platform finance, platform template, and tax-selector assertions. Existing
navigation tests open the named sheet and follow permitted destinations;
onboarding tests exercise publish failures and retained edits; audit/finance tests
render readable records, pagination, recovery, and mutation outcomes. The payment
history recovery test now checks the actual CZK amount. Tax-selector harness tests
already exercise missing percentages, stale selections, catalog failures, retries,
and date-adapter isolation across editor surfaces.

Platform event validator tests keep their real input/output assertions while
losing source-string tails. A rendered event test now proves an invalid
registration time cannot submit the previously retained instant and that
correction re-enables save. A rendered new-template test switches the organization
input and proves the first draft clears and the new target roles replace it,
without any write. Existing platform graph tests cover preserved values,
read failures, paid configuration, operation outcomes, and action locks.

## Persisted schema behavior

Removed the three registration schema inspection suites (`event-registrations`,
`registration-policy-settings`, and `template-event-addons`). Real PostgreSQL
concurrency tests already reject duplicate active registrations and pending
payments even with a forged tenant id. Price-snapshot tests exercise incomplete,
inconsistent and confirmed snapshots; quantity and answer-integrity suites
exercise persisted bounds, mappings, question ownership and uniqueness. Source
exports, retired column names and index spelling remain schema-review concerns.

A new case in the existing quantity-bound PostgreSQL fixture reads real tenant,
template-choice and event-choice policy defaults, rejects negative deadlines,
verifies rejected writes leave state unchanged, accepts zero, then restores the
original nullable/default values. It replaces constraint-name and inferred-type
assertions with actual storage behavior; no schema or production query changes.

## Template graph ownership and atomic audit

Removed the platform template transaction/source-contract case and two shared
graph-loader source cases. New disposable PostgreSQL tests invoke the actual
platform template create/update handlers, write options/add-ons/questions and a
real audit entry, and verify tenant-scoped reads. A deliberately persisted foreign
role reference fails instead of leaking another organization's role.

A controlled audit-write failure occurs after real graph writes. Both create and
replace operations roll back the graph and leave the audit unchanged; a successful
retry commits the updated graph and one update audit. Only that leaf failure is
mocked. Every fixture runs inside an outer transaction that always rolls back.
The ordinary-handler currency lock and broader role-lock ordering checks remain
under audit; these new tests do not claim to prove those concurrency paths.

## Transfer finalization and fulfillment

Removed the transfer-finalization source suite. Existing PostgreSQL tests execute
linear ownership/acquisition history, exact payment/refund-plan links, immutable
add-on lots, recipient compensation, source-account rotation, tenant limits,
changed roles/event approval, concurrent claims and global-user lock races.
Actual registration/transfer handler and Playwright tests retain private claim,
email/link, payment status and fixed-bundle outcomes. The deleted suite duplicated
these through variable names, statement counts and textual lock ordering.

Fulfillment tests now pause a real read behind a PostgreSQL table lock, commit a
consistent redemption transaction, and verify the in-flight view keeps its prior
purchase/lot/history snapshot while a fresh view sees the redemption. The existing
concurrent redemption test also undoes both active events, checking that an
already reversed event never becomes the undo target. These replace the four
fulfillment source guards; the existing transfer-blocking and cancellation/refund
race tests remain.

## Tooling configuration mirrors and ledger structure

Removed the provider-release source inventory and eleven runtime-preflight cases
that copied script text, Compose fragments, registry settings, guide paragraphs,
or environment-example contents. Real preflight diagnostics, credential privacy,
provider prerequisites, browser discovery, command sequencing and setup-before-
mutation tests remain. The Compose test still executes the configured setup
command; workflow URLs still pass through the PostgreSQL connection parser.
Removed two Compose fragment comparisons and the test-user source scanner.
Test-user outputs retain unique environment-variable mapping, exact password
handling and a check that fixture records contain no password property.

Financial ledger and platform audit immutability now use an ESLint rule over
syntax and scope bindings. It diagnoses update/delete calls through imports,
local aliases and simple member assignments, plus direct literal/interpolated
SQL mutations. Reads and inserts remain allowed, including read aliases that the
old scanner rejected outright. Valid/invalid ESLint inputs exercise diagnostics.
This is a bounded structural rule, not whole-program data-flow or SQL analysis;
actual ledger/payment/acquisition integrity continues to have PostgreSQL coverage.

## Checkout webhook source assertions

Removed three webhook source-text cases that searched for finalizer calls,
lock/update ordering, and sorted add-on release queries. Payment-intent ownership,
missing-provider identity, connected-account mismatch, guarded transition failure,
and finalized-expiry replay are still executed by the webhook and completion unit
tests. PostgreSQL tests retain completion/approval overlap without deadlock,
compensation rollback and replay, concurrent expired-claim release, and add-on
completion/expiry races. Those tests assert persisted state and exactly-once
outcomes; they do not prescribe the textual order of the implementation.
The expiry-source checks never executed the HTTP handler concurrently; removing
them does not imply new end-to-end webhook concurrency coverage.

## Platform receipt reads

Removed the assertion counting five upload joins in platform finance source.
A real PostgreSQL case now seeds receipts for two tenants, reads approval and
reimbursement queues through the platform handlers, and verifies that only the
selected tenant's receipt is returned. A foreign receipt detail request fails
with `receiptNotFound`. The fixture storage service dies on every invocation,
so neither queue nor the rejected detail can silently access receipt storage.
The database's composite upload foreign key continues to bind a receipt to its
upload, tenant, event and submitter. This test covers read isolation; it does not
claim to exercise every approval/reimbursement mutation race.

The approval source-order assertion is also removed. A PostgreSQL case changes
the private object key while the storage existence call is in flight. Approval
then fails, leaves the receipt submitted, and writes no audit entry. An explicit
rejection succeeds without touching storage and creates exactly one audit entry.
This exercises revalidation after asynchronous evidence checks without inspecting
query spelling or prescribing a particular arrangement of helper calls.

The two refund recovery source assertions are replaced by a real query test.
It seeds recoverable exhausted refunds with stale future schedules, normally
scheduled claims, leased claims and successful refunds in two tenants. Only the
selected tenant's exhausted claim is returned, with the attendee and event
context; a tenant user with finance permissions cannot invoke the platform read.
All four platform finance source assertions are now removed.

## Redundant lock-order and boundary inventories

Removed the exported `registrationAddonPurchaseLockOrder` array and its equality
test. The array was used only by that test and did not control execution. Actual
checkout completion/expiry and concurrent stock tests remain. Removed the source
check for pinned add-on checkout time: the PostgreSQL cases already verify exact
expiry persistence at the event boundary and rejection one second beyond it.
Removed the tax-validation source assertion; `validate-tax-rate.spec.ts` invokes
the validator, checks the account-scoped SQL parameters and rejects a missing
current account before looking up a rate. The broader account-scope scanner
remains under review for its distinct handler/import paths.

## Schema metadata mirrors

Removed eleven schema suites (39 cases) that inspected column flags, index names,
constraint objects or generated SQL fragments instead of executing database work:

- `discount-integrity`, `event-domain-integrity`, `tenant-boundary-constraints`,
  `registration-answer-integrity` and `registration-quantity-limits`: the retained
  PostgreSQL suites reject actual owner mismatches, duplicates, invalid lifecycle
  states, negative prices and out-of-range quantities/text, and preserve the
  committed rows after rejection. The quantity suite exercises each maximum and
  the next invalid value rather than comparing constraint SQL spelling.
- `email-outbox`: actual dispatch/lease recovery and PostgreSQL rejection of a
  second attempt remain. Exact enum lists, retired column names and index order
  belong to schema review; single-dispatch behavior is exercised directly.
- `event-instances` and `tenants`: actual authoring/discovery, tenant policy,
  timezone and registration tests remain. Retired field absence and exact storage
  type strings are no longer runtime assertions.
- `platform-audit-entries`: real handler audit writes, failed-mutation rollback
  and cursor pagination remain. Index inventory and lifecycle-column spelling
  are schema review concerns; append-only production writes have a lint rule.
- `tenant-brand-asset-uploads`: the existing PostgreSQL image lifecycle suite
  already exercises non-cascading tenant deletion, due cleanup, stale claims,
  interrupted uploads and ownership-safe association.
- `roles`: a new PostgreSQL case allows the same role name in different tenants
  and requires the named uniqueness error within one tenant. Existing handler
  tests retain the user-facing conflict mapping. This replaces metadata proof
  with the actual database error on which that mapping depends.

No production schema was changed. The remaining metadata suites need their own
review; this batch does not claim every database invariant is already covered.

The purchase-order, acquisition and transfer metadata suites (18 more cases)
are also removed after reviewing the actual add-on purchase and transfer
PostgreSQL suites. Retained cases execute operation replay, concurrent stock
consumption, completion versus expiry, incomplete settled allocations, repeated
ownership transfers, shared immutable lot/payment history, source-account
rotation, missing refund-plan compensation and concurrent refund retries. Real
answer/quantity/tenant constraint cases cover the associated owner tuples and
bounds. The deleted suites compared enum/column/index inventories and constraint
SQL; they did not execute those workflows. Exact index layouts, retired columns
and internal table arrangements remain schema-review concerns. Existing
append-only ledger lint and all transaction/settlement behavior tests remain.

The user, onboarding and tax-rate metadata suites (seven cases) are replaced
by three PostgreSQL cases in the existing onboarding fixture. They reject
malformed contact/IBAN values without changing stored data, accept canonical and
nullable optional values, reject duplicate/contentless policy versions and
cross-tenant acceptances/answers, enforce question/options consistency, and
preserve tenant-scoped provider IDs with mandatory account ownership. Successful
writes are read back. Existing onboarding handler behavior remains in the suite;
no production schema or validation rules changed.

The receipt and transaction metadata suites (eleven cases) are removed too.
A PostgreSQL receipt case rejects cross-tenant/wrong-submitter evidence, duplicate
attachment use, and another tenant's reimbursement transaction; it reads back
the unchanged receipt. The existing refund recovery fixture now also attempts
invalid counters, partial leases, incomplete refund provenance, a foreign source
payment, non-Stripe event payment and missing event/registration ownership. All
must fail before the original recoverable claim is returned unchanged. Existing
calendar-day/amount, checkout replay, pending-payment uniqueness and refund worker
cases remain; exact column inventories and SQL formatting are no longer asserted.

The fulfillment audit-shape metadata tests were duplicates of the existing
PostgreSQL case that inserts a system actor without a subject and a cancellation
without a reason and requires their actual constraint failures. Both metadata
cases are removed. The identifier-length schema scanner moves to ESLint:
`postgres-identifiers/explicit-name-length` reports explicit Drizzle names over
63 UTF-8 bytes at their declaration, including imported factory aliases,
namespace calls, local constant strings and foreign-key/primary-key name options.
It intentionally does not evaluate arbitrary code, imported constant values or
generated names. Small valid/invalid lint inputs test the diagnostics, including
Unicode bytes and shadowed/unrelated functions. All seven remaining metadata
suites are now removed; production schema declarations remain unchanged.

## Ordinary template currency races

Removed the source-order assertion from `templates.handlers.spec.ts`. The existing
PostgreSQL stale-currency test now invokes the actual create and update handlers,
observes blocking on a known concurrent writer, requires the typed currency-change
error, and verifies that no new template or edited title was saved. Both paths
then succeed after refreshing the request currency. Fixture cleanup releases the
writer and drains the pending handler even on failure; template cleanup uses only
the owned tenant IDs so generated handler IDs cannot escape it. The separate
currency-writer ordering test remains a lower-level concurrency check.

## Role graph source assertions

Removed seven role-graph source checks that counted helper calls or compared lock
positions. A PostgreSQL overlap now invokes the actual template-create and
ordinary role-delete handlers. The writer's outer fixture transaction pauses only
after the handler has written the graph. Deletion must wait for that transaction,
then reject the now-referenced role; readback proves both role and template option
remain. The fixture drains both operations before cleanup. Existing ordinary and
platform role-write/permission tests, role assignment versus registration races,
announcement reference checks and tenant-boundary tests remain. Template currency
races continue to exercise both authoring handlers directly.

## Provider workflow guards

Removed the five `esncard-release-source` tests and their indentation/string
parsers, copied secret lists, action-version checks and assertions that other
tests exist. Four cases now parse the real baseline/certification workflows and
execute their ref and configuration guards with fixture-only environments. They
accept protected main plus complete test credentials, reject other refs/missing
credentials/live Stripe keys, and require diagnostics to omit fixture secrets.
No real credentials or provider commands are used. Workflow pin/secret-scope lint,
actual preflight outcomes, wrapper command sequencing/trace arguments and provider
UI behavior tests remain. Trigger/job topology and release dependencies stay in
workflow review; these tests prove the guards' behavior rather than their textual
position or every possible workflow wiring change.

## Release workflow execution

Removed the three release-automation source tests, including change-file/editorial
inventories. Native Knope validation remains. The replacement executes the actual
release job's shell steps in workflow order against owned temporary files and
strict fake GitHub/Git commands; only jq and ordinary local shell tools are real.
It requires both current-revision quality gates, ignores successful foreign
revision/branch/event runs, rejects newer failures and mismatched tags, validates
the draft, and requires confirmation after the publish command. No real GitHub
mutation or Git fetch occurs. Ordering/gate cases execute both steps; focused
draft-validation cases execute only the publish step to avoid repeating the same
quality-gate setup. Provider and release tests share a small YAML step
fixture loader instead of indentation parsers or source-fragment assertions.

## HTTP request logging boundaries

The server-response source check for exact `disableLogger` spelling and variable
names is removed. The Effect ESLint plugin now checks calls to the real
`HttpRouter.serve`/`toWebHandler` imports, including import aliases, namespace
access and local method aliases. It requires an explicitly true logger-disable
option, follows local constants and respects spread order. Unknown options that
could enable the raw logger are rejected. This is bounded syntax analysis, not
whole-program mutation/data-flow proof. Fifteen synthetic inputs verify valid
options, missing/false flags, spreads and unrelated/shadowed methods. Existing
middleware tests still execute private callback/token redaction, logs and traces.
No runtime server behavior was changed.

## Node request adaptation

Removed the request-body source-string test. The production Node-to-Web adapter
is now a small Effect function shared by `server.ts` and the existing Bun/Node
socket regression fixture. Runtime execution remains at the server entrypoint.
The fixture now exercises the actual adapter for exact-size bodies, streaming
oversize rejection, bodyless GET/HEAD requests, unsupported bodies and invalid
request addresses; rejection responses must carry security headers and arrive
without waiting for an untrusted stream to end. Existing abort/listener-cleanup
and native Bun boundary cases remain. Route limit selection stays in `server.ts`;
this change extracts the adapter without changing its routing policy.

The original synchronous discard/listener-cleanup checks remain separate from the
adapter's GET/HEAD response checks. Bun's Node bridge does not reliably emit the
IncomingMessage close event for an incomplete GET body after an asynchronous
handler boundary; reproducing the original inline async adapter showed the same
behavior. The adapter checks therefore observe body absence, early responses and
unhandled errors, while the existing leaf-discard fixture retains its exact
listener-cleanup assertions. No timeout was increased and no assertion was dropped.

## Add-on checkout cleanup

Removed the expiry cleanup source assertions for error suppression, fair claiming
and terminal lease clearing, plus the add-on selector and lease SQL-spelling
checks. The existing add-on PostgreSQL fixture now proves a locked earlier claim
cannot prevent a later due claim, active leases exclude a second claim, expired
leases can be reclaimed, and a stale worker cannot clear a replacement lease.
Both successful completion and expiry clear actual persisted leases. A temporary
constraint on the owned disposable database rejects a retry-schedule write;
the real worker must fail while retaining the pending payment and its lease.
The fixture always removes that constraint. The previously empty JSONPath query
check now selects real due claims, excludes future/bound/incident/terminal claims,
and proves transfer-owned payments belong only to the transfer cleanup pass.
Removed the remaining registration/transfer SQL-spelling assertions. Existing backoff, transfer retrieval,
completion/expiry races and registration cleanup cases remain.

## Configuration authoring and call-site inventories

Removed the Dependabot text inventory and Dockerfile package-manager word ban.
Dependency update configuration and base-image maintenance policy belong in review;
these tests did not exercise either process. The remaining container integrity
and runtime-image checks are still under review. Removed the recursive scan
limiting event-graph creation to exactly two call sites: adding a legitimate
transactional caller is not an application regression. Actual event creation,
rollback and account serialization coverage determine the remaining disposition.

## Event creation rollback and shared tax catalog

The existing event-creation PostgreSQL fixture now exercises both ordinary and
platform handlers with the card-discount provider enabled and disabled. A scoped
database constraint rejects the registration-option insert after the event row
has been written. The failed attempt must expose that exact constraint failure,
leave the event rows unchanged and create no audit entry; removing the constraint
allows a successful retry with the stored option, discount and expected audit.
The outer fixture transaction rolls back the test-only constraint and all data.
Removed the two source assertions for handler transaction wiring. Account-lock
ordering assertions remain under review against concurrency coverage.

The existing mixed-account/mixed-tenant tax-rate fixture also calls the ordinary
active catalog: only usable rates from its current account may be returned.

## Payment-account configuration races

Removed the remaining event-create Stripe serialization source suite. A committed
fixture now holds an account-removal transaction on a separate PostgreSQL
connection, starts each actual event handler with the earlier account context,
observes that it waits for that specific writer, and then commits the removal.
Both ordinary and platform creation must return `paymentSetupRequired` with no
event or audit entry. This does not rely on an outer seed transaction holding
locks. The existing template create/update currency races, platform graph rollback
and paid-configuration rejection tests remain; exact helper order and variable
names no longer have their own source-spelling tests.
An ignored diagnostic that replaced only the locking read with an unlocked read
failed the new writer-wait assertion while the other four related cases passed.
Production code was unchanged, and fixture cleanup completed.

## Offline hosting tools versus infrastructure text checks

Renamed the mixed hosting suite to `scaleway-hosting-tools.spec.ts` and removed
18 source-only cases covering old hostnames, Terraform resource spelling,
configuration values, role/wiring inventories, workflow ordering and scanner
settings. These checks did not execute infrastructure or prove its deployed
security properties. Infrastructure policy remains in its existing guidance and
review; native validation, image verification and runtime tests remain unchanged.
Scaleway provisioning and deployment remain deferred.

Kept all offline command and configuration cases: revision changes, manifest
validation, artifact reuse/failure cleanup, protected enablement and actual
managed-schema TLS parsing. Workflow scripts now come from the existing YAML
reader. The ops guard runs through the real step with a terminating fake deploy
command, rather than cutting source at an assumed line position. Fixture
executables and fake values prevent cloud operations. The unrelated Terraform
string assertion was removed from the retained TLS configuration test.

## Runtime image duplication

Removed the two Dockerfile/verifier spelling checks for non-root Bun startup and
source-map removal. `runtime-image-verification.spec.ts` already executes the
actual image verifier against exported-filesystem fixtures and checks image
metadata, rejected source-map/secret paths, required artifacts, cache permissions
and cleanup. The image gate still verifies the built image. Pinning, build-context
exclusions and private-package cache integrity remain under review.

The retained offline hosting tests parse each immutable workflow once per suite,
rather than reparsing the same YAML for every input permutation.

## Private package cache behavior

Removed the Dockerfile/cache-primer source spelling assertion. The actual CLI now
runs against owned lockfiles and real tar archives with a child-process fetch
fixture that cannot contact a registry. It verifies extraction and cache reuse,
rejects HTTP/foreign registry URLs, unsafe package identities, digest mismatches,
archives outside `package/` or containing parent traversal, and mismatched
extracted identities. Every run checks
its temporary directory is cleaned. The Docker build still invokes this same CLI
before the frozen install; no production cache behavior was changed.

## Pending add-on mutation boundaries

Removed five add-on/transfer source checks for RPC identity forwarding, pending
payment guards, acquisition/entitlement statement ordering and retired transfer
RPC names. One existing-fixture PostgreSQL case now attempts actual participant
cancellation and transfer creation with a pending add-on payment, and invokes the
purchase RPC as another participant with forged extra identity fields. It requires
the specific denied outcomes and unchanged ownership, stock, payments, orders,
acquisitions and transfer rows. The existing paid/free transfer journeys and
acquisition PostgreSQL cases continue to prove completed ownership and settlement.
The existing owner-status test now pins event time before the event while moving
the wall clock past both the event and Checkout expiry: it must still show the
event-time purchase availability and flag the payment link as expired. This
replaces the separate clock-wiring source assertion. Late expiry and interruption
source cases remain under review.

## Immediate refund interruption

Extracted the existing immediate-refund failure handler from the transfer claim
loop, following the existing polling-worker failure-handler shape. Tests execute
its Effect failure behavior: ordinary typed failures and defects log only safe
context and allow processing to continue; interruption, including a cause that
also contains a defect, propagates the interrupt and prevents continuation without
emitting a processing-failure log. The claim loop uses this handler directly.
Removed the source assertion for `catchCause`/interrupt-filter spelling. Durable
refund claim and settlement behavior remains covered by the existing database
suites; this extraction does not change queue or provider operations.

## Transfer expiry after lock waits

Removed the final two add-on/transfer source cases and the now-empty source suite.
The existing global-card race fixture now also runs paid and free claims whose
saved offer expires while they wait for that writer. They must return the late
expiry outcome, make no Checkout request, and preserve transfer, registration,
acquisition, payment and capacity state. A separate case reuses the expired-offer
fixture, holds its option row, advances the server clock after the handler is
observed waiting, and verifies no replacement offer or payment is created. These
use real PostgreSQL lock waits and restore the clock and connections afterward.

## Platform mutation source tail

Removed the final platform handler source-string block. Existing event/template
handler PostgreSQL cases prove graph/audit rollback and target/account behavior;
shared cancellation/approval tests and the actual platform cancellation journey
remain. The transfer fixture now also executes the actual platform check-in
handler while a new active transfer commits under its registration lock and while
an event closure commits under its event lock. Both must deny without check-in or
audit changes. It rejects a different target tenant, rolls back ticket/capacity
writes when the audit insert fails, and records one audit after a successful
retry. Actor, target, reason and resource are read from the persisted audit.

## Tax-account scope

Removed the remaining tax-account source suite. The existing paid add-on case now
first hides obsolete-account tax metadata in both owner status and event details,
rejects the purchase without stock/payment/order writes or a provider call, then
restores the current tax account and completes its original email/Checkout checks.
A transfer case similarly rejects obsolete, inactive, exclusive and missing-rate
terms before accepting a current valid rate and creating one payment.

Both actual tax-import handlers now run against committed PostgreSQL fixtures and
a fake Stripe client. An account change held by another transaction must block
the import and then reject the old provider result. A cached tax ID owned by a
different account cannot be reassigned. A clean retry persists current-account
rates and the platform path audits it once. Ordinary imported-rate listing and
platform import markers exclude rates from other accounts and tenants.

## Container source tail

Removed the two remaining container source checks. Image digest choices stay in
dependency review, with the existing Docker/Compose Dependabot configuration and
pinned images unchanged. We do not add a custom Dockerfile parser solely to enforce
tag spelling; a digest is the immutable identity regardless of its tag label.

Before the real repository image build, the image verification gate performs a
tiny native Docker scratch build with
the real `.dockerignore` and synthetic sensitive files. It checks the exported
result excludes local dotenv, Terraform state/configuration and test artifacts,
while preserving the application build inputs. No repository secrets enter this
fixture. This runs with the existing Docker image gate, so ordinary unit tests do
not gain a Docker dependency. Existing runtime image output/security checks remain.

## Mixed helper source checks

Removed trace-name spelling and monitoring-runbook assertions from the latency
probe suite; its real loopback HTTP reports, redaction, deadline and failure
checks remain. Removed the Stripe journey wiring/parallelism text check; resolver
behavior and the paid journeys remain. Protected-input tests continue exercising
real Playwright events and output/artifact redaction, without searching journey
source for helper names or asserting package-command spelling.

Removed publication tests that parsed test titles or asserted package script text
and source file types. Full documentation generation/publication verifies the
actual guide catalog and exported links; publisher fixture tests retain consumer
checkout guards, generated bundles and cleanup outcomes. Private-container tests
now assert the actual fake-curl invocation has safe protocol/configuration options
and no retry or redirect flags, alongside existing argument/environment privacy
and delivered payload checks. No external request is made.

## Review refinements

Foundation review strengthened the lint rules around direct, supported syntax.
Ledger diagnostics cover local aliases, raw SQL constant-string interpolation,
inline or locally stored insert/upsert builders, and each target in a `TRUNCATE`
list. Reads and append-only inserts remain allowed. A local binding that can
refer to protected history is treated conservatively; this is not whole-program
control-flow analysis. Browser trace settings require explicit `off`, including
object-form options without spreads that could replace the mode.

Canonical user contact/payment-field constraints now have one PostgreSQL test.
It checks named constraints, unchanged rows after rejected writes, nullable
optional values and the exact email-length boundary. The weaker duplicate in the
onboarding fixture was removed, retaining its unique invalid-domain input.
Add-on fixtures are cleaned after each case, expiry-predicate queries are scoped
to the fixture tenant, and currency races wait for the actual blocking backend.

The tax-rate browser test selects the named attendee choice instead of relying
on database row order. Accessibility scanning waits for the missing-event error
panel to hydrate, and the live-card journey waits for its reloaded form before
entering the expired protected identifier. The original outcome assertions and
timeouts remain; failed runs are retained in task evidence.

## Review outcome and verification

The source-inspection pass is complete. Remaining filesystem reads load executable
fixture commands or inspect actual generated artifacts and process output. The
RPC tag inventory test also duplicated a handwritten handler merge instead of
using the production merge, and object spread could not prove its claimed
exactly-once property. It is removed: `ServerAppRpcs.of` type-checks the production
handler map, while handler tests and HTTP journeys exercise the registered RPCs.
Publication assertions now check exported bundle slugs rather than copied catalog
metadata. The Playwright inventory is explicitly a manual orientation document.

The latest full server run passed 2,680 cases in 87.47 seconds; the recorded baseline passed 3,039 in 98.29 seconds with
the same pinned toolchain and two-worker limit. These are individual local runs,
not a hosted-CI speed claim. The expensive remaining fixtures exercise process
termination, image output/security and real command wrappers. Keep their distinct
failure outcomes; reducing those assertions solely for test-count savings would
remove useful protection. Earlier lifecycle grace reductions and removal of a
duplicate production build already target measured repeated work.

Publication and merge require the full local suites, fresh reviews, hosted
checks and a timing comparison. Validation and delivery evidence are recorded in
[the foundation PR](https://github.com/evorto-app/app/pull/198) and
[the remaining cleanup PR](https://github.com/evorto-app/app/pull/197).
Passing targeted tests alone does not satisfy those gates. Scaleway cloud
operations remain deferred.
