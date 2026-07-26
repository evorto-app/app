# Application Review Queue

Updated: 2026-07-26

Review branch: `codex/full-application-simplification-review`

Review baseline: `origin/main` at
`10ff7f71d87084a4900f0d5b0139ba7d60480f01`

## Objective

Review the complete application and leave it safe, direct, and maintainable by
one developer. Find and resolve bugs, inconsistencies, missing implementation,
security defects, unnecessary complexity, hidden failures, ambitious
fallbacks, and backwards-compatibility code.

The finished project will be deployed from a fresh schema. Historical data
import and compatibility behavior are not product requirements.

## Review rules

- Prefer one obvious implementation over layered compatibility paths.
- Surface unexpected failures; do not turn defects into plausible-looking
  fallback results.
- Keep only complexity required by a documented product invariant.
- Enforce tenant, identity, permission, payment, and file boundaries on the
  server.
- Keep external side effects explicit. An ambiguous payment or email outcome
  must stop for review rather than retry automatically.
- Use defaults only when creating new records. Invalid persisted state must
  fail decoding or validation.
- Verify user-facing behavior through normal navigation and durable tests.
- A queue item closes only with current source or runtime evidence.

## Status definitions

- **Resolved**: implementation and focused verification are complete.
- **In progress**: a bounded implementation batch is active or awaiting its
  integrated verification.
- **Open**: validated and not yet implemented.
- **Decision**: the code cannot be simplified safely until the named product
  choice is made.
- **Accepted**: complexity is justified by a documented invariant and has a
  recorded boundary.

## Coverage queue

| ID     | Area                        | Required manual review                                                            | Status      | Evidence                                                                                                                                           |
| ------ | --------------------------- | --------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| RQ-001 | Historical artifacts        | Obsolete scan/compliance output and stale references                              | Complete    | Historical compliance ledger, legacy importer, old schema tree, migration-only tests, and two deployment-data audit scripts identified and removed |
| RQ-002 | Product and architecture    | Implemented workflows against `PRODUCT.md` and `ARCHITECTURE.md`                  | Complete    | Product invariants traced through current UI, RPC, service, and database paths                                                                     |
| RQ-003 | App shell and SSR           | Routing, hydration, auth state, tenant resolution, navigation, error states       | Complete    | Manual source/test review plus focused SSR and request-boundary tests                                                                              |
| RQ-004 | Events and templates        | Authoring, review, publishing, listing, snapshots, discoverability                | Complete    | Graph, simple-form, platform, listing, provider, and review paths traced                                                                           |
| RQ-005 | Registration operations     | Eligibility, capacity, questions, add-ons, waitlists, check-in                    | Complete    | Registration handlers/services and concurrency paths traced                                                                                        |
| RQ-006 | Transfers and payments      | Fixed-bundle transfer, checkout, webhooks, refunds, Stripe ownership              | Complete    | Checkout, webhook, transfer, acquisition, and refund paths traced                                                                                  |
| RQ-007 | Identity and administration | Onboarding, roles, capabilities, tenant settings, platform authority, audit trail | Complete    | Auth0, request context, regular/platform administration, and audit paths traced                                                                    |
| RQ-008 | Finance and notifications   | Receipts, storage, reimbursements, email outbox, failure visibility               | Complete    | Tenant/platform finance, object storage, outbox, provider, and worker paths traced                                                                 |
| RQ-009 | Server and RPC              | Contracts, typed errors, defects, retries, fallbacks, concurrency, observability  | Complete    | Bun/Node adapters, Effect RPC ingress, error schemas, logs, and traces traced                                                                      |
| RQ-010 | Database                    | Schema invariants, constraints, query isolation, obsolete migration state         | Complete    | Drizzle schema and key transactional services reviewed against fresh-schema requirements                                                           |
| RQ-011 | Operations                  | Configuration, secrets, Docker, workers, deployment, health/readiness             | Complete    | CI, seed helpers, Docker, Scaleway, Terraform, and release workflows traced                                                                        |
| RQ-012 | Tests and documentation     | Missing behavior, hidden skips, weak assertions, stale generated docs             | Complete    | Test inventory, Playwright fixtures, source guards, CI gates, and generated docs reviewed                                                          |
| RQ-013 | Manual security review      | Authn/authz, tenant isolation, CSRF, XSS, uploads, redirects, SSR leakage         | Complete    | Manual review only; the task-owned automated scan was canceled and removed                                                                         |
| RQ-014 | Simplification review       | Shallow modules, duplicated policy, speculative seams, deletion opportunities     | Complete    | Candidates and concrete simpler directions recorded below                                                                                          |
| RQ-015 | Final verification          | Lint, format, build, unit, integration, Playwright, Browser acceptance            | In progress | Focused suites are recorded in the implementation log; integrated suites remain                                                                    |

