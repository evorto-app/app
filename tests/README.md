# Playwright Tests

This directory contains the active Playwright suite.

Local Playwright database fixtures require `LOCAL_DATABASE=true` and a
`DATABASE_URL` whose driver target matches `POSTGRES_DB` and
`POSTGRES_HOST_PORT` on loopback. Explicit credentials and loopback aliases
are supported; remote hosts, Compose-internal URLs, connection query overrides,
and the reserved `evorto_postgres_integration` app database name fail before
pool creation. Supported package commands validate the final environment before
dispatch; direct CI invocations must supply the same target settings.

## Structure

- Functional/e2e tests: `tests/specs/**`
- Documentation tests: `tests/docs/**`
- Setup/auth/database bootstrapping lives in `tests/setup/**`
- Shared fixtures/utilities/reporters live in `tests/support/fixtures/**`, `tests/support/utils/**`, `tests/support/reporters/**`

## Generated Documentation Authoring Contract

Each product-facing documentation journey should be understandable without
prior Evorto knowledge. Include:

1. the intended reader and exact account, organization, permission, and external-service prerequisites;
2. a click-by-click path starting from normal application navigation;
3. an explanation of choices before the user commits a write or payment;
4. the visible completion state plus a persisted, payment, or notification readback where applicable;
5. critical denial, recovery, retry, timing, and organization-boundary behavior;
6. explicit unsupported or deferred behavior so the guide does not promise an unavailable feature;
7. accessible screenshots where they clarify a real decision or result, backed by behavior assertions rather than screenshots alone.

Use plain product language throughout the published text, guide titles, callouts,
and screenshot captions. Do not publish implementation names, protocols,
identifiers, storage or delivery mechanics, database checks, fixture details, or
test evidence. Keep those details in executable setup and assertions. Name an
external service only where the reader sees or uses it.

The documentation reporter owns each page title and writes the page's single
level-one heading. Authored Markdown must start at `##` or a lower heading
level; adding a `#` heading in a documentation source is an error.

When a complete workflow cannot yet be documented because the product behavior
does not exist, record the missing behavior as a visible release blocker; do
not replace it with aspirational documentation.

## Fixture Contract

- `tests/support/fixtures/parallel-test.ts` seeds a fresh tenant per test with `profile: 'test'`
- `tests/setup/database.setup.ts` seeds the shared docs tenant with `profile: 'docs'`
- Specs should consume deterministic scenario handles from `seeded.scenario`
- Do not discover test entities by template title fragments, fuzzy event searches, or wall-clock checks

The automatic `falsoSeed` fixture scopes deterministic data by project, file,
title path, repetition index, and retry. Use `--repeat-each` for diagnostic
repetitions; each repetition receives a distinct fixture seed.

Local tenant selection uses the scoped routing helper in
`tests/support/utils/tenant-request-routing.ts`. Use the returned `close()`
method for pages created with `openAuthenticatedTestPage`. The base page
fixture uses `closeTenantRequestPages` to cancel each pending intercepted browser
request before closing its context's current pages. Chromium can otherwise replay
a paused request without its tenant header as the page closes. Cancellation and
fulfillment share one terminal action, so an upstream fetch that completes during
cleanup cannot settle the browser request twice. The independent upstream fetch
and context request client remain alive until cleanup drains all admitted work,
then removes the exact owned route. Upstream, cancellation and closure failures
remain visible. If a page
remains open, cleanup fails and retains routing for Playwright's outer context
teardown; it does not retry page closure or remove interception from live pages.
The fixture exclusively owns this final page cleanup. Custom contexts use
`closeTenantRequestContext` for the same cancellation, page-close and drain sequence followed
by owned context closure. It still attempts that closure if page cleanup fails,
and joins remaining callbacks only after confirming the context is closed.
Normal and emergency cleanup share one context-close attempt; a rejected or
unproven closure is not retried, and all known failures remain visible.
Cleanup checks settlements again before each page and context closes, including
callbacks arriving while an earlier page closes. It attempts cancellation before
reading the page inventory, so an inventory failure cannot bypass that step or
discard an earlier cancellation failure.
If cleanup starts while a request is still reading its headers, that request
is canceled without starting an upstream fetch when the headers arrive.
Do not replace the scoped drain with
`unrouteAll`, which can release other active requests before their handlers
finish.

Playwright Test sets `Connection: close` from the first request because its API
client shares idle connections across contexts. The local routing helper
overrides incoming connection headers before fetching. The server also returns
`Connection: close` when that option was requested, so pooled Node clients retire
the socket as soon as its response finishes. The request header alone does not
guarantee retirement when an upstream omits the response header. Keep this policy
when supplying custom context or request headers. Project defaults cover browser contexts and
the independent request fixture, including external provider requests; standalone
clients outside Playwright Test must supply their own connection policy.
Requests are still issued once and all request failures remain visible.

Register database cleanup through `registerDatabaseCleanup` before the first
write. Its callbacks run in reverse order while the owning database pool is
still available, and cleanup failures remain visible.

