# Changelog

All notable changes to this project will be documented in this file.
## 0.0.1 (2026-07-21)

### Features

#### Add the staging-first Scaleway runtime, infrastructure, deployment, object

storage, email delivery, observability, and local PostgreSQL platform while
keeping production disabled pending explicit acceptance. Retire the legacy Fly
application workflow, configuration, hostname defaults, and deployment token.
Keep web liveness independent from database readiness, make managed database
password rotations explicit, and promote validated receipt bytes away from
browser-writable upload keys before they become durable evidence while
discarding any losing copy from concurrent finalization.

#### Migrate forms to Angular Signal Forms

Migrate form models, templates, and custom form controls from legacy reactive
forms/CVA patterns to Angular Signal Forms.

Highlights:

- migrate form bindings to `form()` + `[formField]` patterns,
- move reusable form logic into signal-form schemas and defaults,
- update reusable child form composition and hidden-field behavior,
- fix migration regressions (date handling, dependent permissions, role
  autocomplete de-duplication, location search input behavior),
- update docs/e2e coverage for key signal-forms flows.

#### Derive each tenant's secure public origin from its normalized primary domain,

and use that trusted origin for tenant-scoped email and Stripe return links
instead of request-controlled or process-global origins. Primary-domain
changes now wait for pending Stripe and registration-transfer links to finish,
and the platform UI documents the old-domain redirect required for already-
issued QR codes.

### Fixes

- Publish the complete generated guide suite through the tracked Evorto Pages synchronization contract, with an exact 13-guide lifecycle catalog, versioned bundle metadata, integrity hashes, and fail-closed guide inventory checks.
- Hide template and category write actions when the current user lacks the corresponding capability, while keeping categories available as an explicit read-only view.
- Represent platform administrators as explicit Auth0-backed principals, keep their authority separate from tenant roles, and add target-scoped platform operations for tenants, attributed full-graph event and template management, registration approval/cancellation/check-in, user roles, finance and refund recovery, and tax administration. Supported registration modes remain first-come-first-served and manual approval; legacy random-allocation records stay readable but cannot be persisted by platform create or update operations. Registration inspection accepts a deterministic ticket-result URL and bounds PII-bearing lists to 100 records. Every platform mutation requires an operator reason and commits a typed, PII-free before/after audit entry alongside the domain change without inventing a tenant user.
- Reject oversized RPC and Stripe webhook bodies before buffering them in memory.
- Bridge success and warning state colors through the Material and Tailwind themes with coherent light, dark, and increased-contrast pairs.
- Distinguish empty location searches from missing Google Maps configuration and temporary provider failures, with retryable search and place-detail states.
- Fail receipt uploads and approvals closed when the exact scoped receipt object cannot be verified, while keeping rejection available and explaining unavailable evidence to reviewers.
- Keep Scaleway SSR readiness checks on the container-local RPC path and bound deployment smoke probes.
- Keep repeated staging deployments idempotent when the database has already been initialized.
- Keep authenticated application sessions valid for the encrypted Auth0 session lifetime instead of ending them when an unused OAuth access token expires.
- Make reusable icon and role selectors keyboard operable with reliable accessible names, and label event-page icon actions for screen readers.
- Propagate the resolved tenant through trusted internal RPC requests during anonymous server-side rendering.
- Show accessible first-load errors with explicit retry actions on the tenant user list, transaction history, account-creation form, and template-based event creation.
- Validate tenant default locations against the canonical Google location schema at the RPC boundary.

#### Add tenant registration policy settings

- add tenant defaults for registration transfer and cancellation deadlines,
- add cancellation fee-refund policy control to general settings,
- preserve nullable event and template registration-option overrides when templates become events.

#### Add fixed-bundle registration transfers

- let confirmed participants create a private transfer link and manual claim code while their source ticket remains active,
- revalidate the recipient against current eligibility and questions, then price the unchanged registration, guest count, and complete add-on bundle from current base prices with recipient-current discounts only,
- keep the same confirmed registration, add-on lots, quantities, check-in state, and fulfillment history while changing ownership in place,
- use tenant-connected Stripe Checkout with the platform application fee for paid claims and queue one exact remaining refund claim for every original source Stripe payment,
- record each owner, payment, settled registration/add-on component, and cancellation allocation in an append-only acquisition ledger so repeat transfers never infer ownership from timestamps,
- complete a transfer without Stripe only when the entire bundle is free and no source refund is required,
- require every event registration option and add-on to remain free when the tenant has no connected Stripe account,
- preserve exact checkout and refund claims across retries, expiry, webhook replay, account rotation, and operator recovery,
- block conflicting mutations only while an offer or Checkout owns the ticket, and fully refund a paid recipient if a competing source change still wins,
- and document and cover the participant transfer journey without storing raw bearer credentials.