## Findings queue

### Critical boundaries

| ID    | Severity | Finding and evidence                                                                                                                           | Required simple outcome                                                                                                   | Status   |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-001 | Critical | Staging and production were conditionally reconciled from one Terraform root/state; a staging apply could plan production destruction          | Unconditional per-environment roots, state and credentials; no counts, targets, moved blocks, or cross-environment inputs | Resolved |
| F-002 | High     | Transfer bearer credentials were embedded in `/registration-transfers/:credential`, OAuth redirects, logs, traces, and referrers               | Keep one hashed manual claim code, use a generic route, and submit the code only in the RPC body                          | Resolved |
| F-003 | High     | Email `sending` leases could be reclaimed after provider acceptance and resend the same message; the custom header is not provider idempotency | Dispatch only `queued`; make stale/ambiguous delivery terminal; deadline before lease; no automatic ambiguous retry       | Resolved |
| F-004 | High     | Public RPC error schemas carry `Schema.Defect` causes that can serialize SQL, parameters, PII, and stack detail                                | Public errors carry safe typed data only; log a redacted internal diagnostic with request ID                              | Resolved |
| F-005 | High     | Receipt storage HEAD/signing failures were converted into missing evidence or preview-unavailable results                                      | Preserve a typed service-unavailable outcome; only confirmed not-found means missing evidence                             | Resolved |

### Security, identity, and request handling

| ID    | Severity | Finding and evidence                                                                                                                         | Required simple outcome                                                                                                 | Status                                           |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| F-006 | High     | Cookie-authenticated `/rpc` accepted arbitrary content types and sibling-subdomain origins                                                   | Exact JSON and same-origin before auth/body decoding, with one proved loopback SSR exception                            | Resolved                                         |
| F-007 | High     | Production Bun traffic bypassed the Node Host/forwarded-protocol trust boundary                                                              | One inbound normalizer shared by both adapters; no deprecated or untrusted forwarded-header fallback                    | Resolved; accepted-path Bun runtime test blocked |
| F-008 | High     | Auth0 accepted weak secrets and malformed origins; cookie identifiers/deletion did not match the SDK; logout/provider fallbacks hid failures | Strict redacted config, explicit cookies, hosted Secure flags, and visible provider failures                            | Resolved                                         |
| F-009 | High     | `icons.add` treated ambient platform authority as tenant permission without explicit target/reason/audit                                     | Regular RPC requires tenant permission; add no platform bypass unless a real caller needs a dedicated audited operation | Resolved                                         |
| F-010 | High     | Members Hub route and `admin.roles.findHubRoles` exposed tenant member names without `internal:viewInternalPages`                            | Enforce the capability in both the route and server handler                                                             | Resolved                                         |
| F-011 | Medium   | Default HTTP logging and raw `request.url` trace fields captured credentials and callback queries                                            | Disable raw request logger; trace sanitized route templates only                                                        | Resolved                                         |
| F-012 | Medium   | Dynamic SSR and authenticated QR responses lacked explicit private no-store caching                                                          | `private, no-store` on dynamic/authenticated output; immutable assets remain cacheable                                  | Resolved                                         |
| F-013 | Medium   | Browser telemetry silently dropped oversized errors and used a process-global quota/fingerprint                                              | Bound fields, redact credentials, include path, and isolate bounded state per trusted host                              | Resolved                                         |
| F-014 | Medium   | E2E platform-admin authority was derived from process environment with only a `NODE_ENV` gate                                                | Test-only injection; hosted startup rejects E2E authority variables                                                     | Resolved                                         |
| F-015 | Medium   | Onboarding status returned `{complete:false}` when the authenticated claim lacked `sub`                                                      | Return the same explicit unauthorized outcome as the requirements endpoint                                              | Resolved                                         |
| F-016 | Medium   | Onboarding completion left the client-side permission/request context stale until reload                                                     | Full document navigation after success                                                                                  | Resolved                                         |
| F-017 | Medium   | Regular user/event/finance list contracts accept negative, fractional, or unbounded paging and invalid dates                                 | One bounded integer page schema (maximum 100) and strict date inputs                                                    | Open                                             |
| F-018 | Medium   | Platform audit history is hard-limited to 100 and the UI hides IDs/permissions needed to understand authority changes                        | Cursor pagination and visible safe authority fields                                                                     | Open                                             |

### Events, templates, and registration

