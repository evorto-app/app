# Changelog

All notable changes to this project will be documented in this file.
## 0.0.1 (2026-09-26)

### Features

#### Published sign-up events appear when a person can use at least one sign-up

choice. People who are not signed in see them when a choice is open to new
members. Direct links still open and explain when sign-up is unavailable.

#### Add the staging-first Scaleway runtime, infrastructure, deployment, object

storage, email delivery, observability, and local PostgreSQL platform while
keeping production disabled pending explicit acceptance. Retire the legacy Fly
application workflow, configuration, hostname defaults, and deployment token.
Keep web liveness independent from database readiness, make managed database
password rotations explicit, and promote validated receipt bytes away from
browser-writable upload keys before they become durable evidence while
discarding any losing copy from concurrent finalization.

#### Remove the old, separate template editor so every template is created and

edited through the same complete setup.

Keep category edits available until their save outcome is known. If a category
was saved but its list could not be updated, explain how to view the saved
details without submitting the change again.

Templates no longer set the listing choice for new events. New events use the
standard listing setting; event review and access rules still apply.

Explain how to recover when a category or template is no longer available, while
keeping unsaved category entries visible. Distinguish repeated template entries
from concurrent changes, and scope category failure logs to the template feature.

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
and the platform UI warns that links and QR codes using the old address will
stop working.

### Fixes

- Publish the complete generated guide suite through the tracked Evorto Pages synchronization contract, with an exact 13-guide lifecycle catalog, versioned bundle metadata, integrity hashes, and fail-closed guide inventory checks.
- Hide template and category write actions when the current user lacks the corresponding capability, while keeping categories available as an explicit read-only view.
- Represent platform administrators as explicit Auth0-backed principals, keep their authority separate from tenant roles, and add target-scoped platform operations for tenants, attributed full-graph event and template management, registration approval/cancellation/check-in, user roles, finance and refund recovery, and tax administration. Supported registration modes remain first-come-first-served and manual approval; legacy random allocation is excluded from the fresh target schema and supported API records. Registration inspection accepts a deterministic ticket-result URL and bounds PII-bearing lists to 100 records. Every platform mutation requires an operator reason and commits a typed, PII-free before/after audit entry alongside the domain change without inventing a tenant user.
- Bind event and template discounts to their registration option owner, prevent duplicate discount types on one option, and reject negative discounted prices. Preserve the existing creation and editing paths, including simple templates and copied event discounts, by writing the matching event or template ID.
- Reject oversized RPC and Stripe webhook bodies before buffering them in memory.
- Bridge success and warning state colors through the Material and Tailwind themes with coherent light, dark, and increased-contrast pairs.
- Use the shared receipt-country policy validator consistently so malformed organization settings retain their precise validation errors.
- Explain denied access and page recovery, clarify unpublished legal pages, and require the internal-pages capability before opening the Members Hub.
- Name the affected application, ticket, pending sign-up or waitlist place when a cancellation outcome cannot be confirmed, and direct the user to check its current status before retrying.
- Declare row and column headers in platform change-history tables so assistive technology can identify each changed value.
- Clarify that sign-up questions remain available in Simple setup for events and templates, while add-on controls stay hidden until Advanced setup.
- Describe the tenant-wide ticket scanner accurately, give missing-ticket recovery guidance, and align the scanner guide with the current check-in window states.
- Report missing warm-request upstream timings as insufficient evidence, retain measured sample counts, and fail enforced latency checks when evidence is incomplete.
- Pass the protected Google Maps key to the baseline E2E web container and validate its presence before starting CI setup, so application readiness can succeed.
- Confirm successful platform template updates when the editor is already on the saved template page.
- Distinguish empty location searches from missing Google Maps configuration and temporary provider failures, with retryable search and place-detail states.
- Fail receipt uploads and approvals closed when the exact scoped receipt object cannot be verified, while keeping rejection available and explaining unavailable evidence to reviewers.
- Wait for the host Playwright app to finish cleanup before restoring its local object storage when shutdown signals repeat. Preserve the first shutdown status and leave previously running storage containers running.
- Keep Scaleway SSR readiness checks on the container-local RPC path and bound deployment smoke probes.
- Keep repeated staging deployments idempotent when the database has already been initialized.
- Keep authenticated application sessions valid for the encrypted Auth0 session lifetime instead of ending them when an unused OAuth access token expires.
- Keep a confirmed event or template create locked after navigation or list refresh fails, so submitting the same form cannot create a duplicate.
- Finalize paid ticket transfers with an explicit compatible tenant lock while rechecking recipient eligibility, preserving the settled payment account and transfer ownership checks.
- Make reusable icon and role selectors keyboard operable with reliable accessible names, and label event-page icon actions for screen readers.
- Check scanner access before starting the camera and provide clear retry choices when a ticket cannot be opened. Remove the incomplete recent-ticket list from administrator ticket support.
- Keep the confirmed cancellation outcome visible when refreshing the organizer page fails, and explain how to reload the current details without repeating the cancellation.
- Preserve paid event prices and tax selections in platform administration when payment settings are unavailable. Pause saving and paid controls until current settings load, provide a retry after failed reads, and reject tax rates with incomplete percentage data.
- Propagate the resolved tenant through trusted internal RPC requests during anonymous server-side rendering.
- Keep ticket QR images and error responses private and non-cacheable, and give clear sign-in, missing-ticket, and organizer-help messages when a ticket cannot be opened.
- Use upstream Quay copies of the pinned MinIO server and client images so clean development and CI runners can pull them anonymously.
- Refresh the Angular Query patch release and lint plugin. Keep fixture UUID generation on the patched CommonJS-compatible UUID release without changing the runtime Effect or Auth0 dependency versions.
- Redact credential headers in Playwright failure diagnostics even when request logs contain terminal formatting. Preserve failed-test details and prevent protected values in formatted attachments from escaping the reporter.
- Load the saved event details before returning from the editor and prevent an older cached read from replacing them. Clarify save recovery and verify the returned details before reloading documentation pages.
- Reject tax rates with empty or whitespace-only percentages in paid template validation, selectable rate catalogs, and registration checks. Selected paid add-ons report their unavailable tax details before starting a sign-up or payment. Existing selections remain visible as unavailable until an organizer chooses a usable rate; valid zero-percent rates remain supported.
- Reject missing or invalid organizer event IDs before loading event data, and keep raw command output out of schema-operation logs and trace exception records.
- Remove the unsupported random allocation mode from the registration schema, API records, and event/template editors. First come, first served and Manual approval retain their existing behavior. Apply this as part of the coordinated fresh-schema relaunch; existing random rows must not be silently converted to another mode.
- Remove the unused Checkout retry API. Existing pending sign-ups retain their payment link and cannot create a second payment by repeating registration.
- Clear the obsolete read-failure warning after an explicit successful retry following an event review conflict. Preserve the original conflict, reviewer comment, and any unconfirmed or confirmed action outcome.
- Preserve strict settings input validation after separating the administration pages. Reject unsupported fields and keep registration limits and receipt-country choices within the existing supported values.
- Keep unavailable saved template tax rates visible and require an available rate with a percentage before saving a paid sign-up choice or add-on.
- Remove the legacy ordinary `events.update` API. Event editing continues through `events.updateGraph`, including date, registration, permission and payment validation. The platform event update API remains available.
- Remove tracking images from persisted template descriptions when loading template details, and distinguish malformed create input from a concurrent edit.
- Prevent home organization changes from deadlocking with concurrent event registrations, while rejecting changes after organization membership is removed.
- Prevent Chromium from replaying intercepted tenant requests during test page cleanup by settling browser requests before closure while draining each original upstream request once.
- Capture organization email settings and payment deadline time zones after the approval transaction acquires the organization lock.
- Use clear ticket, sign-up, place, item, and refund wording throughout ticket scanning and add-on handout flows. Show task-specific recovery messages instead of unexpected failure details.
- Keep guest quantities within the ten-guest limit and available capacity, including repeated edits, and explain the 2000-character answer limit before registration or waitlist requests are sent.
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
- preserve exact checkout and refund claims across retries, expiry, webhook replay, and operator recovery,
- block conflicting mutations only while an offer or Checkout owns the ticket, and fully refund a paid recipient if a competing source change still wins,
- and document and cover the participant transfer journey without storing raw bearer credentials.