#### Add versioned tenant onboarding

- require every tenant user to accept the current immutable privacy-policy version and answer active tenant questions before protected access,
- let tenant administrators publish hosted or linked policy versions and immutable short-text or selection questions with an explicit affected-user warning,
- preserve a user's home tenant across additional tenant joins and expose an explicit profile action to change it,
- document and functionally cover first joins, policy reacceptance, persisted answers, default-role assignment, and cross-tenant home behavior.

#### Require credential-backed Google Maps location search and place-detail evidence for production releases, and remove the retired Cloudflare Images editor-upload RPC, runtime configuration, cleanup tooling, and dependencies while preserving S3-compatible asset storage.

Harden repository workflows with immutable action pins, step-scoped secrets, explicit reusable-provider secret inputs, and separate test and production Stripe credentials. Require an explicit production storage bucket without coupling provider certification to a specific deployment platform.

#### Align Scaleway release smoke checks with the rendered events route and the

Effect RPC protocol error envelope.

#### Apply tenant runtime settings consistently

- fix application and Material formatting to `de-DE` while removing locale from tenant-admin writes,
- apply tenant currency and IANA timezone defaults consistently in SSR, browser rendering, date inputs, and event-day grouping,
- preserve stored event instants and transaction currencies while keeping post-data currency/timezone edits locked.

#### Avoid cross-tenant registration-transfer deadlocks by reading notification

addresses without taking unnecessary global user-row locks.

#### Bootstrap an empty Scaleway staging database safely

Initialize deterministic staging data before deploying web only when every
application table is empty. Preserve all existing staging data during normal
deployment reconciliation and fail closed when partial data lacks the required
staging tenant.

Use PostgreSQL's canonical receipt-expiry default expression so repeated schema
plans remain stable after the first application.

#### Stabilize Bun local runtime around Neon and Effect RPC SSR transport

Improve local Bun runtime reliability for migration and CI parity by:

- preferring Neon local fetch transport paths (no websocket handoff) in app and Playwright DB clients,
- removing transaction-only registration seeding writes that forced websocket fallback under Neon local,
- aligning runtime test defaults to deterministic local ports for auth callback consistency,
- resolving server-side Effect RPC requests through an absolute `/rpc` origin during SSR.

#### Stabilize Bun template flows and docs e2e reliability

Finalize Bun-first migration quality gates by:

- removing transaction-only template simple create/update writes that failed on Neon local websocket transaction paths under Bun,
- persisting template `location` consistently across create and update inputs in the simple template router,
- tightening docs test selectors/navigation for profile discounts and event approval workflows,
- reducing template e2e data collisions by generating unique template titles per run,
- validating final Bun gates end-to-end (`lint`, `build`, `test`, `e2e`, and `e2e:docs`).

#### Complete organizer and helper signup

Separate organizer/helper choices from participant registration, explain
direct and approval-based access states, refresh event and scanner capabilities
after signup or cancellation, gate organizer operations with server-derived
permissions, identify organizer/helper passes in the event and profile UI, and
add executable functional and generated-documentation journeys.

#### Classify managed database TLS failures

Distinguish hostname, trust-chain, expired, and not-yet-valid certificate
failures in bounded ops logs so staging deployment diagnostics identify the
safe remediation without exposing provider command output.

#### Close production-readiness review gaps

- protect credential-backed E2E runs and suppress authenticated trace artifacts,
- reject unsafe or ambiguously masked Playwright reporter sinks before protected values can be entered,
- enforce recipient registration limits when paid transfers finalize,
- keep exact transfer-refund progress visible to the previous owner without restoring ticket actions,
- scope transfer-email idempotency to each transfer operation,
- use the target tenant timezone for platform event editing,
- align event duration, add-on limits, and migration domain handling with their persisted contracts.

#### Complete transactional registration notifications