| ID    | Severity | Finding and evidence                                                                                                          | Required simple outcome                                                                                      | Status                                                                                                   |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| F-019 | High     | Ongoing events disappear at their start because discovery filters by `start > now`                                            | Discover while `end > from`                                                                                  | Resolved                                                                                                 |
| F-020 | High     | Required participant/organizer/both/unlisted listing audience is represented only by a boolean                                | One explicit fresh-schema listing-audience enum used end to end                                              | Resolved                                                                                                 |
| F-021 | High     | Template/event authoring can silently drop ESN discounts or zero a paid graph when provider/Stripe capability is unavailable  | Block the write with a typed unavailable result and preserve pricing                                         | Resolved                                                                                                 |
| F-022 | High     | Capability, discount, tax, role, and icon query failures were mapped to `false`, `{}`, or empty lists                         | Distinguish unavailable from disabled/empty and show an actionable error                                     | In progress: capability/discount/tax paths resolved                                                      |
| F-023 | High     | Check-in validated mutable owner/status/guest state before the lock and returned invented success after races                 | Lock and reread all mutable state; only persisted exact retries are idempotent                               | Resolved; PostgreSQL race execution pending isolated DB                                                  |
| F-024 | Medium   | Check-in remains open indefinitely after an event                                                                             | Close at event end plus one explicit grace period and return an ended reason                                 | Open                                                                                                     |
| F-025 | High     | Retrying `registerForEvent` can ignore changed guests, answers, or add-ons and resume an older Checkout                       | Separate choice-free retry operation; reject an active existing registration from normal create              | Open                                                                                                     |
| F-026 | High     | Guest/add-on quantities are unbounded and feed an O(n) refund allocator; valid graphs can exceed Stripe's 100 line-item limit | Small product caps at UI/contract/service/DB boundaries plus a pre-reservation line-count check              | Resolved: 10 guests, 10 units per add-on, 20 add-on types, and a 100-line pre-reservation Checkout guard |
| F-027 | Medium   | Checkout cleanup discards reschedule failures with `Effect.ignore` and reports only aggregates                                | Propagate or aggregate identified failures; no clean-looking result after partial failure                    | Open                                                                                                     |
| F-028 | High     | Confirmed/payment-pending registrations can lack price snapshots and views reconstruct history from mutable prices or zero    | Require immutable snapshots, store explicit zero for free confirmations, and delete reconstruction fallbacks | Open                                                                                                     |
| F-029 | Medium   | Current Stripe sessions always write metadata but completion accepts metadata-free historical sessions                        | Require the exact current metadata tuple; delete compatibility branches/fixtures                             | Open                                                                                                     |
| F-030 | Medium   | Questions/answers lack pragmatic size/count limits and duplicate answers can overwrite silently                               | Bounded inputs and explicit duplicate rejection                                                              | Open                                                                                                     |
| F-031 | Medium   | Scanner opens the camera before capability resolution and can stop permanently after navigation failure                       | Resolve capability first; surface navigation failure and restore an explicit retry state                     | Resolved                                                                                                 |
| F-032 | Medium   | Listing/filter/paging UI contains no-op controls, hidden mutation failures, and a fixed first 100                             | Delete controls with no product behavior or implement URL state and load-more; show mutation failures        | Open                                                                                                     |
| F-071 | High     | Platform event editing could change title, description, requiredness, order, or option ownership after answers existed        | Share the ordinary immutable-after-answer guard with platform editing; no historical-answer rewrite          | In progress                                                                                              |
| F-076 | Medium   | Template reads silently dropped unresolved role IDs even though the array cannot have a database foreign key                  | Treat an unresolved persisted role as an integrity defect with template, option, and role context            | Resolved                                                                                                 |

### Finance and notifications