#### Keep joining information current

- Ask every member to accept the current privacy policy and answer the current
  joining questions before entering protected areas.
- Let organization administrators publish a privacy policy and joining
  questions, with a clear warning when existing members must answer again.
- Show the latest privacy policy to members and public visitors.
- Keep a person's home organization when they join another one, with a profile
  action for changing it.

#### Align event listing and review feedback

Keep event-list pages aligned with the shared request limit and use consistent
"return to draft" wording when review feedback is required.

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

#### Bind saved registration answers to the same event, registration option, and tenant as their registration and question. Preserve questions with saved registration or transfer answers when organizers edit an event.

Serialize event-question edits with registration, waitlist, and transfer answer validation so concurrent writes cannot delete history or accept outdated required-question sets. Reject nonzero prices on free graph options before persistence, and index transfer answers by question for bounded history checks.

#### Bootstrap an empty Scaleway staging database safely

Initialize deterministic staging data before deploying web only when every
application table is empty. Preserve all existing staging data during normal
deployment reconciliation and fail closed when partial data lacks the required
staging tenant.

Use PostgreSQL's canonical receipt-expiry default expression so repeated schema
plans remain stable after the first application.

#### Validate event-list page offsets, require canonical timestamps, and show at most 100 events per page. Load more events without losing earlier pages.

Wait for event results or an explicit error before completing server rendering, so initial HTML does not retain a loading message after the request has finished.

Show the event-list actions menu only when the visitor can create events, so public visitors do not open an empty menu.

#### Bound registration guests, add-on quantities, and sign-up question text consistently across storage and supported event, template, and transfer inputs. Existing registrations retain their ownership and payment workflows. Platform template editors show overlong question help text errors beside the field.

Reject platform event add-on mappings above the combined included and optional quantity limit with a typed input error before opening a database mutation.

Store pending transfer answers with the same 2000-character limit as completed
registration answers. Offer only tax rates with a percentage, including valid
zero-percent rates. Free add-on browser fixtures own their event and registration
graph so failed setup cannot remove seeded acquisition history. Apply the current
schema through the existing isolated reset/setup flow; no incremental migration
is introduced.

Reject oversized stored question sets and implicit included add-on selections before registration or transfer actions. Require tax references for paid add-on and transfer prices, preserving free and included quantities and zero-percent rates. Validate persisted Checkout snapshots, including their 100-line limit, before resuming provider requests. Explain unavailable registration settings to participants while preserving the authorized event edit route.

Reject event creation from stored templates that exceed the add-on or sign-up question limits before copying any event data.

Reject new transfer claims for oversized stored add-on bundles before expanding their fulfillment or recipient prices. Keep supported bundles complete, and explain oversized bundles in the claim view.

Show the sign-up answer character limit before participants start typing, alongside any organizer guidance, while keeping the existing input limit and validation.

Reject oversized stored included-plus-optional add-on mappings before selecting entitlements, and check all event add-on types before offering public registration. Keep authorized event editing available for repairs. Show the transfer-answer character limit alongside organizer guidance while preserving the native Signal Forms limit.

Report unavailable registration settings before offering a paid sign-up when its tax reference or percentage is missing. Keep zero-percent tax rates and free options available, without requiring tax details for unselected optional add-ons.

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

#### Confirm settings saves and current values before clearing entered fields. Explain unconfirmed responses and failed reads after confirmed saves, block repeated changes, and offer an explicit reload that replaces retained entries with saved values.

Keep new member setup publication separate from navigation and later reads. A
confirmed publication offers navigation recovery; an uncertain outcome retains
entries and requires checking saved setup before another publication.

Reject stale edits using the original values for the specific settings page. Preserve entered values for an explicit reload while allowing saves to unrelated settings pages.

#### Clarify payment and add-on availability

Explain when paid event and template choices are unavailable because the organization has no connected Stripe account. Describe included add-ons without promising that every add-on can be purchased during sign-up.

#### Explain unavailable event links

Explain when an event cannot be found or is unavailable to the viewer, and offer
a link back to Events. Keep retry guidance for temporary loading failures.

Use the same Event not found heading throughout missing or inaccessible event pages.

#### Classify managed database TLS failures

Distinguish hostname, trust-chain, expired, and not-yet-valid certificate
failures in bounded ops logs so staging deployment diagnostics identify the
safe remediation without exposing provider command output.

#### Close event check-in two hours after an event ends, explain whether check-in is

not open yet or has ended, and preserve every answered sign-up question as
event history.

#### Close production-readiness review gaps

- protect credential-backed E2E runs and suppress authenticated trace artifacts,
- reject unsafe or ambiguously masked Playwright reporter sinks before protected values can be entered,
- enforce recipient registration limits when paid transfers finalize,
- keep exact transfer-refund progress visible to the previous owner without restoring ticket actions,
- scope transfer-email idempotency to each transfer operation,
- use the target tenant timezone for platform event editing,
- align event duration, add-on limits, and migration domain handling with their persisted contracts.

#### Clarify event sign-up, ticket, payment-review and cancellation actions, preserve in-progress answers when checking account access again, and explain missing tax details without implying that tax information was verified. Describe unconfirmed cancellation and tax-import outcomes without claiming that stored data stayed unchanged. Update the matching attendee and organizer guides and browser journeys.

Explain organizer waitlist removal separately from cancelling a confirmed ticket, and report the completed cancellation outcome for applications, pending payment sign-ups, tickets, and waitlist places.

#### Persist complete historical price terms when registrations are confirmed or approved, including zero discount amounts for undiscounted registrations and transfers. Reject partial, inconsistent, or missing confirmed price snapshots in the database while allowing unpriced pending applications before approval.

Recheck event availability, captured prices and discounts, current verified-card eligibility and provider settings, and selected add-on terms after acquiring registration locks. Reject concurrent setup changes before recording a sign-up, waitlist entry, approval, or payment claim, and ask the user to review the current details. Serialize card writes before their card-row and uniqueness checks so a concurrent card refresh, removal, or replacement cannot leave a stale discount or deadlock a sign-up.

Applying the schema rejects existing incomplete or inconsistent rows. Historical payment terms must be reviewed from their original records; this change does not reconstruct or automatically rewrite financial history.

#### Complete transactional registration notifications

- render accessible HTML and plain-text lifecycle emails with React Email,
- queue idempotent confirmation, cancellation, waitlist-availability, and transfer messages in the same database transactions as their registration transitions,
- link confirmed participants back to their authenticated ticket page without turning the URL into a bearer credential, and
- keep delivery retries, leases, sender policy, and operator visibility at the durable outbox boundary.

#### Require explicit confirmation before participant or organizer registration cancellation, keep the safe action focused by default, and document cancellation, refund, capacity, waitlist, and recovery behavior.

Prevent failed organizer participant or receipt queries from appearing as verified empty data, and provide explicit retry actions for both operations.

#### Consolidate repeated image verification fixtures

Check all forbidden shell paths, packaged paths, and removed-provider contents
in three verifier invocations instead of nineteen. Retain an assertion for
every reported match and keep fail-fast artifact, symlink, readability, and
cleanup cases separate.

Wait for hydrated navigation and handout controls in the existing organizer and
scanner journeys before clicking, preserving their permission assertions.

