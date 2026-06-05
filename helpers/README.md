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

`bun run env:runtime` prints the generated `BASE_URL`,
`COMPOSE_PROJECT_NAME`, and `NEON_LOCAL_HOST_PORT` after writing `.env.dev`.
Use that output to find the app URL or Compose project instead of running a
bare shell `dotenv` command.
`bun run dev:check` and `bun run docker:check` also print a non-secret runtime
target summary, including the browser URL, local database target, Compose
project name, Neon Local host port, and Neon Local metadata directory where
applicable.
Use `bun run dev:status` for a combined non-mutating local runtime report. It
refreshes `.env.dev`, runs the development preflight, runs the Docker preflight,
and runs the Neon Local cleanup dry-run in one pass so Docker failures do not
hide branch-cleanup status or missing development variables.

The Neon Local container does not emit every proxied query in its default logging configuration, so `docker logs` staying quiet during `db:reset` does not mean the reset missed Docker.

Docker Compose now also runs one-shot `db-expiration` and `db-setup`
containers before `evorto` starts. `bun run docker:start`,
`bun run docker:start:foreground`, and `bun run docker:start:watch` run
`docker compose down` first, then run the equivalent of `bun run db:reset`
against the Docker database during stack startup. That Docker reset path drops
and recreates the `public` schema before running Drizzle so the one-shot
container cannot get stuck on non-TTY confirmation prompts from older local
branch state. Neon Local still receives `DELETE_BRANCH=true` so normal
`docker compose down` deletes the branch. Generated local `.env.dev` also sets
`NEON_LOCAL_METADATA_DIR=./.neon_local`, matching the Docker Compose bind mount
so package-script cleanup reads the same branch metadata file as the local Neon
container. `db-expiration` immediately sets a two-hour Neon branch expiration as
a fallback for interrupted local or CI shutdowns, and CI runs
`delete-neon-local-branches.ts` immediately after
required configuration validation, before private registry auth can fail the
job, and again after Compose shutdown.
When a cancelled local or GitHub run has already stopped but cleanup still
reports a specific young active-test branch inside the TTL, pass the exact id as
`NEON_LOCAL_FORCE_DELETE_BRANCH_IDS=<branch-id>` to `bun run
db:cleanup:neon-local`. That explicit path is intended for confirmed-inactive
branches only; default CI and local cleanup remain TTL-conservative and the
helper refuses protected branches.
`helpers/testing/ci-start-docker-stack.sh` owns the E2E Docker startup path. It
bounds the runtime preflight, bounds Compose image pre-pull attempts, builds the
app images with the CI BuildKit cache overlay, starts the already-built stack,
and keeps the existing one-prune retry before surfacing startup failure.
`helpers/testing/ci-stop-docker-stack.sh` owns the E2E Docker shutdown path: it
first gives the Neon Local `db` container a 60-second stop window inside a
bounded 90-second command, then runs bounded Compose down, force-removes leftover
Compose containers, and invokes the Neon prune helper with a 5-minute timeout
against the metadata branch that shutdown should have released. The workflow's separate
`Prune expired Neon branches after E2E` finalizer still runs
`helpers/testing/ci-prune-neon-local-branches.sh` so Neon cleanup remains
visible, dependency-free, and independent if Docker teardown hangs or times out.
CI Compose status, logs, debug streaming, shutdown, and container-removal
commands use the generated `.env.dev` dotenv cascade after dependencies exist,
while final branch deletion runs directly against the already-exported workflow
environment so dependency-install failures cannot prevent Neon cleanup. The same
cleanup helper
also prunes non-main Neon branches whose `expires_at` has already passed, and
also prunes non-main branches without expiration metadata once their
`created_at` timestamp is outside the active-test TTL. It runs that stale sweep
when local metadata is missing or when the metadata file exists but contains no
branch ids, so an interrupted Neon Local metadata write does not become a
cleanup blind spot. That covers stale CI branches after their short TTL even
when local metadata, the expiration sidecar, or graceful GitHub Actions shutdown
is interrupted. When Neon API access is available, the helper logs a sanitized
branch cleanup summary with total, protected, active-test, and stale-deleted
counts plus any active branches still inside the TTL. Use
`bun run neon:cleanup:dry-run` for a non-mutating local branch audit and
`bun run neon:cleanup` for the same TTL-conservative local cleanup path without
remembering the helper script and dotenv cascade. A lightweight
`Neon Branch Cleanup` workflow also runs the same helper hourly, on manual
dispatch, and after the E2E workflow completes, so stale branches do not wait
for the next Playwright attempt before being pruned.
CI must not set `BRANCH_ID`; it may receive `PARENT_BRANCH_ID` from secrets, and
otherwise relies on Neon Local's documented default project branch for ephemeral
branch creation. Persistent Neon branches are an explicit local opt-in through
`BRANCH_ID` or `DELETE_BRANCH=false`, and they should not be used for E2E because
the cleanup helper intentionally skips existing-branch and persistent-branch
modes.
That standalone cleanup workflow is intentionally narrow: it has `contents:
read`, validates `NEON_API_KEY` and `NEON_PROJECT_ID`, uses
`DELETE_BRANCH=true`, keeps the two-hour active-test TTL, runs in a
non-canceling `neon-branch-cleanup` concurrency group, and has a 10-minute job
timeout.
The E2E cache-warmer also runs the same TTL cleanup before dependency installs
when Neon credentials are available. That keeps branch-count recovery out of the
Font Awesome bandwidth path and gives cancelled or replaced PR runs another
pre-Docker cleanup checkpoint.
Playwright `webServer` uses `bun run docker:webserver`, which removes
stopped/created Compose service containers and then starts the foreground
Compose stack without forcing `docker compose down` first. Use
`bun run docker:resume` only for an already initialized stack when you want to
bring stopped containers back without recreating them. Use `bun run docker:ps`
to inspect the generated worktree Compose project; bare `docker compose ps` can
point at the wrong project because it does not preload `.env.dev`. The package
scripts preload the needed environment with `dotenv -c dev` before invoking
Docker, and direct external-tool commands should use
`node_modules/.bin/dotenv -c dev -- ...` if a package script does not already
exist.

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
Once `.env.dev` has been generated, later package-script preflights preserve the
recorded local ports unless an explicit override such as `APP_HOST_PORT=4200` is
provided again. This keeps `BASE_URL` aligned with a running stack when you use
non-mutating commands such as `bun run docker:ps`.

