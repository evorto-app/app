# Implementation Plan

## Phase 1: D0 MinIO + Endpoint-Configurable Bun S3 Client

- [x] Task: Add MinIO to local test docker stack
  - [x] Add MinIO service definition
  - [x] Add bucket-init step for test bucket creation
  - [x] Ensure `bun run docker:start` (or explicit test variant) brings storage up consistently
- [x] Task: Make S3 configuration environment-driven across environments
  - [x] Add support for endpoint/region/bucket/access/secret env vars in storage config
  - [x] Keep compatibility with R2 endpoint in production profile
  - [x] Keep MinIO path-style compatible behavior
- [x] Task: Ensure Bun-native S3 client endpoint override is used
  - [x] Confirm storage code path uses Bun S3 client only
  - [x] Remove assumptions that require Cloudflare-specific credentials in baseline E2E
- [x] Task: Update CI baseline E2E storage dependency to MinIO
  - [x] Ensure PR baseline E2E does not require Cloudflare secrets
  - [ ] Optionally add a separate manual/scheduled R2 smoke job for one upload/read check
- [ ] Task: Conductor - User Manual Verification 'D0 MinIO + Endpoint-Configurable Bun S3 Client' (Protocol in workflow.md)

## Phase 2: D2 Pinned Time/Seed + Live Clock Removal

- [x] Task: Implement reproducibility env controls
  - [x] Add `E2E_NOW_ISO` support for pinned test-time baseline
  - [x] Add `E2E_SEED_KEY` support for deterministic pseudo-random seed
  - [x] Preserve acceptable local fallback behavior
- [x] Task: Add and propagate Playwright `testClock` fixture
  - [x] Derive from `E2E_NOW_ISO` or seeded date source
  - [x] Expose typed fixture for docs and functional tests
- [x] Task: Remove `diffNow()` and other wall-clock test logic
  - [x] Refactor `tests/docs/events/register.doc.ts`
  - [x] Refactor `tests/docs/finance/inclusive-tax-rates.doc.ts`
  - [x] Remove remaining `diffNow()` usage from docs/functional tests
- [x] Task: Replace hardcoded receipt date with deterministic derived date
  - [x] Update `tests/specs/finance/receipts-flows.spec.ts`
- [x] Task: Add minimal server clock helper where test-affecting logic needs pinning
  - [x] Replace direct live-clock calls in relevant server paths
- [ ] Task: Conductor - User Manual Verification 'D2 Pinned Time/Seed + Live Clock Removal' (Protocol in workflow.md)

## Phase 3: D1 Seed Profiles + Scenario Handles + Stable Template Keys

- [x] Task: Add seed profile and scenario contract to `seedTenant`
  - [x] Add/confirm `SeedProfile` (`demo`/`test`/`docs`)
  - [x] Return `seedResult.scenario.events` handles for freeOpen/paidOpen/closedReg/past/draft
- [x] Task: Replace brittle title-based template selection
  - [x] Add stable template metadata key(s) in `helpers/add-templates.ts`
  - [x] Update `helpers/add-events.ts` to select templates by stable key
- [x] Task: Wire profiles in harness entrypoints
  - [x] Ensure per-test seeding uses `profile: 'test'`
  - [x] Ensure docs baseline seeding uses `profile: 'docs'`
  - [x] Ensure local dev seed command uses `profile: 'demo'`
- [x] Task: Surface scenario handles in debug/CI seed map logs
  - [x] Include IDs/slugs in `logSeedMap` output
- [ ] Task: Conductor - User Manual Verification 'D1 Seed Profiles + Scenario Handles + Stable Template Keys' (Protocol in workflow.md)

## Phase 4: Migrate E2E Specs to Scenario-Handle Addressing

- [x] Task: Refactor E2E tests to consume scenario handles directly
  - [x] Replace "find open event" style selection with `seedResult.scenario...`
  - [x] Remove dependence on demo realism and fuzzy discovery
- [x] Task: Add minimal helper wrappers for consistent scenario consumption
  - [x] Keep helper layer thin and explicit
- [ ] Task: Conductor - User Manual Verification 'Migrate E2E Specs to Scenario-Handle Addressing' (Protocol in workflow.md)

## Phase 5: D3 RBAC Matrix + Least-Privilege + Negative Coverage + Tenant Isolation

- [x] Task: Document user-role matrix intent
  - [x] Add clear JSDoc matrix in `helpers/user-data.ts`
- [x] Task: Convert at least 3 functional specs to least-privileged users
  - [x] Organizer/section-member for event creation flows
  - [x] Regular user for registration flows
  - [x] Admin for finance/admin flows
- [x] Task: Add table-driven permission matrix tests using `permissionOverride`
  - [x] Add capability matrix definition under `tests/support/permissions/`
  - [x] Implement iterate-and-assert allowed/denied test coverage
- [x] Task: Add negative permission tests for at least two gated features
  - [x] Assert hidden UI and/or forbidden server response where possible
- [x] Task: Replace tenant-isolation TODOs with real tax-rate separation assertions
  - [x] Assert tenant A created resource is not visible/accessible in tenant B
- [ ] Task: Conductor - User Manual Verification 'D3 RBAC Matrix + Least-Privilege + Negative Coverage + Tenant Isolation' (Protocol in workflow.md)

## Phase 6: D4 Stripe E2E-First Reliability + Idempotency/Dedupe

- [x] Task: Make most Stripe-related E2E deterministic via mirrored DB state
  - [x] Prefer seeded paid/confirmed states for finance/reporting flows
  - [x] Reduce hosted-checkout dependency to smoke-only
- [x] Task: Keep exactly 1-2 hosted checkout smoke tests and harden them
  - [x] Replace return URL timing waits with bounded polling against app/DB confirmation
  - [x] Avoid fixed sleeps and add failure diagnostics
- [x] Task: Add checkout session idempotency key
  - [x] Derive key from transaction/registration identity
  - [x] Cover retry behavior in tests (minimal unit where high leverage if needed)
- [x] Task: Add webhook event dedupe and replay safety
  - [x] Persist processed event IDs with uniqueness protection
  - [x] Duplicate webhook returns 200 and performs no duplicate side effects
- [x] Task: Add E2E API-level replay test (Playwright request + DB assertions)
  - [x] Send same webhook twice
  - [x] Assert single durable effect
- [x] Task: Externalize Stripe account id
  - [x] Replace hardcoded id with `STRIPE_TEST_ACCOUNT_ID` env var for paid seeding
- [ ] Task: Conductor - User Manual Verification 'D4 Stripe E2E-First Reliability + Idempotency/Dedupe' (Protocol in workflow.md)

## Phase 7: Documentation and Final Verification

- [x] Task: Update `docs/testing.md`
  - [x] Document exact test commands
  - [x] Document required env vars including MinIO + `E2E_NOW_ISO` + `E2E_SEED_KEY`
  - [x] Document docker start/stop instructions
- [~] Task: Run final verification
  - [x] Run `bun run test:unit` (only adjust scope if related logic changed)
  - [ ] Run `bun run test:e2e --project=local-chrome`
  - [ ] Run `bun run test:e2e:docs` (no screenshot refactor)
  - [ ] Fix regressions introduced by this track
- [ ] Task: Conductor - User Manual Verification 'Documentation and Final Verification' (Protocol in workflow.md)