#### Run the active and expired ESNcard certification journey once in the generated

user guide instead of repeating its provider calls in a separate browser spec.
Keep direct profile loading, card persistence and refresh checks, protected
credential handling, and the complete provider-error checks.

#### Consolidate duplicated administrator onboarding and missing-receipt-evidence browser journeys into the existing documentation tests. Retain keyboard selection, persisted privacy acceptance and answers, historical purchase-country preservation, rejection controls, and the rejection reason on the organizer's receipt card.

Remove redundant onboarding source-string checks while retaining the guide's publication mapping in the existing publisher tests.

Require keyboard readiness before selecting an onboarding answer after the full-page redirect.

#### Consolidate duplicated profile browser tests into the existing documentation journeys while retaining field normalization, persisted state, ticket actions and invalid-card coverage. Run the complete functional and documentation baselines together so database and authentication setup executes once, and ensure documentation commands export the guides in CI mode.

Remove duplicate source-count bookkeeping while retaining exact executable-file inventory checks.

Consolidate blank-percentage template recovery into one representative browser journey while retaining the existing null, empty and whitespace validation matrices.

Wait for the template tax selector's keyboard listener to hydrate before replacing an unavailable tax rate, avoiding a lost keypress against server-rendered controls.

#### Create platform events after ESNcard discounts are disabled

When an administrator creates an event from a saved template, copy its ESNcard discount only if the target organization still enables that provider and the sign-up choice is paid. Keep the saved template discount and normal ticket price unchanged.

#### Keep standalone staging latency checks manual while Scaleway operational work

is deferred.

Keep the latency runbook and infrastructure overview consistent with that manual-only trigger.

#### Refresh supported dependencies and runtime tooling

Update compatible application dependencies, including Angular Material, Effect,
Stripe, React, Playwright, lint tooling, and CSS security fixes. Align local, CI,
and Docker tooling on Bun `1.4.2` and Node `24.21.0`; Angular CLI runs through Node.

Keep TypeScript 6 and Vitest 4 within Angular 22 support. Keep Effect at beta.103
because the current Drizzle release candidate still uses `Schema.TaggedErrorClass`,
removed in beta.104. Pin the shared Effect platform package to the same prerelease.

Patch the two Effect Angular wrappers' peer metadata to match the upstream Angular
22 declaration without changing their runtime code. Vendored reference sources are
unchanged by this update.

Align outgoing Stripe API requests with the SDK's `2026-08-26.dahlia` version,
a backward-compatible monthly update within the existing Dahlia release.

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
- require supported First come, first served or Manual approval modes when creating or editing registration options

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

#### Reject impossible receipt dates, amounts that exceed supported limits,

oversized reimbursement batches, and malformed bank or PayPal payout details
before finance work begins.

Apply the same checks during receipt review and reimbursement. Normalize valid
bank and PayPal details before saving them in a profile, and keep invalid payout
entries available for correction with a field-specific message.

#### Enforce tenant identity across role assignments and registrations

- bind every role assignment to the shared tenant of its role and membership,
- reject registrations whose event belongs to another tenant, and
- reject registrations whose selected option belongs to another event.

#### Release registrations after an unbound Checkout expires

- sweep a bounded batch of expired registration payment claims that never bound a Stripe Checkout session,
- serialize cleanup with approval, cancellation, and webhook transitions before cancelling the exact local claim, and
- release the registration's reserved capacity and add-on inventory atomically.

#### Explain how guest registrations affect capacity and paid totals, keep direct

event links available when sign-up is unavailable, and keep event
creation errors visible without discarding the organizer's form entries.

#### Validate organization and platform role changes consistently, report duplicate names, and remove the unused member-collapse setting. Return a complete role catalog while keeping template organizer and participant defaults tied to their flags. Show valid stored permissions and wildcard grants as effective concrete form selections while preserving original grants until a user explicitly revokes their implied access. Resolve implied permissions transitively while preserving platform separation and valid organization grants.

Browse organization members in bounded pages and assign roles with clear validation messages. Review platform changes through stable pages of readable before-and-after summaries, with operator reasons and private implementation identifiers omitted from the response.

Preserve wildcard and legacy grants when editing platform-managed roles, while allowing their visible permissions to be revoked explicitly. Summarize added and removed member roles even when the total number of assigned roles stays the same.

Keep fractional audit timestamps intact across page boundaries and decode sanitized descriptions for readable plain-text summaries.

Explain permission dependencies in the platform role editor and prevent an implied permission from appearing revoked while its parent remains selected.

Show role-catalog loading and retry states in template forms, retaining entered values through lookup failures and recovery.

#### Expose cancellation refund progress and recovery

Show participant-safe refund progress on cancelled Profile event cards and
operator-safe lifecycle summaries in platform finance, distinguish queued,
provider-action, stopped, and recovered states consistently, fail closed before
a paid add-on cancellation can mutate inventory without a reconciled payment
allocation, and document the signed Stripe failure and audited recovery journey.

#### Preserve entered prices, discounts, and tax choices when authoring data cannot be

loaded. Keep event and template entries visible after an uncertain save response,
and distinguish a confirmed save from a failed page or list update. Allow supported
setup changes to be saved together while preserving existing choices and history.

Keep the event editor usable when removing a sign-up choice, question, or add-on,
while preserving the remaining controls and their entered values.

Show icon search loading and failure states, offer an explicit retry, and keep
icon selection clear and usable within event and template dialogs.

Keep supported text, links, and formatting when editing rich text, without accepting
images that the editor cannot save. Show tax-rate refreshes as loading while
retaining the selected rates and blocking saves until verification finishes.

#### Keep sample data setup reliable

Stop clearly when required organization details are missing or inconsistent,
instead of leaving partial or misleading sample data.

Require the staging ops Stripe test account in its protected secret contract
and validate seed configuration before initialization or destructive reset.

Require an explicit local database name and match the PostgreSQL driver target before reset or schema operations. Pass the same name into Compose database setup so missing or mismatched targets fail before connecting.

Fail when a declared sample add-on or registration question cannot resolve its
required template or registration option, rather than omitting it from the seed.

Show the bounded staging seed configuration diagnostic when a private ops call fails, while keeping unknown or internal response details private.

Validate pinned seed dates before connecting or beginning a reset, and reject invalid supplied dates before the seed transaction starts.

Run seed configuration preflight before Compose database setup resets or reapplies the schema.

Resolve file-backed seed dates and RNG keys before preflight or pool creation,
with the same configuration precedence as database and Stripe settings. Preserve
explicit caller overrides, including blank values, throughout nested seeding.

Make the documented local database reset supply its explicit destructive-reset
confirmation only to the guarded reset invocation, after seed preflight passes.
Keep empty receipt seeding a no-op even without receipt users, while requiring
those users before any writes or random-ID work when events are present.

#### Keep receipt storage outages visible and distinguish them from missing files.

Receipt approval and platform queue reads omit unused preview signing; opening
receipt details still verifies the file and prepares its preview link.

#### Keep sample sign-ups consistent

Stop clearly when sample sign-ups do not match their organization or related
event and account information, instead of silently using unrelated data.

#### Stop releases when required safety checks are missing, out of date, or

unsuccessful. Failed test data is no longer included in release packages.

Validate production enablement after protected-environment approval, and fail
visibly before deployment commands unless its environment flag is exactly true.

#### Show a clear error when a saved template sign-up choice refers to a role that

no longer exists.

#### Improve finance receipt submission, approval, and refunds

- let organizations choose permitted receipt countries and whether other
  countries are allowed,
- reuse clear receipt fields while submitting and approving expenses,
- keep refund lists stable while they update,
- remove the profile-receipts shortcut from the finance overview, and
- update Playwright specs and generated guide coverage for receipt workflows.

