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
`docker compose down` first, then run the equivalent of `bun run db:reset`
against the Docker database during stack startup. That Docker reset path drops
and recreates the `public` schema before running Drizzle so the one-shot
container cannot get stuck on non-TTY confirmation prompts from older local
branch state. Neon Local still receives `DELETE_BRANCH=true` so normal
`docker compose down` deletes the branch, and `db-expiration` immediately sets
a short Neon branch expiration as a fallback for interrupted local or CI
shutdowns. Playwright `webServer` uses `bun run docker:webserver`, which starts
the foreground Compose stack without forcing `docker compose down` first. Use
`bun run docker:resume` only for an already initialized stack when you want to
bring stopped containers back without recreating them. Use `bun run docker:ps`
to inspect the generated worktree Compose project; bare `docker compose ps` can
point at the wrong project because it does not preload `.env.dev`. The package
scripts preload the needed environment with `dotenv -c dev` before invoking
Docker.

Inside Docker, keep `BASE_URL` browser-facing so Auth0 redirects point at the
host-mapped app URL, and keep `SSR_RPC_ORIGIN` pointed at the app container's
internal listener (`http://localhost:4200`). Server-side rendering uses
`SSR_RPC_ORIGIN` for in-container RPC calls; browser-side RPC calls still use the
normal `/rpc` relative path.

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
runtime secret that Stripe CLI generated for the listener session.

Testing/runtime context that depends on these seed flows lives in [tests/README.md](../tests/README.md).

## Modifying the Seeding Process

If you need to modify the seeding process:

1. Make changes to the appropriate file(s) in the `helpers` directory
2. Test your changes by running `bun run db:reset`
3. Verify that the application displays the expected data

For Playwright tests, prefer consuming `seeded.scenario` in fixtures/specs rather
than searching for events by title, date, or incidental seeded content.
