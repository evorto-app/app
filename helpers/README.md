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

1. Generate or refresh `.env.dev` through the package script's `bun run env:runtime` prelude, so Docker, database, and Playwright commands keep isolated ports/project naming
2. Ensure schema exists and reset/seed the local database (`bun run db:reset`)

`bun run db:reset` now uses the same generated `.env.dev` plus `dotenv -c dev` loading model as `db:push`. In this repo, the supported local files are `.env` for developer secrets, `.env.dev.local` for tracked shared defaults, and `.env.dev` for generated worktree overrides. `bun run db:push`, Docker's `db-setup` service, and `bun run db:studio` all consume the same local environment contract.

The Neon Local container does not emit every proxied query in its default logging configuration, so `docker logs` staying quiet during `db:reset` does not mean the reset missed Docker.

Docker Compose now also runs one-shot `db-expiration` and `db-setup`
containers before `evorto` starts. `bun run docker:start`,
`bun run docker:start:foreground`, and `bun run docker:start:watch` run
`docker compose down --timeout 60 --remove-orphans` first, then run the
equivalent of `bun run db:reset`
against the Docker database during stack startup. That Docker reset path drops
and recreates the `public` schema before running Drizzle so the one-shot
container cannot get stuck on non-TTY confirmation prompts from older local
branch state. Neon Local still receives `DELETE_BRANCH=true` so normal
`docker compose down` deletes the branch. The database receives a 60-second
shutdown grace period for that cleanup, and `db-expiration` must successfully
set a short Neon branch expiration before database setup can continue. The
expiration is a fallback for interrupted local or CI shutdowns; failure is a
startup blocker rather than silently accepting lost cleanup coverage. Both
services share the project-scoped `neon-local-metadata` Docker
volume by default. Keeping that shutdown-critical state off a macOS host bind
mount avoids Docker Desktop file-sharing stalls while Neon Local reads the
metadata during branch cleanup. The database container assigns the mount to
Neon's `postgres` user before startup so the branch state is writable during
expiration and shutdown cleanup. Neon Local is not restarted independently: a
proxy crash leaves the stack failed so the next explicit stack start also reruns
the branch-expiration sidecar instead of creating an untracked replacement
branch. CI or another controlled environment can set
`NEON_LOCAL_METADATA_DIR` to an absolute host directory when a bind mount is
intentional. With the normal generated `NEON_LOCAL_PROXY=true` environment,
Playwright `webServer` uses `bun run docker:webserver`, which starts the
foreground Compose stack without forcing `docker compose down` first. It uses
`--abort-on-container-failure` so a failed one-shot setup service ends startup
immediately, while successful one-shot services leave the long-running app
stack active. The wrapper traps process exit and Playwright shutdown signals,
then runs the project-scoped
`docker compose down --timeout 60 --remove-orphans --volumes` so stopped
containers, networks, and disposable named volumes do not linger. Each Compose
teardown call has a 90-second wall-clock watchdog, and each container, network,
or volume verification call has a 10-second watchdog.
Playwright allows five minutes for both teardown attempts, watchdog termination
grace, verification, removal, and an additional shutdown buffer. When
Playwright reuses a stack that was already serving the app, it never starts that
wrapper; the user-owned stack therefore keeps running. If the project instead
contains a stopped database container created with an explicit `BRANCH_ID` or
`DELETE_BRANCH=false`, the disposable wrapper refuses ownership before starting
Compose. Resume that retained stack with `bun run docker:resume`, or choose
`bun run docker:start` for an intentional reset.

An explicitly supplied disposable database with `NEON_LOCAL_PROXY=false` uses
`helpers/testing/host-e2e-webserver.sh`. That host wrapper starts or temporarily
resumes only the current worktree's MinIO container, initializes its bucket,
and exports the same loopback S3 endpoint and credentials to the Angular server
that receipt fixtures use. It restores a previously stopped MinIO container and
removes a MinIO container it created after the host server stops; it never calls
Compose teardown or mutates unrelated services or projects. Existing host app
servers are not reused in this mode because their storage configuration cannot
be proven after startup.

`bun run docker:resume` rejects the default
ephemeral `DELETE_BRANCH=true` mode because the branch is gone after the
database stops. It inspects the existing database container rather than
trusting current dotenv values, because retained containers keep the
environment from their creation. Resume only when that container was created
with an explicit existing `BRANCH_ID` or `DELETE_BRANCH=false`; otherwise start
a fresh stack.

Resume also verifies that the existing `db`, `minio`, `stripe`, and `evorto`
containers are present and that the original `db-expiration`, `db-setup`, and
`minio-init` containers completed successfully. It starts the retained database
and MinIO container IDs directly, waits for both to become healthy, then starts
Stripe and waits for its signing-secret-backed healthcheck before starting the
app. It never invokes Compose
startup dependency resolution or starts the one-shot services again, so a
resume cannot create a replacement container and preserves the initialized
schema, seed data, bucket, and branch-expiration state. If any container is
missing or any one-shot setup failed, use `bun run docker:start` for an
intentional fresh reset instead.

Use `bun run docker:ps` to inspect the generated worktree Compose project; bare
`docker compose ps` can point at the wrong project because it does not preload
`.env.dev`. The package scripts preload the needed environment with
`dotenv -c dev` before invoking Docker.

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

Local global-admin e2e coverage can use `E2E_GLOBAL_ADMIN_AUTH0_IDS` as a
no-secret fallback when the Auth0 tenant user has app metadata but the
post-login session does not include the namespaced global-admin claim. Keep this
limited to known local or CI e2e Auth0 ids. The fallback is ignored when
`NODE_ENV=production`; production global-admin access remains driven by Auth0
app metadata claims, not tenant roles.

Run `bun run docker:check` before investigating Docker startup failures. The
check validates required local secrets before Compose tears down or starts
containers, including Neon Local, Auth0, Stripe, the app session secret, and
Font Awesome package registry access for premium and brand icons. It also
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

The Docker Stripe CLI listener writes its generated webhook signing secret into
a shared Docker volume. The app container reads that file through
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