Receipt submission, review, and reimbursement retain entered values while the
action and all active follow-up reads finish. A confirmed save followed by a
failed read or navigation keeps its saved outcome visible. Unconfirmed mutation
responses retain a separate message and prevent another write until the user
checks fresh state.

Closing an uncertain receipt submission keeps Add receipt unavailable. Show
latest receipts reads the original event before another editor can open, even
when the page has changed events. Receipt review and ordinary reimbursement
outcomes direct users to reload the page; platform finance provides an explicit
read-only refresh. These changes do not retry a payment or change refund recovery
eligibility.

Leaving a platform receipt page prevents a late detail read from changing the
closed editor or showing its error notification.

Distinguish a missing uploaded receipt from a temporary storage outage. Missing
files are rejected with instructions to add the file again; storage failures
retain cleanup ownership. Receipt approval and reimbursement queues offer a
read-only retry after an initial load failure without repeating a reimbursement.

#### Stabilize browser cleanup and scroll-restoration checks

Wait for the blank replacement document to load before closing test pages,
avoiding a Chromium cleanup stall on Linux while preserving tenant request
cancellation and drain ownership.

Place the scroll-restoration test's event below the initial viewport so browser
click preparation cannot erase its required nonzero departure position.

#### Attach an organization's first payment account through the private worker operation after checking the account and existing payment configuration. Keep attached accounts immutable, show payment readiness without account identifiers in browser settings, and reject incomplete tax rates with clear import and selection feedback.

Block first account attachment when the organization has transaction history using any payment method, including recorded receipt reimbursements.
Explain an empty tax-rate selection in event and registration forms and direct users to someone who manages payments to import a rate. Keep initial loading, refresh, and unavailable states distinct, and preserve existing selected rates.

#### Fix anonymous authenticated-route deep links

Redirect first-time anonymous visitors from protected staging links into Auth0
instead of returning the unknown-organization page when Angular cancels its
initial server-side navigation.

#### Fix Scaleway private database deployment output

Use the private database endpoint IP when constructing role-scoped database
secrets because Scaleway private RDB endpoints do not provide a hostname.

#### Compare Scaleway secret environment variable keys using the current container

API map shape so unchanged scheduled reconciliations do not create new
deployments.

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

#### Cancel initial popup navigation during browser cleanup

Abort intercepted popup navigations whose frame is not yet available without
reporting that expected absence as a cleanup failure. Preserve unexpected
frame-access, document-preparation, and cancellation errors.

#### Keep platform scanner actions tied to confirmed state

Bind platform cancellation to the sign-up and payment state shown in its confirmation dialog. Reject a changed state before cancellation or refund work. Confirm completed cancellation without guessing its former state, and preserve completed approval, cancellation and check-in outcomes when loading current details fails.

Use scoped scanner diagnostics and free-ticket fixtures for scanner flows without Stripe payment sources.

Reload the current ticket once after a completed action, so a duplicate read cannot turn successful refresh feedback into a failure message.

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

#### Run the application from a pinned, non-root distroless image with Bun as the direct entrypoint, and refresh the Angular server rendering, rich text editor, HTML conversion, and CSS tooling dependencies to supported security fixes. Run Angular CLI package scripts on Node 24.21.0, while retaining Bun 1.4.2 for package management and the application runtime. Docker image builds compile Angular and ops with native builder tools, then assemble the runtime with target-platform Bun and a separate production dependency install. Local web and worker containers use that same entrypoint and retain logs through Docker. Deployment workflows hash the packaged schema on the runner without starting the image. The image gate continues to reject every HIGH or CRITICAL vulnerability. No database schema changes are included.

Scan the exact image digest on every staging deployment, including reused images, and rescan the copied production digest with a fresh vulnerability database before schema reconciliation and worker/web deployment. Runtime verification rejects debug shells, missing application artifacts, and incomplete archive scans.

#### Keep the hosted service safer

Limit what the hosted service can access if it is compromised, while keeping
startup failures visible and application logs available to support.

#### Keep uploaded logos and icons safe

- keep each uploaded file within its organization and intended use,
- accept supported images only when their contents match the chosen format,
- show storage failures instead of pretending a file is missing, and
- verify saved branding can be loaded again,
- exercise real object-storage uploads in the tenant settings browser test, and
- document upload, save, persisted readback, and recovery behavior in the
  generated tenant settings guide.

#### Resolve local command environments separately for each invocation so concurrent commands cannot select another command's Docker project or database through `.env.dev`. Preserve explicit environment overrides and dotenv expansion, and pass resolved values in memory with native command signals and exit status. Hold the Docker project lease for the full Drizzle Studio session, and validate seed configuration before local database reset.

Derive and validate encoded container database URLs before acquiring Docker ownership, preserve literal healthcheck arguments, and enforce Compose-compatible project names.

Validate the final local database host, port, and database before dispatching commands or opening Playwright pools. Keep the application database separate from the reserved integration database, and use the PostgreSQL driver's database-name parsing for integration guards.

Bootstrap the standalone PostgreSQL integration database after validating its disposable target and server version, without resetting the application database.

Require an explicit integration database port and isolate its maintenance, reset, and child commands from inherited TLS settings.

Bind local integration database URLs to the resolved port of the leased Docker project before opening a connection.

#### Keep shared setup, staging, and production separate so changes in one

environment cannot affect another.

Require production promotion to use the current main revision and recheck it
before deploying the schema role. Protect both the managed database instance
and the application database from planned destruction or replacement.

#### Keep templates and events within their organization, require valid event review state and time ranges, and enforce consistent registration capacity, pricing, and registration windows.

Reject registration options whose paid/free flag disagrees with their price through a typed validation error before event creation or updates reach database constraints.

#### Dispatch each durable email notification at most once, keep failed or uncertain outcomes visible without retries, and include sent history in the platform overview. Stop polling workers when an unexpected worker failure occurs.

The coordinated relaunch schema removes stored sender/retry fields and enforces a single delivery attempt. Existing retry-state rows need explicit review before applying this schema; do not reconstruct their history or resend uncertain messages.

Use the email configuration readiness endpoint for worker startup, explain environment-policy suppression accurately, and bound incident ordering to indexed per-status candidates. Exact overview summary counts still scan retained delivery history. Apply the new status/update-time/id index with the coordinated relaunch schema.

Clarify that messages with an unknown delivery outcome will not be sent again, including by manual retry.

#### Check organizer access before opening the camera. If the camera or next page

cannot open, explain what happened and offer a clear retry action. Remove
incomplete scanner and event-list controls that could not provide the result
they promised.

Use the signed-in person's verified access directly when loading events, and
keep guides tied to the pages that actually exist.

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

#### Improve staging response diagnostics

- distinguish time spent in sign-in, workspace selection, page rendering, and
  event loading, and
- record only bounded response context so investigations do not capture
  personal values.

Reject latency probe targets that are not plain HTTP(S) origins before making
requests, and describe warning and critical thresholds as independent checks.

#### Prevent concurrent registration approval, payment completion, add-on purchases, and platform role assignments from deadlocking. Preserve concurrent free sign-ups across events while checking current eligibility and payment settings under a consistent lock order.

Platform role assignments acquire their organization row before membership, matching registration eligibility while retaining the role-graph advisory lock.

Use the current organization limit when admitting a sign-up, after acquiring the existing eligibility locks. A settings change that commits first applies to that admission; a change waiting behind it applies afterwards. Waitlist entries remain exempt from the active-registration limit.

#### Align Playwright tests with new structure and linting

- migrate Playwright tests to `tests/**` (docs in `tests/docs/**`) and retire legacy `e2e/` layout,
- enforce required `@track`, `@req`, and `@doc` tags via ESLint for Playwright tests,
- update documentation, configs, and tooling references to the new test structure,
- require every collected functional and documentation test to pass without skips, fixmes, retries, flakes, or other incomplete outcomes.

