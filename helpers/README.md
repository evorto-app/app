# Database Seeding

This directory contains scripts for setting up and seeding the database with
development, documentation, and Playwright test data.

## Overview

The database seeding process serves two distinct goals:

- `demo` profile: plausible demo/development data for local usage
- `test` profile: deterministic fixtures for isolated Playwright tenants
- `docs` profile: deterministic shared dataset for documentation journeys

## Key Files

- `database.ts`: Main entry point for database setup and seeding
- `seed-tenant.ts`: Shared tenant seeding logic used by tests, development, and demos
- `add-events.ts`: Creates events with deterministic dates, statuses, and visibilities
- `add-roles.ts`: Sets up user roles and permissions
- `add-templates.ts`: Creates event templates
- `add-template-categories.ts`: Sets up template categories
- `user-data.ts`: Defines test users
- `seed-clock.ts`: Resolves deterministic seeded time
- `seed-falso.ts`: Resolves deterministic pseudo-random seed key

## Seeding Approach

The seeding approach is deterministic, but not every profile has the same goal:

1. **Profiles**
   - `demo` keeps the richer, more realistic local dataset.
   - `test` and `docs` expose stable scenario handles instead of relying on fuzzy discovery.

2. **Scenario Contract**
   - `seedTenant()` returns `result.scenario.events.*` handles.
   - Current scenario handles:
     - `freeOpen`
     - `paidOpen`
     - `closedReg`
     - `past`
     - `draft`
   - Playwright tests should use those handles directly.
   - Scanner specs and generated check-in docs use `past` with an explicit
     confirmed participant registration so camera entry, partial guest arrival,
     duplicate scans, and organizer totals are deterministic.

3. **Pinned Clock + Seed Key**
   - `seed-clock.ts` honors `E2E_NOW_ISO` when provided.
   - `seed-falso.ts` honors `E2E_SEED_KEY` when provided.
   - Playwright defaults both values in code, so normal test runs do not need extra env wiring.

4. **Deterministic Events**
   - Fixed number of events per template type
   - `demo` keeps the richer local dataset to roughly 50 events and spreads approved, draft, and pending-review states across a more gradual timeline
   - `test` and `docs` keep the smaller stable schedule that backs scenario handles
   - Deterministic assignment of status, visibility, and creator
   - Template selection is based on stable `seedKey` metadata, not title matching

5. **Realistic Data Structure**
   - Events have appropriate registration options
   - Users have appropriate roles and permissions
   - Templates and categories are properly linked

## Running the Seeding Process

To reset and seed the development/demo database:

```bash
bun run db:reset
```

This will:

1. Resolve an invocation-private environment through `env:run`, so concurrent Docker, database, Mailpit, and Playwright commands keep their own ports and project names
2. Ensure schema exists and reset/seed the local database (`bun run db:reset`)

`bun run db:reset` uses the same invocation-private environment as `db:push` and validates seed configuration before resetting the schema. In this repo, the supported local files are `.env` for developer secrets, `.env.dev.local` for tracked shared defaults, and `.env.dev` for generated worktree overrides. `bun run db:push`, Docker's `db-setup` service, and `bun run db:studio` all consume the same local environment contract. The local Drizzle config refuses to connect unless `LOCAL_DATABASE=true`, the PostgreSQL URL has explicit credentials and a database name matching the required `POSTGRES_DB` exactly, and its host is loopback or the Compose `db` service. An exported remote or mismatched `DATABASE_URL` therefore fails before schema inspection or mutation.

Docker Compose runs a pinned PostgreSQL 17 container plus one-shot `db-setup`
before `evorto` and the polling worker start. `bun run docker:start`,
`bun run docker:start:foreground`, and `bun run docker:start:watch` run
`docker compose down --timeout 60 --remove-orphans` first, then run the
equivalent of `bun run db:reset` against the Docker database during stack
startup. The one-shot setup ensures the fixed disposable integration database
exists directly through PostgreSQL, then drops and recreates the application's
`public` schema, applies Drizzle, and seeds the local dataset without an
interactive confirmation. PostgreSQL data, Mailpit messages, and the Stripe
signing secret use project-scoped named volumes; MinIO data is container-local
for the disposable test stack. PostgreSQL startup has no host-file mount.