- render accessible HTML and plain-text lifecycle emails with React Email,
- queue idempotent confirmation, cancellation, waitlist-availability, and transfer messages in the same database transactions as their registration transitions,
- link confirmed participants back to their authenticated ticket page without turning the URL into a bearer credential, and
- keep delivery retries, leases, sender policy, and operator visibility at the durable outbox boundary.

#### Require explicit confirmation before participant or organizer registration cancellation, keep the safe action focused by default, and document cancellation, refund, capacity, waitlist, and recovery behavior.

Prevent failed organizer participant or receipt queries from appearing as verified empty data, and provide explicit retry actions for both operations.

#### Refresh dependency and vendored upstream baselines

Update the root dependency set across Angular, Effect, Drizzle, Stripe,
Cloudflare, Sentry, Tiptap, Playwright, Tailwind/PostCSS, ESLint, Prettier, and
type packages.

- align vendored `repos/effect` with Effect `4.0.0-beta.92`,
- align vendored `repos/drizzle` with Drizzle `1.0.0-rc.4`,
- update the Bun toolchain references to `1.3.14`,
- temporarily run Angular CLI package scripts through Node `24.15.0` in CI and
  Docker until Bun exposes a Node compatibility version accepted by Angular 22.

#### Diagnose silent Drizzle schema failures

Retry failed, empty Drizzle JSON responses with a non-mutating text-mode
explain command so staging deployment logs retain a redacted database failure
category without exposing provider output.

#### Make manual registration approval concurrency-safe

- claim one pending registration payment before reserving capacity or calling Stripe,
- persist an immutable Checkout request so concurrent attempts and crash retries reuse the same transaction and idempotency key,
- expose honest organizer and participant recovery states while a payment link is being prepared,
- serialize cancellation against approval and require exact local transaction/session ownership in Stripe webhooks, and
- document the complete free and paid manual-approval journeys with generated Playwright guidance.

#### Make local E2E configuration deterministic

- refresh the supported worktree-local `.env.dev` override before canonical Playwright commands,
- load developer secrets from `.env` without introducing alternate dotenv filenames, and
- default `NO_WEBSERVER` to `false` when it is unset so local commands start the tested application stack.

#### Split public RPC errors from server implementation errors

Restructure Effect RPC error handling so the shared contract exposes only
serializable public tagged errors while server-only implementation and
integration failures stay on the server side.

- move public domain error schemas next to their RPC contract modules,
- keep global boundary errors centralized in `src/shared/errors/rpc-errors.ts`,
- preserve defects until the server boundary instead of normalizing them into
  ordinary RPC failures, and
- align handlers with typed `Schema.TaggedError` contracts and explicit mapping.

#### Move icon selector APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the icon domain to Effect RPC:

- add shared `icons.search` and `icons.add` Effect RPC contracts,
- implement authenticated icon handlers in the Effect RPC server layer,
- migrate icon selector client calls and query invalidation to Effect RPC helpers/client,
- remove `icons` from the tRPC app router surface and delete the unused tRPC icons router.

#### Move template category APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the template category domain to Effect RPC:

- add shared `templateCategories.findMany`, `templateCategories.create`, and `templateCategories.update` Effect RPC contracts,
- implement authenticated/permissioned template category handlers in the Effect RPC server layer,
- migrate template category query/mutation callsites to Effect RPC helpers/client,
- remove `templateCategories` from the tRPC app router surface and delete the obsolete tRPC template category router.

#### Move templates grouped-by-category reads from tRPC to Effect RPC

Continue the template-domain cutover by migrating grouped template-list reads to Effect RPC:

- add shared `templates.groupedByCategory` Effect RPC contract and typed response schema,
- implement tenant-scoped grouped template read handler in the Effect RPC server layer,
- migrate template list and category list query callsites to Effect RPC helpers,
- update create/edit invalidations to target Effect RPC query keys for grouped templates,
- remove `templates.groupedByCategory` from the tRPC template router.

#### Add tenant registration graph editing

- let tenant organizers switch templates and draft events between simple and advanced registration configuration with explicit confirmation
- support arbitrary registration options, option-targeted questions, and reusable multi-option add-ons without losing included or optional quantities
- persist event-owned template snapshots and prevent later template edits or concurrent stock changes from rewriting draft event configuration
- keep legacy random allocation readable while requiring an explicit supported-mode migration before editing

#### Enable participant add-on purchases after registration

