# Application Review Queue

Updated: 2026-07-27

Review branch: `codex/full-application-simplification-review`

Review baseline: `origin/main` at
`d117229d3d7d357af9f9fc61fdad8d348d6809ea`

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
- **Complete** (coverage): the required review and its current evidence are
  complete.
- **Blocked** (coverage): an exact named external prerequisite prevents the
  required evidence; weaker evidence is not substituted.

## Coverage queue

| ID     | Area                        | Required manual review                                                                 | Status   | Evidence                                                                                                                                                                                                                       |
| ------ | --------------------------- | -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RQ-001 | Historical artifacts        | Obsolete scan/compliance output and stale references                                   | Complete | Historical compliance ledger, legacy importer, old schema tree, migration-only tests, and two deployment-data audit scripts identified and removed                                                                             |
| RQ-002 | Product and architecture    | Implemented workflows against `PRODUCT.md` and `ARCHITECTURE.md`                       | Complete | Product invariants traced through current UI, RPC, service, and database paths                                                                                                                                                 |
| RQ-003 | App shell and SSR           | Routing, hydration, auth state, tenant resolution, navigation, error states            | Complete | Manual source/test review plus focused SSR and request-boundary tests                                                                                                                                                          |
| RQ-004 | Events and templates        | Authoring, review, publishing, listing, snapshots, discoverability                     | Complete | Graph, simple-form, platform, listing, provider, and review paths traced                                                                                                                                                       |
| RQ-005 | Registration operations     | Eligibility, capacity, questions, add-ons, waitlists, check-in                         | Complete | Registration handlers/services and concurrency paths traced                                                                                                                                                                    |
| RQ-006 | Transfers and payments      | Fixed-bundle transfer, checkout, webhooks, refunds, Stripe ownership                   | Complete | Checkout, webhook, transfer, acquisition, and refund paths traced                                                                                                                                                              |
| RQ-007 | Identity and administration | Onboarding, roles, capabilities, tenant settings, platform authority, audit trail      | Complete | Auth0, request context, regular/platform administration, and audit paths traced                                                                                                                                                |
| RQ-008 | Finance and notifications   | Receipts, storage, reimbursements, email outbox, failure visibility                    | Complete | Tenant/platform finance, object storage, outbox, provider, and worker paths traced                                                                                                                                             |
| RQ-009 | Server and RPC              | Contracts, typed errors, defects, retries, fallbacks, concurrency, observability       | Complete | Bun/Node adapters, Effect RPC ingress, error schemas, logs, and traces traced                                                                                                                                                  |
| RQ-010 | Database                    | Schema invariants, constraints, query isolation, obsolete migration state              | Complete | Drizzle schema and key transactional services reviewed against fresh-schema requirements                                                                                                                                       |
| RQ-011 | Operations                  | Configuration, secrets, Docker, workers, deployment, health/readiness                  | Complete | CI, seed helpers, Docker, Scaleway, Terraform, and release workflows traced                                                                                                                                                    |
| RQ-012 | Tests and documentation     | Missing behavior, hidden skips, weak assertions, stale generated docs                  | Complete | Test inventory, Playwright fixtures, source guards, CI gates, and generated docs reviewed                                                                                                                                      |
| RQ-013 | Manual security review      | Authn/authz, tenant isolation, CSRF, XSS, uploads, redirects, SSR leakage              | Complete | Manual review only; scan workers and temporary output were stopped and removed, while durable cancellation acknowledgment was blocked by the scan service                                                                      |
| RQ-014 | Simplification review       | Shallow modules, duplicated policy, speculative seams, deletion opportunities          | Complete | Candidates and concrete simpler directions recorded below                                                                                                                                                                      |
| RQ-015 | Final verification          | Lint, format, build, unit, integration, image security, Playwright, Browser acceptance | Complete | The canonical full gate passed on the final application source; the final documentation-selector correction then passed formatting, lint, and all 52 documentation journeys. Authenticated visual acceptance remains separate. |

## Findings queue

Current totals: **114 findings** — 1 Critical, 43 High, 62 Medium, and 8
Low. **113 are resolved and 1 is accepted with evidence.**

### Critical boundaries

| ID    | Severity | Finding and evidence                                                                                                                           | Required simple outcome                                                                                                   | Status   |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-001 | Critical | Staging and production were conditionally reconciled from one Terraform root/state; a staging apply could plan production destruction          | Unconditional per-environment roots, state and credentials; no counts, targets, moved blocks, or cross-environment inputs | Resolved |
| F-002 | High     | Transfer bearer credentials were embedded in `/registration-transfers/:credential`, OAuth redirects, logs, traces, and referrers               | Keep one hashed manual claim code, use a generic route, and submit the code only in the RPC body                          | Resolved |
| F-003 | High     | Email `sending` leases could be reclaimed after provider acceptance and resend the same message; the custom header is not provider idempotency | Dispatch only `queued`; make stale/ambiguous delivery terminal; deadline before lease; no automatic ambiguous retry       | Resolved |
| F-004 | High     | Public RPC error schemas carry `Schema.Defect` causes that can serialize SQL, parameters, PII, and stack detail                                | Public errors carry safe typed data only; log a redacted internal diagnostic with request ID                              | Resolved |
| F-005 | High     | Receipt storage HEAD/signing failures were converted into missing evidence or preview-unavailable results                                      | Preserve a typed service-unavailable outcome; only confirmed not-found means missing evidence                             | Resolved |

### Security, identity, and request handling

| ID    | Severity | Finding and evidence                                                                                                                                                                  | Required simple outcome                                                                                                                                               | Status   |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-006 | High     | Cookie-authenticated `/rpc` accepted arbitrary content types and sibling-subdomain origins                                                                                            | Exact JSON and same-origin before auth/body decoding, with one proved loopback SSR exception                                                                          | Resolved |
| F-007 | High     | Production Bun traffic bypassed the Node Host/forwarded-protocol trust boundary                                                                                                       | One inbound normalizer shared by both adapters; no deprecated or untrusted forwarded-header fallback                                                                  | Resolved |
| F-008 | High     | Auth0 accepted weak secrets and malformed origins; cookie identifiers/deletion did not match the SDK; logout/provider fallbacks hid failures                                          | Strict redacted config, explicit cookies, hosted Secure flags, and visible provider failures                                                                          | Resolved |
| F-009 | High     | `icons.add` treated ambient platform authority as tenant permission without explicit target/reason/audit                                                                              | Regular RPC requires tenant permission; add no platform bypass unless a real caller needs a dedicated audited operation                                               | Resolved |
| F-010 | High     | Members Hub route and `admin.roles.findHubRoles` exposed tenant member names without `internal:viewInternalPages`                                                                     | Enforce the capability in both the route and server handler                                                                                                           | Resolved |
| F-011 | Medium   | Default HTTP logging and raw `request.url` trace fields captured credentials and callback queries                                                                                     | Disable raw request logger; trace sanitized route templates only                                                                                                      | Resolved |
| F-012 | Medium   | Dynamic SSR and authenticated QR responses lacked explicit private no-store caching                                                                                                   | `private, no-store` on dynamic/authenticated output; immutable assets remain cacheable                                                                                | Resolved |
| F-013 | Medium   | Browser telemetry silently dropped oversized errors and used a process-global quota/fingerprint                                                                                       | Bound fields, redact credentials, include path, and isolate bounded state per trusted host                                                                            | Resolved |
| F-014 | Medium   | E2E platform-admin authority was derived from process environment with only a `NODE_ENV` gate                                                                                         | Test-only injection; hosted startup rejects E2E authority variables                                                                                                   | Resolved |
| F-015 | Medium   | Onboarding status returned `{complete:false}` when the authenticated claim lacked `sub`                                                                                               | Return the same explicit unauthorized outcome as the requirements endpoint                                                                                            | Resolved |
| F-016 | Medium   | Onboarding completion left the client-side permission/request context stale until reload                                                                                              | Full document navigation after success                                                                                                                                | Resolved |
| F-078 | High     | Tenant brand-asset upload trusted the claimed image MIME type and served arbitrary bytes from the application origin                                                                  | Verify PNG, JPEG, GIF, WebP, or ICO signatures before storage; reject a MIME mismatch                                                                                 | Resolved |
| F-074 | High     | Auth0 `globalAdmin` app metadata remained an undocumented backwards-compatible platform-authority alias                                                                               | Accept only the canonical `platformAdministrator` authority key                                                                                                       | Resolved |
| F-077 | High     | Tenant role reads silently discarded persisted platform-global permissions and hid corrupt authority data                                                                             | Strictly decode tenant-only role permissions at the first read boundary and fail loudly                                                                               | Resolved |
| F-079 | Medium   | Public approved-event responses exposed reviewer identity and internal review comments                                                                                                | Keep public event projections free of private review metadata; expose it only through an authorized operation                                                         | Resolved |
| F-081 | Medium   | SSR RPC/config initialization could continue with a hard-coded localhost origin or without request context                                                                            | Require one valid request/configured origin and server request context; fail startup/render visibly                                                                   | Resolved |
| F-082 | Medium   | Rich-text mounted an image subsystem with no uploader while allowing third-party tracking images and showing impossible upload guidance                                               | Remove image support and blob-upload state until an owned upload product flow exists                                                                                  | Resolved |
| F-085 | Medium   | Auth request-origin resolution retained a deprecated forwarded-protocol alias and invented a localhost origin when normalized context was absent                                      | Accept only normalized protocol and required Host; fail visibly when the inbound boundary was not established                                                         | Resolved |
| F-088 | Medium   | Event identity failures were treated as anonymous, personal-card queries ran without confirmed identity, and cached identity could retain creator controls after a failed refresh     | Render an explicit identity retry and gate creator, organizer, and personal-card queries and cached data on a successful authenticated identity result                | Resolved |
| F-089 | Medium   | Angular route discovery checked its no-request lifecycle only after constructing `ConfigService` and its request-bound RPC/query dependencies                                         | Check the official route-discovery token in the app initializer before injecting `ConfigService`; real SSR still requires request context                             | Resolved |
| F-095 | Medium   | Accepted tenant configuration did not directly apply its document theme class, while `index.html` advertised two static browser colors that matched none of the available palettes    | Apply exactly one current theme class through the shared tenant-configuration path and delete the invalid static `theme-color` tags; add no dynamic mapping subsystem | Resolved |
| F-090 | High     | Direct TLS requests normalized by the Node adapter traversed the global boundary again and were downgraded to HTTP when platform proxy trust was disabled                             | Apply the inbound boundary exactly once: Node uses its normalized request, while Bun retains the ingress boundary; prove direct TLS and spoof rejection               | Resolved |
| F-092 | High     | Distributed request rebuilding transferred Bun's streaming body to a different Web `Request`, leaving the downstream RPC request body-used and making accepted POST bodies unreadable | Rebuild once inside the boundary middleware, provide that normalized server request downstream, and prove an accepted RPC POST body remains readable                  | Resolved |
| F-017 | Medium   | Regular user/event/finance list contracts accept negative, fractional, or unbounded paging and invalid dates                                                                          | One bounded integer page schema (maximum 100) and strict date inputs                                                                                                  | Resolved |
| F-018 | Medium   | Platform audit history is hard-limited to 100 and the UI hides IDs/permissions needed to understand authority changes                                                                 | Cursor pagination and visible safe authority fields                                                                                                                   | Resolved |