MinIO server and client images come from the upstream `quay.io/minio`
repositories, retaining their pinned versions and immutable digests. These
references support anonymous pulls on clean CI runners. When diagnosing image
availability, check registry access without saved credentials; an existing
local image cache can hide a registry access failure.

The runtime resolver derives `DOCKER_DATABASE_URL` from the literal
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values. Compose uses this
encoded URL for setup, web, and worker containers; the database healthcheck
passes user and database names as literal arguments. Database names must
round-trip through the PostgreSQL driver's URL parser: spaces, Unicode, and
literal percent signs are supported, while URI-reserved characters such as
`/`, `?`, `#`, and `$` are rejected before a child command acquires its project
lease. Credentials remain literal and are percent-encoded without trimming.
Direct CI Compose steps supply an explicit matching container URL in workflow
environment variables.

The generated `E2E_USE_DOCKER_STACK=true` environment makes Playwright use
`bun run docker:webserver`. That wrapper refuses to take ownership when an
existing project database container is present, builds and starts the full
stack, and uses
`--abort-on-container-failure` so a failed one-shot setup service ends startup
immediately, while successful one-shot services leave the long-running app
stack active. The wrapper traps process exit and Playwright shutdown signals,
then runs the project-scoped
`docker compose down --timeout 60 --remove-orphans --volumes` so stopped
containers, networks, and disposable named volumes do not linger. Each Compose
teardown call has a 90-second wall-clock watchdog, and each container, network,
or volume verification call has a 10-second watchdog.
Playwright allows five minutes for teardown, watchdog termination grace,
verification, removal, and an additional shutdown buffer. When it reuses
a stack that was already serving the app, it never starts that wrapper and the
user-owned stack remains running. Resume an initialized stopped project with
`bun run docker:resume`, or use `bun run docker:start` for an intentional reset.

`run-with-wall-clock-timeout.ts` keeps `TIMEOUT GRACE COMMAND [ARGS...]`,
standard streams, and command exit codes. It runs commands in an owned live
supervisor group; cancellation adds up to 25 milliseconds for FIFO observation, the configured
grace, and at most one second for result acknowledgement before group termination. The command deadline is
unchanged. `docker-webserver.sh` sends cancellation through its private FIFO
(`EVORTO_WALL_CLOCK_CONTROL_FD=3` and `EVORTO_WALL_CLOCK_CONTROL_PATH`
pointing to the same retained FIFO; newline-delimited `HUP`, `INT`, or `TERM`);
writer EOF also cancels. The first external signal wins between signals; a
command deadline that fires while the command still runs overrides its status
with 124 without extending grace. Command exit cancels that deadline. Callers must retain and
close their owned writer, then await helper exit and captured stream closure
before removing fixture files. Resolve the absolute Bun executable and helper
path before replacing `PATH` in synthetic fixtures; a Vitest runner's
`process.execPath` may be Node. OS scheduling, refused signals, or uninterruptible
processes can exceed this settlement allowance: a deadline failure must remain
visible while the owner continues awaiting closure, never become permission to
signal a reused PID or remove live fixtures.

An explicitly supplied `E2E_USE_DOCKER_STACK=false` uses
`helpers/testing/host-e2e-webserver.sh`. The caller owns its database. The host
wrapper acquires the same project lease before inspecting or changing MinIO
and retains it through host-app cleanup and MinIO restoration. It starts or
temporarily resumes only the current worktree's MinIO container, initializes
its bucket, and exports the same loopback S3 endpoint and credentials to the Angular server
that receipt fixtures use. It restores a previously stopped MinIO container and
removes a MinIO container it created after the host server stops; it never calls
Compose teardown or mutates unrelated services or projects. Existing host app
servers are not reused in this mode because their storage configuration cannot
be proven after startup.

`bun run docker:resume` requires the existing `db`, `minio`, `mailpit`,
`stripe`, `worker`, and `evorto` containers plus successful `db-setup` and
`minio-init` containers. It starts retained container IDs directly, waits for
database, object storage, email, and Stripe health, then starts worker and web.
It never reruns schema reset/seeding or bucket initialization. If any container
is missing or a one-shot setup failed, use `bun run docker:start` for an
intentional fresh reset instead.

Use `bun run docker:ps` to inspect the generated worktree Compose project; bare
`docker compose ps` can point at the wrong project because it does not resolve
the worktree runtime environment. Package scripts use `env:run` and never read
the shared `.env.dev` snapshot. Set `MAILPIT_HOST_PORT` on the package command
only when an explicit Mailpit inspection port is needed;
otherwise the runtime helper derives one from the worktree identity.

