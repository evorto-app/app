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

## Required Tags

All tests in `tests/**/*.ts` are linted with a custom ESLint rule:

- `@track(<track_id>)` is required for every test title
- `@req(<id>)` is required for non-doc tests
- `@doc(<id>)` is required for doc tests under `tests/docs/**`

## Commands

```bash
bun run test:e2e
bun run test:e2e:ui
bun run test:e2e:docs
bun run test:e2e:install
bun run test:e2e -- --project=setup
bun run test:e2e -- --headed --workers 1
bun run test:e2e:docs -- --project=docs-integration
bun run test:e2e:report
bun run lint
```

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Check whether required local Docker secrets are available:
  `bun run docker:check`
- Start the local runtime stack: `bun run docker:start`
- Start the local runtime stack in foreground for Playwright `webServer`: `bun run docker:start:foreground`
- Start the local runtime stack in watch mode: `bun run docker:start:watch`
- Stop the local runtime stack: `bun run docker:stop`
- Local Docker runs use Neon Local instead of a plain Postgres container.
- Docker Compose includes a one-shot `db-setup` service that runs the equivalent of `db:reset` before `evorto` starts.
- Local `dev:start`, `test:e2e`, `test:e2e:ui`, `test:e2e:docs`, `db:*`, and `docker:*` package scripts refresh `.env.dev` before invoking `dotenv -c dev`, so new worktrees get isolated local app/service ports and database URLs by default.
- `bun run docker:check` fails before Docker Compose mutates local containers
  when required local runtime variables are missing. The check covers Neon
  Local, Auth0, Stripe, the application session secret, and Font Awesome package
  registry access for the premium and brand icon packages. It also reports Bun, Docker
  Compose, Compose config, Playwright CLI, `.env.dev`, and Playwright browser
  cache status. Missing Playwright browsers are warnings because they affect
  Playwright runs, not Docker startup.
- `bun run env:runtime` generates `.env.dev`, the untracked worktree-local override file.
- `.env.dev.local` is the tracked shared default dev config file.
- `.env` is the untracked developer-secrets file.
- `.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo.
- Starting the Docker stack is destructive for local database state by design because `db-setup` pushes schema and resets/seeds the Docker database on every start.
- `bun run test:e2e:ui` opens unrestricted Playwright UI mode so you can choose projects and tests interactively.
- Local Docker scripts preload the environment with `dotenv -c dev` before invoking Compose.
- Use `bun run ...` package scripts, not a bare shell `dotenv` command. Local shells may resolve a different `dotenv` executable than `node_modules/.bin/dotenv`; when a direct external-tool command is unavoidable, spell it as `node_modules/.bin/dotenv -c dev -- ...`.
- Playwright list/discovery commands do not clean or write generated docs
  output and may run without local Auth0/Stripe secrets. In list-only mode the
  Playwright config uses inert placeholder values for runtime-only secrets so
  test titles can be enumerated without starting Docker or contacting external
  services. Run the docs projects without `--list` when you intentionally want
  to regenerate documentation artifacts.

## Playwright Browsers

Install the browser binaries after dependency installation and whenever the Playwright package version changes:

```bash
bun run test:e2e:install
```

CI runs `bunx playwright install --with-deps`, but local macOS/Linux development only needs the package script unless the host is missing OS-level browser dependencies.

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
  - `docs-integration`

CI infers whether integration-only credentials are required from the selected Playwright projects.
If you select `docs-integration`, CI/runtime validation demands the extra external-service credentials.
UI mode is intentionally unrestricted and does not force integration-only credentials at startup.

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
- `STRIPE_WEBHOOK_SECRET`

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

## Local Stack Isolation

`.env.dev` is generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local app port and `BASE_URL`
- distinct local Neon Local port
- distinct local MinIO ports

Set `APP_HOST_PORT` before running `bun run env:runtime` only when you need a specific callback URL such as `localhost:4200`.