#### Keep compensated Checkout replays idempotent

Recognize an existing full eligibility-compensation refund before finalizing a transfer Checkout again, preventing a second refund claim from blocking an otherwise idempotent replay. Preserve exact source-payment ownership and refund terms.

Record registration and add-on reconciliation failures before attempting to persist a retry schedule, so the original failure remains visible when rescheduling also fails. Keep rescheduling failures explicit. Align manual-approval hydration waits and validate retry-fixture ownership before changing payment snapshots.

### Restore existing registration payments

Let platform administrators restore an existing registration payment from
organization finance with a required reason and an atomic audit record. Verify
the saved claim and original Stripe session before binding; keep uncertain or
mismatched payments held without creating another Checkout. Preserve approval
notification delivery history and use normal reconciliation for completion or
expiry.

Validate the complete private recovery audit snapshots before persisting their original incident history and restored session state.

Keep organization finance within the available page width and adapt its columns
to the panel size, so recovery controls remain reachable on narrow screens.

#### Preserve literal credentials in local environment references

Local commands preserve dollar signs, backslashes, and replacement characters
when environment files reference caller credentials. Variable expansion resolves
forward references and nested defaults without executing command text, and
rejects cycles with key-only errors before starting the command.

Refresh Angular framework and Material packages to 22.2.0, along with the
reviewed Auth0, Maps loader, dotenv, lint, and formatter updates. Update CI
actions to their current immutable releases.

Browser test teardown leaves application documents before cancelling their
requests, preserving tenant interception while preventing cleanup from creating
unhandled initializer failures.

#### Keep failed routed test requests and documentation database cleanup under their fixture owners, preserving request and cleanup errors without interrupting unfinished cleanup.

Return `Connection: close` when an HTTP request asks to close the connection, so pooled clients retire the completed response's socket. Preserve response bodies, redirects, caching, and security headers.

Preserve complete browser request headers during tenant routing and keep failed route-removal ownership until context closure is proven. Cancel rejected and bodyless HTTP request streams, preserve HEAD discovery-document responses, and reject malformed internal SSR origins before URL normalization.

Use typed sign-in recovery when an encrypted session's optional profile claims do not match the shared RPC contract. Keep valid custom metadata available to request authorization.

Validate selected browser state before context creation, including canonical HTTP(S) origins, complete serialized cookies, and captured storage records. Reject missing or invalid state with an authentication-setup instruction; preserve intentional anonymous contexts and valid inline state. Authentication setup remains explicit, with no age-based reuse or automatic login fallback.

#### Reuse the application build when exporting source maps

Keep the private source-map export outside the Docker build context so CI can
reuse the verified application build instead of compiling it again.
Check for the required PR change note before full verification to avoid an
unnecessary correction and repeat validation cycle.

#### Avoid redundant Scaleway container revisions when the desired image,

configuration, and secrets already match the live role. Keep staging releases
behind the complete pull-request quality gate and provide the worker email
delivery dependency at the request boundary.

#### Require the current owner and authenticated recipient to use one private transfer code flow for every ticket transfer. Keep the same ticket, guests, add-on quantities, check-in and handout history; show the previous owner whether a refund actually started. Retire direct organizer reassignment and obsolete recipient-registration aliases, and keep private codes out of page URLs. Tell owners when a transfer outcome could not be confirmed and guide them to check the current state before trying again.

Allow a new private transfer offer when an earlier open offer expired and the current transfer deadline permits a replacement. Close the expired offer and record its expiry in the same transaction, while preserving active offers, pending payments, and refund protections.

#### Reconcile Checkout cancellation before releasing registrations

- require Stripe to confirm a bound Checkout is expired before cancelling its local payment claim or releasing reserved capacity,
- keep unbound or unconfirmed payment claims intact with an explicit retry path,
- serialize completion and expiry webhooks with registration-first row locks and exact transaction/session ownership, and
- cover competing completion and expiry delivery against real Postgres state.

#### Repeat safe schema reconciliation and empty-staging initialization when retrying

an unchanged deployment image. Release the worker and web roles at the same
reviewed digest only after those prerequisites succeed.

#### Show clear first-load errors with retry actions on the member list, payment

history, account-creation form, and template-based event creation. Load
discount-card details only after sign-in is confirmed, and hide saved card
details while sign-in is being checked.

#### Reduce custom trace costs

- sample ten percent of hosted application traces while keeping complete parent-based traces,
- suppress health, readiness, and version traces while preserving their native logs and metrics,
- retain custom Cockpit traces for the included seven-day window,
- allow a staging workflow dispatch to restore 100% sampling until the next reconciliation,
- wait for organization-settings hydration before exercising the live Google Maps documentation flow,
- use the ESNcard provider host that serves the validation API without a Cloudflare 403,
- and pin the production dependency graph to the security-fixed PostCSS release required by the runtime image gate.

#### Public event details no longer send internal check-in counts, post-sign-up

instructions, role identifiers or Stripe tax-rate identifiers for sign-up
choices. Eligibility checks, prices and displayed tax labels stay the same.

#### Refresh application and development dependencies within their supported

version ranges. Align environment expansion with the current dotenv release
while preserving existing variable expansion and credential precedence.

Update the Angular framework and Material packages together to 22.1.7,
TanStack Query packages to 5.103.1, the Auth0 management SDK to 7.2.0,
and Prettier to 3.9.7.

#### Refresh Effect and vendored dependency baselines

Update the vendored Effect source to the official `Effect-TS/effect`
`4.0.0-beta.101` release and align all runtime and test Effect packages to that
version. Refresh the remaining direct dependencies and bring the vendored
Drizzle snapshot to the official `1.0.0-rc.4` source tree.

#### Refresh local email and webhook testing with Mailpit 1.31.1 and Stripe CLI

1.50.11, pinned to verified multi-platform image digests.

#### Refresh local services and image verification

Update PostgreSQL 17, Mailpit and the Stripe test listener. Build MinIO from
its fixed upstream source release so restricted service accounts cannot create
unrestricted credentials. Refresh the Node base image and the image scanners.

#### Update the aligned Effect v4 beta packages to beta.107 while retaining the PostgreSQL cancellation patch. Refresh dotenv, ESLint, Unicorn, Prettier and tsx, preserve the existing control-flow lint style, and correct the generated-documentation checkout paths in the environment template.

Use the renamed typed-error constructor throughout the app and patch Drizzle RC4 error constructors to the same Effect API while preserving their tags, fields and database behavior.

#### Preserve the payment window after transfer reservation work

Calculate a paid ticket transfer's Checkout expiry immediately before storing
its payment claim. Keep the offer deadline and payment safety margin, including
when reservation work takes time or finishes on an exact second boundary.

Remove repeated image-verifier scenarios and tests that only pin documentation
wording. Preserve cache, shell detection, cleanup, and payment behavior checks.

#### Keep paid registration and add-on reservations attached to one immutable Checkout claim. Validate provider identities before binding, reconcile ambiguous binding acknowledgements, and retain uncertain attempts for organizer review. Bind paid manual approval with its notification atomically, preserve settled price snapshots, and prevent duplicate capacity release when payment completion or expiry is replayed.

Paid sign-up completion checks saved answers against the currently locked questions. If required answers are no longer complete, it records the captured payment and cancels the pending sign-up with a durable full refund claim, rather than confirming it or leaving its payment unresolved. Replayed completion preserves the same refund and capacity release. Generic approval failures explain that the result needs checking without assuming payment setup is at fault.

#### Tighten administration, sign-up, and scanner behavior

- Let administrators with the required access assign existing organization
  roles to members.