- let confirmed participants buy eligible add-ons before or during an event,
- settle free add-ons immediately and keep paid add-ons pending until the exact Stripe Checkout completes,
- preserve retry-safe Checkout recovery across reloads without exposing premature entitlements, and
- explain purchase, cancellation, and transfer blockers on the active ticket.

#### Enforce complete pull request quality gates

Require lint, both unit suites, the application build, Knope validation, the
dedicated PostgreSQL 17 integration suite, and every applicable Playwright
baseline to pass completely on a developer machine before any push, pull-request
update, or CI-triggering action. Vitest and Playwright now reject skipped, todo,
fixme, expected-failure, interrupted, focused, retried, or flaky outcomes;
missing disposable-database configuration fails loudly, and CI only confirms an
already-green local result. GitHub release publication also waits for successful
PR Quality and E2E Baseline main-push runs for the exact release merge commit.
CI provisions Chromium for browser-backed security unit tests and Bun for the
runtime-image verification step instead of relying on runner-global tools.

#### Enforce tenant identity across role assignments and registrations

- bind every role assignment to the shared tenant of its role and membership,
- reject registrations whose event belongs to another tenant, and
- reject registrations whose selected option belongs to another event.

#### Release registrations after an unbound Checkout expires

- sweep a bounded batch of expired registration payment claims that never bound a Stripe Checkout session,
- serialize cleanup with approval, cancellation, and webhook transitions before cancelling the exact local claim, and
- release the registration's reserved capacity and add-on inventory atomically.

#### Explain how guest registrations affect capacity and paid totals, prove that

unlisted events remain available through their direct links, and keep event
creation errors visible without discarding the organizer's form entries.

#### Expose cancellation refund progress and recovery

Show participant-safe refund progress on cancelled Profile event cards and
operator-safe lifecycle summaries in platform finance, distinguish queued,
provider-action, stopped, and recovered states consistently, fail closed before
a paid add-on cancellation can mutate inventory without a reconciled payment
allocation, and document the signed Stripe failure and audited recovery journey.

#### Polish finance receipts submission, approval, and refund flows

Update the finance receipts experience with:

- tenant-level finance settings for allowed receipt countries plus an `Allow other` toggle,
- shared receipt form fields between submit and approval flows (date picker, tax amount, country select, checkbox-driven amount fields),
- refund list stability fixes to prevent signal writes during template rendering and keep the Material table flow reliable,
- removal of the finance overview shortcut to profile receipts,
- updated Playwright specs and docs coverage for the receipts workflows.

#### Fix anonymous authenticated-route deep links

Redirect first-time anonymous visitors from protected staging links into Auth0
instead of returning the unknown-organization page when Angular cancels its
initial server-side navigation.

#### Fix Scaleway private database deployment output

Use the private database endpoint IP when constructing role-scoped database
secrets because Scaleway private RDB endpoints do not provide a hostname.

#### Gate repository releases on live ESNcard certification

Require protected active and permanently expired non-production ESNcard
identities to pass live add, refresh, remove, expired-state, and provider-error
UI verification before a repository release can be published. Knope Bot keeps
version and changelog preparation reviewable in its release pull request and
creates a draft GitHub release; after merge, automation verifies that the draft
tag targets that exact merge and publishes it only after provider certification.
Deployment orchestration is intentionally left to its separate change.

#### Grant the Scaleway schema owner database access

Grant the deployment-only schema owner explicit access to create and update
objects in the managed application database while retaining the separate
read/write-only runtime role.

#### Make registration refunds and Stripe ownership durable

- persist each registration payment's owning Stripe Connect account and use it for Checkout retries, expiry reconciliation, fee hydration, and refunds,
- create refund claims atomically with local registration transitions, then reconcile them through idempotent retry workers and Stripe webhooks,
- recover terminal or exhausted refunds on the same source-linked claim with generation-aware idempotency and archived attempt history,
- preserve the immutable gross payment amount while storing Stripe application fee, processing fee, and net amount separately,
- enforce participant cancellation deadlines and choose gross-versus-net refunds from the locked tenant and registration-option policy,
- finalize transfer Checkouts and exact source refunds through append-only acquisition payments and components instead of generic capacity cleanup or timestamp-based ownership inference,
- lease and reconcile bound Checkouts through their persisted Connect account, recovering missed paid completion for direct, manual, and transfer registrations only after exact gross-amount and currency validation,
- route delayed-payment success through the same idempotent completion transition and preserve only Stripe-confirmed retryable failures, and
- keep Checkout expirations safely inside Stripe's minimum and maximum creation windows, and
- block connected-account changes while registration Checkouts or refunds remain pending.