### Events, templates, and registration

| ID    | Severity | Finding and evidence                                                                                                                                                                                                                  | Required simple outcome                                                                                                                                       | Status                                                                                                       |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F-019 | High     | Ongoing events disappear at their start because discovery filters by `start > now`                                                                                                                                                    | Discover while `end > from`                                                                                                                                   | Resolved                                                                                                     |
| F-020 | High     | Required participant/organizer/both/unlisted listing audience is represented only by a boolean                                                                                                                                        | One explicit fresh-schema listing-audience enum used end to end                                                                                               | Resolved                                                                                                     |
| F-021 | High     | Template/event authoring can silently drop ESN discounts or zero a paid graph when provider/Stripe capability is unavailable                                                                                                          | Block the write with a typed unavailable result and preserve pricing                                                                                          | Resolved                                                                                                     |
| F-022 | High     | Capability, discount, tax, role, and icon query failures were mapped to `false`, `{}`, or empty lists                                                                                                                                 | Distinguish unavailable from disabled/empty and show an actionable error                                                                                      | Resolved                                                                                                     |
| F-023 | High     | Check-in validated mutable owner/status/guest state before the lock and returned invented success after races                                                                                                                         | Lock and reread all mutable state; only persisted exact retries are idempotent                                                                                | Resolved                                                                                                     |
| F-024 | Medium   | Check-in remains open indefinitely after an event                                                                                                                                                                                     | Close at event end plus one explicit grace period and return an ended reason                                                                                  | Resolved                                                                                                     |
| F-025 | High     | Retrying `registerForEvent` can ignore changed guests, answers, or add-ons and resume an older Checkout                                                                                                                               | Separate choice-free retry operation; reject an active existing registration from normal create                                                               | Resolved: normal create rejects active state; an owned choice-free RPC/UI retry resumes only persisted terms |
| F-026 | High     | Guest/add-on quantities are unbounded and feed an O(n) refund allocator; valid graphs can exceed Stripe's 100 line-item limit                                                                                                         | Small product caps at UI/contract/service/DB boundaries plus a pre-reservation line-count check                                                               | Resolved: 10 guests, 10 units per add-on, 20 add-on types, and a 100-line pre-reservation Checkout guard     |
| F-027 | Medium   | Checkout cleanup discards reschedule failures with `Effect.ignore` and reports only aggregates                                                                                                                                        | Propagate or aggregate identified failures; no clean-looking result after partial failure                                                                     | Resolved: registration and add-on reschedule persistence failures now fail the worker iteration visibly      |
| F-028 | High     | Confirmed/payment-pending registrations can lack price snapshots and views reconstruct history from mutable prices or zero                                                                                                            | Require immutable snapshots, store explicit zero for free confirmations, and delete reconstruction fallbacks                                                  | Resolved: writers persist complete snapshots, DB checks enforce them, and reads fail on missing history      |
| F-029 | Medium   | Current Stripe sessions always write metadata but completion accepts metadata-free historical sessions                                                                                                                                | Require the exact current metadata tuple; delete compatibility branches/fixtures                                                                              | Resolved: completion accepts only the exact current registration, tenant, transaction, and transfer tuple    |
| F-030 | Medium   | Questions/answers lack pragmatic size/count limits and duplicate answers can overwrite silently                                                                                                                                       | Bounded inputs and explicit duplicate rejection                                                                                                               | Resolved                                                                                                     |
| F-031 | Medium   | Scanner opens the camera before capability resolution and can stop permanently after navigation failure                                                                                                                               | Resolve capability first; surface navigation failure and restore an explicit retry state                                                                      | Resolved                                                                                                     |
| F-032 | Medium   | Listing/filter/paging UI contains no-op controls, hidden mutation failures, and a fixed first 100                                                                                                                                     | Delete controls with no product behavior or implement URL state and load-more; show mutation failures                                                         | Resolved: dead controls deleted; bounded deterministic load-more preserves prior pages and exposes failures  |
| F-071 | High     | Platform event editing could change title, description, requiredness, order, or option ownership after answers existed                                                                                                                | Share the ordinary immutable-after-answer guard with platform editing; no historical-answer rewrite                                                           | Resolved                                                                                                     |
| F-075 | Medium   | Event option policy inheritance could be inferred from omitted write fields                                                                                                                                                           | Require an explicit null or override value; keep omitted policy state invalid                                                                                 | Resolved                                                                                                     |
| F-076 | Medium   | Template reads silently dropped unresolved role IDs even though the array cannot have a database foreign key                                                                                                                          | Treat an unresolved persisted role as an integrity defect with template, option, and role context                                                             | Resolved                                                                                                     |
| F-080 | Medium   | Event edit/organizer route guards converted transport, authorization, decoding, and server failures into false 404s                                                                                                                   | Route only true not-found to 404, handle explicit auth outcomes, and surface unexpected unavailability                                                        | Resolved                                                                                                     |
| F-083 | Low      | Event review recovery branched on English message substrings despite tagged RPC errors                                                                                                                                                | Switch on the decoded error tag and delete copy-dependent heuristics                                                                                          | Resolved                                                                                                     |
| F-084 | Low      | Event-list `userId` and a `users.maybeSelf` request duplicated identity already held by authenticated server context                                                                                                                  | Delete the input, mismatch warning, and extra identity query                                                                                                  | Resolved                                                                                                     |
| F-086 | High     | Event creation positionally matched returned option rows and silently filtered add-on mappings when persistence returned an incomplete/reordered set                                                                                  | Pre-generate option IDs and require every declared discount, add-on, and question mapping                                                                     | Resolved                                                                                                     |
| F-087 | Medium   | Anonymous event details invoked the authenticated organizer-capability RPC and rendered its authorization failure as a public-page outage                                                                                             | Enable the capability query only after `maybeSelf` confirms authentication; never expose cached organizer state anonymously                                   | Resolved                                                                                                     |
| F-091 | Medium   | Registration-transfer tests still modeled the deleted recipient-registration column, ignored the fresh source/status/tenant predicate, omitted refund-stage new-transfer coverage, and suggested cancellation where it is unavailable | Test only the fresh source-registration model, prove refund-stage preview and commit remain blocked without mutation, and use stage-neutral recovery guidance | Resolved                                                                                                     |

### Finance and notifications

