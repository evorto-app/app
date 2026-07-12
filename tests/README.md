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
  selection, owner attribution, operation reasons, atomic audit records, and
  participant-only boundaries. It also explains when refund recovery starts a
  new idempotency generation versus resuming the existing durable claim, and
  keeps deferred random allocation read-compatible but non-writable.
- Prefer the target-scoped registration-result route for repeatable platform
  scanner checks. Keep real camera behavior in the organizer scanner's manual
  review unless Playwright camera emulation is straightforward and reliable.

## Registration Transfer Coverage

- `specs/events/registration-transfer.spec.ts` exercises the free-registration
  private-link claim flow, paid private-offer/current-price and self-claim
  boundaries, deterministic paid Checkout completion through the shared server
  finalizer, terminal source-refund failure plus operator requeue, and paid
  non-Stripe cancellation with a durable manual refund.
- `docs/events/registration-transfer.doc.ts` generates the participant-facing
  walkthrough for creating and claiming a private transfer link. Its paid
  journey captures the pending Checkout, confirmed/refund-processing,
  refund-needs-attention, and safely requeued states from persisted data.

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
  do not run deletion calls against developer-configured or remote R2 endpoints.
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
AUTH0_MANAGEMENT_CLIENT_ID=... AUTH0_MANAGEMENT_CLIENT_SECRET=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_IMAGES_API_TOKEN=... CLOUDFLARE_IMAGES_DELIVERY_HASH=... bun run test:e2e:integration
E2E_LIVE_ESN_CARD_IDENTIFIER=... bun run test:e2e:live-esncard
E2E_LIVE_ESN_CARD_IDENTIFIER=... bun run test:e2e:live-esncard:release
bun run test:e2e:docs
bun run test:e2e:docs:publish
bun run test:e2e:install
bun run test:e2e -- --project=setup
bun run test:e2e -- --headed --workers 1
bun run test:e2e:report
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

A remote target must be an isolated Neon `appdb` branch whose name starts with
`codex-postgres-integration-`. The runner uses `NEON_API_KEY`,
`NEON_PROJECT_ID`, and `POSTGRES_INTEGRATION_NEON_BRANCH_ID` to prove that the
branch is non-default, unprotected, unexpired, expires within 25 hours, and
owns the supplied active read/write endpoint before any schema reset. Use
`bun run test:integration:postgres:local` when those values are supplied by the
supported dev dotenv files plus exported target variables.

The runner does not create or delete remote branches. Create a schema-only,
short-lived branch before the run, and explicitly delete and verify removal of
that same branch afterward; expiration is crash recovery, not the primary
cleanup path. Never point this command at the default, production, shared, or
otherwise persistent database. Connection URLs and credentials must not be
printed or committed.

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Check whether required local Docker secrets are available:
  `bun run docker:check`
- Show the generated worktree Compose project status: `bun run docker:ps`
- Start the local runtime stack: `bun run docker:start`
- Resume an existing local runtime stack without recreating containers:
  `bun run docker:resume`. This is only valid with an explicit existing
  `BRANCH_ID` or `DELETE_BRANCH=false` on the existing database container; the
  command fails for the default ephemeral branch because it is deleted when the
  database container stops. Changing dotenv after the container stops does not
  make it resumable because retained containers keep their original
  environment. Resume requires the existing `db`, `minio`, `stripe`, and
  `evorto` containers plus successfully completed `db-expiration`, `db-setup`,
  and `minio-init` containers. It starts only those retained long-running
  container IDs and never invokes dependency startup, schema reset/seeding,
  bucket initialization, or branch-expiration setup.
- Start the local runtime stack in foreground for Playwright `webServer` without
  forcing `docker compose down`: `bun run docker:webserver`
- Start the local runtime stack in foreground from a reset state:
  `bun run docker:start:foreground`
- Start the local runtime stack in watch mode: `bun run docker:start:watch`
- Stop the local runtime stack: `bun run docker:stop`
- Local Docker runs use Neon Local instead of a plain Postgres container.
- Docker Compose includes a one-shot `db-setup` service that runs the equivalent of `db:reset` before `evorto` starts. It first drops and recreates the Docker database `public` schema so Drizzle does not require interactive confirmation inside the container.
- Docker Compose forces app media/uploads to the in-network MinIO endpoint even
  when normal local dotenv values point to an external S3-compatible endpoint.