- Show the scanner only to people who can use it today.
- Support first-come-first-served and manual approval sign-ups only.
- Add focused settings for reply addresses and active sign-up limits while
  showing payment readiness without exposing account numbers.
- Send receipt-review and manual-approval messages from the chosen sending
  address while keeping delivery status visible to Evorto administrators.

#### Compile the production app once in the quality workflow

Use the required Linux image build to compile and verify the production browser,
server, and ops bundles. Remove the duplicate standalone compile from the unit
test job and local verification checklist, while retaining every test suite,
image inspection, source-map export, security scan, and aggregate quality gate.

#### Remove rich-text images because the editor does not provide them. Saved rich

text now contains only supported formatting and cannot load hidden tracking
images from another site.

#### Remove obsolete organizer information

Stop carrying unused organizer-status information. Organizer access now
depends only on current confirmed organizer sign-ups.

#### Show confirmed sent email history as complete when its sent time is recorded. Keep sent records with a missing sent time marked for attention, without offering a resend action.

Prioritize incomplete sending, sent, and suppressed diagnostics alongside failed
and uncertain deliveries, ahead of ordinary retained history. Keep each overview
candidate bucket bounded and index incomplete terminal records separately.
Normal delivery writers continue recording terminal timestamps atomically;
these diagnostics cover degraded records and never offer or schedule a resend.

#### Keep profile fields and reimbursement hints readable in the edit dialog. Offer a read-only retry when profile information cannot be loaded and wait for the profile to be ready before capturing its guide. Block further ESNcard changes after an unconfirmed result until an explicit read loads the current saved cards.

Keep card changes locked after a known card-change or missing-card rejection when
its follow-up read fails. Preserve the entered card number and the known rejection
until a successful explicit read restores the current card list. Offer an explicit
retry for failed receipt reads and use "Email for updates" consistently in account
and profile validation messages.

#### Explain how to recover from empty tax-rate catalogs, pause event tax selection

during refreshes, and require a usable selected tax rate for paid platform
templates while preserving free items and zero-percent rates.

#### Report private ops failures safely

Return only a fixed failure category from private schema operations so a
failed deployment is actionable without exposing database output, and verify
managed PostgreSQL certificates against IP connection identities explicitly.

Reject a missing or malformed database runtime role before private ops routes
start, so a staging reset cannot drop the schema before discovering that required
configuration. Validate the actual child process environment, rather than accepting
a dotenv-only fallback, and share the identifier check with the prerequisites command.

#### Identify slow test cleanup stages

Report fixed cleanup-stage labels when test teardown remains pending, without
logging fixture data or changing cleanup deadlines and failure handling.

#### Require change files for release notes

Document the team policy to always use Knope change files in `.changeset/*.md`
for release documentation, instead of relying on conventional commits or PR
titles.

#### Require complete Google Maps suggestions and ESNcard validity windows before saving provider results. Keep saved cards unchanged when validation is unavailable or the card changes during a check, and refresh the profile after a discarded check.

Discard a saved-card validation if its original identity changed during the
provider request. Clear prior metadata and validity dates when an authoritative
result omits them, while preserving the saved card on transport failure. Reject
blank or mismatched returned Google place IDs and bound diagnostic reason scanning and queued
objects before traversing provider failures.
Reload the current saved card after a discarded save or refresh, preserving the
identifier draft and leaving provider-failure state unchanged.

Report concurrent ESNcard ownership and first-save conflicts as recoverable errors without overwriting the winning card. Keep diagnostic inspection bounded across prototype chains and safe when failure objects contain proxies.

#### Require complete organization policies, receipt countries, currency, and timezone instead of inventing values when settings are missing. Reject fractional or out-of-range limits before saving, support the Classic theme in the current settings forms, and use the latest versioned privacy policy as the only policy source.

Ship the Classic palette and browser chrome colors together with its persisted setting and administration controls.

Reject stale organization settings forms before changing persisted values, keep unsaved edits visible, and offer an explicit reload of the latest settings.

Keep organization saves pending through refresh and navigation, advance the saved
snapshot without replacing newer drafts, and report concurrent domain claims as
an existing-domain conflict instead of an internal error.

Check the current settings snapshot before fetching destination-account tax rates
during Stripe account rotation. Release the database lock for the provider request
and recheck the snapshot under lock before writing, preserving conflict recovery.

Reject non-boolean receipt-country policies in direct consumers and verify PostgreSQL project discovery against every integration spec in the source tree.

Return typed unauthorized or not-found responses when a tenant disappears before discount settings or registration pricing are read, while preserving strict validation failures for malformed stored settings.

#### Stop receipt review when an organization has no clear receipt-country settings

instead of guessing.

#### Stop Evorto from starting in hosting unless it can verify the work it should do

and its secure connection.

#### Restore local storage bootstrap on clean runners

Build the pinned MinIO server and client releases from checksum-verified source
archives on a pinned Alpine runtime. This removes unavailable upstream images
while preserving bucket initialization and the server's health check.

#### Restore first-party QR scanner camera access

- allow the authenticated first-party scanner to request camera access while keeping geolocation and microphone disabled,
- expose accessible camera starting, ready, and failure states with retry guidance,
- use one server-authoritative test clock for scanner timing, check-in timestamps, and seeded Docker event windows,
- add server and page-backed camera-policy regressions,
- add a beginner-friendly generated check-in guide covering navigation, camera recovery, partial guest arrival, duplicate scans, and organizer totals.

#### Retain ownership of bounded test commands through cancellation and descendant

shutdown. Docker test startup now uses an owned cancellation channel and waits
for settlement before teardown, preserving command failures alongside cleanup
failures without signalling process identifiers after their owner has exited.

#### Remove the retired legacy import commands, schema snapshots, and unused

application dependencies. The application continues to use its current schema;
historical data transfer is separate work.

#### Reject invalid saved organization-role permissions before resolving member

access, including platform-wide grants, retired permissions and unknown values.
Use `admin:tax` for tax authority and stop accepting `admin:manageTaxes`.
Preserve role IDs, permission dependencies and valid organization wildcards;
revoking one wildcard capability keeps the other grants, including payment
management. Role editing and audit details use the current tax permission.

Event edit and organizer routes distinguish unavailable events, denied access,
and unexpected failures while preserving their existing access checks.

Keep internal failure details out of public RPC responses while retaining safe
server diagnostics for registration notification-link failures.

#### Return events to draft after review

Use consistent "Return to draft" wording in the review queue, feedback dialog,
and event approval guide. Explain why an event can no longer be reviewed or
submitted.

Keep review and submission actions busy until their follow-up reads settle.
Distinguish uncertain responses from confirmed changes whose updated details
could not be loaded, and retain feedback when a reviewer reopens the dialog.

Keep feedback when reopening a review from the admin queue, and distinguish an
uncertain response from a confirmed decision whose follow-up reads failed.
Describe refresh failures without incorrectly claiming the event detail failed.
Keep previously loaded event pages visible with an explicit refresh warning and
retry when a background reload fails.

#### Keep location and membership-card checks reliable

Keep location and membership-card checks working in every new Evorto setup
without replacing that setup's required settings. If required settings are
missing, stop and explain what is needed.

#### Split profile concerns into focused pages

Keep the familiar profile navigation while giving sign-ups, discount cards,
and submitted receipts their own pages. The account overview shows contact,
home-organization, and reimbursement readiness without exposing full bank
details. Event add-on summaries use the recorded organization currency and
charge only purchased extras. On small screens, moving between sections focuses
the page heading and preserves clear spacing.

Explain how to reload current cards after a confirmed ESNcard change is followed
by a failed card-list update.

Keep profile fields and reimbursement hints readable in the edit dialog. Offer
a read-only retry when profile information cannot be loaded, and wait for the
profile to be ready before capturing its guide. Block further ESNcard changes
after an unconfirmed result until an explicit read loads the current saved
cards. Keep the Use transfer code action and guide aligned.