Commands that start, stop, resume, or own the Docker stack, plus local database
push/reset, Studio, and the disposable PostgreSQL integration suite, acquire one
fail-fast lease for the generated Compose project. The lease uses a stable,
private per-user directory under `/tmp`, independent of caller `TMPDIR`, `TMP`,
and `TEMP` overrides. A second command for that same worktree exits immediately
and names the active operation instead of racing a reset or waiting on a changing
stack. Other worktrees use different
project names and remain independent. The operating system releases the lease
when its command exits, including after a forced termination; stale owner
details are replaced after the next successful acquisition and cannot hold the
lease by themselves.

Local environment files support `$NAME` and `${NAME}` references with names
matching `[A-Za-z_][A-Za-z0-9_]*`. Forward references are resolved independently
of file order. `${NAME:-default}` and `${NAME:+alternate}` treat empty values as
absent; the forms without `:` distinguish an empty value from an unset name.
Nested operands are supported and only the selected operand is expanded.
Missing references become empty strings. A backslash before `$` preserves that
dollar literally; unsupported or malformed expressions remain literal text.
Caller values and generated defaults are inserted verbatim, including dollar
signs and backslashes, without rescanning their contents. Command substitutions
are never executed. Reference cycles stop the command with an error naming only
the affected keys. This deliberately corrects the previous expansion library's
handling of empty non-colon defaults and interpolated literal credentials.

Environment resolution runs before lease acquisition. Keep `env:run` outside
leased commands because native process replacement closes additional file
descriptors. The lease exports an internal marker so an accidental nested
`env:run` fails before starting its command.

`bun run db:studio` holds that lease for the entire Studio session. Stop the
`bun run db:studio` process before resetting or stopping the same project;
closing its browser tab leaves the lease active. Database operations in other
worktrees remain independent.

Ordinary Docker start, stop, and status commands have wall-clock limits around
each Compose operation. A failed or timed-out operation stops immediately and
prints the current project state plus recent logs; it does not retry or silently
rebuild a partial stack. Foreground and watch sessions remain active until the
operator stops them, after their reset and build steps finish within the same
bounds.

Inside Docker, keep `BASE_URL` browser-facing so Auth0 redirects point at the
host-mapped app URL, and keep `SSR_RPC_ORIGIN` pointed at the app container's
internal listener (`http://localhost:4200`). Server-side rendering uses
`SSR_RPC_ORIGIN` for in-container RPC calls; browser-side RPC calls still use the
normal `/rpc` relative path. The generated runtime environment and app container
set `NODE_ENV=development` explicitly so tenant outbound URLs may use the
worktree's loopback `BASE_URL`, including its mapped port. The generated runtime
environment also supplies the shared deterministic `E2E_NOW_ISO` and
`E2E_SEED_KEY` values to database seeding and the app container so seeded event
windows and server timing decisions use the same clock.

Auth0 callback URLs are configured outside this repository. The runtime helper
may generate a non-4200 app port for worktree isolation, but authenticated local
Browser or Playwright runs only work when that exact callback URL is registered
in Auth0. If the generated port is not registered, free port 4200 and start the
stack with `APP_HOST_PORT=4200 bun run docker:start`.

Authenticated Playwright setup uses the Auth0 Management test client to verify
that the dedicated administrator account already has the owner-approved
`app_metadata.platformAdministrator: true` claim. It never changes or restores
shared metadata, so concurrent CI and local runs cannot revoke each other's
authority. The Auth0
post-login action must copy app metadata into the namespaced
`evorto.app/app_metadata` session claim. Setup opens an administrator page
before saving browser state, so a missing action or claim fails visibly instead
of granting authority through a local override. The management client needs
`read:users` for this check; keep those credentials in the
ignored `.env` file.