`specs/templates/event-discount-snapshot.spec.ts` creates events through normal
template navigation using the discount-enabled fixture. Its two scenarios edit
or clear the visible ESNcard price, change the template price while the form is
open, and read back both the new event and template to prove their snapshots
remain separate. Before its first write, the spec registers separate callbacks
for its created event graph and the exact original template option/discount
state. The shared discount fixture separately restores the original provider
and user-card state; this does not claim whole-tenant cleanup.

The shared `helpers/testing/e2e-runtime-state.ts` reader treats only a missing
runtime file as absent. Other read failures, malformed JSON, and missing,
blank, or untrimmed tenant domains fail setup. Authentication waits for missing
state; the base fixture uses its configured tenant only when the file is absent.
Playwright configuration and `openAuthenticatedTestPage` use normal browser TLS
verification without blanket certificate-error overrides.

## Platform Operation Coverage

- `specs/admin/platform-tenant-operations.spec.ts` follows the guarded tenant
  operation links, opens the refund-recovery surface, and resolves a
  deterministic scanner result from an attendee ticket URL. Its payment-setup
  recovery journey restores one original Stripe test-mode Checkout through
  platform finance, then verifies the same claim, held capacity, one approval
  notification and privacy-safe audit. The fixture registers cleanup before
  changing records and expires only its exact unpaid test session.
- `docs/admin/platform-tenant-operations.doc.ts` documents explicit target
  selection and executes representative event and template edits, existing-user
  role assignment and removal, an unverifiable-receipt rejection, and attendee
  plus guest check-in. Every page mutation supplies its own operational reason,
  reads domain state back from PostgreSQL, and is then found by reason, action,
  and target tenant in the visible platform audit log. The guide explicitly
  separates participant-owned flows and names the adjacent finance, lifecycle,
  tax-import, approval, and cancellation operations that it does not execute.
- The organization guide also documents payment restoration through the same
  real test-mode provider read and audited page action. PostgreSQL recovery
  coverage proves concurrent changes, tenant boundaries, discovery pagination,
  audit rollback, email preservation and canonical paid/expired reconciliation,
  including add-on stock and a fee mismatch after open-session recovery.
- Prefer the target-scoped registration-result route for repeatable platform
  scanner checks. The organizer guide already exercises deterministic mocked
  camera permission/readiness, while Browser review covers the fallback and a
  real result page. This evidence does not claim physical-device focus or QR
  recognition certification.

## Paid Registration Checkout Coverage

- Paid registration-completion fixtures create an idempotent Stripe test-mode
  PaymentIntent and wait for its connected-account balance transaction before
  sending the signed local Checkout webhook. That keeps the production
  charge, fee, currency, and ownership reconciliation active instead of
  accepting invented charge ids. It is test-mode workflow evidence, not
  certification of live bank or card-network settlement.

## Registration Transfer Coverage

- `specs/events/registration-transfer.spec.ts` exercises the free-registration
  private-offer/manual-code claim flow, paid private-offer/current-price and self-claim
  boundaries, deterministic paid Checkout completion through the shared server
  finalizer, and terminal source-refund failure plus operator requeue. Binding
  transfer coverage must also prove that the registration, guest quantity, all
  included/free/purchased add-on quantities, and fulfillment/check-in history
  move unchanged as one fixed bundle, priced at current base prices with only
  the recipient's current discounts, with one exact refund per original Stripe
  source. The recipient payment is recalculated independently from those source
  refunds, and source-user discounts do not transfer. Only a wholly free bundle
  with no refund may complete database-only. Attendee self-service always
  uses the private offer-and-claim path. There is no separate organizer or
  attendee reassignment action. The current owner creates the private offer,
  and the recipient claim collects and replaces the recipient-owned answers.
- `docs/events/registration-transfer.doc.ts` generates the participant-facing
  walkthrough for creating and claiming a private transfer offer by private code. Its paid
  journey captures the pending Checkout, confirmed/refund-processing,
  refund-needs-attention, and safely requeued states from persisted data and
  explains the fixed-bundle, current-recipient-pricing contract. It also follows
  the source participant's event-page summary through processing, failure,
  retry, and completion, showing the exact aggregate refund without restoring
  ticket ownership or management actions.

## Registration Cancellation Coverage

- `docs/events/registration-cancellation.doc.ts` keeps the ordinary free-ticket
  and organizer cancellation guidance together with a Stripe-backed add-on
  recovery journey. The Stripe journey starts from a free confirmed
  registration with one included and two settled optional units, records one
  included and one purchased redemption through the production service, then
  cancels through the participant UI and reads back exact source allocation,
  refund allocation, inventory, capacity, and cancellation-email state.
- The same journey sends signed local Stripe refund webhooks through the
  production `/webhooks/stripe` handler. It proves the failed, safely requeued
  generation-1, and succeeded states across the organizer scanner result,
  participant Profile, Global Admin **Refunds needing attention** UI, durable refund
  history, and append-only platform audit record. This is deterministic local
  workflow evidence, not certification of live bank or card-network settlement.