| ID    | Severity | Finding and evidence                                                                                                               | Required simple outcome                                                                          | Status                                                                                    |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| F-033 | High     | Receipt amounts are arbitrary numbers, contradictory values are silently zeroed, and zero totals can enter an unreimbursable state | Positive integer minor units; reject precision/contradictions; bounded paging                    | Open                                                                                      |
| F-034 | High     | Receipt calendar dates are stored/transported as timestamps and can shift day by timezone                                          | PostgreSQL `date` and strict `YYYY-MM-DD` end to end                                             | Open                                                                                      |
| F-035 | High     | Tenant reimbursement is an irreversible one-click mutation while platform reimbursement has a clear confirmation                   | Reuse one confirmation model and cap each batch at 100                                           | Open                                                                                      |
| F-036 | High     | Platform finance UI replaces actionable typed failures with generic catch messages                                                 | Render typed conflict, ambiguity, review, and storage outcomes                                   | In progress: receipt-detail storage failures are surfaced; broader mutation errors remain |
| F-037 | High     | Concurrent upload finalization performs repeated 20 MiB download/hash/upload work before one conditional write wins                | Atomically claim `pending -> finalizing`; interrupted work is terminal and the user starts fresh | Open                                                                                      |
| F-038 | High     | Orphan cleanup holds DB locks during remote storage work and can roll back DB state after irreversible object deletion             | Brief claims and independent per-row processing; normalized not-found only                       | Open                                                                                      |
| F-039 | Medium   | Reimbursement audit does not retain the immutable payout fingerprint/masked destination confirmed by the operator                  | Persist fingerprint and safe masked destination in the reimbursement audit                       | Open                                                                                      |
| F-040 | Medium   | Browser receipt file acceptance disagrees with server MIME/20 MiB rules                                                            | Share one MIME/size contract and reject before upload                                            | Open                                                                                      |
| F-041 | Medium   | Receipt-country configuration drops invalid entries and substitutes defaults for invalid persisted state                           | Validate nonempty settings; defaults only at tenant creation; one resolver                       | Open                                                                                      |
| F-042 | Medium   | Manual-approval email prints a raw UTC ISO deadline                                                                                | Pass tenant timezone and format a clear `de-DE` local deadline with zone                         | Resolved: the timezone is required and invalid persisted zones fail before enqueue        |
| F-043 | Medium   | Email-outbox overview can displace old unresolved incidents with newer routine rows                                                | Cursor/status filtering or unresolved-first ordering                                             | Resolved                                                                                  |

### Database and domain integrity

| ID    | Severity | Finding and evidence                                                                                                               | Required simple outcome                                                       | Status                                             |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| F-044 | High     | Template/event discounts lacked keys, owner FKs, uniqueness, and nonnegative checks                                                | Composite owner FKs, unique type per option, keys, and nonnegative checks     | Resolved; PostgreSQL execution pending isolated DB |
| F-045 | High     | Registration question/answer ownership, receipt/event/refund ownership, and payment provenance still rely partly on service checks | Composite tenant/owner foreign keys and focused invalid-row tests             | In progress: question/answer ownership resolved    |
| F-046 | Medium   | Quantities, counters, receipt sizes/amounts/status relationships, and lifecycle timestamps lack DB checks                          | Add direct constraints for domain ranges/state relationships                  | Open                                               |
| F-047 | Medium   | Persisted tenant/receipt/discount decoding sometimes supplies plausible defaults                                                   | Make persisted decoding strict; creation code owns defaults                   | Open                                               |
| F-048 | Medium   | Communication email and payout identifiers are weakly validated                                                                    | Nonempty canonical email, PayPal email schema, normalized checksum-valid IBAN | Open                                               |
| F-049 | Medium   | Candidate indexes are inferred rather than measured                                                                                | Confirm with representative `EXPLAIN`; add only proven indexes                | Open                                               |

### Administration and user experience

| ID    | Severity | Finding and evidence                                                                                                                  | Required simple outcome                                                    | Status                                                      |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| F-050 | High     | Admin overview fires review/role queries without the required permissions and then hides 403s                                         | Gate queries by capability and render real failure states                  | Resolved                                                    |
| F-051 | High     | Regular tenant Stripe tax-rate administration silently succeeds with no account, reads only 100, and imports unbounded/inactive rates | One bounded tenant tax-rate service shared with the stricter platform path | Resolved                                                    |
| F-052 | Medium   | General settings truncate fractional limits and silently clamp invalid values                                                         | Integer/nonnegative schemas and inline errors; no coercion                 | Resolved                                                    |
| F-053 | Medium   | Role create/edit failures are invisible; regular/platform validation diverges                                                         | One role-write normalizer and visible typed duplicate/validation errors    | Resolved                                                    |
| F-054 | Medium   | Icon-only controls lack accessible names and required role fields do not render their errors                                          | Accessible labels and inline validation at the field                       | Resolved                                                    |
| F-055 | Medium   | Platform finance/admin mutations use generic catch messages instead of typed outcomes                                                 | Use the shared typed error renderer                                        | In progress: non-finance resolved; finance separately owned |

### Operations, tests, and release behavior