Use clearer account setup labels and guidance for email verification, failed
reads, and changed joining requirements. Normalize the email for updates
consistently during account creation and profile editing. After completing
setup, refresh access with a full navigation and return to the originating
local page, including New member setup for the publishing administrator.
Use the profile when there is no valid local return destination.

#### Scope imported Stripe tax rates to their owning Connect account and reject stale

or unowned metadata in payment configuration and Checkout paths. Attach only an
organization's first payment account; an attached account remains immutable.

The fresh target schema requires account ownership directly. Server writers
serialize paid event and template configuration, tax-rate imports, and first
payment-account attachment on the tenant row. Legacy data transfer must provider-verify every
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

#### Prevent two local setup commands from changing the same development services

at once. A conflicting command now stops immediately and identifies the active
operation instead of racing a database reset.

Keep project ownership stable across temporary-directory overrides and retain it through host Playwright startup, application cleanup, and object-storage restoration.

#### Keep ticket check-in consistent when organizers act at the same time, distinguish

between check-in that has not opened and check-in that has ended, and close
check-in two hours after the event ends.

#### Save one ESNcard on a member's account and share it across their organizations.

Each organization still decides whether to offer ESNcard discounts. Explain
that changing or removing the card affects future discounts everywhere while
preserving prices already recorded for registrations and payments.

Recheck current card eligibility when registrations, approvals, and transfers
commit. Keep late provider responses from overwriting a replacement card, and
restore the exact original account state after shared browser tests.

Card storage now uses global account and identifier uniqueness. The relaunch
schema and application must be applied together; transferring legacy data is
separate work and this change adds no incremental migration.

#### Finalize each receipt upload only once, clean up abandoned uploads safely, use

one shared upload limit, retain masked payout evidence, require an explicit
receipt country, and remove duplicate stored details.

#### Make release setup fail clearly

Stop release setup after the first setup failure and preserve the original
details for support.

Make deployments fail clearly and require a corrected release instead of
attempting a risky rollback.

#### Refresh the default look and shared controls

- refresh the Evorto theme with indigo, slate, orange, and warm-neutral colors while retaining the ESN theme,
- make shared role, location, icon, and rich-text controls clearer and more consistent, and
- preserve expected validation and registration messages while limiting issue reports to safe, bounded details,
- recover event review conflicts using typed outcomes, and
- apply the current theme and light/dark browser chrome colors during both browser and server initialization,
- preserve images in saved rich-text content when surrounding text is edited or formatted, and
- bound browser error telemetry across caller-controlled hosts with per-process and per-host quotas.

Preserve actionable onboarding and registration errors, reject inherited timezone keys, and verify selected roles before saving while keeping failed lookups removable and role search bounded.

Keep location selection tied to the latest request and preserve cancellation while the dialog closes. Preserve safe organizer, organization-settings, and tax-import guidance without exposing provider or internal errors.

Keep website address validation visible when creating or editing an
organization, while keeping unexpected errors out of user-facing messages.

Reject raw paths, backslashes, and embedded whitespace before URL normalization
when validating tenant domains or local development origins.

Browser telemetry uses one fixed 60-second quota window per web process: up to
100 admitted reports total and 10 per host, with deduplication in that window.
Host quotas and fingerprints expire together, so caller-controlled host keys
cannot retain the next window's budget. Each process retains at most 100 host
keys and 100 fingerprints. Multiple web instances have independent budgets,
and restarts reset them; these are not service-wide or rolling-minute limits.
Anonymous callers can consume the process budget, so this remains bounded,
best-effort diagnostics rather than a tenant-authenticated delivery guarantee.

Limit role searches to 64 characters and reuse recently verified role lookup results without repeating one request per known selected role. Keep stale, failed, or missing selections subject to verification and removal before saving.

Keep selected roles unverified while a required lookup is running, retaining their labels and removal controls. Reuse successful per-role checks for 30 seconds from their original verification time.

Remove URL usernames and passwords before browser telemetry is fingerprinted or
logged, including encoded credentials in the report URL, message, name, or stack.
Keep useful host/path details and the existing query/fragment redaction.

Reject raw paths and malformed separators in the internal SSR RPC origin before accepting the normalized loopback address.

Apply the same telemetry redaction before client logging and transmission, and retain server-side sanitization for directly submitted reports.

Recheck selected roles when their cached verification expires while a form stays open. Keep saving blocked until that check succeeds, while preserving removal and manual retry after failures.

Validate platform template role selections against the target organization before saving, including pending, failed, and missing role lookups. Preserve unavailable selections so they can be removed.

Omit oversized diagnostic fields before parsing or redaction, keeping browser error handling responsive without exposing a truncated credential prefix.

Redact registration-transfer credentials in page URLs and diagnostic text before
logging or serialization, including encoded routes and credentials.

Refresh event details and review lists when an event disappears during approval.
Render one role icon and reject malformed HTTP origin syntax before URL
normalization.

Use one visible Edit button for rich-text previews, keeping saved links outside interactive button semantics.

Keep initialized platform template forms visible during role lookup failures and retries. Retain cached or saved role labels for removal, and block saving until target roles are verified.

Reject explicit empty ports in organization, development, and internal SSR origins before URL normalization.

Prevent an interrupted PostgreSQL query from cancelling an unrelated request after
its pooled connection is reused. Retain the connection until query and cancellation
completion are known, and discard connections when cancellation cleanup is uncertain.

#### Split organization settings into focused pages

Replace the single large settings form with five independently saved pages for
organization details, sign-up rules, payments and discounts, appearance, and
legal information. Payment and discount settings are available only to people
who can manage payments; the other pages remain available to people who can
manage organization settings.

Each page keeps unsaved edits when new information arrives and asks before
discarding them during navigation. Appearance settings also wait for logo and
site-icon uploads to finish before saving their new addresses.

New organization image uploads are recorded before storage writes. Saving appearance settings attaches selected uploads atomically and retains replaced images for 24 hours before cleanup. The `/tenant-assets/` route is reserved for ready, organization-owned uploads: newly selected URLs use their app-relative path; absolute URLs using that route are rejected. Exactly unchanged existing image URLs and external URLs using other paths remain supported without being adopted into cleanup.

Apply the updated Drizzle schema to the isolated development database (`bun run db:push`, or `bun run db:reset` for a disposable reset). The upload ledger uses a non-cascading organization foreign key. Unknown or interrupted storage-write outcomes retain durable metadata and become eligible for another bounded indexed cleanup after 5 minutes, including after an earlier successful deletion; this recurring metadata/cleanup cost is intentional until successful write settlement is known. Local workers poll every 5 minutes; hosted workers use the existing private receipt-cleanup trigger (hourly at minute 15). Brand cleanup passes have a 30-second deadline and retain their claim on interruption or failure. No locks span storage requests. Future organization deletion must drain owned assets before removing the organization. No bucket scan or historical image backfill is performed.

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

#### Stop guessing organization time and currency

Evorto now reports missing organization settings instead of silently showing
EUR, Berlin time, or the current time. Sign-ups also remain unavailable when an
event has no start time, with a clear explanation to contact an organizer.

#### Stop the background worker when an email or payment processor fails. Preserve

failure details and durable work so an operator can inspect the failure before
restarting.

#### Prevent built-in HTTP tracing from recording raw request URLs and sensitive

callback or transfer query parameters. Retain the sanitized application request
trace while handlers continue to receive the original request.

#### Let organizers choose which organization roles can find an announcement that

has no sign-up choices. Choosing no roles keeps it available only through its
direct link; the choice never assigns roles, grants access, or sends messages.