#### Keep uploaded tenant branding tenant-bound

- reject uploaded logo and favicon paths that belong to another tenant or the
  wrong brand-asset kind,
- exercise real object-storage uploads in the tenant settings browser test,
  and
- document upload, save, persisted readback, and recovery behavior in the
  generated tenant settings guide.

#### Tighten Neon Local CI wiring and TLS guardrails

Follow up on Neon Local runtime review feedback by:

- forwarding Neon branch-related environment variables into the Docker `db` service for CI runs,
- removing the unnecessary CI hard-fail on `PARENT_BRANCH_ID` because Neon defaults to the project's default branch when it is unset,
- restoring `@db/*` imports in Playwright fixtures,
- limiting the Neon Local TLS certificate bypass to local proxy hostnames only.

#### Normalize Scaleway container IDs for deployment updates

Strip Terraform's regional resource prefix before passing a container UUID to
the Scaleway CLI, and report which deployment boundary fails without exposing
protected values.

#### Normalize Scaleway Secret Manager IDs for deployment

Expose bare Secret Manager UUIDs to the deployment scripts because the
Scaleway CLI accepts the region separately from each secret identifier.

#### Align Playwright tests with new structure and linting

- migrate Playwright tests to `tests/**` (docs in `tests/docs/**`) and retire legacy `e2e/` layout,
- enforce required `@track`, `@req`, and `@doc` tags via ESLint for Playwright tests,
- update documentation, configs, and tooling references to the new test structure,
- require every collected functional and documentation test to pass without skips, fixmes, retries, flakes, or other incomplete outcomes.

#### Reconcile Checkout cancellation before releasing registrations

- require Stripe to confirm a bound Checkout is expired before cancelling its local payment claim or releasing reserved capacity,
- keep unbound or unconfirmed payment claims intact with an explicit retry path,
- serialize completion and expiry webhooks with registration-first row locks and exact transaction/session ownership, and
- cover competing completion and expiry delivery against real Postgres state.

#### Recover email delivery after worker crashes

- lease each claimed outbox row and automatically reclaim expired or legacy `sending` rows,
- fence delivery completion by lease ownership so an older worker cannot overwrite a newer claim, and
- reuse the existing Resend idempotency key while recovering an interrupted delivery attempt.

#### Tighten relaunch admin, registration, and scanner behavior

- add tenant-scoped existing-user role assignment behind `users:assignRoles`
- hide Scanner navigation unless the user can scan through permissions or an active organizing registration today
- expose manual approval as the supported non-FCFS registration mode while rejecting unsupported random allocation on write paths
- add tenant operations settings for email reply-to, Stripe account id, and active registration limits
- queue receipt and manual-approval notifications through a durable email outbox with global-admin visibility
- require the Resend API key at startup and send manual approval/receipt review emails from `ESN.WORLD <no-reply@notifications.esn.world>`

#### Report private ops failures safely

Return only a fixed failure category from private schema operations so a
failed deployment is actionable without exposing database output, and verify
managed PostgreSQL certificates against IP connection identities explicitly.

#### Require change files for release notes

Document the team policy to always use Knope change files in `.changeset/*.md`
for release documentation, instead of relying on conventional commits or PR
titles.

#### Restore first-party QR scanner camera access

- allow the authenticated first-party scanner to request camera access while keeping geolocation and microphone disabled,
- expose accessible camera starting, ready, and failure states with retry guidance,
- use one server-authoritative test clock for scanner timing, check-in timestamps, and seeded Docker event windows,
- add server and page-backed camera-policy regressions,
- add a beginner-friendly generated check-in guide covering navigation, camera recovery, partial guest arrival, duplicate scans, and organizer totals.

#### Return reviewed events to draft

- replace the stale durable rejected status with a return-to-draft transition,
- require and preserve reviewer feedback and reviewer audit fields on the draft,
- keep only drafts editable and eligible for review submission, and
- align event review actions, status copy, tests, and generated documentation
  with the draft, pending-review, and published lifecycle.

#### Scope imported Stripe tax rates to their owning Connect account, reject stale

