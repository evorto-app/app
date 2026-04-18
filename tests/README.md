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
bun run test:e2e -- --project=setup
bun run test:e2e -- --headed --workers 1
bun run test:e2e:docs -- --project=docs-integration
bun run test:e2e:report
bun run lint:check
```

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Start the local runtime stack: `bun run docker:start`
- Start the local runtime stack in foreground for Playwright `webServer`: `bun run docker:start:foreground`
- Start the local runtime stack in watch mode: `bun run docker:start:watch`
- Stop the local runtime stack: `bun run docker:stop`
- Local Docker runs use Neon Local instead of a plain Postgres container.
- Docker Compose includes a one-shot `db-setup` service that runs the equivalent of `db:setup` before `evorto` starts.
- `bun run env:runtime` generates `.env.dev`, the untracked worktree-local override file.
- `.env.dev.local` is the tracked shared default dev config file.
- `.env` is the untracked developer-secrets file.
- `.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo.
- Starting the Docker stack is destructive for local database state by design because `db-setup` pushes schema and resets/seeds the Docker database on every start.
- `bun run test:e2e:ui` pre-runs the Playwright `setup` project before opening UI mode because Playwright UI does not reliably honor the repo's setup dependency chain.
- Docker Compose does not load repo dotenv files directly; local scripts preload the environment with `dotenv -c dev` before invoking Compose.

## Runtime Environment Precedence

Application runtime config resolves in this precedence order:

- real environment variables
- `.env.dev.local`
- `.env.dev`
- `.env`
- in-code defaults

External-tool scripts use `dotenv -c dev`. Because `dotenv-cli` is first-wins, the effective dotenv precedence for those scripts is:

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

`E2E_MODE=baseline` is the default.
`E2E_MODE=integration` is required when running integration-only projects so runtime validation demands the extra external-service credentials.

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
- distinct local Neon Local port
- distinct local MinIO ports

The local app port stays at `4200` by default because the current Auth0 local callback configuration expects `localhost:4200`.