| ID    | Severity | Finding and evidence                                                                                                               | Required simple outcome                                                                          | Status                                                                                   |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| F-033 | High     | Receipt amounts are arbitrary numbers, contradictory values are silently zeroed, and zero totals can enter an unreimbursable state | Positive integer minor units; reject precision/contradictions; bounded paging                    | Resolved: one strict minor-unit policy now spans RPC, UI, handlers, and database checks  |
| F-034 | High     | Receipt calendar dates are stored/transported as timestamps and can shift day by timezone                                          | PostgreSQL `date` and strict `YYYY-MM-DD` end to end                                             | Resolved: calendar dates remain strict strings over a PostgreSQL `date` column           |
| F-035 | High     | Tenant reimbursement is an irreversible one-click mutation while platform reimbursement has a clear confirmation                   | Reuse one confirmation model and cap each batch at 100                                           | Resolved: both paths use one confirmation dialog and one shared 100-receipt limit        |
| F-036 | High     | Platform finance UI replaces actionable typed failures with generic catch messages                                                 | Render typed conflict, ambiguity, review, and storage outcomes                                   | Resolved: all platform finance mutation catches render decoded typed messages            |
| F-037 | High     | Concurrent upload finalization performs repeated 20 MiB download/hash/upload work before one conditional write wins                | Atomically claim `pending -> finalizing`; interrupted work is terminal and the user starts fresh | Resolved: only the atomic claim winner performs storage inspection                       |
| F-038 | High     | Orphan cleanup holds DB locks during remote storage work and can roll back DB state after irreversible object deletion             | Brief claims and independent per-row processing; normalized not-found only                       | Resolved: brief `cleaning` claims precede independent remote and row deletion            |
| F-039 | Medium   | Reimbursement audit does not retain the immutable payout fingerprint/masked destination confirmed by the operator                  | Persist fingerprint and safe masked destination in the reimbursement audit                       | Resolved: audit state stores the validated SHA-256 fingerprint and masked destination    |
| F-040 | Medium   | Browser receipt file acceptance disagrees with server MIME/20 MiB rules                                                            | Share one MIME/size contract and reject before upload                                            | Resolved: browser and server consume one exact MIME and size validator                   |
| F-041 | Medium   | Receipt-country configuration drops invalid entries and substitutes defaults for invalid persisted state                           | Validate nonempty settings; defaults only at tenant creation; one resolver                       | Resolved: required canonical unique settings fail on empty, invalid, or duplicate values |
| F-042 | Medium   | Manual-approval email prints a raw UTC ISO deadline                                                                                | Pass tenant timezone and format a clear `de-DE` local deadline with zone                         | Resolved: the timezone is required and invalid persisted zones fail before enqueue       |
| F-043 | Medium   | Email-outbox overview can displace old unresolved incidents with newer routine rows                                                | Cursor/status filtering or unresolved-first ordering                                             | Resolved                                                                                 |

### Database and domain integrity

| ID    | Severity | Finding and evidence                                                                                                               | Required simple outcome                                                       | Status                                                                                                                              |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F-044 | High     | Template/event discounts lacked keys, owner FKs, uniqueness, and nonnegative checks                                                | Composite owner FKs, unique type per option, keys, and nonnegative checks     | Resolved                                                                                                                            |
| F-045 | High     | Registration question/answer ownership, receipt/event/refund ownership, and payment provenance still rely partly on service checks | Composite tenant/owner foreign keys and focused invalid-row tests             | Resolved                                                                                                                            |
| F-046 | Medium   | Quantities, counters, receipt sizes/amounts/status relationships, and lifecycle timestamps lack DB checks                          | Add direct constraints for domain ranges/state relationships                  | Resolved                                                                                                                            |
| F-047 | Medium   | Persisted tenant/receipt/discount decoding sometimes supplies plausible defaults                                                   | Make persisted decoding strict; creation code owns defaults                   | Resolved                                                                                                                            |
| F-048 | Medium   | Communication email and payout identifiers are weakly validated                                                                    | Nonempty canonical email, PayPal email schema, normalized checksum-valid IBAN | Resolved                                                                                                                            |
| F-049 | Medium   | Candidate indexes are inferred rather than measured                                                                                | Confirm with representative `EXPLAIN`; add only proven indexes                | Accepted: four read-only plans confirmed current seeded-path indexes; tiny or empty tables do not justify a speculative scale index |

### Administration and user experience

| ID    | Severity | Finding and evidence                                                                                                                  | Required simple outcome                                                    | Status                                                              |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| F-050 | High     | Admin overview fires review/role queries without the required permissions and then hides 403s                                         | Gate queries by capability and render real failure states                  | Resolved                                                            |
| F-051 | High     | Regular tenant Stripe tax-rate administration silently succeeds with no account, reads only 100, and imports unbounded/inactive rates | One bounded tenant tax-rate service shared with the stricter platform path | Resolved                                                            |
| F-052 | Medium   | General settings truncate fractional limits and silently clamp invalid values                                                         | Integer/nonnegative schemas and inline errors; no coercion                 | Resolved                                                            |
| F-053 | Medium   | Role create/edit failures are invisible; regular/platform validation diverges                                                         | One role-write normalizer and visible typed duplicate/validation errors    | Resolved                                                            |
| F-054 | Medium   | Icon-only controls lack accessible names and required role fields do not render their errors                                          | Accessible labels and inline validation at the field                       | Resolved                                                            |
| F-055 | Medium   | Platform finance/admin mutations use generic catch messages instead of typed outcomes                                                 | Use the shared typed error renderer                                        | Resolved: finance and non-finance mutations use the shared renderer |

### Operations, tests, and release behavior

| ID    | Severity | Finding and evidence                                                                                                                                                                   | Required simple outcome                                                                                                                                                                            | Status                                                          |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| F-056 | High     | Local `db:push` can target an exported remote `DATABASE_URL`                                                                                                                           | Refuse anything except the explicit local/loopback database boundary                                                                                                                               | Resolved                                                        |
| F-057 | High     | Staging RPC smoke considered a raw `Defect` response success                                                                                                                           | Assert a meaningful typed success/auth-boundary outcome                                                                                                                                            | Resolved                                                        |
| F-058 | High     | Partial seed failures could still write initialized state; paid fixtures and declared seed records still accepted missing prerequisites                                                | Atomic truthful marker, exact paid-fixture prerequisites, required declared records, and no arbitrary fallbacks                                                                                    | Resolved                                                        |
| F-059 | High     | Reused images can skip equivalent security checks and Trivy ignores unfixed findings                                                                                                   | Scan every exact digest and use explicit reviewed waivers only                                                                                                                                     | Resolved                                                        |
| F-060 | Medium   | Release gates can select an older successful run rather than the latest completed exact SHA                                                                                            | Gate on the exact intended revision/run                                                                                                                                                            | Resolved                                                        |
| F-061 | Medium   | Playwright fixture swallows malformed runtime state, globally ignores HTTPS errors, and hides tenant-cookie setup failure                                                              | Only ENOENT means absent; explicit local-only TLS exception; fail setup visibly                                                                                                                    | Resolved                                                        |
| F-062 | Medium   | `.dockerignore` sends test/auth/report/vendor material; Docker apt upgrade is nondeterministic                                                                                         | Minimize build context and pin deterministic base/package behavior                                                                                                                                 | Resolved                                                        |
| F-063 | Medium   | Invalid explicit `APP_HOST_PORT` falls back; robots/sitemap hardcode the alpha host; private ops curl lacks timeouts                                                                   | Reject invalid config, derive canonical host, and use bounded calls                                                                                                                                | Resolved                                                        |
| F-064 | Medium   | Worker readiness was previously absent                                                                                                                                                 | Recheck the new worker email readiness route against deployment probes before closing                                                                                                              | Resolved                                                        |
| F-093 | High     | The exact production runtime image scan reported four Critical and 21 High Debian package findings, including four Critical `perl-base` CVEs                                           | Use a pinned minimal runtime containing only Bun and required application artifacts; no waiver, suppression, broad package upgrade, shell wrapper, or scanner fallback                             | Resolved                                                        |
| F-094 | Medium   | The real credential-backed Playwright baseline exposed 30 stale fresh-schema constraint fixtures, outdated assertions, and mutable shared-identity failures after 120/150 tests passed | Align fixtures with current review, price-snapshot, and confirmed-state invariants; update stale assertions; isolate mutable test identities; require green functional and documentation baselines | Resolved: real Auth0 functional 151/151 and documentation 52/52 |

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

### Settled-decision implementation follow-up

