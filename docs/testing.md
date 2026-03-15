# Testing Guide

## Commands

- Unit tests: `bun run test:unit`
- Functional E2E (Chromium): `bun run test:e2e --project=local-chrome`
- Documentation E2E: `bun run test:e2e:docs`
- Playwright UI mode: `bun run test:e2e:ui`
- Refresh only the shared setup/auth states: `bun run test:e2e:states`

## Docker Runtime

- Start runtime stack: `bun run docker:start`
- Start runtime stack in foreground (used by Playwright webServer): `bun run docker:start:test`
- Stop runtime stack: `bun run docker:stop`
- Local docker runs now use Neon Local instead of a plain Postgres container.
- Docker Compose now includes a one-shot `db-setup` service that runs the equivalent of `db:setup` inside Docker before `evorto` starts.
- `.env.runtime` is an explicit worktree-local override created with `bun run env:runtime`.
- For linked worktrees that run the Neon Local Docker stack, generate `.env.runtime` once when the worktree is created so `NEON_LOCAL_GIT_HEAD_PATH` points at the resolved Git HEAD file.
- Local Neon metadata persists in `.neon_local/`, which lets Neon Local reuse a branch per worktree/git branch by default.
- `.env.ci` is the checked-in CI baseline env file; workflow env should supply CI-specific secrets and overrides.
- `bun run db:push` applies schema only.
- `bun run db:studio` opens Drizzle Studio against the current database URL under the same explicit dotenv chain.
- `bun run db:setup` ensures schema exists, then resets and seeds the local database.
  It now runs under the same explicit dotenv chain as `db:push`, so if `.env.runtime` exists it will target the local Neon Local proxy instead of the checked-in baseline URL.
- `bun run db:reset` is now an alias for `bun run db:setup`.
- The Neon Local container does not log every proxied query by default, so a quiet `db` container log is not evidence that `db:reset` missed Docker.
- Starting the Docker stack is now destructive for local database state by design: the `db-setup` container pushes schema and resets/seeds the Docker database every time the Compose stack starts.
- `bun run test:e2e:ui` now pre-runs `test:e2e:states` before opening the Playwright UI. This is intentional: Playwright UI mode does not reliably honor the repo's setup-project dependency chain (`database-setup` -> `setup`) the same way the normal CLI run does, so prewarming the shared auth/storage state avoids the UI appearing to hang on the `page` fixture before any spec body starts.

Config now resolves in this precedence order:

- real environment variables
- `.env.local`
- `.env`
- `.env.runtime`
- in-code defaults

For external-tool scripts that use `dotenv-cli` (`db:*`, `docker:*`, `test:e2e*`), the file order is intentionally reversed because `dotenv-cli` is first-wins in this repo:

- `.env.runtime`
- `.env.ci` in CI
- `.env.local`
- `.env`

`bun run env:runtime` now generates:

- a host-side `DATABASE_URL` that points at `localhost:${NEON_LOCAL_HOST_PORT}` with `sslmode=require`
- `DELETE_BRANCH=false` for local persistent Neon Local branches

We keep this explicit `-e` ordering instead of `dotenv -c` because `-c` would let `.env` win over `.env.local` for values like `DATABASE_URL` in this repo. `dotenv-cli` also ignores missing `-e` files, so the scripts do not need file-existence checks around `.env.runtime`.

## Deterministic E2E Environment

Playwright now defaults deterministic test values in code via
`helpers/testing/deterministic-test-defaults.ts`, so local runs do not need extra flags.

Default values:

- `E2E_NOW_ISO=2026-02-01T12:00:00.000Z`
- `E2E_SEED_KEY=evorto-e2e-default-v1`

Optional overrides:

- `E2E_NOW_ISO` (example: `2026-02-01T12:00:00.000Z`)
- `E2E_SEED_KEY` (example: `ci-e2e-seed-v1`)

Policy:

- Standard Playwright runs, including CI baseline runs, can omit both values and use the in-code defaults.
- Set either value only when you deliberately want a different deterministic seed or clock.

## Seed Profiles And Scenario Contract

`seedTenant()` is now profile-driven:

- `demo`: richer development/demo dataset
- `test`: minimal deterministic dataset for isolated Playwright tenants
- `docs`: deterministic shared dataset for documentation flows

Tests should not discover entities by title fragments or wall-clock filtering.
Use the seeded scenario handles exposed by `SeedTenantResult` instead:

- `seeded.scenario.events.freeOpen`
- `seeded.scenario.events.paidOpen`
- `seeded.scenario.events.closedReg`
- `seeded.scenario.events.past`
- `seeded.scenario.events.draft`

The seed map emitted during setup includes these handles for CI/debugging.

## Local Stack Isolation

`.env.runtime` is generated from the current working directory, so separate worktrees get:

- distinct `COMPOSE_PROJECT_NAME`
- distinct local Neon Local port
- distinct local MinIO ports

The local app port intentionally stays at `4200` by default because the current Auth0 local callback configuration expects `localhost:4200`. That means:

- database and object-storage state can be isolated per worktree
- fully authenticated browser stacks still need the shared `4200` app port unless Auth0 callback settings are expanded

If `.env.runtime` is absent, local commands fall back to the checked-in env files and process env only. In linked worktrees that also means Docker Compose falls back to `./.git/HEAD`, which is only valid for non-worktree clones.

If you intentionally need another isolated stack from the same working tree, override the generated ports/project name explicitly before running `bun run env:runtime`.

## Object Storage Environment (MinIO/R2-Compatible)

Canonical variables:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

For local MinIO defaults used by docker-compose:

- `S3_ENDPOINT=http://minio:9000`
- `S3_REGION=us-east-1`
- `S3_BUCKET=evorto-testing`
- `S3_ACCESS_KEY_ID=minioadmin`
- `S3_SECRET_ACCESS_KEY=minioadmin`

## Other E2E Variables

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

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_IMAGES_DELIVERY_HASH`
- `CLOUDFLARE_IMAGES_API_TOKEN`