| ID    | Severity | Finding and evidence                                                                                                                        | Required simple outcome                                                               | Status   |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| F-056 | High     | Local `db:push` can target an exported remote `DATABASE_URL`                                                                                | Refuse anything except the explicit local/loopback database boundary                  | Resolved |
| F-057 | High     | Staging RPC smoke considered a raw `Defect` response success                                                                                | Assert a meaningful typed success/auth-boundary outcome                               | Resolved |
| F-058 | High     | Partial seed failures could still write initialized state; seed helpers caught discount errors and selected arbitrary tenant/currency/users | Atomic truthful marker and required explicit seed inputs; defects propagate           | Resolved |
| F-059 | High     | Reused images can skip equivalent security checks and Trivy ignores unfixed findings                                                        | Scan every exact digest and use explicit reviewed waivers only                        | Resolved |
| F-060 | Medium   | Release gates can select an older successful run rather than the latest completed exact SHA                                                 | Gate on the exact intended revision/run                                               | Resolved |
| F-061 | Medium   | Playwright fixture swallows malformed runtime state, globally ignores HTTPS errors, and hides tenant-cookie setup failure                   | Only ENOENT means absent; explicit local-only TLS exception; fail setup visibly       | Resolved |
| F-062 | Medium   | `.dockerignore` sends test/auth/report/vendor material; Docker apt upgrade is nondeterministic                                              | Minimize build context and pin deterministic base/package behavior                    | Resolved |
| F-063 | Medium   | Invalid explicit `APP_HOST_PORT` falls back; robots/sitemap hardcode the alpha host; private ops curl lacks timeouts                        | Reject invalid config, derive canonical host, and use bounded calls                   | Resolved |
| F-064 | Medium   | Worker readiness was previously absent                                                                                                      | Recheck the new worker email readiness route against deployment probes before closing | Resolved |

### Removed compatibility and stale artifacts

| ID    | Severity | Finding and evidence                                                                                                           | Required simple outcome                                                                  | Status   |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------- |
| F-065 | High     | `migration/**`, `old/**`, `drizzle.config.old.ts`, migration-only tests/config, and `db:migrate` implemented a legacy importer | Delete the complete path and now-unused dependencies/config exceptions                   | Resolved |
| F-066 | Medium   | Stored `random` registration mode and writable/readable compatibility branches survived the relaunch contract                  | Remove the mode from DB, contracts, UI, services, platform tools, docs, and tests        | Resolved |
| F-067 | Medium   | Persisted tenant locale duplicated the fixed `de-DE` product invariant                                                         | Remove the column/type/context and use the invariant directly                            | Resolved |
| F-068 | Medium   | `admin:manageTaxes` aliased `admin:tax`; `collapseMembersInHup` had no implemented behavior                                    | Remove both end to end                                                                   | Resolved |
| F-069 | Medium   | Obsolete simple-template RPC/service and a second unused template-form cluster duplicated the graph path                       | Delete them and keep the canonical graph flow                                            | Resolved |
| F-070 | Low      | Historical compliance ledger and deployment-data audit scripts described old releases/data repair                              | Replace with this queue and delete the scripts                                           | Resolved |
| F-073 | Medium   | A broad `roles: all` legacy E2E account made unrelated profile/template tests pass with excessive authority                    | Scope the profile account as a regular user and use explicit admin state for admin tests | Resolved |

## Complexity and simplification queue

Every item records a deletion test or a concrete boundary. “Split this file”
alone is not a recommendation.