or unowned metadata in payment configuration and Checkout paths, and
atomically remap assigned rates to exact semantic matches when the connected
account rotates.

The fresh target schema requires account ownership directly. Server writers
serialize paid event and template configuration, tax-rate imports, and account
rotation on the tenant row. Legacy data transfer must provider-verify every
imported rate and write its owning account; nullable staging rows, production
backfills, and runtime-installed integrity triggers are not part of the release
path. The schema-managed tenant/rate unique index remains the conflict target
for account-scoped import upserts.

#### Harden tenant authorization, trusted media, payments, and registration concurrency

- separate tenant-role permissions from platform-global authority, isolate
  cached permissions and data per browser or SSR application, and execute event
  organizer/edit guards directly while retaining server authorization as the
  source of truth,
- bind public links, receipt uploads, and icon catalog writes to trusted tenant context,
- bound Stripe webhook ingress and require persisted checkout/account/payment bindings,
- apply security headers and sanitized server fallbacks before response transmission while preserving client aborts, and
- serialize active registrations and pending checkout claims across concurrent requests.

#### Stabilize event review documentation coverage

Wait for event review mutations to complete before checking the persisted event
status, preventing transient queue rerenders from racing the documentation test.

#### Stabilize Neon Local shutdown on Docker Desktop

- keep Neon Local branch metadata in a project-scoped Docker volume by default,
- initialize the metadata mount for Neon's unprivileged runtime user,
- share the same metadata volume with the branch-expiration fallback,
- fail closed instead of autonomously restarting Neon without the expiration sidecar,
- fail startup when the expiration fallback cannot be installed,
- give Docker up to 60 seconds to stop Neon Local while retaining branch
  expiration as a fallback for interrupted deletion,
- remove Playwright-owned Compose objects after process exit or shutdown while
  refusing stopped persistent stacks and leaving reused user-owned stacks
  running,
- reject attempts to resume an already-deleted ephemeral branch,
- retain only the explicit non-secret service log allowlist in CI artifacts, and
- retain an explicit host-directory override for controlled environments such as CI.

#### Stabilize profile edit browser coverage

Wait for the profile form to finish initializing and commit each edited field
before checking the persisted reimbursement details.

#### Align tax rates track behavior with specification

Align tax rate permissions, sync behavior, and registration persistence with the tax-rates conductor track.

Highlights:

- switch tax-rate admin access checks from `admin:manageTaxes` to `admin:tax` (with legacy compatibility mapping for existing roles),
- enforce server-side rejection of non-inclusive Stripe tax rates during import,
- persist selected registration tax-rate snapshot fields (`tax_rate_id`, name, percentage, inclusive/exclusive) on `event_registrations`,
- require tax-rate selection only when registration options are paid.

#### Migrate rich text editor from TinyMCE to Tiptap core (MIT-only)

- replace TinyMCE integration with a Tiptap core editor implementation in shared form controls,
- add server-side rich text sanitization for template and event descriptions,
- enforce an MIT-only guard for Tiptap dependencies and block Tiptap Platform/Pro references.

#### Preserve recorded currency throughout receipt workflows

- record the tenant currency on each new receipt and render review/profile
  amounts from that immutable value,
- keep reimbursement batches currency-homogeneous and create their ledger
  transaction in the receipts' recorded currency,
- serialize receipt review and reimbursement so the ledger always uses the
  locked approved amount, currency, status, and current payout destination,
- prevent tenant and platform-admin currency edits from reinterpreting existing
  template, event, receipt, or transaction amounts without a dedicated migration,
- cover AUD submission and CZK approval and reimbursement in Playwright.

#### Verify managed PostgreSQL TLS during schema deployment

Configure the packaged Drizzle schema tool with Scaleway's managed database CA
instead of opening an unverified URL-only connection.

#### Verify the private database endpoint

Verify managed PostgreSQL certificates against the actual connection host by
default so Scaleway's private-only database certificate matches schema and
runtime connections, while retaining an optional server-name override for
other providers.

#### Verify the Scaleway database server identity

Keep database traffic on the private-network IP while verifying Scaleway's
certificate against that endpoint identity. Classify bounded schema command
failures without logging provider output, and exclude local Terraform working
data from container build contexts.

#### Wait for template edit hydration in documentation coverage

Prevent the server-rendered template edit form from restoring stale controlled
field values after Playwright starts editing it.