- Compose only passes through `E2E_RUNTIME_MODE`; ordinary `docker:start` and
  `docker:resume` do not force it. The disposable Docker Playwright server and
  E2E CI launch paths set `E2E_RUNTIME_MODE=playwright`. Server startup
  accepts that mode only together with `NODE_ENV=development`,
  `LOCAL_DATABASE=true`, and the pinned `E2E_NOW_ISO`, then pauses only the
  recurring registration-refund worker so audited recovery assertions and
  signed webhook transitions cannot race it. Immediate refund processing still
  runs through production code. Outside that validated local mode the worker is
  enabled by default; an attempted production override fails server startup.

## Receipt Submission Coverage

- `specs/finance/receipts-flows.spec.ts` and
  `docs/finance/receipt-submission.doc.ts` share the same normal-navigation and
  receipt-dialog helpers. The generated journey starts at **Events**, opens the
  seeded event and **Organize this event**, and then proves missing-file and
  invalid-breakdown recovery before a successful PDF upload.
- The documentation journey reads back both the tenant/event/user-bound upload
  and submitted receipt, checks the organizer card and **Profile → Receipts**,
  and proves that a same-tenant regular member still cannot enter the organizer
  route or read another user's profile receipt.
- Receipt submission itself queues no email. Approval or rejection is the
  later action that queues a `receiptReviewed` email; reimbursement remains a
  separate manual money-transfer workflow documented in
  `docs/finance/receipt-review-reimbursement.doc.ts`.
- Approval fixtures upload the real sample PDF to the worktree's host-mapped
  MinIO service before inserting the bound database rows. The functional flow
  also keeps one deliberately missing object to prove that approval fails
  closed while rejection remains available. These helpers require the
  generated `MINIO_HOST_PORT` and never use developer or remote `S3_ENDPOINT`
  values.
- The tenant-routing fixture grants Chromium local-network access only to the
  exact loopback application origin, allowing its PDF iframe to load the
  separate local MinIO origin. This accounts for Chromium treating Playwright's
  fulfilled application document as an unknown network address space. The
  permission ends with the test context; external origins receive no grant.
- The documentation readback accepts any configured HTTP(S) S3-compatible
  endpoint while requiring the exact tenant/event/user-bound bucket-key suffix.
  Receipt/upload database rows are deleted by the journey. The Docker MinIO
  service has no persistent Compose volume, so `bun run docker:stop` (and the
  destructive start commands) removes the container and its test objects. Tests
  do not run deletion calls against developer-configured remote object-storage
  endpoints.
  When repeatedly reusing one already-running stack, stop that stack after the
  run to discard its temporary objects.

## Test Titles and Optional Tags

Prefer clear behavior-oriented test titles because Playwright `--list`,
generated docs, and inventory reviews depend on readable names.

Do not add placeholder `@track(...)`, `@req(...)`, or `@doc(...)` title
metadata to real tests. Keep semantic tags such as `@finance`, `@admin`, or
`@permissions` when they affect filtering or inventory. Reporter unit fixtures
may still include legacy tag strings when they are exercising title
normalization. Dynamic titles are acceptable for compact matrix-style coverage
when the listed output remains readable.

## Commands

The commands below support focused diagnosis and iteration. Forwarded file,
filter, project, shard, `--changed`, or reporter arguments make a run partial;
that result never satisfies the mandatory local CI gate. Before any
CI-triggering action, use the canonical unfiltered command set in the root
`README.md` and require every collected test to pass.

```bash
bun run test:e2e
bun run test:e2e:ui
AUTH0_MANAGEMENT_CLIENT_ID=... AUTH0_MANAGEMENT_CLIENT_SECRET=... PUBLIC_GOOGLE_MAPS_API_KEY=... bun run test:e2e:integration
E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:live-esncard
E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:live-esncard:release
bun run test:e2e:docs
EVORTO_PAGES_ROOT=/absolute/path/to/evorto-pages AUTH0_MANAGEMENT_CLIENT_ID=... AUTH0_MANAGEMENT_CLIENT_SECRET=... PUBLIC_GOOGLE_MAPS_API_KEY=... E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:docs:publish
bun run test:e2e:install
bun run test:e2e -- --project=setup
bun run test:e2e -- --headed --workers 1
bun run lint
```

In a linked worktree, the integration, live ESNcard, release-certification, and
documentation-publication commands fill only missing Google Maps and ESNcard
test values from the primary checkout's `.env`. Values already set for the
current command win, and database, Auth0, Stripe, ports, and all other settings
remain worktree-local. Values absent from both locations remain missing; the
existing command and test requirements still apply. The wrapper does not skip
tests or invent substitute values.

## PostgreSQL Integration Suite