- Docker keeps `BASE_URL` browser-facing for Auth0 redirects and sets
  `SSR_RPC_ORIGIN=http://localhost:4200` so SSR RPC calls stay inside the app
  container instead of calling the host-mapped port. Generated and container
  runtime config explicitly sets `NODE_ENV=development`, allowing tenant
  outbound links to retain the worktree-local `BASE_URL` port.
- Auth0 callback URLs are registered out-of-band. Worktree-local generated
  ports keep stacks isolated, but authenticated Browser/Playwright validation
  needs a callback URL Auth0 accepts. On this machine, run Docker-backed
  authenticated checks with `APP_HOST_PORT=4200 bun run docker:start` unless the
  generated worktree port has also been added to the Auth0 application.
- Local `dev:start`, `test:e2e`, `test:e2e:ui`, `test:e2e:integration`, `test:e2e:docs`, `db:*`, and `docker:*` package scripts refresh `.env.dev` before invoking `dotenv -c dev`, so new worktrees get isolated local app/service ports and database URLs by default. Use `bun run docker:ps` rather than bare `docker compose ps` when checking a worktree stack because the generated `COMPOSE_PROJECT_NAME` must be loaded from `.env.dev`.
- `bun run docker:check` fails before Docker Compose mutates local containers
  when required local runtime variables are missing. The check covers Neon
  Local, Auth0, Stripe, the application session secret, and Font Awesome package
  registry access for the premium and brand icon packages. It also reports Bun, Docker
  Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright browser
  cache status. It lists optional live-provider variables, such as
  `E2E_LIVE_ESN_CARD_IDENTIFIER`, without printing values and without making
  Docker startup depend on them. Missing Playwright browsers are warnings
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
  Neon Local and the branch-expiration helper share a project-scoped named
  metadata volume by default so Docker Desktop does not need a macOS host bind
  mount during shutdown cleanup. The database container assigns that mount to
  Neon's `postgres` user before startup so branch state remains writable for
  expiration and shutdown cleanup. `NEON_LOCAL_METADATA_DIR` remains available
  for controlled environments such as CI that intentionally provide a host
  metadata directory.
  Playwright `webServer` uses
  `docker:webserver`, which still builds and starts the Compose stack in the
  foreground but does not force a Compose teardown first. Its wrapper traps
  exit and Playwright shutdown signals and runs the project-scoped
  `docker compose down --timeout 60 --remove-orphans`; Compose gets a 60-second
  database shutdown grace period, while Playwright gives the wrapper 90 seconds
  to finish object removal. Named volumes are not removed. Playwright and the
  E2E workflows probe `/readyz`, which anonymously renders `/events` on the
  incoming origin and returns `204` only for the expected event-list SSR
  document. Redirects, error/authentication documents, non-HTML responses, and
  missing SSR output return a non-ready status. Workflow probes require that
  exact `204` without following redirects, so a redirect's final `2xx` cannot
  report a false green. A static asset such as `/robots.txt` is not a valid
  application readiness check. A pre-existing stack selected through
  `reuseExistingServer` never starts the wrapper and remains running. The
  branch-expiration sidecar is fail-closed, so inability to set the fallback
  expiration prevents database setup instead of silently continuing.
  A final local gate must not trust an unknown reused server: stop it and let
  Playwright own a fresh stack, or explicitly start the exact checkout being
  pushed and verify that provenance. `/readyz` proves behavior, not commit or
  image identity.
- `bun run test:e2e:ui` opens unrestricted Playwright UI mode so you can choose projects and tests interactively.
- `bun run test:e2e:integration` runs all integration-only Playwright
  projects. It is intended for credential-gated specs and docs such as Auth0
  Management account creation.
- `bun run test:e2e:live-esncard` runs only the live esncard.org
  add/refresh/remove profile path. It uses the dedicated
  `local-chrome-live-esncard` project with normal authenticated setup and
  narrows execution to
  `tests/specs/profile/user-profile-live-esncard.spec.ts` and
  `@needs-live-esncard`. The command runs the fail-closed live-provider runtime
  preflight first; a missing `E2E_LIVE_ESN_CARD_IDENTIFIER` is an error, not a
  skipped test. This focused command does not run the provider-error unit check;
  use `bun run test:e2e:live-esncard:release` for the complete local release
  certification required before merging, pushing, or releasing to `main`.