| ID    | Severity | Finding and evidence                                                                                                                                                                        | Required simple outcome                                                                                                                           | Status   |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-096 | High     | Tenant and platform settings accepted an arbitrary non-empty Stripe account ID on initial connection, deferring the defect until a later paid flow                                          | Verify every changed non-null account with Stripe before persistence; reject unavailable, malformed, or unusable accounts                         | Resolved |
| F-097 | High     | Direct and manual-approval registration Checkout builders could serialize a positive-priced included-only add-on as a zero-quantity Stripe line                                             | Add a Checkout line only when both unit price and purchased quantity are positive; keep the included entitlement unchanged                        | Resolved |
| F-098 | Medium   | The focused-settings documentation title generated a new slug while publication still required the deleted monolithic-settings slug                                                         | Update the exact publication source contract and keep its fail-closed bundle test green                                                           | Resolved |
| F-099 | Medium   | Event-listing permission and generated admin guidance still implied all events use the four option-based audiences after role-targeted announcements were implemented                       | Describe optionful audiences and optionless announcement roles separately; keep access and notifications explicitly separate                      | Resolved |
| F-100 | Medium   | The first routed profile shell constructed the overview before a direct child route activated, so child pages still started the overview's personal-data query                              | Make overview the explicit default child route and let each routed page exclusively own its data                                                  | Resolved |
| F-101 | Medium   | Profile add-on summaries used Angular's default currency and multiplied the paid unit price by total entitlement, including free included units                                             | Carry the tenant currency and purchased quantity in the typed summary; display only the amount paid for purchased units                           | Resolved |
| F-102 | High     | A payment-settings form opened on Stripe account A could overwrite a concurrent change to B because request-start reads did not carry the form's original account                           | Require the originally loaded account in both fresh update contracts; reject a mismatch before provider calls and under lock                      | Resolved |
| F-103 | Medium   | Stripe account validation converted network, authentication, rate-limit, malformed-response, and mismatched-ID failures into ordinary invalid-account input                                 | Map only Stripe's definitive invalid-request response to bad input; preserve every unexpected provider or contract failure as a defect            | Resolved |
| F-104 | Medium   | Ordinary announcement listing failures were silent, and Save could close before the role catalog proved every selected discovery role still existed                                         | Fail closed until the role catalog is valid and show the exact mutation failure; an empty validated selection remains link-only                   | Resolved |
| F-105 | Medium   | Focused settings pages discarded dirty edits on sibling navigation and unconditionally overwrote them when tenant configuration refreshed                                                   | Guard all five routes, hydrate only pristine forms, reset after successful saves, and require initialized tenant state                            | Resolved |
| F-106 | Medium   | Appearance settings could save old asset URLs while a file upload was still running and then leave the uploaded URL as unmarked unsaved state                                               | Disable and guard Save through file read/upload; mark the returned local URL dirty until the focused settings save succeeds                       | Resolved |
| F-107 | Medium   | Individually valid registration, guest, and add-on prices could overflow PostgreSQL integer aggregates and surface an internal SQL failure after entering checkout                          | Bound each lot, subtotal, and combined total with `BigInt` before reservation or persistence and return a typed conflict                          | Resolved |
| F-108 | Medium   | Mobile profile navigation removed the focused link without moving focus, while detail pages duplicated the shell heading and retained fragment-era layout residue                           | Focus the routed detail heading, keep one page-level heading, preserve mobile spacing, and delete the obsolete receipt fragment                   | Resolved |
| F-109 | Medium   | Stripe-backed Playwright tried to execute `cat` inside the intentionally shell-less distroless application image, so signed webhook tests could not read the mounted listener secret        | Read the file through the shipped Bun runtime; keep the running container authoritative and retain the fail-closed timeout                        | Resolved |
| F-110 | Low      | The advanced-template snapshot journey compared the event's copied discovery default with a template API projection that intentionally has no visibility field                              | Compare the event with the persisted template default; do not restore template visibility or an optional compatibility field                      | Resolved |
| F-111 | Medium   | Server-rendered focused settings forms left native controls active before Angular hydration and event replay; an early submit performed a native GET before replayed `preventDefault` threw | Keep the complete form disabled through browser render and application stability, then enable it; guard every save with the same readiness signal | Resolved |
| F-112 | Low      | The legal-settings Playwright readback selected the derived `privacyPolicyUrl` projection as if it were a tenant column, so Drizzle rejected the nested selection before checking the save  | Assert only the legal-notice and terms columns owned by this focused settings page; do not add a compatibility field                              | Resolved |
| F-113 | Low      | The event-discovery guide selected the first page-wide `Events` link, so the new profile-section link shadowed the documented main-navigation destination                                   | Scope the journey to the explicitly labelled main navigation; keep the distinct public-event and profile-event destinations visible               | Resolved |
| F-114 | Low      | Two touched seed helpers used avoidable `../src` paths for database and shared modules even though their existing runtime supports the repository aliases                                   | Use the existing `@db` and `@shared` aliases locally; keep the direct tenant-type import and do not add lint machinery or sweep unrelated helpers | Resolved |
| F-115 | Low      | The documented `@types/*` application alias occupies TypeScript's declaration-package namespace; Angular rejected it with TS6137 and Playwright could not resolve it                        | Delete the invalid alias, update its three test consumers and repository guidance, and keep application-type imports direct                       | Resolved |

## Complexity and simplification queue

Every item records a deletion test or a concrete boundary. “Split this file”
alone is not a recommendation.

Current totals: **36 candidates** — 32 simplified and 4 accepted at explicit
boundaries.