`bun run test:integration:postgres` owns every `*.postgres.spec.ts` test. It
validates its disposable target and verifies PostgreSQL major version 17
through the server's `postgres` maintenance database, then creates the reserved
integration database if missing. It resets only that database's `public` schema,
applies the current Drizzle schema, and runs the database tests serially. It is part of the mandatory local-first CI gate and must finish with
every collected test passing.

The runner refuses to start unless
`POSTGRES_INTEGRATION_DISPOSABLE=true` and an explicit
`POSTGRES_INTEGRATION_DATABASE_URL` are present. A loopback URL is accepted
only with explicit credentials and a port, for the exact database name
`evorto_postgres_integration`. Omitted TLS mode is normalized to
`sslmode=disable`; other modes are rejected. Integration child commands retain
unrelated environment values but remove inherited database CA/server-name and
PostgreSQL TLS settings. The runner's maintenance/reset pools use the same
explicit local TLS policy without changing the caller's environment. For example:

```bash
POSTGRES_INTEGRATION_DISPOSABLE=true \
POSTGRES_INTEGRATION_DATABASE_URL='postgresql://evorto:integration@localhost:5432/evorto_postgres_integration' \
bun run test:integration:postgres
```

Remote targets are rejected. `bun run test:integration:postgres:local` loads the
generated worktree-local loopback URL and runs the integration helper with
`--local`. This mode rejects an explicit URL override whose port differs from
the resolved `POSTGRES_HOST_PORT`, before opening any database pool. The direct
`test:integration:postgres` command accepts its separately validated explicit
loopback target for CI. Both require `POSTGRES_INTEGRATION_DISPOSABLE=true`.
Never point this command at a default,
production, shared, or otherwise persistent database. Connection URLs and
credentials must not be printed or committed.

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Check whether required local Docker secrets are available:
  `bun run docker:check`
- Show the generated worktree Compose project status: `bun run docker:ps`
- Start the local runtime stack: `bun run docker:start`
- Resume an existing local runtime stack without recreating containers:
  `bun run docker:resume`. Resume requires the existing `db`, `minio`,
  `mailpit`, `stripe`, `worker`, and `evorto` containers plus successfully
  completed `db-setup` and `minio-init` containers. It starts only retained
  long-running container IDs and never invokes dependency startup, schema
  reset/seeding, or bucket initialization.
- Start the local runtime stack in foreground for Playwright `webServer` without
  forcing `docker compose down`: `bun run docker:webserver`
- When an explicit caller sets `E2E_USE_DOCKER_STACK=false`, the
  canonical Playwright command uses `host-e2e-webserver.sh` instead of the full
  Compose stack. That wrapper starts only this worktree's MinIO service when it
  is absent, initializes the local bucket, gives the host Angular server the
  same local S3 endpoint and credentials used by receipt fixtures, and restores
  a MinIO container that it started from a stopped state. It never runs Compose
  teardown or recreates unrelated services. Stop any manually started app on
  `BASE_URL` before this mode; host-runtime reuse is deliberately disabled so a
  server with remote or mismatched object-storage configuration cannot be
  mistaken for a valid functional-test runtime.
- Start the local runtime stack in foreground from a reset state:
  `bun run docker:start:foreground`
- Start the local runtime stack in watch mode: `bun run docker:start:watch`
- Stop the local runtime stack: `bun run docker:stop`
- Local Docker runs use the pinned plain PostgreSQL 17 container.
- Mailpit captures local transactional email and the worker runs as a separate
  polling process from the same image as web.
- Docker Compose includes a one-shot `db-setup` service that runs the equivalent of `db:reset` before `evorto` starts. It first drops and recreates the Docker database `public` schema so Drizzle does not require interactive confirmation inside the container.
- Docker Compose forces app media/uploads to the in-network MinIO endpoint even
  when normal local dotenv values point to an external S3-compatible endpoint.
- Docker keeps `BASE_URL` browser-facing for Auth0 redirects and sets
  `SSR_RPC_ORIGIN=http://localhost:4200` so SSR RPC calls stay inside the app
  container instead of calling the host-mapped port. Generated and container
  runtime config explicitly sets `NODE_ENV=development`, allowing tenant
  outbound links to retain the worktree-local `BASE_URL` port.
- Scaleway web containers set `SSR_RPC_ORIGIN=http://127.0.0.1:4200` so their
  readiness SSR check reaches RPC inside the candidate revision before the
  public custom domain routes traffic to it.
- `SSR_RPC_ORIGIN` must return to the same HTTP runtime process that is rendering
  the page, including during Vite development. Internal SSR requests carry a
  process-local capability through a non-enumerable render-context property and
  the redacted Authorization header; public routing markers alone grant no trust.
  Do not point this origin at a load balancer or a different worker. Missing or
  mismatched capabilities cannot bypass the cookie-origin check or choose a
  tenant. Contextless prerender/development fallbacks have no capability, and
  an in-flight render during a server reload may need to be requested again.