| ID    | Candidate                                                  | Why it is shallow or duplicated                                                                                                                    | Simpler direction and deletion test                                                                                                                            | Recommendation  | Status                                                                 |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| C-001 | Legacy importer and old Drizzle tree                       | Entire parallel application/data model for a deployment that starts fresh                                                                          | Delete; build, source guards, and current schema tests remain green                                                                                            | Strong          | Resolved                                                               |
| C-002 | Random-mode and simple-template compatibility              | Read/write adapters existed only for unsupported stored data and an obsolete authoring path                                                        | Delete; canonical graph tests cover all current modes                                                                                                          | Strong          | Resolved                                                               |
| C-003 | Dual transfer credentials                                  | URL token and manual code authorize the same claim with two hashes/lookups                                                                         | Keep one manual code and a generic route; no credential appears in URLs                                                                                        | Strong          | Resolved                                                               |
| C-004 | Redundant transfer columns                                 | `recipientRegistrationId`, `recipientSpotCount`, and `reservedAdditionalSpots` can only repeat source identity/spots/zero                          | Delete columns and derive from the source registration; transfer/refund tests remain green                                                                     | Strong          | Open                                                                   |
| C-005 | Dead registration/payment paths                            | `ensureAddonPaymentAllocations`, old bound-checkout cleanup, `cancelPendingRegistration`, and the unused webhook parser have no production callers | Delete each after reference proof and focused lifecycle tests                                                                                                  | Strong          | Open                                                                   |
| C-006 | Duplicate registration Checkout lifecycle                  | Direct/manual approval repeat release/create/bind/ambiguity logic                                                                                  | One narrow registration-specific helper; do not build a framework spanning transfer/add-on Checkout                                                            | Worth exploring | Open                                                                   |
| C-007 | Old event editing RPCs                                     | `findOneForEdit` and old `events.update` duplicate the graph endpoints with no app caller                                                          | Delete after source-reference and platform test proof                                                                                                          | Strong          | Open                                                                   |
| C-008 | Huge event/registration handlers                           | 5,000-line handler and 3,800-line service mix eligibility, checkout, check-in, transfer, and query policy                                          | Extract only stable domain operations at existing transaction seams; keep orchestration local                                                                  | Worth exploring | Open                                                                   |
| C-009 | Raw-header RPC context bridge                              | Verified context is encoded into internal base64 headers and decoded again                                                                         | Pass one Effect request-context service directly; hostile-header tests remain green                                                                            | Worth exploring | Open                                                                   |
| C-010 | Duplicate Bun/Node server assembly                         | Divergent adapter wiring caused the deployed proxy-trust defect                                                                                    | One shared inbound normalizer and adapter contract tests                                                                                                       | Strong          | Resolved                                                               |
| C-011 | Test state inside production runtime config                | Production parses E2E/Auth0-management authorization settings                                                                                      | Inject test-only configuration in test layers                                                                                                                  | Strong          | Resolved                                                               |
| C-012 | Ambient platform permissions                               | `globalAdmin:*` behaves as tenant authority and creates special-case bypasses                                                                      | Keep platform authority only in explicit `PlatformOperation` contracts                                                                                         | Strong          | Resolved                                                               |
| C-013 | Regular/platform role and tax logic                        | Two implementations drift on normalization, pagination, and errors                                                                                 | Small shared domain operation with thin authorization/audit adapters                                                                                           | Strong          | Resolved                                                               |
| C-014 | Tenant/platform finance handlers                           | 1,080- and 1,770-line handlers duplicate review/reimbursement rules                                                                                | One receipt review/reimbursement service; adapters retain tenant/platform authority and audit                                                                  | Worth exploring | Open                                                                   |
| C-015 | Finance remote fan-out                                     | List endpoints HEAD/sign objects they never render                                                                                                 | Remove remote calls from list paths; sign only an opened preview                                                                                               | Strong          | Resolved                                                               |
| C-016 | Dead finance fields                                        | Tax-rate ID, duplicate attachment snapshots, and public storage key have no consumer or duplicate upload truth                                     | Delete after reference proof and focused record-shape tests                                                                                                    | Strong          | Open                                                                   |
| C-017 | Email outbox forwarding layers                             | Stored sender fields are never read and a one-method operations service only forwards                                                              | Delete fields/service; keep one delivery boundary                                                                                                              | Strong          | Resolved                                                               |
| C-018 | Recurring full infrastructure reconcile/automatic rollback | Scheduled mutation and rollback after a forward schema release broaden failure paths                                                               | Optional read-only drift; fail visible and recover manually                                                                                                    | Strong          | Resolved                                                               |
| C-019 | Source-string/manual test inventories                      | Tests assert spellings and hand-maintained lists instead of behavior/discovery                                                                     | Replace worst guards with behavior or generated discovery as touched                                                                                           | Worth exploring | Resolved                                                               |
| C-020 | User profile mega-component                                | Inactive sections mounted event, card, and receipt queries; unrelated account concerns still share one route shell                                 | Gate each data query by the active section now; extract a section only when it can own its query/mutation state without duplicating shell context              | Worth exploring | Accepted: inactive queries stopped; presentational-only split rejected |
| C-021 | General settings mega-form                                 | Provider, legal, currency, limits, assets, and SEO share one required full-payload mutation and error surface                                      | Introduce explicit product-section RPCs first, then delete the monolithic model/RPC; no UI-only wrapper split, optional patch bag, or compatibility forwarder  | Worth exploring | Accepted: requires product-level mutation seams                        |
| C-022 | Stale `src/app/core/auth.ts`                               | Old query/raw redirect helper has no current caller                                                                                                | Delete after reference proof                                                                                                                                   | Strong          | Resolved                                                               |
| C-023 | Tax/role duplicate queries and icon failure masking        | The tax dialog reloaded parent data, role selectors fanned out per selected ID, and icon failures rendered like empty results                      | Pass imported IDs into the dialog, use one cached role catalog, delete dead role lookup RPC/filtering, and render explicit unavailable states                  | Worth exploring | Resolved                                                               |
| C-024 | Scanner/filter dead UI                                     | Empty filter, inert dismissal, unused paging methods, and fixed first page imply behavior that does not exist                                      | Delete the controls or implement the complete URL/load-more path                                                                                               | Strong          | Open                                                                   |
| C-025 | Unused dependencies/scripts                                | Brand icons, `he`, `skia-canvas`, `ws`, icon-color experiment, and Stripe-listen script had no caller                                              | Prove references, delete individually, then lockfile/build/test                                                                                                | Strong          | Resolved                                                               |
| C-026 | Unused user-attributes/view-count state                    | `user_attributes`, `User.attributes`, `events:organizesSome`, and cancelled view counts have no production consumer                                | Delete schema/query/context state after reference proof                                                                                                        | Strong          | Resolved                                                               |
| C-027 | Duplicate privacy-policy truth                             | Tenant row and version table both hold current policy URL/text                                                                                     | Latest version is authoritative; tenant points to it                                                                                                           | Worth exploring | Open                                                                   |
| C-028 | Per-handler defect stripping                               | Individual payment handlers sanitize defects inconsistently                                                                                        | Public schemas omit causes; one shared allowlisted log summary replaces handler-specific stripping                                                             | Strong          | Resolved                                                               |
| C-029 | Stripe tax-rate rotation operations seam                   | Focused plan tests inject three operations to prove account-before-write, metadata-before-remap ordering, and zero writes on account mismatch      | Keep the narrow test seam: production binds it only to the caller's active transaction, preserving atomicity without runtime fallback or configurable behavior | Strong          | Accepted                                                               |
| C-030 | Dead tax-rate helpers                                      | An unreferenced logging module and test-only price formatter added a second unused tax-formatting surface                                          | Delete both; retain the one UI label formatter and its behavior tests                                                                                          | Strong          | Resolved                                                               |