| ID    | Candidate                                                  | Why it is shallow or duplicated                                                                                                                                            | Simpler direction and deletion test                                                                                                                                                                                                                                                                                                                | Recommendation  | Status                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-001 | Legacy importer and old Drizzle tree                       | Entire parallel application/data model for a deployment that starts fresh                                                                                                  | Delete; build, source guards, and current schema tests remain green                                                                                                                                                                                                                                                                                | Strong          | Resolved                                                                                                                                                                                                    |
| C-002 | Random-mode and simple-template compatibility              | Read/write adapters existed only for unsupported stored data and an obsolete authoring path                                                                                | Delete; canonical graph tests cover all current modes                                                                                                                                                                                                                                                                                              | Strong          | Resolved                                                                                                                                                                                                    |
| C-003 | Dual transfer credentials                                  | URL token and manual code authorize the same claim with two hashes/lookups                                                                                                 | Keep one manual code and a generic route; no credential appears in URLs                                                                                                                                                                                                                                                                            | Strong          | Resolved                                                                                                                                                                                                    |
| C-004 | Redundant transfer columns                                 | `recipientRegistrationId`, `recipientSpotCount`, and `reservedAdditionalSpots` can only repeat source identity/spots/zero                                                  | Delete columns and derive from the source registration; transfer/refund tests remain green                                                                                                                                                                                                                                                         | Strong          | Resolved: columns, constraints, writes, and reads deleted; source identity/spots are derived                                                                                                                |
| C-005 | Dead registration/payment paths                            | `ensureAddonPaymentAllocations`, old bound-checkout cleanup, `cancelPendingRegistration`, and the unused webhook parser have no production callers                         | Delete each after reference proof and focused lifecycle tests                                                                                                                                                                                                                                                                                      | Strong          | Resolved: all four paths deleted; source reference proof is empty                                                                                                                                           |
| C-006 | Registration and transfer Checkout orchestration           | Direct/manual approval repeat release/create/bind/ambiguity logic, while registration and transfer share a review/Checkout shape but have different recovery ownership     | Use one Stripe Checkout Session for a new registration and its add-ons. Keep transfer as a fixed-bundle offer/claim flow that rechecks recipient eligibility, questions, and current discounts. Share only stable primitives; do not build a generic Checkout framework across distinct post-payment recovery rules                                | Worth exploring | Accepted: the product boundary is settled; rollback, email, binding, refund, and ambiguous-completion invariants remain flow-specific                                                                       |
| C-007 | Old event editing RPCs                                     | `findOneForEdit` and old `events.update` duplicate the graph endpoints with no app caller                                                                                  | Delete after source-reference and platform test proof                                                                                                                                                                                                                                                                                              | Strong          | Resolved                                                                                                                                                                                                    |
| C-008 | Huge event/registration handlers                           | 5,000-line handler and 4,000-line service mix eligibility, checkout, check-in, transfer, and query policy                                                                  | Extract only stable domain operations at existing transaction seams; keep orchestration local                                                                                                                                                                                                                                                      | Worth exploring | Accepted: extracted the reused immutable price-snapshot read; remaining operations keep transaction and side-effect ownership local because a file-only split would add indirection without deleting policy |
| C-009 | Raw-header RPC context bridge                              | Verified context is encoded into internal base64 headers and decoded again                                                                                                 | Pass one Effect request-context service directly; hostile-header tests remain green                                                                                                                                                                                                                                                                | Worth exploring | Resolved                                                                                                                                                                                                    |
| C-010 | Duplicate Bun/Node server assembly                         | Divergent adapter wiring caused the deployed proxy-trust defect                                                                                                            | One shared inbound normalizer and adapter contract tests                                                                                                                                                                                                                                                                                           | Strong          | Resolved                                                                                                                                                                                                    |
| C-011 | Test state inside production runtime config                | Production parses E2E/Auth0-management authorization settings                                                                                                              | Inject test-only configuration in test layers                                                                                                                                                                                                                                                                                                      | Strong          | Resolved                                                                                                                                                                                                    |
| C-012 | Ambient platform permissions                               | `globalAdmin:*` behaves as tenant authority and creates special-case bypasses                                                                                              | Keep platform authority only in explicit `PlatformOperation` contracts                                                                                                                                                                                                                                                                             | Strong          | Resolved                                                                                                                                                                                                    |
| C-013 | Regular/platform role and tax logic                        | Two implementations drift on normalization, pagination, and errors                                                                                                         | Small shared domain operation with thin authorization/audit adapters                                                                                                                                                                                                                                                                               | Strong          | Resolved                                                                                                                                                                                                    |
| C-014 | Tenant/platform finance handlers                           | 1,080- and 1,770-line handlers duplicate review/reimbursement rules                                                                                                        | One receipt review/reimbursement service; adapters retain tenant/platform authority and audit                                                                                                                                                                                                                                                      | Worth exploring | Resolved: shared batch policy; adapters keep authority and audit                                                                                                                                            |
| C-015 | Finance remote fan-out                                     | List endpoints HEAD/sign objects they never render                                                                                                                         | Remove remote calls from list paths; sign only an opened preview                                                                                                                                                                                                                                                                                   | Strong          | Resolved                                                                                                                                                                                                    |
| C-016 | Dead finance fields                                        | Tax-rate ID, duplicate attachment/preview snapshots, and public storage key have no consumer or duplicate upload truth                                                     | Delete after reference proof and focused record-shape tests                                                                                                                                                                                                                                                                                        | Strong          | Resolved: dead fields deleted; user-visible attachment label retained                                                                                                                                       |
| C-017 | Email outbox forwarding layers                             | Stored sender fields are never read and a one-method operations service only forwards                                                                                      | Delete fields/service; keep one delivery boundary                                                                                                                                                                                                                                                                                                  | Strong          | Resolved                                                                                                                                                                                                    |
| C-018 | Recurring full infrastructure reconcile/automatic rollback | Scheduled mutation and rollback after a forward schema release broaden failure paths                                                                                       | Optional read-only drift; fail visible and recover manually                                                                                                                                                                                                                                                                                        | Strong          | Resolved                                                                                                                                                                                                    |
| C-019 | Source-string/manual test inventories                      | Tests assert spellings and hand-maintained lists instead of behavior/discovery                                                                                             | Replace worst guards with behavior or generated discovery as touched                                                                                                                                                                                                                                                                               | Worth exploring | Resolved                                                                                                                                                                                                    |
| C-020 | User profile mega-component                                | Inactive sections mounted event, card, and receipt queries; unrelated account concerns still share one route shell                                                         | Retain a small shared profile shell, move substantial areas to routed pages that own their query/mutation state, and replace the sparse overview with a meaningful landing page; do not add presentational-only wrappers                                                                                                                           | Worth exploring | Resolved: overview, events, discounts, and receipts are routed pages that own their queries; the shared shell contains only navigation and provider-aware visibility                                        |
| C-021 | General settings mega-form                                 | Provider, legal, currency, limits, assets, and SEO share one required full-payload mutation and error surface                                                              | Add independently saved focused sections/pages inside the familiar two-column settings layout, backed by explicit section RPCs; provider/payment gets its own restricted page. Delete the monolithic model/RPC only after those seams exist; exact page names can be chosen later                                                                  | Worth exploring | Resolved: five independently saved routes use explicit section RPCs; the monolithic payload, component, and endpoint are deleted, and payments/providers has a dedicated permission boundary                |
| C-022 | Stale `src/app/core/auth.ts`                               | Old query/raw redirect helper has no current caller                                                                                                                        | Delete after reference proof                                                                                                                                                                                                                                                                                                                       | Strong          | Resolved                                                                                                                                                                                                    |
| C-023 | Tax/role duplicate queries and icon failure masking        | The tax dialog reloaded parent data, role selectors fanned out per selected ID, and icon failures rendered like empty results                                              | Pass imported IDs into the dialog, use one cached role catalog, delete dead role lookup RPC/filtering, and render explicit unavailable states                                                                                                                                                                                                      | Worth exploring | Resolved                                                                                                                                                                                                    |
| C-024 | Scanner/filter dead UI                                     | Empty filter, inert dismissal, unused paging methods, and fixed first page imply behavior that does not exist                                                              | Delete the controls or implement the complete URL/load-more path                                                                                                                                                                                                                                                                                   | Strong          | Resolved                                                                                                                                                                                                    |
| C-025 | Unused dependencies/scripts                                | Brand icons, `he`, `skia-canvas`, `ws`, icon-color experiment, and Stripe-listen script had no caller                                                                      | Prove references, delete individually, then lockfile/build/test                                                                                                                                                                                                                                                                                    | Strong          | Resolved                                                                                                                                                                                                    |
| C-026 | Unused user-attributes/view-count state                    | `user_attributes`, `User.attributes`, `events:organizesSome`, and cancelled view counts have no production consumer                                                        | Delete schema/query/context state after reference proof                                                                                                                                                                                                                                                                                            | Strong          | Resolved                                                                                                                                                                                                    |
| C-027 | Duplicate privacy-policy truth                             | Tenant row and version table both hold current policy URL/text                                                                                                             | Latest version is authoritative and request context reads it directly                                                                                                                                                                                                                                                                              | Worth exploring | Resolved                                                                                                                                                                                                    |
| C-028 | Per-handler defect stripping                               | Individual payment handlers sanitize defects inconsistently                                                                                                                | Public schemas omit causes; one shared allowlisted log summary replaces handler-specific stripping                                                                                                                                                                                                                                                 | Strong          | Resolved                                                                                                                                                                                                    |
| C-029 | Stripe tax-rate rotation operations seam                   | Focused plan tests inject three operations to prove account-before-write, metadata-before-remap ordering, and zero writes on account mismatch                              | Keep the narrow test seam: production binds it only to the caller's active transaction, preserving atomicity without runtime fallback or configurable behavior                                                                                                                                                                                     | Strong          | Accepted                                                                                                                                                                                                    |
| C-030 | Dead tax-rate helpers                                      | An unreferenced logging module and test-only price formatter added a second unused tax-formatting surface                                                                  | Delete both; retain the one UI label formatter and its behavior tests                                                                                                                                                                                                                                                                              | Strong          | Resolved                                                                                                                                                                                                    |
| C-031 | Placeholder discount-provider configuration                | An unused generic schema described nonexistent API credentials and missing adapters silently skipped validation                                                            | Keep the one real provider type and required adapter; provider outages fail visibly                                                                                                                                                                                                                                                                | Strong          | Resolved                                                                                                                                                                                                    |
| C-032 | Bun/Angular reported-Node compatibility define             | Angular 22 rejects Bun 1.3.14's reported Node version, so every Angular CLI command rewrites `process.version` and `process.versions.node`                                 | Keep the explicit define only on Bun 1.3.14; after [Node compatibility commit `0fcead6`](https://github.com/oven-sh/bun/commit/0fcead62d8df317ca62b15cd2d6ad185f7639d59) and [Angular coverage commit `749589f`](https://github.com/oven-sh/bun/commit/749589fe798fd078d473b0f093ede73289e0de22) ship in stable, update and delete the define/docs | Strong          | Accepted: 1.3.14 is the latest stable; canary is not an acceptable production baseline                                                                                                                      |
| C-033 | Distributed request/body reconstruction                    | Adapter-specific paired Web requests, body-marker transfer, and source-spelling guards duplicated one inbound boundary and made streaming ownership fragile                | Let the single boundary middleware rebuild and provide the normalized server request; delete request-pair, body-transfer, and source-spelling machinery                                                                                                                                                                                            | Strong          | Resolved                                                                                                                                                                                                    |
| C-034 | Raw Playwright fixture invariants                          | Direct event/registration inserts and shared mutable identities duplicated fresh-schema review, price-snapshot, and confirmation rules until 30 tests exposed the drift    | Keep narrow scenario-local invariant helpers and canonical seeds, isolate mutable identities, and delete duplicate raw setup; do not build a universal fixture framework                                                                                                                                                                           | Strong          | Resolved: bounded local fixture corrections; functional 151/151 and docs 52/52                                                                                                                              |
| C-035 | Focused-settings fallback and refresh handling             | Five pages repeated a pseudo-fallback from `tenantSignal()` to an imperative getter and replaced local edits on every query refresh                                        | Enforce one initialized-tenant invariant and one small dirty-state policy; keep each page's explicit model mapping instead of adding a generic settings framework                                                                                                                                                                                  | Strong          | Resolved: the fallback is deleted, one shared route/dirty policy protects five explicit page models, and dirty payment state pins its original Stripe account                                               |
| C-036 | Unused filesystem KeyValueStore layer                      | Server startup constructed and wired a relative filesystem cache service with no consumer, creating runtime state and a future writable-directory boundary for no behavior | Delete the import, cache path, layer, and both composition entries; do not add a `/tmp` fallback, configuration option, ownership workaround, or volume for an unused service                                                                                                                                                                      | Strong          | Resolved                                                                                                                                                                                                    |

## Accepted complexity

- Registration/payment row locks, durable claims, idempotency keys, and
  ambiguity stops are required by money and capacity invariants. Simplify
  duplication around them, not the invariants themselves.
- A new registration and its add-ons use one Stripe Checkout Session. Transfer
  uses the same broad review/Checkout shape but remains a fixed-bundle
  offer/claim flow with its own refund and ambiguous-completion recovery.
  Share stable payment primitives, not a generic backend Checkout framework.
- Explicit platform-operation contracts with target, reason, and transactional
  audit are intentionally deeper than ambient permission checks.
- Effect RPC and tagged domain errors remain the single typed client/server
  boundary.
- Receipt MIME sniffing, hashing, immutable object keys, and narrow signed URLs
  are justified storage-security controls.