- Auth0 callback URLs are registered out-of-band. Worktree-local generated
  ports keep stacks isolated, but authenticated Browser/Playwright validation
  needs a callback URL Auth0 accepts. On this machine, run Docker-backed
  authenticated checks with `APP_HOST_PORT=4200 bun run docker:start` unless the
  generated worktree port has also been added to the Auth0 application.
- Local `dev:start`, `test:e2e`, `test:e2e:ui`, `test:e2e:integration`, `test:e2e:docs`, `db:*`, and `docker:*` package scripts use `env:run` to resolve an invocation-private environment. Concurrent commands cannot overwrite each other's selected project or database through `.env.dev`. Use `bun run docker:ps` rather than bare `docker compose ps` so the worktree project is selected explicitly.
- `bun run docker:check` fails before Docker Compose mutates local containers
  when required local runtime variables are missing. The check covers Auth0,
  Stripe, the application session secret, and Font Awesome package registry
  access for the premium icon package. It also reports Bun, Docker
  Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright browser
  cache status. It lists optional live-provider variables, including
  `E2E_LIVE_ESN_CARD_IDENTIFIER` and
  `E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER`, without printing values and without
  making Docker startup depend on them. Missing Playwright browsers are warnings
  because they affect Playwright runs, not Docker startup.
- `bun run env:runtime` generates `.env.dev`, the untracked worktree-local override file.
- `.env.dev.local` is the tracked shared default dev config file.
- `.env` is the untracked developer-secrets file.
- `.env.example` is the tracked no-secret checklist for Docker-required
  developer secrets.
