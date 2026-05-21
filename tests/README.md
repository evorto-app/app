# Playwright Tests

This directory contains the active Playwright suite.

## Structure

- Functional/e2e tests: `tests/specs/**`
- Documentation tests: `tests/docs/**`
- Setup/auth/database bootstrapping lives in `tests/setup/**`
- Shared fixtures/utilities/reporters live in `tests/support/fixtures/**`, `tests/support/utils/**`, `tests/support/reporters/**`

## Fixture Contract

- `tests/support/fixtures/parallel-test.ts` seeds a fresh tenant per test with `profile: 'test'`
- `tests/setup/database.setup.ts` seeds the shared docs tenant with `profile: 'docs'`
- Specs should consume deterministic scenario handles from `seeded.scenario`
- Do not discover test entities by template title fragments, fuzzy event searches, or wall-clock checks

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

```bash
bun run test:e2e
bun run test:e2e:ui
AUTH0_MANAGEMENT_CLIENT_ID=... AUTH0_MANAGEMENT_CLIENT_SECRET=... bun run test:e2e:integration
AUTH0_MANAGEMENT_CLIENT_ID=... AUTH0_MANAGEMENT_CLIENT_SECRET=... bun run test:e2e:create-account
bun run test:e2e:esncard-provider
bun run test:e2e:docs
bun run test:e2e:docs:publish
bun run test:e2e:install
bun run test:e2e -- --project=setup
bun run test:e2e -- --headed --workers 1
bun run test:e2e:report
bun run lint
```

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Check whether required local Docker secrets are available:
  `bun run docker:check`
- Show the generated worktree Compose project status: `bun run docker:ps`
- Start the local runtime stack: `bun run docker:start`
- Resume an existing local runtime stack without recreating containers:
  `bun run docker:resume`
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
  container instead of calling the host-mapped port.
- Auth0 callback URLs are registered out-of-band. Worktree-local generated
  ports keep stacks isolated, but authenticated Browser/Playwright validation
  needs a callback URL Auth0 accepts. On this machine, run Docker-backed
  authenticated checks with `APP_HOST_PORT=4200 bun run docker:start` unless the
  generated worktree port has also been added to the Auth0 application.
- Local `dev:start`, `test:e2e`, `test:e2e:ui`, `test:e2e:integration`, `test:e2e:docs`, `db:*`, and `docker:*` package scripts refresh `.env.dev` before invoking `dotenv -c dev`, so new worktrees get isolated local app/service ports and database URLs by default. Use `bun run docker:ps` rather than bare `docker compose ps` when checking a worktree stack because the generated `COMPOSE_PROJECT_NAME` must be loaded from `.env.dev`.
- `bun run docker:check` fails before Docker Compose mutates local containers
  when required local runtime variables are missing. The check covers Neon
  Local, Auth0, Stripe, the application session secret, and Font Awesome package
  registry access for the premium and brand icon packages. It also reports Bun,
  Docker Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright
  browser cache status. ESNcard provider coverage uses tenant-scoped
  deterministic test mode, so Docker startup no longer depends on live ESNcard
  identifiers. Missing Playwright browsers are warnings
  because they affect Playwright runs, not Docker startup.
- `bun run env:runtime` generates `.env.dev`, the untracked worktree-local override file.
- `.env.dev.local` is the tracked shared default dev config file.
- `.env` is the untracked developer-secrets file.
- `.env.example` is the tracked no-secret checklist for Docker-required
  developer secrets.
- `.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo.
- Starting the Docker stack with `docker:start`, `docker:start:foreground`, or
  `docker:start:watch` is destructive for local database state by design because
  those scripts run `docker compose down` and then `db-setup` clears the
  `public` schema, pushes schema, and resets/seeds the Docker database.
  Playwright `webServer` uses
  `docker:webserver`, which still builds and starts the Compose stack in the
  foreground but does not force a Compose teardown first. Use `docker:resume`
  only for an already initialized stack when you want to bring containers back
  without recreating them.
- `bun run test:e2e:ui` opens unrestricted Playwright UI mode so you can choose projects and tests interactively.
- `bun run test:e2e:integration` runs all integration-only Playwright
  projects. It is intended for credential-gated specs and docs such as Auth0
  Management account creation.
- `bun run test:e2e:create-account` runs only the Auth0 Management
  account-creation functional spec and generated-doc journey. Use it when the
  main checkout has Auth0 Management credentials but you do not want the whole
  integration suite.
- `bun run test:e2e:esncard-provider` runs only the deterministic ESNcard
  provider add/refresh/remove profile path. It uses tenant-scoped provider test
  mode with `TESTESN*` identifiers and narrows execution to
  `tests/specs/profile/user-profile-esncard-provider.spec.ts` and
  `@esncard-provider`.
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

Playwright defaults deterministic test values in code via `helpers/testing/deterministic-test-defaults.ts`, so local runs do not need extra flags.

Default values:

- `E2E_NOW_ISO=2026-09-15T12:00:00.000Z`
- `E2E_SEED_KEY=evorto-e2e-default-v1`

Optional overrides:

- `E2E_NOW_ISO`
- `E2E_SEED_KEY`

Keep `E2E_NOW_ISO` ahead of the real current date or deterministic checkout expiry behavior will break.

## Baseline vs Integration Projects

Playwright separates external-service coverage with dedicated projects:

- baseline:
  - `local-chrome-baseline`
  - `docs-baseline`
- integration-only:
  - `local-chrome-integration`
  - `docs-integration`

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
Playwright runs may omit the static secret; the replay spec file then skips
itself before page/database fixtures are requested.

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

ESNcard provider outcomes are covered through tenant-scoped deterministic test
mode. Use `bun run test:e2e:esncard-provider` to exercise profile
add/refresh/remove behavior with provider-success and provider-unavailable
inputs without relying on esncard.org returning a reusable live card.

## Local Stack Isolation

`.env.dev` is generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local app port and `BASE_URL`
- distinct local Neon Local port
- distinct local MinIO ports

Set `APP_HOST_PORT` before running `bun run env:runtime` only when you need a specific callback URL such as `localhost:4200`.
After `.env.dev` exists, later package scripts preserve its generated local
ports unless you explicitly override them again, so status checks do not
silently move `BASE_URL` away from the already running Docker stack.
