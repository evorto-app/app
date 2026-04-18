# Testing Guide

## Commands

- Angular/UI unit tests: `bun run test:unit`
- Server/db/helper unit tests: `bun run test:unit:server`
- Server/db/helper unit tests (watch): `bun run test:unit:server:watch`
- Functional E2E (Chromium baseline): `bun run test:e2e`
- Documentation E2E: `bun run test:e2e:docs`
- Playwright UI mode: `bun run test:e2e:ui`
- Maintenance tasks: `bun run maintenance -- list`

Advanced Playwright usage now forwards extra CLI flags through the slimmer script surface:

- Headed baseline browser run: `bun run test:e2e -- --headed --workers 1`
- Refresh only the shared setup/auth states: `bun run test:e2e -- --project=setup`
- Documentation E2E (integration-only): `bun run test:e2e:docs -- --project=docs-integration`

## Docker Runtime

- Generate or refresh worktree-local runtime overrides: `bun run env:runtime`
- Start runtime stack: `bun run docker:start`
- Start runtime stack in foreground (used by Playwright webServer): `bun run docker:start:foreground`
- Start runtime stack in watch mode: `bun run docker:start:watch`
- Stop runtime stack: `bun run docker:stop`
- Local docker runs now use Neon Local instead of a plain Postgres container.
- Docker Compose now includes a one-shot `db-setup` service that runs the equivalent of `db:setup` inside Docker before `evorto` starts.
- `.env.runtime` is an explicit worktree-local override created with `bun run env:runtime`.
- Local Neon metadata persists in `.neon_local/`, but local Docker no longer ties branch selection to Git HEAD.
- Local Docker branches are ephemeral by default and are deleted on stack shutdown.
- `.env.ci` is the checked-in CI baseline env file; workflow env should supply CI-specific secrets and overrides.
- `bun run db:push` applies schema only.
- `bun run db:studio` opens Drizzle Studio against the current database URL under the same explicit dotenv chain.
- `bun run db:setup` ensures schema exists, then resets and seeds the local database.
  It now runs under the same explicit dotenv chain as `db:push`, so if `.env.runtime` exists it will target the local Neon Local proxy instead of the checked-in baseline URL.
- `bun run db:reset` is now an alias for `bun run db:setup`.
- The Neon Local container does not log every proxied query by default, so a quiet `db` container log is not evidence that `db:reset` missed Docker.
- Starting the Docker stack is now destructive for local database state by design: the `db-setup` container pushes schema and resets/seeds the Docker database every time the Compose stack starts.
- `bun run test:e2e:ui` now pre-runs the Playwright `setup` project before opening the UI. This is intentional: Playwright UI mode does not reliably honor the repo's setup-project dependency chain (`database-setup` -> `setup`) the same way the normal CLI run does, so prewarming the shared auth/storage state avoids the UI appearing to hang on the `page` fixture before any spec body starts.

Config now resolves in this precedence order:

- real environment variables
- `.env.local`
- `.env`
- `.env.ci` in CI
- `.env.runtime`
- in-code defaults

For external-tool scripts that use the shared helper wrapper (`db:*`, `docker:*`, `test:e2e*`), the file order is intentionally reversed because the underlying `dotenv-cli` behavior is first-wins in this repo:

- `.env.ci` in CI
- `.env.runtime`
- `.env.local`
- `.env`

`bun run env:runtime` now generates:

- a host-side `DATABASE_URL` that points at `localhost:${NEON_LOCAL_HOST_PORT}` with `sslmode=require`
- `DELETE_BRANCH=true` so local Neon branches are cleaned up automatically

We keep this explicit `-e` ordering instead of `dotenv -c` because `-c` would let `.env` win over `.env.local` for values like `DATABASE_URL` in this repo. `dotenv-cli` also ignores missing `-e` files, so the scripts do not need file-existence checks around `.env.runtime`.

In CI and other hosted automation, keep `.env.ci` as the tracked baseline and pass secrets through explicit environment variables instead of generating extra dotenv artifacts.

## Unit Test Lanes

- Angular component/browser-facing unit tests stay on the Angular builder via `ng test`.
- Server, database, and helper unit tests run through Vitest with `@effect/vitest`.
- The dedicated Vitest lane includes `src/server/**/*.spec.ts`, `src/db/**/*.spec.ts`, and `helpers/**/*.spec.ts`.
- It intentionally excludes `src/app/**/*.spec.ts` and everything under `tests/**` so Playwright and Angular specs stay on their existing runners.

## Deterministic E2E Environment

Playwright now defaults deterministic test values in code via
`helpers/testing/deterministic-test-defaults.ts`, so local runs do not need extra flags.

Default values:

- `E2E_NOW_ISO=2026-09-15T12:00:00.000Z`
- `E2E_SEED_KEY=evorto-e2e-default-v1`

Optional overrides:

- `E2E_NOW_ISO` (example: `2026-09-15T12:00:00.000Z`)
- `E2E_SEED_KEY` (example: `ci-e2e-seed-v1`)

Policy:

- Standard Playwright runs, including CI baseline runs, can omit both values and use the in-code defaults.
- Set either value only when you deliberately want a different deterministic seed or clock.
- Keep `E2E_NOW_ISO` ahead of the real current date. `buildCheckoutSessionExpiresAt(...)` falls back to the wall clock once the pinned value is in the past, which breaks deterministic checkout expiry behavior.

## Baseline vs Integration Projects

Playwright now separates external-service coverage with dedicated projects instead of a single global grep toggle:

- baseline projects:
  - `local-chrome-baseline`
  - `docs-baseline`
- integration-only projects:
  - `docs-integration`

There is currently no non-doc integration-only project because the repo does not yet have a functional Playwright spec that directly exercises Auth0 Management, Cloudflare Images, or Google Maps.

`E2E_MODE` still exists as a runtime contract for config validation:

- `E2E_MODE=baseline` is the default and is what CI baseline uses.
- `E2E_MODE=integration` is required when running the integration-only projects so CI/runtime validation demands the extra external-service credentials.

Integration-only coverage is tagged at the test-title level:

- `@needs-auth0-management`
- `@needs-cloudflare`
- `@needs-google-maps`

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

If `.env.runtime` is absent, local commands fall back to the checked-in env files and process env only.

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

## Stacked Delivery Workflow

Large infra and configuration changes ship as a Git Town stack instead of a single long-lived feature branch:

- keep one assembly branch for the overall initiative
- create the next reviewable phase branch with `git town append <branch-name>`
- sync the entire stack with `git town sync --stack` before starting work and before proposing review
- open PRs with `git town propose` so each branch targets its parent branch in the stack

When a phase is tracked in Linear, use the Linear branch name for that child branch and stack it on top of the current assembly branch or stack tip.