- The Bun/Angular version define is a temporary, visible toolchain constraint,
  not a runtime fallback. Delete it as soon as a stable Bun release contains
  the already-merged [Node compatibility
  change](https://github.com/oven-sh/bun/commit/0fcead62d8df317ca62b15cd2d6ad185f7639d59)
  and [Angular CLI coverage
  change](https://github.com/oven-sh/bun/commit/749589fe798fd078d473b0f093ede73289e0de22);
  do not replace it with a canary pin.
- The three named tenant themes are an explicit 2026-07-27 product requirement:
  the new palette is `evorto` and the default, the former Evorto palette is the
  selectable `classic` theme, and `esn` remains independent. These are exact
  fresh-schema enum choices, not aliases, automatic fallbacks, or legacy-data
  compatibility.

## Product decisions

All previously open product questions are settled, and their application
follow-up is implemented below. Provisional page labels and the new focused
payments permission remain explicit review choices, not hidden compatibility
behavior.

| ID    | Product boundary                         | Settled direction                                                                                                                                                                                                                         | Implementation outcome                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | Waitlists and active-registration limits | A waitlist entry does not consume the tenant active-registration limit. Check the limit only when converting the entry into a real registration.                                                                                          | Resolved: waitlist joins do not inspect or consume the limit. Normal registration, private claims, and paid-transfer finalization count only pending and confirmed future registrations and surface the unavailable outcome at the real-registration boundary.                                           |
| D-002 | Participant registration transfer        | Keep one private offer-and-claim flow. A wholly free, questionless claim completes immediately; every payment-involving transfer remains asynchronous through Stripe.                                                                     | Resolved: the obsolete participant direct-reassignment RPC and compatibility branches are deleted. Organizer operational reassignment remains separately constrained to free, no-refund, questionless bundles, while participant claims retain visible Stripe recovery.                                  |
| D-003 | Template listing audience                | A template stores the default event discovery audience copied into each new event. Templates themselves have no visibility state. This is settled and no decision remains.                                                                | Confirmed: creation tests prove the template default is copied to the new event, while template management has no visibility state.                                                                                                                                                                      |
| D-004 | Optionless announcement discovery        | An optionless announcement gets an explicit set of selected tenant roles for normal discovery. With no selected roles it is link-only. Discovery selection does not grant access and does not send notifications.                         | Resolved: event-owned tenant role IDs drive ordinary discovery, empty roles are link-only, role deletion is integrity-guarded, and ordinary/platform UI and contracts keep direct-link access and notifications separate.                                                                                |
| D-005 | Tenant general-settings structure        | General settings become independently saved focused sections/pages inside the familiar two-column settings layout. Provider/payment configuration gets its own restricted page. Exact section and page names can be chosen during design. | Resolved: organization, registration, appearance, legal, and payments/providers are independent guarded routes with explicit section RPCs. The monolith and tenant fallback are deleted; payments/providers uses the dedicated `admin:managePayments` boundary and rejects stale account edits.          |
| D-006 | Profile structure                        | Retain a small shared profile shell, move substantial areas to their own pages, and redesign the sparse overview into a meaningful landing page.                                                                                          | Resolved: the routed overview, events, discounts, and receipts pages own their data and mutations; the small shell supplies responsive navigation and explicit focus handoff, and fragment/tab compatibility is deleted.                                                                                 |
| D-007 | Registration and transfer Checkout scope | A new registration and its add-ons use one Stripe Checkout Session. Transfers follow the same review/Checkout pattern but keep one fixed bundle, rechecking recipient eligibility, participant questions, current prices, and discounts.  | Resolved: one persisted claim and Stripe Session cover registration plus positively purchased add-ons, included-only entitlements add no Checkout line, and transfer keeps its fixed-bundle eligibility/pricing review and distinct post-payment recovery rather than a generic orchestration framework. |

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
- 2026-07-26: Rebased the consolidated review snapshot onto the newer
  `origin/main` revision `d117229d`, preserving the reviewed dependency
  deletions while taking the current Effect and Angular versions.
- 2026-07-26: Canceled the task-owned automated security scan at the user's
  request, stopped its worker/service process tree, and moved its temporary
  output roots to the macOS Trash.
- 2026-07-26: A later process-table check found a replacement task-owned scan
  worker tree still active; stopped that exact process group, moved its
  temporary root to the macOS Trash, and verified that no scan process remained.
- 2026-07-26: Final process verification caught a second replacement scan
  service (`codex-security-scans-WUk70s`) targeting the separate main checkout.
  Stopped its exact process group and moved that temporary root to the macOS
  Trash. No automated scan result is part of this review.
- 2026-07-26: The owning scan task invoked the official cancellation for scan
  `115415ef-9328-4479-b7aa-2b4516557e87`, but the Codex Security service
  returned `Transport closed`. The owning task is idle, all local workers are
  stopped, and all discovered scan temporary roots are absent; only the durable
  service acknowledgment remains unavailable.
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
- 2026-07-26: Deleted the event list's empty filter dialog and inert dismissal,
  then replaced the fixed first-page limit with bounded deterministic load-more
  behavior that preserves already loaded pages and exposes later failures.
- 2026-07-26: Removed the hand-maintained Playwright file list, circular
  inventory assertions, a historical storage migration spelling guard, an
  unused screenshot compatibility export, and commented browser projects.
- 2026-07-26: Reconciled the platform audit implementation against F-018:
  deterministic 50-entry keyset pages retain safe actor, tenant, resource, and
  permission evidence while raw provider/error payloads remain hidden.
- 2026-07-26: Reconciled regular and platform check-in against F-024: both use
  one shared one-hour-before/two-hours-after timing policy and return distinct
  typed `notOpen` and `ended` outcomes before writing.
- 2026-07-26: Made template graph reads fail loudly when a persisted
  registration option references a missing tenant role instead of silently
  dropping the role from the response.
- 2026-07-26: Removed the fake discount-provider credential schema and
  unreachable missing-adapter fallbacks; the supported ESN Card adapter is now
  required and validation outages stay visible.
- 2026-07-26: Removed the stale plan for a future best-effort legacy data
  migration from the fresh Scaleway deployment documentation.
- 2026-07-26: Added server-side signature checks for tenant logos and favicons;
  claimed image MIME types no longer permit arbitrary bytes to be stored and
  served from the application origin.
- 2026-07-26: Made admin overview/settings/role failures explicit, unified
  regular and platform role writes, bounded persisted registration settings,
  and routed non-finance platform mutation errors through the typed renderer.
- 2026-07-26: Replaced role-selector N+1 lookups with one cached catalog,
  deleted the now-unused ordinary role-detail RPC and filter branches, passed
  imported tax IDs into the import dialog, kept icon lookup failures distinct
  from empty results, and stopped inactive profile-section data queries.
- 2026-07-26: Replaced the base64 `x-evorto-*` RPC identity bridge with one
  request-scoped typed Effect context, kept the RPC server lifecycle outside
  individual requests, made missing trusted context a visible defect, and
  retained hostile-header rejection coverage.
- 2026-07-26: Bounded regular list paging with one shared integer schema,
  required canonical UTC timestamps for event and audit cursors, and aligned
  page-size controls with the 100-row contract ceiling.
- 2026-07-26: Removed the legacy Auth0 `globalAdmin` platform-authority alias
  and made corrupt tenant-role platform permissions fail at the request-context
  and admin-read boundaries instead of silently discarding them.
- 2026-07-26: Removed SSR RPC origin reconstruction from forwarded headers and
  the hard-coded localhost fallback. SSR now requires either a valid configured
  origin or an absolute Angular request URL, and server configuration aborts
  when Angular request context is missing.
- 2026-07-26: Deleted rich-text image support, its unused Tiptap extension and
  dependency, and impossible pending-upload validators. The server sanitizer
  now strips remote and temporary images while retaining supported text, links,
  lists, tables, and horizontal rules.
- 2026-07-26: Removed the event-list `users.maybeSelf` query and client-supplied
  `userId`; the event-list handler now uses only authenticated request context
  for identity and has no mismatch-warning branch.
- 2026-07-26: Replaced the event list's fixed first page with bounded explicit
  load-more, preserved loaded pages when a later request fails, merged tenant
  days across page boundaries, and ordered equal-start events by ID.
- 2026-07-26: Gated review identity/comments to event editors and reviewers,
  routed event guards by exact tagged outcomes, and made review conflict
  recovery independent of English message copy.
- 2026-07-26: Reconciled explicit event-option inheritance, bounded question
  and answer inputs, duplicate-answer rejection, and one shared
  immutable-after-answer policy. Deleted the obsolete event edit RPC pair and
  extracted only the stable registration price-snapshot read invariant from
  the large handlers.
- 2026-07-26: Pre-generated event option IDs by source template option and
  required every copied discount, add-on attachment, and question to resolve;
  creation now defects instead of pairing returned rows positionally or
  dropping an invalid mapping.
- 2026-07-26: Made receipt values and dates strict end to end; aligned browser
  and server upload limits; added atomic finalization and short orphan-cleanup
  claims; reused the reimbursement confirmation and batch policy; retained a
  masked, versioned payout audit; rejected invalid persisted country settings;
  and deleted duplicate receipt metadata, the unused tax-rate field, and the
  stored object URL.
- 2026-07-26: Closed the remaining database ownership and range gaps with
  composite question, answer, receipt, upload, refund, event, registration, and
  transaction provenance constraints; retry counters and leases now reject
  impossible persisted states directly.
- 2026-07-26: Made tenant, receipt-country, discount-provider, communication
  email, PayPal email, and IBAN persistence fail loudly. Persisted ESN Card
  purchase URLs must be canonical HTTPS URLs, and defaults remain creation-only.
- 2026-07-26: Removed privacy policy URL/text from the tenant row and its write
  paths. The version table is now the only persisted truth, and request context
  reads its latest version for public legal links.
- 2026-07-26: Tightened fresh seeding so every profile requires its explicit
  Stripe test account, one exact active 7% and 19% tax rate, complete returned
  template rows, and every declared add-on/question attachment. Missing
  fixtures now abort the atomic seed instead of becoming empty arrays.
- 2026-07-26: Attempted representative index measurement only against the
  isolated disposable `evorto-491cffdb-db-1` PostgreSQL container. Docker
  Desktop failed to start that container, so no `EXPLAIN` result is claimed and
  no index was added from static inference; this remains explicit under RQ-015.
- 2026-07-26: Removed the deprecated forwarded-protocol alias and invented
  localhost origin from Auth0 request handling. Auth now requires the protocol
  and Host established by the normalized inbound request boundary.
- 2026-07-26: Integrated verification passed both TypeScript projects,
  formatting, lint, the complete application build, all 945 Angular tests, and
  all 1,485 server tests.
- 2026-07-26: PostgreSQL integration and representative `EXPLAIN` execution
  remain unavailable because Docker Desktop failed to start the exact
  disposable review container and then stopped answering inspection requests.
  No speculative index or database-pass claim was added.
- 2026-07-26: Playwright environment preflight stopped before test execution
  because the isolated review environment lacks the required Auth0 client
  secret, Stripe API key, and seven E2E account passwords. Playwright
  installation, test collection, and Docker Compose configuration were
  available; no E2E pass is claimed.
- 2026-07-26: Browser acceptance remains explicitly blocked. Port 4200 serves
  an Evorto instance of unverified branch provenance, and the required in-app
  Browser control bridge was unavailable after prescribed discovery retries.
  A direct HTTP response was not substituted for interactive Browser evidence.
- 2026-07-27: Removed storage-error message matching. Object reads now treat
  only an explicit provider existence result of `false` as missing; provider
  and network failures remain visible internal failures.
- 2026-07-27: Re-ran the complete disposable PostgreSQL suite after aligning
  fresh-schema fixtures with the current provenance and snapshot constraints:
  17 files and 68/68 tests passed. The run exposed and closed a stale
  registration-transfer query; cancellation and check-in now block only
  mutation-conflicting transfer stages while a new transfer still blocks on
  every active refund stage.
- 2026-07-27: Ran four plain read-only `EXPLAIN` plans and rolled back the
  transaction. The tenant-cap query selected
  `event_registrations_active_tenant_user_idx`, email dispatch selected
  `email_outbox_dispatch_idx`, and ordinary event discovery used the current
  event-instance and active-registration indexes. Checkout reconciliation
  selected its unique Stripe-session index on an empty table. The seed has 18
  events and 36 options but no registrations, transfers, transactions, or
  outbox rows, so no additional scale index is claimed or added.
- 2026-07-27: Container acceptance exposed that Effect's original Web Request
  bypassed normalized request overrides. Every Web boundary now reconstructs
  the Request from the validated protocol, Host, path, headers, body, signal,
  and redirect mode. Angular route discovery is the one explicit no-request
  initialization lifecycle; real SSR requests still fail without request
  context. The rebuilt container returns 204 from `/readyz`.
- 2026-07-27: The authenticated Playwright baseline collected 150 tests, seeded
  the disposable database, and then failed visibly at the first Auth0 setup
  case. Auth0 reported `Callback URL mismatch` for the isolated
  `http://localhost:4275` runtime; 148 scenarios did not run. Port 4200 is owned
  by another worktree's active stack, so it was not stopped or reused.
- 2026-07-27: Verified against Bun's official release and merged-change
  history that 1.3.14 is still the latest stable. Native Angular CLI
  compatibility is merged after that release on Bun main. Retained the
  explicit version define and recorded its first-stable-release deletion
  trigger instead of adopting an untested canary.
- 2026-07-27: Branch-authentic Browser acceptance on the rebuilt isolated
  port-4275 application exposed F-087: public event details called the
  authenticated organizer-capability operation and displayed its failure.
  The query and cached result are now gated by confirmed authentication; the
  focused component suite passed 29/29, and a repeated public event-list/detail
  journey showed the correct login-required registration state with no false
  organizer alert. Authenticated Browser coverage remains blocked by the same
  rejected Auth0 callback as Playwright.
- 2026-07-27: Final diff review exposed three places where a superficially
  correct guard still hid the real boundary. Event identity failures now render
  a retry, personal data and creator/organizer state require a successful
  authenticated identity result, and a failed refresh removes cached creator
  controls. Angular route discovery now stops before constructing request-bound
  configuration. The Node adapter also hands its already-normalized request
  directly to application routes, while Bun retains the one ingress boundary,
  so direct TLS cannot be downgraded by a second normalization pass.
- 2026-07-27: Replaced the remaining deleted recipient-registration transfer
  fixtures with the fresh source-registration predicate. Preview and commit now
  have explicit zero-mutation coverage for both refund recovery stages, while
  cancellation and check-in retain their narrower mutation-blocking policy.
  Shared conflict guidance no longer suggests cancellation in a stage where it
  is unavailable.
- 2026-07-27: The final boundary regression exposed that rebuilding a Web
  request outside the middleware transferred Bun's streaming body away from
  the request consumed by RPC. Removed the paired-request and body-marker
  transfer helpers. The one boundary middleware now rebuilds and provides the
  normalized server request, and an accepted RPC POST proves its body remains
  readable.
- 2026-07-27: Added the requested `#4956C8` / `#62677A` / `#FFB26B` /
  `#F7F4ED` / `#72778A` / `#B3261E` palette as the default `evorto` theme.
  Preserved the former Evorto palette byte-for-byte as `classic` and kept `esn`
  unchanged; tenant contracts and both administration forms expose all three
  explicit choices.
- 2026-07-27: Centralized document theme-class changes in the accepted
  tenant-configuration path, so initialization and later tenant refreshes use
  the same lifecycle. Deleted the two static `theme-color` tags because their
  colors matched no selectable palette; no tenant-to-meta mapping layer replaced
  them.
- 2026-07-27: Ran the real Auth0 setup and credential-backed functional suite
  against the reviewed app through an isolated container network without
  touching the other port-4200 stack. Setup passed for all six accounts and the
  baseline reached 120/150 passing tests. The remaining 30 failures exposed
  stale constraint fixtures, assertions, and shared mutable identities rather
  than an authentication block; F-094 and C-034 track the bounded corrections
  until both functional and documentation baselines are green.
- 2026-07-27: Closed the credential-backed failures without a compatibility
  layer or universal fixture framework. Current review metadata, immutable
  price snapshots, exact profile relations, isolated mutable identities,
  explicit transfer-code re-entry, and transactionally consistent scanner
  counters replaced the stale setup. The real Auth0 functional baseline then
  passed 149/149.
- 2026-07-27: The first complete documentation baseline exposed 12 additional
  stale raw inserts and UI assumptions. After narrow current-schema and
  test-clock corrections, all 52 documentation journeys passed. No test was
  skipped, retried, or converted into a fallback.
- 2026-07-27: The exact production-image gate built the application, completed
  runtime checks and SBOM generation, then failed on four Critical and 21 High
  Debian package findings. F-093 records the defect; remediation uses no
  suppression or package-upgrade fallback.
- 2026-07-27: Replaced the final Debian Bun layer with a pinned non-root
  distroless runtime, copied only Bun and required application artifacts, and
  removed the shell/FIFO log duplicator plus redundant worker command. The
  exact image gate now passes at 95,685,275 bytes with zero High/Critical
  Debian or Node findings; Bun 1.3.14 executes directly, and SBOM/source-map
  checks pass.
- 2026-07-27: Updated the generated-documentation source guard to verify
  `checkedInSpots` and `confirmedSpots` restoration separately; the focused
  suite passed 28/28.
- 2026-07-27: Ran the complete canonical local gate on implementation commit
  `5beab55743a0b11cb5af11aacdab8a6ee848e47e`. Frozen install, release
  validation, formatting, lint, clean-tree checks, server 1,495/1,495, Angular
  956/956, PostgreSQL 68/68, build, Terraform/Trivy, the exact 95,685,275-byte
  runtime image, real-Auth0 functional Playwright 149/149, and documentation
  Playwright 52/52 all passed without failures, skips, retries, or incomplete
  tests.
- 2026-07-27: Settled D-001 through D-007 without changing application code.
  The chosen directions exclude waitlists from the active-registration limit
  until conversion, converge participant transfers on one private offer/claim
  flow, keep template audience as only a copied event default, give optionless
  announcement discovery explicit tenant roles, give settings and profile
  focused routed ownership, and keep registration/add-on Checkout in one
  Session without a generic framework spanning transfer recovery. C-020 and
  C-021 are now open implementation work with their product direction resolved.
- 2026-07-27: Implemented D-001 through D-007 end to end. Waitlists now defer
  active-limit checks to conversion; participant transfer has one private
  offer/claim path; template discovery remains a copied event default;
  optionless announcements use explicit tenant roles; settings and profile use
  focused routed ownership; and initial registration plus add-ons use one
  persisted payment claim and Stripe Session. The obsolete participant
  reassignment RPC, monolithic settings RPC/component, profile fragment
  routing, and generic-orchestration temptation were deleted rather than
  retained as compatibility or fallback paths.
- 2026-07-27: Independently reviewed the settled-decision implementation and
  fixed five follow-up defects: changed Stripe account IDs are verified before
  persistence in both tenant and platform flows; included-only add-ons cannot
  create zero-quantity Stripe lines; focused-settings documentation publishes
  under its current slug; announcement guidance separates discovery from
  access and notifications; and profile child routes no longer construct the
  overview query.
- 2026-07-27: Corrected the routed profile's add-on financial summary. The typed
  response now carries currency and purchased quantity explicitly, and the UI
  no longer presents included entitlement as paid or formats it in Angular's
  default currency.
- 2026-07-27: A final independent server and UI contract review found and
  closed seven defects rather than adding fallbacks. Loaded Stripe account IDs
  are concurrency tokens, provider/response failures remain defects, optionless
  announcement saves require a valid role catalog, focused settings preserve
  dirty state, appearance uploads cannot race their save, checkout arithmetic is
  bounded before persistence, and routed profile pages hand off keyboard focus.
- 2026-07-27: Simplified focused-settings lifecycle handling to one explicit
  initialized-tenant invariant plus a small dirty-state route policy. Each page
  retains its direct model and RPC instead of introducing a generic settings
  framework.
- 2026-07-27: Repeated the functional baseline after isolating and removing the
  interrupted worktree-local Docker stack. With the infrastructure interference
  gone, 150/151 journeys passed and the remaining registration-settings failure
  reproduced Angular event replay submitting the still-active server-rendered
  form before hydration. All five focused settings forms now remain natively
  disabled until the browser render and `ApplicationRef.whenStable()` boundary;
  the save handlers independently enforce the same readiness state.
- 2026-07-27: The next isolated retry cleared the hydration defect and reached
  150/151 journeys. Its sole failure was a legal-settings test projection that
  treated the versioned privacy-policy value as a tenant column. The readback
  now checks only the legal-notice and terms columns owned by that page; no
  compatibility field or application fallback was added.
- 2026-07-27: The isolated functional baseline then passed all 151 journeys.
  The documentation baseline reached 51/52 and exposed one ambiguous
  page-wide `Events` selector: the routed profile section correctly preceded
  the public-event link in document order. The guide now selects the explicitly
  labelled main navigation instead of relying on link order.
- 2026-07-27: The complete documentation baseline then passed 52/52 on a
  freshly created worktree-local stack. Label-based cleanup confirmed zero
  remaining containers, networks, or volumes for this worktree; the unrelated
  four-container stack remained running and untouched.
- 2026-07-27: PR review follow-up kept the template-copy integrity guards as
  deliberate defects and kept ambiguous forwarded-protocol headers fail-closed.
  Two touched seed helpers now use the valid repository aliases, and the build
  exposed and removed the invalid `@types/*` alias rather than hiding TS6137.
  The entirely unused filesystem `KeyValueStore` layer was deleted instead of
  gaining a writable-directory fallback, configuration switch, ownership
  workaround, or volume. A current image export showed `/app` owned by UID/GID
  65532, so the reported runtime permission failure itself was not reproducible.
- 2026-07-27: The complete post-review local gate passed: release validation,
  formatting, lint, application build, 1,517 server tests, 977 Angular tests,
  76 PostgreSQL integration tests, infrastructure validation, the production
  image-security gate, 151 functional Playwright journeys, and 52 documentation
  journeys. Docker Desktop diagnostics exposed orphaned container start/attach
  requests, so the daemon was restarted and the pre-existing four-service stack
  was restored to healthy after reconstructing its two missing bind-source
  files. Label-based cleanup again confirmed zero containers, networks, or
  volumes remain for this worktree.

## Verification evidence

- Legacy deletion source/schema guards: 31/31 and 23/23.
- Fresh-schema tenant/permission/settings server tests: 86/86.
- Fresh-schema Angular/shared tests: 54/54.
- Template/registration-mode Angular tests: 69/69.
- Template/registration-mode server tests: 202/202.
- Event/provider fail-loud Angular tests: 92/92.
- Event discovery and copied-discount server tests: 26/26.
- Check-in handler tests: 96/96.
- Auth/config tests: 14/14; SSR cookie forwarding: 9/9.
- Auth request-origin and inbound-boundary tests: 20/20.
- RPC ingress tests: 22/22; SSR/client integration: 15/15.
- Typed RPC request-context, user-handler, and request-resolver tests: 37/37.
- Members Hub/onboarding/permission-guard Angular tests: 12/12.
- Tax-label/dead-helper focused server and Angular tests: 10/10.
- Registration seed/auth-account helper tests: 14/14; affected Playwright
  dependency/test collection: 9/9.
- Platform audit, check-in, and platform-registration server tests: 145/145.
- Scanner, platform audit, profile-query gating, role/tax/icon, event-list, and
  shared-contract Angular tests: 101/101.
- Admin settings/overview/user-list Angular tests: 20/20.
- Identity, admin, list-contract, and audit server tests: 96/96.
- Identity/admin list and provider-state Angular/shared tests: 72/72.
- SSR origin and server configuration initialization Angular tests: 9/9.
- Rich-text sanitizer tests: 4/4; affected rich-text form schema tests: 26/26.
- Event-list identity contract tests: 29/29 server and 2/2 Angular.
- Event creation/query integrity tests: 31/31 server; event route, review,
  details, and paged-list tests: 40/40 Angular.
- Registration snapshot, question-history, check-in, handler, platform, and
  serialization tests: 178/178.
- Database ownership, privacy-version, request-context, onboarding, global
  administration, and seed-prerequisite tests: 67/67.
- Strict tenant/receipt/provider configuration tests: 22/22.
- Profile email and payout validation tests: 31/31.
- `tsc -p tsconfig.app.json --noEmit` passed after the database, privacy, and
  seed changes.
- Test discovery, skip inventory, storage-state, and suite-ownership tests:
  29/29; current functional Playwright baseline: 151/151.
- Receipt storage/finance handler tests: 71/71.
- Finance lifecycle, schema, platform reimbursement, and audit tests: 88/88;
  receipt value/date/reimbursement contract tests: 53/53.
- Finance shared-policy, receipt UI, event-organizer, and platform-finance
  Angular tests: 81/81.
- Receipt detail/list-contract Angular tests: 33/33.
- Security boundary tests: 51 focused server tests plus cache/telemetry tests.
- Infrastructure/source tests: 37/37.
- Terraform validation for bootstrap, staging, and production.
- `bun run infra:check`: zero Trivy misconfigurations.
- Multiple focused `bun run lint`, `bun run format:write`,
  `bun run build:app`, and `git diff --check` runs passed.
- Integrated `tsc -p tsconfig.app.json --noEmit` and
  `tsc -p tsconfig.spec.json --noEmit` passed.
- Integrated `bun run format:check`, `bun run lint`, and
  `bun run build:app` passed.
- Integrated Angular suite: 132 files, 977 tests passed.
- Integrated server suite: 193 files, 1,517 tests passed.
- Current request-boundary, request-body, worker-route, and server-response
  regressions: 36/36.
- Current event registration handler regressions: 101/101.
- Current Angular application/configuration and event-identity regressions:
  36/36.
- Default/classic/ESN theme schema and focused administration/form tests: 3/3
  and 47/47; all three compiled light/dark theme classes were exercised in
  Chromium, including Material primary, primary-container, tertiary, and
  surface role contrast plus exact standard/high-contrast primary values; both
  palette generator commands reproduce their tracked files.
- PostgreSQL integration: 18 files, 76/76 tests passed.
- Settled-decision focused server tests: waitlist, transfer, combined Checkout,
  settings validation, announcement discovery, and profile routing passed
  without skips or retries.
- Settled-decision focused PostgreSQL tests prove active-limit conversion,
  fixed-bundle payment finalization, role-targeted announcement discovery,
  role-deletion integrity, and the platform-update versus role-delete race.
- Settled-decision focused Angular/shared tests cover the five settings pages,
  routed profile ownership, ordinary/platform announcement role selection,
  explicit permissions, and current documentation contracts.
- Final decision follow-up tests: checkout amount boundaries 67/67; payment
  account handlers 71/71; provider failure classification 4/4; payment
  contracts/forms 45/45; focused settings guard/hydration 33/33. The ordinary
  announcement dialog now has behavioral role-catalog and mutation-failure
  coverage, and the routed profile shell has explicit focus-contract coverage.
- Focused settings hydration/readiness tests: 18/18.
- Current production-image gate: Debian 13.6 and every Node package report
  zero High/Critical findings; runtime verification, Bun 1.3.14 execution,
  SBOM, and private source-map export passed.
- Rebuilt isolated distroless stack: web `/readyz` returned HTTP 204; Bun ran as
  PID 1, and the worker started both polling loops without a shell or command
  override.
- Theme Playwright smoke: database setup plus the selected theme scenario
  passed 2/2. Default, Classic, and ESN Material primary,
  primary-container, tertiary, and surface roles meet their standard and
  increased-contrast requirements across light and dark modes.
- Representative PostgreSQL planning: four read-only `EXPLAIN` statements
  completed and rolled back; current indexes were selected where the seeded
  cardinality was meaningful, and no speculative index was added.
- Rebuilt container `/readyz`: HTTP 204.
- Authenticated Playwright setup: database setup and all six real Auth0 account
  logins passed through the isolated runner.
- Credential-backed functional Playwright baseline: 151/151 passed through real
  Auth0 with zero failures, skips, retries, or incomplete tests.
- Credential-backed documentation Playwright baseline: 52/52 passed with zero
  failures, skips, retries, or incomplete tests.
- Event-detail authentication gating: 33/33 focused Angular tests passed.
- Interactive Browser acceptance: the branch-authentic public event-list and
  event-detail journey passed on the rebuilt distroless stack with no browser
  warnings or errors. The document used `theme-evorto` by default and exposed
  the generated primary, tertiary, and surface roles. Authenticated in-app
  Browser acceptance remains explicitly blocked because Auth0 registers
  `localhost:4200`, which belongs to another worktree; the real-auth automated
  baselines above exercised the reviewed application without taking over that
  stack.

## Completion evidence

Completion requires:

- every coverage row complete or blocked by an exact named external
  prerequisite;
- every finding resolved, explicitly accepted, or blocked by a recorded product
  decision;
- no backwards-compatibility implementation for the legacy application;
- no production fallback that hides an unexpected failure;
- the architecture/simplification report generated and reviewed;
- all locally runnable verification passing, with each environment-only block
  named precisely and never replaced by weaker evidence; and
- Browser acceptance or its explicit environment block recorded separately
  from automated Playwright evidence.
