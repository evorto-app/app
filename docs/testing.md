# Testing Guide

## Commands

- Unit tests: `bun run test:unit`
- Functional E2E (Chromium): `bun run test:e2e --project=local-chrome`
- Documentation E2E: `bun run test:e2e:docs`

## Docker Runtime

- Start runtime stack: `bun run docker:start`
- Start runtime stack in foreground (used by Playwright webServer): `bun run docker:start:test`
- Stop runtime stack: `bun run docker:stop`
- Local docker runs now use a real Postgres container, not `neon_local`.
- `docker:*` and `db:*` commands generate `.env.runtime` automatically before they run.
- `bun run db:push` applies schema only.
- `bun run db:setup` ensures schema exists, then resets and seeds the local database.
- `bun run db:reset` is now an alias for `bun run db:setup`.

Config now resolves in this precedence order:

- real environment variables
- `.env.local`
- `.env`
- `.env.runtime`
- in-code defaults

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
- distinct local Postgres port
- distinct local MinIO ports

The local app port intentionally stays at `4200` by default because the current Auth0 local callback configuration expects `localhost:4200`. That means:

- database and object-storage state can be isolated per worktree
- fully authenticated browser stacks still need the shared `4200` app port unless Auth0 callback settings are expanded

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