## Accepted complexity

- Registration/payment row locks, durable claims, idempotency keys, and
  ambiguity stops are required by money and capacity invariants. Simplify
  duplication around them, not the invariants themselves.
- Explicit platform-operation contracts with target, reason, and transactional
  audit are intentionally deeper than ambient permission checks.
- Effect RPC and tagged domain errors remain the single typed client/server
  boundary.
- Receipt MIME sniffing, hashing, immutable object keys, and narrow signed URLs
  are justified storage-security controls.

## Product decisions

| ID    | Decision                                                          | Current evidence                                                                                                                                              | Safe default while undecided                                                                   |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D-001 | Do waitlist entries consume the tenant active-registration limit? | Product text calls them lightweight demand indicators; tests deliberately count them                                                                          | Keep current limit and record it explicitly; do not silently change eligibility                |
| D-002 | Is immediate participant reassignment still a product workflow?   | `events.transferMyRegistration` has no UI caller; the UI uses private offer/claim, while `PRODUCT.md` still promises immediate free/questionless reassignment | Keep the endpoint until the product text or UI is changed; do not maintain two participant UIs |
| D-003 | What does a template listing audience control?                    | Resolved: templates store an explicit default event listing audience and template lists do not imply visibility                                               | Keep the UI copy explicit that this is the default copied to new events                        |
| D-004 | How should optionless announcements enter ordinary discovery?     | Registration-option kind now determines participant/organizer discovery, while valid operational events may have no options                                   | Keep them out of ordinary discovery; add no inferred audience or missing-option fallback       |

## Verified controls

The manual review found no actionable defect in these areas:

- tenant-first hosted host resolution and local-only tenant-cookie fallback;
- role assignment tenant/role locking and scoped authorization;
- event review transitions and current graph write transactions;
- rich-text write-boundary sanitization;
- open-redirect rejection of absolute, protocol-relative, backslash, control,
  and encoded escape forms;
- Stripe webhook signature/body/event replay controls;
- exact connected-account/session/amount/currency/PaymentIntent/refund ownership
  checks;
- transfer preservation of the fixed registration bundle and payment provenance;
- receipt MIME sniffing, hashing, ownership FK, and narrow signed URLs;
- reimbursement row locks and same-transaction notification enqueue;
- outbox producer idempotency and hosted recipient/provider fail-closed checks;
- runtime-role restrictions for private worker/ops routes; and
- non-root container execution, pinned GitHub actions, and PostgreSQL
  integration fail-closed behavior.

## Review and implementation log

- 2026-07-26: Fetched and rebased onto `origin/main` revision `10ff7f71`.
- 2026-07-26: Canceled the task-owned automated security scan at the user's
  request, stopped its worker/service process tree, and moved its temporary
  output roots to the macOS Trash.
- 2026-07-26: Removed the historical production-readiness ledger and
  deployment-data audit scripts.
- 2026-07-26: Deleted the legacy importer/old schema trees and about 11,000
  lines of compatibility code.
- 2026-07-26: Removed persisted tenant locale, the tax-permission alias, the
  unused Members Hub collapse field, stored random mode, obsolete
  simple-template APIs, and the unused legacy template-form cluster.