Run `bun run docker:check` before investigating Docker startup failures. The
check validates required local secrets before Compose tears down or starts
containers, including Auth0, Stripe, the app session secret, and
Font Awesome package registry access for the premium icon package. It also
reports local tooling readiness such as Bun, Docker Compose, Compose config
validation, Playwright CLI availability, and whether the matching Playwright
browser cache is installed. Required and optional variables that are already
available are listed without printing their values, so token paths such as
Font Awesome registry access and optional live-provider coverage inputs can be
confirmed even when another required secret still blocks startup. The Docker
Stripe webhook sidecar is pinned in `docker-compose.yml`; if
its logs report a newer CLI version, update that image pin and rebuild with
`APP_HOST_PORT=4200 bun run docker:start` before relying on paid-flow webhook
validation. Missing Playwright browsers are reported as a warning because they
block local Playwright runs, not Docker startup. Local e2e runs use bundled
Chromium by default; set `E2E_BROWSER_CHANNEL=chrome` for exploratory runs on a
machine that already has Google Chrome installed.

Use the tracked `.env.example` file as the no-secret checklist for values that
belong in your untracked `.env` or exported shell environment. Do not add real
secret values to `.env.example`, `.env.dev.local`, or `.env.dev`.

The same non-mutating preflight has an `esncard-release` target. Local Docker
treats `E2E_LIVE_ESN_CARD_IDENTIFIER` and
`E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER` as optional, while
`bun helpers/testing/runtime-preflight.ts esncard-release` treats the approved
active and permanently expired non-production identifiers as required and
reports only their variable names and purposes, never their values. The release
workflow invokes this target before the live provider journey.

Docker Compose passes `STRIPE_TEST_ACCOUNT_ID` into both the `db-setup` service
and the app container so the seeded local tenants can exercise paid registration
flows against the intended connected test account.

Docker Compose also forces the app container to use the in-network MinIO
endpoint at `http://minio:9000`. This keeps Docker upload/media flows
self-contained even when `.env.dev.local` or a developer `.env` points normal
local development at an external S3-compatible endpoint.

The Playwright seed baseline is the contract for what "usable from zero" means
after the Docker `db-setup` reset: default user and organizer roles, all
template seed families, paid and free event options, paid tax-rate wiring,
scenario handles for open/closed/draft/past registration states, confirmed
registrations, and at least one checked-in aggregate for scanner review.
The setup reset and every seeded tenant commit in one database transaction.
Tenant domain, name, and currency are explicit seed inputs, and missing
administrator, organizer, or regular-user roles fail the seed. Declared add-ons
and registration questions also require their template and exact registration
option; a missing lookup aborts the seed instead of silently omitting a fixture.

The local Stripe listener image includes its startup script and uses a pinned
Stripe CLI release. It writes its generated webhook signing secret into a shared
Docker volume. The app container reads that file through
`STRIPE_WEBHOOK_SECRET_FILE`, so local paid checkout webhooks use the same
runtime secret that Stripe CLI generated for the listener session. Compose
waits for the secret file to become nonempty before starting the app container.

Testing/runtime context that depends on these seed flows lives in [tests/README.md](../tests/README.md).

## Modifying the Seeding Process

If you need to modify the seeding process:

1. Make changes to the appropriate file(s) in the `helpers` directory
2. Test your changes by running `bun run db:reset`
3. Verify that the application displays the expected data

For Playwright tests, prefer consuming `seeded.scenario` in fixtures/specs rather
than searching for events by title, date, or incidental seeded content.

## Seed configuration preflight

`STAGING_SEED_PREFLIGHT_ONLY=true bun helpers/database.ts` validates database
configuration, the required Stripe test account, and the pinned seed date
(`E2E_NOW_ISO`) without opening a database connection or changing the seed RNG.
The ordinary seed uses the same resolved date. Direct helper invocation resolves
both `E2E_NOW_ISO` and `E2E_SEED_KEY` from the process environment, then
`.env.dev.local`, `.env.dev`, and `.env`, using the same provider as database and
Stripe settings. Explicit blank caller values retain the unpinned clock or daily
RNG default instead of falling through to a file. Command-mode flags such as
`STAGING_SEED_PREFLIGHT_ONLY` remain explicit process controls. Local database reset, Compose
`db-setup`, and staging ops run this configuration preflight before their
destructive schema step. A failed Compose preflight stops setup before reset,
Drizzle schema application, or seeding.

Roles and imported VAT rates are fixed seed declarations, not external fixture
configuration or provider lookups. Checks on inserted roles, tax-rate rows,
template registration options, and scenario handles still run in the seed
transaction, where those rows exist. Configuration preflight does not certify
future database writes or make the separate staging drop/apply/seed commands
atomic; database or runtime failures can still interrupt that workflow.
