# Testing Guide

## Commands

- Unit tests: `bun run test:unit`
- Functional E2E (Chromium): `bun run test:e2e --project=local-chrome`
- Documentation E2E: `bun run test:e2e:docs`

## Docker Runtime

- Start runtime stack: `bun run docker:start`
- Start runtime stack in foreground (used by Playwright webServer): `bun run docker:start:test`
- Stop runtime stack: `bun run docker:stop`
- After schema changes, apply the latest schema with `bun run db:push` before running Playwright against an existing local runtime.

`.env.development` is loaded automatically by app and tests whenever the file exists.

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

## Object Storage Environment (MinIO/R2-Compatible)

Preferred variables:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Compatible aliases also supported:

- `AWS_ENDPOINT`
- `AWS_REGION`
- `AWS_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

For local MinIO defaults used by docker-compose:

- `S3_ENDPOINT=http://minio:9000`
- `S3_REGION=us-east-1`
- `S3_BUCKET=evorto-testing`
- `S3_ACCESS_KEY_ID=minioadmin`
- `S3_SECRET_ACCESS_KEY=minioadmin`

## Other E2E Variables

Required for full Playwright flows:

- `DATABASE_URL`
- `BASE_URL` (or `PLAYWRIGHT_TEST_BASE_URL`)
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
- One of:
  - `CLOUDFLARE_IMAGES_API_TOKEN`
  - `CLOUDFLARE_TOKEN`