- `.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo.
- Starting the Docker stack with `docker:start`, `docker:start:foreground`, or
  `docker:start:watch` is destructive for local database state by design because
  those scripts run `docker compose down --timeout 60 --remove-orphans` and then
  `db-setup` clears the
  `public` schema, pushes schema, and resets/seeds the Docker database.
  PostgreSQL data, Mailpit messages, and the Stripe signing secret use
  project-scoped named volumes. The Playwright-owned disposable wrapper removes
  those volumes on exit; manual `docker:stop` preserves them for
  `docker:resume`.
  Playwright `webServer` uses
  `docker:webserver`, which still builds and starts the Compose stack in the
  foreground but does not force a Compose teardown first. Its wrapper traps
  exit and Playwright shutdown signals and runs the project-scoped
  `docker compose down --timeout 60 --remove-orphans --volumes`; Compose gets a
  60-second database shutdown grace period, while portable wall-clock watchdogs
  cap each Compose attempt at 90 seconds and each container, network, or volume
  verification command at 10 seconds. Playwright gives the wrapper five minutes
  for both attempts, watchdog termination grace, verification, removal, and a
  final buffer. Playwright and the
  E2E workflows probe `/readyz`, which anonymously renders `/events` on the
  incoming origin and returns `204` only for the expected event-list SSR
  document. Redirects, error/authentication documents, non-HTML responses, and
  missing SSR output return a non-ready status. Workflow probes require that
  exact `204` without following redirects, so a redirect's final `2xx` cannot
  report a false green. A static asset such as `/robots.txt` is not a valid
  application readiness check. A pre-existing stack selected through
  `reuseExistingServer` never starts the wrapper and remains running. Any
  existing PostgreSQL container is also protected: the disposable wrapper
  refuses to take ownership and directs the operator to `docker:resume` or an
  intentional `docker:start` reset.
  A final local gate must not trust an unknown reused server: stop it and let
  Playwright own a fresh stack, or explicitly start the exact checkout being
  pushed and verify that provenance. `/readyz` proves behavior, not commit or
  image identity.
  Saved authentication state is validated before the shared test context is
  created and before an explicitly authenticated helper creates another context.
  The saved-state contract requires complete serialized cookies and canonical
  HTTP(S) origins with valid local-storage records. Optional captured IndexedDB,
  OPFS, and credential records retain their supported structural shape. This is
  validation of saved output, not the looser URL-based `addCookies` input format.
  Missing or invalid selected files fail with a setup instruction; they do not
  silently become anonymous sessions or trigger automatic authentication. Normal
  setup always signs in and replaces the six state files. There is no file-age
  reuse or refresh policy. An intentional undefined state remains anonymous, and
  valid inline state is preserved. Validation errors never include cookie values
  or malformed JSON fragments.

- `bun run test:e2e:ui` first creates the six authenticated storage states in a
  trace-off setup run, then opens a baseline-only Playwright UI. The UI baseline
  projects retain their `database-setup` dependency for the newly started UI
  stack but omit the password-entering authentication setup and reuse the
  precreated storage states. Playwright UI always records a live trace, so
  provider and account-creation tests that enter protected values are
  intentionally excluded; run their canonical non-UI commands instead.
- `bun run test:e2e:integration` runs all integration-only Playwright
  projects. It is the Auth0 Management and required Google Maps portion of the
  provider gate and requires their approved local credentials.
- `bun run test:e2e:live-esncard` runs only the live esncard.org active-card
  add/refresh/remove and expired-card status paths. It selects both the
  `local-chrome-live-esncard` functional project and the `docs-live-esncard`
  publication project with normal authenticated setup; the current collection
  is nine tests across those projects, including shared setup. The command
  narrows execution to the functional and documentation ESNcard sources tagged
  `@needs-live-esncard`. It runs the fail-closed live-provider runtime preflight
  first; a missing `E2E_LIVE_ESN_CARD_IDENTIFIER` or
  `E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER` is an error, not a skipped test. This
  focused command does not run the provider-error unit check;
  use `bun run test:e2e:live-esncard:release` for the ESNcard provider portion.
  Complete local provider certification requires both
  `bun run test:e2e:integration` and
  `bun run test:e2e:live-esncard:release`, in that order, before any push, PR
  update, merge, or release that triggers the provider gate. Every collected
  test in both commands must pass with zero failures, skips, todos, fixmes,
  expected failures, retries/flakes, interruptions, or focused tests before CI
  is attempted.
- Local Docker scripts resolve an invocation-private environment with `env:run` before invoking Compose.
- Use `bun run ...` package scripts or `bun run env:run -- <command>` for direct external tools. Chaining `env:runtime` and `dotenv` would reintroduce shared-file races.
- Playwright list/discovery commands do not clean or write generated docs
  output and may run without local Auth0/Stripe secrets. In list-only mode the
  Playwright config uses inert placeholder values for runtime-only secrets and
  terminal-only reporters, so test titles can be enumerated without starting
  Docker, contacting external services, or writing local docs/HTML report
  artifacts. Run the docs projects without `--list` when you intentionally want
  to regenerate documentation artifacts.
- Normal local runs also omit Playwright's persistent HTML, JSON, and blob
  reporters. Playwright API step titles and its automatic ARIA failure snapshot
  can contain form values, including Auth0 passwords and protected provider
  identifiers, even when traces, screenshots, and video are disabled. Protected
  credential entry must use `fillProtectedValue`; its auto policy fails closed
  unless effective trace, screenshot, video, HAR, and context-video capture are
  all off and the protected-value sanitizer reporter is active. The helper
  accepts a protected environment-variable name instead of an arbitrary value;
  the create-account fixture uses a fresh run-generated Auth0 password that is
  registered before workers start. A value-free step and native form setter keep
  the value out of Playwright action titles. Downstream reporters run in quiet
  mode while the sanitizer emits redacted stdout/stderr, removes automatic
  `error-context.md` attachments, and redacts protected values from remaining
  text diagnostics. An attachment that cannot be inspected is removed and fails
  the run closed. Explicit safe attachments remain available. Never log or
  assert a raw protected value, and do not add a file-writing reporter to a
  secret-bearing run. Delete any older `playwright-report` directory before
  sharing artifacts.
- `bun run test:e2e:docs` writes generated docs to ignored local
  `test-results/docs` paths. Every other non-publishing Playwright package
  script forces the same ignored paths, so `DOCS_OUT_DIR` or
  `DOCS_IMG_OUT_DIR` values in local dotenv files cannot erase published docs
  during a functional, integration, live-provider, UI, or focused run.
- Use `bun run test:e2e:docs:publish` only when you intentionally want to update
  the generated guide catalog in the tracked Evorto Pages documentation app.
  Set `EVORTO_PAGES_ROOT` to an absolute path containing
  `apps/marketing/src/content/generated-docs`, `apps/marketing/public/docs`,
  and `tools/docs/sync-generated-docs.mjs`; the command does not assume a
  developer-specific checkout. Publishing requires
  the complete Auth0 Management, Google Maps, active ESNcard, and permanently
  expired ESNcard credential set. It generates `docs-baseline`,
  `docs-integration`, and `docs-live-esncard` together into ignored staging,
  maps every guide into the consumer's fixed 13-guide lifecycle catalog, and
  emits `docs-tests.bundle/v1alpha1` plus the hashed output manifest. Any new,
  renamed, missing, or unmapped guide fails publication before the consumer is
  changed. The Evorto Pages sync tool validates that exact artifact and performs
  its own rollback-backed replacement of only the generated guide and asset
  trees, preserving curated routes and assets. A failed or incomplete run
  leaves the previous consumer content unchanged.

## Playwright Browsers

Install the browser binaries after dependency installation and whenever the Playwright package version changes:

```bash
bun run test:e2e:install
```

CI runs `bunx playwright install --with-deps`, but local macOS/Linux development only needs the package script unless the host is missing OS-level browser dependencies.

Local runs use Playwright's bundled Chromium by default. For exploratory runs
on a machine that already has Google Chrome installed, set
`E2E_BROWSER_CHANNEL=chrome` to use the system Chrome channel without
installing the bundled browser cache.

## Runtime Environment Precedence

Application runtime config resolves in this precedence order:

- real environment variables
- `.env.dev.local`
- `.env.dev`
- `.env`
- in-code defaults

External-tool package scripts use `env:run` with dotenv parsing and expansion:

- real environment variables
- `.env.dev.local`
- invocation-generated runtime defaults
- `.env`

The shared `.env.dev` snapshot and unsupported `.env.local` are not read. Invocation environments stay in
memory; the resolver replaces itself with the command, preserving native
signals and exit status. The standalone `.env.dev` writer uses an atomic rename
and mode `0600`. Nested Playwright commands inherit the resolved environment; explicit remote database URLs remain visible to the
local database guard and are rejected, never replaced with a local URL.

CI should not rely on dotenv files at all; workflows provide values via exported environment variables.

## Deterministic E2E Environment

Playwright defaults deterministic test values in code via
`src/shared/testing/deterministic-test-defaults.ts`, so local runs do not need
extra flags.

Default values:

- `E2E_NOW_ISO=2026-09-15T12:00:00.000Z`
- `E2E_SEED_KEY=evorto-e2e-default-v1`

Optional overrides:

- `E2E_NOW_ISO`
- `E2E_SEED_KEY`

Keep `E2E_NOW_ISO` ahead of the real current date or deterministic checkout expiry behavior will break.
The generated `.env.dev` passes the same clock and seed key to Docker database
setup and the app container; do not seed against one clock while evaluating
registration or check-in windows against another.

Primary pages and additional authenticated contexts start at the same seeded
browser time and advance with elapsed `performance.now()` time. Do not freeze
`Date.now()` in an additional context: framework scheduling still needs an
advancing clock, even when the test uses deterministic business dates.

## Baseline vs Integration Projects

Playwright separates external-service coverage with dedicated projects:

- baseline:
  - `local-chrome-baseline`
  - `docs-baseline`
- integration-only:
  - `local-chrome-integration`
  - `docs-integration`
- live-provider certification:
  - `local-chrome-live-esncard`

CI infers whether Google Maps credentials are required from the selected
Playwright projects. Authenticated setup always requires the Auth0 Management
test client so it can verify the dedicated administrator identity already has
the real production claim before login. It never changes shared metadata. If you
select `local-chrome-integration` or `docs-integration`, CI/runtime validation
also demands the Google Maps credential. UI mode is intentionally baseline-only:
it omits protected-input provider and account-creation tests, but its initial
authenticated setup still verifies the dedicated administrator identity.
CI baseline jobs set `E2E_SELECTED_PROJECTS` so Playwright worker processes
that no longer expose the original CLI `--project` flags still use the
baseline credential contract.

Integration-only coverage is tagged at the test-title level:

- `@needs-auth0-management`
- `@needs-google-maps`

The dedicated live-provider project selects `@needs-live-esncard` without
requiring unrelated integration credentials.

## Required E2E Variables

Required for full Playwright flows:

- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- `DATABASE_URL`
- `BASE_URL`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `E2E_DEFAULT_USER_PASSWORD`
- `E2E_ADMIN_USER_PASSWORD`
- `E2E_GLOBAL_ADMIN_USER_PASSWORD`
- `E2E_REGULAR_USER_PASSWORD`
- `E2E_ORGANIZER_USER_PASSWORD`
- `E2E_EMPTY_USER_PASSWORD`
- `ISSUER_BASE_URL`
- `SECRET`
- `STRIPE_API_KEY`
- `STRIPE_TEST_ACCOUNT_ID`
- `STRIPE_WEBHOOK_SECRET` for CI webhook replay coverage, or the
  Docker-provided `STRIPE_WEBHOOK_SECRET_FILE` path for app webhook verification

The Auth0 test tenant's post-login action must copy `event.user.app_metadata`
into the `evorto.app/app_metadata` ID-token claim. The dedicated administrator
account must already have an owner-approved `platformAdministrator: true`
app-metadata field. Setup checks that field, signs in, and proves the resulting
session can open an administrator page. Missing or non-boolean claims fail
closed; tests never grant, revoke, or restore administrator access. This keeps
overlapping CI workflows and local processes independent. Before provisioning
the claim, drain older test runs that still mutate and restore this account's
metadata. There is no local identity allowlist.

The Docker stack can use `STRIPE_WEBHOOK_SECRET_FILE` for the app container
instead of a static `STRIPE_WEBHOOK_SECRET`; the Compose-managed Stripe CLI
listener writes the generated signing secret there. The replay specs that
generate signed webhook payloads directly still need `STRIPE_WEBHOOK_SECRET`
when those specs are run outside the Docker listener path. Local non-CI
Playwright runs may omit the static secret only when the replay spec is not
selected; selecting it without the secret fails its explicit `beforeAll`
precondition.

Registration payment docs and functional tests that deliver an exact signed
completion event prefer the running Compose app container's file-backed secret,
resolved through its project/service labels without logging it. They wait for
that nonempty file and fail closed instead of signing with a stale static value;
`STRIPE_WEBHOOK_SECRET` is used only when no Compose app container is running.

The six stable Auth0 Playwright accounts use dedicated password variables.
Their prior tracked passwords are compromised by repository history and must
not be reused. Rotate all six accounts out of band, then configure the new
values in the ignored local `.env` for local certification. Runtime preflight
and the authentication setup fail closed when any value is absent. Never print
the values, put them in command examples, or copy them back into tracked
fixtures.

Keep these long-lived passwords exclusively in the protected
`esncard-release-certification` GitHub environment; do not keep repository-level
copies. The E2E Baseline has no pull-request trigger, validates that it is
running from protected `main` before its secret-bearing job can start, and then
targets that environment. The Production Provider Certification workflow uses
the same boundary. The environment must exist with required reviewers and a
protected deployment-branch policy before either workflow is enabled. If that
trusted boundary cannot be provisioned, CI must instead create disposable
Auth0 accounts whose credentials and sessions are revoked after each run.
The authentication setup disables traces, screenshots, and video. The default
local reporter set also omits persistent HTML, JSON, and blob output because
Playwright can include password form-fill values in API step titles. Together,
these controls keep password values out of repository-owned Playwright
artifacts while preserving terminal results and the mandatory completeness
reporter. Credential-backed baseline CI additionally forces tracing off, never
uploads `playwright-report`, and explicitly excludes `trace.zip` from both
artifact uploads.

The ordinary `test:e2e`, `test:e2e:ui`, `test:e2e:integration`, and
`test:e2e:docs` scripts run `test:e2e:check` first. That Playwright preflight
requires all six passwords and the Auth0 Management test client before
Docker-backed test startup. `docker:check` does not require them, so starting
the development stack remains independent of test-account custody. The
management client needs `read:users` for the administrator identity check.
Account-creation integration
tests additionally need permission to create and delete their temporary users.

Required in CI baseline docs/functional jobs:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Required only for integration-tagged Playwright projects:

- `PUBLIC_GOOGLE_MAPS_API_KEY`

Required for every live-provider run (but not for local Docker startup):

- `E2E_LIVE_ESN_CARD_IDENTIFIER` for active-card add/refresh/remove and
  `E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER` for the permanently expired-card state
  against esncard.org. Supply both only from a local secret source; do not check
  either into the repository. Run the path with
  `E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:live-esncard`.
  Its credential preflight fails closed before Playwright starts when either
  identifier is absent. The dedicated `local-chrome-live-esncard` project does
  not require Google Maps credentials; its shared authenticated setup still
  verifies the dedicated Auth0 administrator identity.

### Production provider certification credential ownership and rotation

The **Production Provider Certification** workflow is both manually
dispatchable and called as a required job by the repository Release workflow.
Its job targets the protected `esncard-release-certification` GitHub
environment. The first step validates the required secret and variable names
before checkout or tool setup, including Auth0 Management, Google Maps, all six
Auth0 Playwright account passwords,
`E2E_LIVE_ESN_CARD_IDENTIFIER`, and
`E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER`. The Release caller maps only the
declared required secrets; the called job keeps the protected environment
boundary, whose secrets take precedence.

The GitHub environment and its protection rules must be created out of band;
referencing its name in workflow source is not proof that the environment is
protected. The Google Maps key must allow the certification localhost origin,
have billing enabled, and enable Maps JavaScript API plus Places API (New).
Runtime object-storage config has no fallback to a test bucket. Store the
test-mode Stripe key as
`STRIPE_TEST_API_KEY` in the repository E2E secret set and in the certification
environment. Baseline and certification test steps map it to the runtime
`STRIPE_API_KEY` variable expected by the application; they never receive a
production Stripe key.

The designated release-operations maintainer owns both environment secrets and
must keep a backup maintainer able to rotate them. Both values must be
ESNcard-program-approved non-production identities, never a member's personal
card. Review both provider outcomes before each release. Rotate the active
identity immediately if it expires, and rotate either identity if it is revoked,
changes custodian, may have been disclosed, or no longer produces its expected
active or permanently expired outcome. Rotation is performed out of band in the
GitHub environment: replace the affected secret, dispatch
`Production Provider Certification`, verify the run, then retire the replaced
provider identity. Neither workflow output nor test artifacts should contain
either value.

The current esncard.org validation endpoint requires no API key, OAuth client,
or other ESNcard provider credential. Normal CI infrastructure still needs the
application's Auth0, PostgreSQL, Stripe, Font Awesome, and local-stack
configuration;
those are not ESNcard provider credentials. Repository code can enforce the
gate but cannot configure the GitHub environment protection rules or provision
either approved identity.

## Local Stack Isolation

Runtime defaults are generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local app port and `BASE_URL`
- distinct local PostgreSQL port
- distinct local Mailpit port
- distinct local MinIO ports

Set `APP_HOST_PORT` on the package invocation when you need a specific callback
URL such as `localhost:4200`. Set `MAILPIT_HOST_PORT` on that command for a
specific local email-inspection port.
