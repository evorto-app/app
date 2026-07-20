# Playwright Tests

This directory contains the active Playwright suite.

## Structure

- Functional/e2e tests: `tests/specs/**`
- Documentation tests: `tests/docs/**`
- Setup/auth/database bootstrapping lives in `tests/setup/**`
- Shared fixtures/utilities/reporters live in `tests/support/fixtures/**`, `tests/support/utils/**`, `tests/support/reporters/**`

## Generated Documentation Authoring Contract

Each product-facing documentation journey should be understandable without
prior Evorto knowledge. Include:

1. the intended user and exact account, tenant, permission, and external-service prerequisites;
2. a click-by-click path starting from normal application navigation;
3. an explanation of choices before the user commits a write or payment;
4. the visible completion state plus a persisted, payment, or notification readback where applicable;
5. critical denial, recovery, retry, timing, and tenant-boundary behavior;
6. explicit unsupported or deferred behavior so the guide does not promise an unavailable feature;
7. accessible screenshots where they clarify a real decision or result, backed by behavior assertions rather than screenshots alone.

When a complete workflow cannot yet be documented because the product behavior
does not exist, keep that absence in `APPLICATION_COMPLIANCE_AUDIT.md`; do not
replace it with aspirational documentation.

## Fixture Contract

- `tests/support/fixtures/parallel-test.ts` seeds a fresh tenant per test with `profile: 'test'`
- `tests/setup/database.setup.ts` seeds the shared docs tenant with `profile: 'docs'`
- Specs should consume deterministic scenario handles from `seeded.scenario`
- Do not discover test entities by template title fragments, fuzzy event searches, or wall-clock checks

## Platform Operation Coverage

- `specs/admin/platform-tenant-operations.spec.ts` follows the guarded tenant
  operation links, opens the refund-recovery surface, and resolves a
  deterministic scanner result from an attendee ticket URL.
- `docs/admin/platform-tenant-operations.doc.ts` documents explicit target
  selection and executes representative event and template edits, existing-user
  role assignment and removal, an unverifiable-receipt rejection, and attendee
  plus guest check-in. Every page mutation supplies its own operational reason,
  reads domain state back from PostgreSQL, and is then found by reason, action,
  and target tenant in the visible platform audit log. The guide explicitly
  separates participant-owned flows and names the adjacent finance, lifecycle,
  tax-import, approval, and cancellation operations that it does not execute.
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
  with no refund may complete database-only. Immediate direct reassignment is
  also limited to options without participant questions; otherwise the private
  recipient claim must collect and replace the recipient-owned answers.
- `docs/events/registration-transfer.doc.ts` generates the participant-facing
  walkthrough for creating and claiming a private transfer offer by link or manual code. Its paid
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
  participant Profile, Global Admin **Refund recovery** UI, durable refund
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

## PostgreSQL Integration Suite

`bun run test:integration:postgres` owns every `*.postgres.spec.ts` test. It
resets the target database's `public` schema, applies the current Drizzle
schema, verifies PostgreSQL major version 17, and runs the database tests
serially. It is part of the mandatory local-first CI gate and must finish with
every collected test passing.

The runner refuses to start unless
`POSTGRES_INTEGRATION_DISPOSABLE=true` and an explicit
`POSTGRES_INTEGRATION_DATABASE_URL` are present. A loopback URL is accepted
only for the exact database name `evorto_postgres_integration`. For example:

```bash
POSTGRES_INTEGRATION_DISPOSABLE=true \
POSTGRES_INTEGRATION_DATABASE_URL='postgresql://evorto:integration@localhost:5432/evorto_postgres_integration' \
bun run test:integration:postgres
```

Remote targets are rejected. `bun run test:integration:postgres:local` loads the
generated worktree-local loopback URL and still requires
`POSTGRES_INTEGRATION_DISPOSABLE=true`. Never point this command at a default,
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
- Auth0 callback URLs are registered out-of-band. Worktree-local generated
  ports keep stacks isolated, but authenticated Browser/Playwright validation
  needs a callback URL Auth0 accepts. On this machine, run Docker-backed
  authenticated checks with `APP_HOST_PORT=4200 bun run docker:start` unless the
  generated worktree port has also been added to the Auth0 application.
- Local `dev:start`, `test:e2e`, `test:e2e:ui`, `test:e2e:integration`, `test:e2e:docs`, `db:*`, and `docker:*` package scripts refresh `.env.dev` before invoking `dotenv -c dev`, so new worktrees get isolated local app/service ports and database URLs by default. Use `bun run docker:ps` rather than bare `docker compose ps` when checking a worktree stack because the generated `COMPOSE_PROJECT_NAME` must be loaded from `.env.dev`.
- `bun run docker:check` fails before Docker Compose mutates local containers
  when required local runtime variables are missing. The check covers Auth0,
  Stripe, the application session secret, and Font Awesome package
  registry access for the premium and brand icon packages. It also reports Bun, Docker
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
- Local Docker scripts preload the environment with `dotenv -c dev` before invoking Compose.
- Use `bun run ...` package scripts, not a bare shell `dotenv` command. Local shells may resolve a different `dotenv` executable than `node_modules/.bin/dotenv`; when a direct external-tool command is unavoidable, spell it as `node_modules/.bin/dotenv -c dev -- ...`.
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
  `apps/documentation-page` and `tools/docs/sync-generated-docs.mjs`; the
  command does not assume a developer-specific checkout. Publishing requires
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

External-tool package scripts use `dotenv -c dev`. Because `dotenv-cli` is first-wins, the effective dotenv precedence for those scripts is:

- `.env.dev.local`
- `.env.local` if someone creates it manually; this file is unsupported and should not exist
- `.env.dev`
- `.env`

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

CI infers whether integration-only credentials are required from the selected Playwright projects.
If you select `local-chrome-integration` or `docs-integration`, CI/runtime validation demands the extra external-service credentials.
UI mode is intentionally baseline-only: it omits protected-input provider and
account-creation tests and does not require their integration credentials at
startup.
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
requires all six passwords before Docker-backed test startup. `docker:check`
does not require them, so starting the development stack remains independent of
test-account custody.

Required in CI baseline docs/functional jobs:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Required only for integration-tagged Playwright projects:

- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- `PUBLIC_GOOGLE_MAPS_API_KEY`

Required for every live-provider run (but not for local Docker startup):

- `E2E_LIVE_ESN_CARD_IDENTIFIER` for active-card add/refresh/remove and
  `E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER` for the permanently expired-card state
  against esncard.org. Supply both only from a local secret source; do not check
  either into the repository. Run the path with
  `E2E_LIVE_ESN_CARD_IDENTIFIER=... E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=... bun run test:e2e:live-esncard`.
  Its credential preflight fails closed before Playwright starts when either
  identifier is absent. The dedicated `local-chrome-live-esncard` project does
  not require unrelated Auth0 Management or Google Maps provider credentials.

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

`.env.dev` is generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local app port and `BASE_URL`
- distinct local PostgreSQL port
- distinct local MinIO ports

Set `APP_HOST_PORT` before running `bun run env:runtime` only when you need a specific callback URL such as `localhost:4200`.