Local global-admin e2e coverage can use `E2E_GLOBAL_ADMIN_AUTH0_IDS` as a
no-secret fallback when the Auth0 tenant user has app metadata but the
post-login session does not include the namespaced global-admin claim. Keep this
limited to known local e2e Auth0 ids. Production global-admin access remains
driven by Auth0 app metadata claims, not tenant roles.

Run `bun run docker:check` before investigating Docker startup failures. The
check validates required local secrets before Compose tears down or starts
containers, including Neon Local, Auth0, Stripe, and the app session secret. It
also reports local tooling readiness such as Bun, Docker Compose, Compose config
validation, the Docker container start path through a disposable Alpine
container, generated Compose project container state, Playwright CLI
availability, and whether the matching Playwright browser cache is installed.
If service containers for the generated project are stuck in `created`, `dead`,
or `removing`, the preflight fails before Docker startup can hang while trying
to start or tear down them. The same check also fails if the generated Compose
project container inspection times out, because uninspectable project state can
make `docker compose up/down` hang before Browser verification can run.
If the disposable Alpine container start probe times out, Docker can inspect
local configuration but cannot start containers; Browser verification and
Docker-backed Playwright are blocked below the app tooling layer until Docker
Desktop or the Docker engine recovers. The preflight gives that probe a bounded
cleanup window before returning so the disposable `evorto-runtime-preflight-*`
container is removed when Docker removal is still responsive.
Run `bun run docker:clean-stale` to attempt bounded cleanup before retrying
Docker startup; it uses the generated `COMPOSE_PROJECT_NAME`, falls back to the
Docker `com.docker.compose.project` label when Compose inspection hangs, and
times out Docker inspect/remove subprocesses instead of relying on GNU
`timeout`. The cleanup removes stale or unhealthy containers one at a time, so
one stuck container does not prevent reporting or removing the remaining
generated-project containers. If bounded cleanup cannot stop an unhealthy
running generated container, shut down the generated project with Docker Compose
before retrying; if that shutdown also times out, restart Docker Desktop or the
Docker engine because container removal is blocked below the app tooling layer.
Required and optional variables that are already available are listed without
printing their values, so secret availability can be confirmed even when another
required secret still blocks startup. If required variables are missing in a
Codex worktree and the sibling main checkout has an untracked `.env`, the
preflight points at `bun run env:copy-main`. It does not copy secrets
automatically, and it still warns not to copy generated `.env.dev`. The guarded
copy path reads
`$HOME/code/<repo>/.env` by default, supports `MAIN_CHECKOUT_DIR=/path/to/repo`
for a different source checkout, and refuses to overwrite an existing worktree
`.env` unless rerun with `--force`.
Font Awesome icons use public npm packages only; Docker and CI installs must
not depend on a private Font Awesome registry token or project `.npmrc`. CI
install retries preserve the restored Bun package cache instead of clearing it
before retrying, so transient failures do not force another Font Awesome package
download.
CI also clears common Font Awesome token environment variables and points npm's
user and global config paths at temporary public-only files before dependency
steps run, so account-level registry configuration cannot leak into cache misses
or Docker installs.
`.github/actions/setup-bun-dependency-caches/action.yml` centralizes the
GitHub Actions Bun setup, public Font Awesome registry override, private Font
Awesome dependency guard, and Bun package/dependency-tree cache restores for
workflows that install dependencies. The Neon cleanup workflow stays
install-free and does not need that registry setup.
`helpers/testing/install-ci-dependencies.sh` centralizes the GitHub Actions
Bun cache/offline install policy: `warm` mode is reserved for the serial E2E
cache warmer, while E2E workers and Copilot setup use `offline-required` mode
and fail before opening another registry install path when warmed caches are
missing.
Docker builds also write a temporary public Font Awesome npm user config before
container installs, writes an empty npm global config, and locks the shared
BuildKit Bun cache mount so parallel install stages do not race the cache. CI
persists that `bun-install-cache` mount as a separate `buildkit-bun-cache`
Actions cache and injects it back into the BuildKit builder before a
dependency-only warm build and the later Docker Compose builds, because
BuildKit layer caches alone do not carry `RUN --mount=type=cache` contents
between GitHub-hosted runners. Codex setup also ignores copied `.npmrc` files,
writes the same
temporary public Font Awesome npm user config, and installs through the Bun
package cache instead of requiring `FONT_AWESOME_TOKEN`. `.dockerignore` also
keeps `.npmrc` out of Docker and remote deploy build contexts, so a
developer-level private registry file cannot be copied into the image context by
accident. The Docker
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

The Stripe CLI listener forwards events for the configured test account into
the local app. When a reused test account has older Connect activity, Docker
logs can show a short burst of stale webhook deliveries that do not correspond
to the freshly reset local database. Treat repeated new `400` webhook responses
as a real investigation target, but do not infer that an old isolated delivery
proves current checkout flow failure without replaying the flow against the
current reset database.

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