- 2026-07-26: Split the destructive shared Terraform root into unconditional
  bootstrap/staging/production roots; per-root state credential isolation is a
  remaining integration item.
- 2026-07-26: Hardened Auth0 configuration/cookies, RPC content type/origin,
  dynamic SSR caching, raw request logging/tracing, and browser telemetry.
- 2026-07-26: Made check-in state validation transactional and truthful.
- 2026-07-26: Began the second implementation wave for transfer credentials,
  email ambiguity, provider-failure visibility, database discount integrity,
  inbound proxy trust, operations fail-loud behavior, and authority cleanup.
- 2026-07-26: Made permission guards fail closed without metadata, protected
  the Members Hub route, gated the admin review-count query, and replaced
  post-onboarding cache invalidation with a full application navigation.
- 2026-07-26: Kept ongoing events discoverable until their end, made copied
  ESN discounts fail before writes, preserved paid graphs when Stripe is
  unavailable, and made capability/discount/tax provider failures explicit.
- 2026-07-26: Removed unused tax-rate logging/formatting helpers and replaced
  the plausible `Incl. Tax` fallback with an explicit unavailable state.
- 2026-07-26: Added F-071 after the owner-tuple review proved that platform
  editing could rewrite the meaning of already-persisted question answers.
- 2026-07-26: Kept receipt storage outages distinct from confirmed missing
  evidence, removed storage fan-out from non-preview receipt queues, and made
  the platform approval detail the only platform path that signs a preview.
- 2026-07-26: Removed the registration seed helper's arbitrary first-tenant
  fallback; tenant, currency, event ownership, and base-user input are now
  explicit and fail loud.
- 2026-07-26: Removed the broad all-roles E2E fixture; the dedicated profile
  account now has regular-user roles and template-category administration uses
  the explicit admin account.
- 2026-07-26: Made scanner authorization fresh and fail closed, added explicit
  camera/navigation retries, removed the fixed first-page platform scanner API,
  and replaced scanner source assertions with rendered behavior.
- 2026-07-26: Removed the hand-maintained Playwright file list, circular
  inventory assertions, a historical storage migration spelling guard, an
  unused screenshot compatibility export, and commented browser projects.
- 2026-07-26: Made template graph reads fail loudly when a persisted
  registration option references a missing tenant role instead of silently
  dropping the role from the response.
- 2026-07-26: Made admin overview/settings/role failures explicit, unified
  regular and platform role writes, bounded persisted registration settings,
  and routed non-finance platform mutation errors through the typed renderer.
- 2026-07-26: Replaced role-selector N+1 lookups with one cached catalog,
  deleted the now-unused ordinary role-detail RPC and filter branches, passed
  imported tax IDs into the import dialog, kept icon lookup failures distinct
  from empty results, and stopped inactive profile-section data queries.

## Focused verification recorded so far

- Legacy deletion source/schema guards: 31/31 and 23/23.
- Fresh-schema tenant/permission/settings server tests: 86/86.
- Fresh-schema Angular/shared tests: 54/54.
- Template/registration-mode Angular tests: 69/69.
- Template/registration-mode server tests: 202/202.
- Event/provider fail-loud Angular tests: 92/92.
- Event discovery and copied-discount server tests: 26/26.
- Check-in handler tests: 96/96.
- Auth/config tests: 14/14; SSR cookie forwarding: 9/9.
- RPC ingress tests: 22/22; SSR/client integration: 15/15.
- Members Hub/onboarding/permission-guard Angular tests: 12/12.
- Tax-label/dead-helper focused server and Angular tests: 10/10.
- Registration seed/auth-account helper tests: 14/14; affected Playwright
  dependency/test collection: 9/9.
- Receipt storage/finance handler tests: 71/71.
- Receipt detail/list-contract Angular tests: 33/33.
- Security boundary tests: 51 focused server tests plus cache/telemetry tests.
- Infrastructure/source tests: 37/37.
- Terraform validation for bootstrap, staging, and production.
- `bun run infra:check`: zero Trivy misconfigurations.
- Multiple focused `bun run lint`, `bun run format:write`,
  `bun run build:app`, and `git diff --check` runs passed.

These focused results do not replace the integrated final verification.

## Completion evidence

Completion requires:

- every coverage row complete;
- every finding resolved, explicitly accepted, or blocked by a recorded product
  decision;
- no backwards-compatibility implementation for the legacy application;
- no production fallback that hides an unexpected failure;
- the architecture/simplification report generated and reviewed;
- all relevant local verification passing with zero incomplete outcomes; and
- Browser acceptance recorded separately from automated Playwright evidence.