- Local Docker scripts preload the environment with `dotenv -c dev` before invoking Compose.
- Use `bun run ...` package scripts, not a bare shell `dotenv` command. Local shells may resolve a different `dotenv` executable than `node_modules/.bin/dotenv`; when a direct external-tool command is unavoidable, spell it as `node_modules/.bin/dotenv -c dev -- ...`.
- Playwright list/discovery commands do not clean or write generated docs
  output and may run without local Auth0/Stripe secrets. In list-only mode the
  Playwright config uses inert placeholder values for runtime-only secrets and
  terminal-only reporters, so test titles can be enumerated without starting
  Docker, contacting external services, or writing local docs/HTML report
  artifacts. Run the docs projects without `--list` when you intentionally want
  to regenerate documentation artifacts.
- `bun run test:e2e:docs` writes generated docs to ignored local
  `test-results/docs` paths by default. Use
  `bun run test:e2e:docs:publish` only when you intentionally want to update
  `/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs` and
  `/Users/hedde/code/evorto-pages/apps/documentation/public/docs`.

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
UI mode is intentionally unrestricted and does not force integration-only credentials at startup.
CI baseline jobs set `E2E_SELECTED_PROJECTS` so Playwright worker processes
that no longer expose the original CLI `--project` flags still use the
baseline credential contract.

Integration-only coverage is tagged at the test-title level:

- `@needs-auth0-management`
- `@needs-cloudflare`
- `@needs-google-maps`

The dedicated live-provider project selects `@needs-live-esncard` without
requiring unrelated integration credentials.

## Required E2E Variables

Required for full Playwright flows:

- `DATABASE_URL`
- `BASE_URL`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `ISSUER_BASE_URL`
- `NEON_API_KEY` for Docker-backed Neon Local runs
- `NEON_PROJECT_ID` for Docker-backed Neon Local runs
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
resolved through its project/service labels without logging it, and fall back
to `STRIPE_WEBHOOK_SECRET` when no Docker runtime is available.

Required in CI baseline docs/functional jobs:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Required only for integration-tagged Playwright projects:

- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_IMAGES_DELIVERY_HASH`
- `CLOUDFLARE_IMAGES_API_TOKEN`

Required for every live-provider run (but not for local Docker startup):

- `E2E_LIVE_ESN_CARD_IDENTIFIER` for the profile ESNcard add/refresh/remove
  journey against esncard.org. Use a real valid card identifier only from a
  local secret source; do not check it into the repo. Run it with
  `E2E_LIVE_ESN_CARD_IDENTIFIER=... bun run test:e2e:live-esncard` when you
  exercise that live-provider path locally. Its credential preflight fails
  closed before Playwright starts when the identifier is absent. The dedicated
  `local-chrome-live-esncard` project does not require unrelated Auth0
  Management or Cloudflare provider credentials.

### ESNcard release credential ownership and rotation

The `ESNcard Release Certification` workflow is both manually dispatchable and
called as a required job by the repository Release and Fly Deploy workflows.
Its job targets the protected `esncard-release-certification` GitHub environment
and fails before setup when that environment cannot provide the
`E2E_LIVE_ESN_CARD_IDENTIFIER` secret. Every `main` push must complete the
reusable certification workflow before the actual Fly deployment job can apply
the database schema or deploy the application. The deploy workflow inherits
secrets into the reusable workflow instead of duplicating credential handling.

The designated release-operations maintainer owns this environment secret and
must keep a backup maintainer able to rotate it. The value must be an
ESNcard-program-approved non-production identity, never a member's personal
card. Review its validity before each release and rotate it immediately when it
expires, is revoked, changes custodian, or may have been disclosed. Rotation is
performed out of band in the GitHub environment: replace the secret, dispatch
`ESNcard Release Certification`, verify the run, then retire the old provider
identity. Neither workflow output nor test artifacts should contain the value.

The current esncard.org validation endpoint requires no API key, OAuth client,
or other ESNcard provider credential. Normal CI infrastructure still needs the
application's Auth0, Neon, Stripe, Font Awesome, and local-stack configuration;
those are not ESNcard provider credentials. Repository code can enforce the
gate but cannot provision the approved non-production identity or configure the
GitHub environment protection rules.

## Local Stack Isolation

`.env.dev` is generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local app port and `BASE_URL`
- distinct local Neon Local port
- distinct local MinIO ports

Set `APP_HOST_PORT` before running `bun run env:runtime` only when you need a specific callback URL such as `localhost:4200`.