Announcements intentionally use this role list, while ordinary events are
found through their available sign-up choices. Invalid saved roles and failed
updates remain visible instead of being silently ignored.

Show announcement discovery guidance only for announcements, including when an
ordinary event has no sign-up choices eligible for the current viewer.

#### Align tax rates track behavior with specification

Align tax rate permissions, sync behavior, and registration persistence with the tax-rates conductor track.

Highlights:

- use `admin:tax` for tax-rate admin access and reject the retired `admin:manageTaxes` permission,
- enforce server-side rejection of non-inclusive Stripe tax rates during import,
- persist selected registration tax-rate snapshot fields (`tax_rate_id`, name, percentage, inclusive/exclusive) on `event_registrations`,
- require tax-rate selection only when registration options are paid.

#### Migrate rich text editor from TinyMCE to Tiptap core (MIT-only)

- replace TinyMCE integration with a Tiptap core editor implementation in shared form controls,
- add server-side rich text sanitization for template and event descriptions,
- enforce an MIT-only guard for Tiptap dependencies and block Tiptap Platform/Pro references.

#### Update Effect and preserve PostgreSQL connection safety

Update the coordinated Effect RC, Vitest and Angular build-tool cohort. Preserve strict settings validation, database socket paths, TLS identity checks and timestamp precision with the native PostgreSQL driver. Reject unsupported SSL URL options explicitly. Discard canceled PostgreSQL sessions before reuse, including held and transaction-pinned connections, and cover native cancellation ownership with protocol-level tests.

#### Use the current Evorto address as the only ordinary way to select an

organization. Keep server rendering and local test routing separate and
tightly limited. Only people marked as platform administrators through the
current sign-in settings receive platform-wide access.

Reject raw paths and malformed separators in the configured internal RPC
origin before allowing server-rendered requests to select an organization.

Require a server-issued ephemeral capability for internal SSR tenant routing and
cookie-origin exemptions, keep that capability out of serialized context, and
serve robots and sitemap metadata only for resolved organizations, using their
canonical public origins. Unknown hosts receive the existing non-cacheable 404
response without loading an authentication session; explicit local routing
continues to use the configured loopback origin.
Dispose unsupported Bun request bodies and Node GET/HEAD uploads without waiting
for EOF, and reject unrecognized Playwright storage-state documents.

Normalize the accepted internal SSR RPC path to the registered `/rpc` endpoint
before forwarding privileged headers, and validate separately supplied query
parameters before granting that forwarding.

Validate sign-in profile claims before server rendering so invalid sessions
receive the same non-cacheable sign-in recovery and cookie cleanup as RPC calls.
Keep local test routing owned and abort-only until browser context closure is
confirmed, including when context cleanup fails.

#### Replace implementation wording in the application with plain descriptions of

what happened and what the person can do next. Keep unexpected failures visible
while retaining technical diagnostics only in logs and executable checks.

Documentation publication retains both errors when publishing and temporary-file
cleanup fail together, while continuing to report a cleanup failure on its own.

Receipt-load failures explicitly leave the current list unconfirmed and ask
organizers to retry before adding another receipt. Documentation screenshots
wait for visible compound loading messages and indeterminate loading indicators,
while allowing hidden states and settled content.

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

#### Require HTTPS sign-in issuer addresses on the default port. Reject blank database

CA settings and connection URL options that override explicit TLS verification.
Attempt to restore original test-account access after uncertain administrator
setup failures, and report restoration failures explicitly.

#### Validate profile contact and payout details

- Trim and validate contact and payout email addresses before saving.
- Format and verify international bank account numbers using their country,
  length, and check digits.
- Reject malformed saved profile details before they are shown.
- Apply the same rules when a profile is created and when it is edited.

#### Check that uploaded organization logos and site icons have a supported image

signature matching the selected file type before saving them.

#### Require complete sign-in settings and sessions. Keep administrator access tied

to the verified administrator claim, refresh access after account setup, and
show incomplete sign-in details as a failure instead of treating them as a
signed-out session.

Require an explicit deployment environment, application role, worker trigger,
and database TLS choice. Authenticated tests require a preconfigured dedicated
administrator account without changing its shared claim during overlapping runs.

Reject blank required database certificates and verify the effective IPv6 connection host while preserving explicit server identities and strict TLS validation.

Reject auth origins whose raw paths, dot segments, empty query/fragment markers,
backslashes, credentials, or internal whitespace would disappear during URL
normalization. Preserve valid default ports, IPv6 origins, and local loopback
base URLs while retaining typed configuration failures.

Use the effective PostgreSQL host query value for managed schema connections
and certificate identity. Reject a supplied blank CA before any raw ops entrypoint
connects, including when verified TLS is optional, without trimming valid PEM.
Recover missing sign-in transactions with the same explicit callback failure
response while retaining unexpected SDK failures as defects.

Use a supplied CA for managed schema operations even when TLS is optional, and
normalize IPv6 certificate identities before verification or SNI. Keep effective
connection hosts, port/user/password overrides, and database pathname decoding
consistent with the pinned PostgreSQL driver. Managed URLs with a CA now reject
unsupported query settings instead of silently dropping them; URL credentials
remain explicit, with no ambient PostgreSQL credential fallback.

Reject malformed or non-IPv6 bracketed TLS identities instead of repairing them
into DNS names. Keep authentication configuration consistent with client origin
validation by rejecting explicit empty ports while preserving supported ports.

Apply the application's optional TLS server-name normalization to raw schema,
prerequisite, and reset settings: trim surrounding whitespace and verify the
connection host when the setting is blank, without weakening certificate checks.

Preserve explicit empty process and dotenv values until runtime configuration
validation. Reject an empty supplied database CA even when TLS is optional, and
never replace an empty higher-priority setting with a lower-priority value.

Require Members Hub permission before reading its roles and member names through
RPC, matching the protected page instead of allowing every signed-in account.

Preserve PostgreSQL raw Unix socket paths for connections without a configured
CA, while retaining IPv6 URL normalization and strict verified-TLS identity
validation. Other malformed non-URL connection strings remain rejected.

Recover invalid decoded sign-in sessions with a non-cacheable sign-in response
and expire only their session cookies. Keep unexpected identity-provider failures
on the existing server-error path.

Validate decoded session containers and primary token-set shapes before reading
them, so malformed stored values receive the same explicit sign-in recovery.
Use the effective PostgreSQL query host even without a URL authority, and reject
Unix-socket hosts whenever a CA is supplied, including explicit TLS-name overrides.

Recover unreadable session cookies even when the identity SDK returns no session. Keep absent cookies anonymous and preserve unrelated cookie names, including names that share the session prefix.

#### Verify managed PostgreSQL TLS during schema deployment

Configure the packaged Drizzle schema tool with Scaleway's managed database CA
instead of opening an unverified URL-only connection.

#### Verify the private database endpoint

Verify managed PostgreSQL certificates against the actual connection host by
default so Scaleway's private-only database certificate matches schema and
runtime connections, while retaining an optional server-name override for
other providers.

#### Recheck stored receipt evidence when confirming an earlier upload, report paused event refreshes honestly, and preserve organization time zones in editing and search. Clarify which sign-up choices visitors can see before signing in.

Distinguish included add-on units in profile summaries and recheck the accepted main revision immediately before deploying the production schema role.

#### Strengthen hosted Evorto security

Strengthen the connections used by hosted Evorto and keep local setup files out
of hosted releases.

#### Keep PostgreSQL pool capacity reserved until discarded connections physically

close, including cancellation on retained checkouts.

Preserve complete database names after the first separator in raw Unix-socket
configuration for both PostgreSQL clients, including spaces and Unicode.

#### Wait for template edit hydration in documentation coverage

Prevent the server-rendered template edit form from restoring stale controlled
field values after Playwright starts editing it.
