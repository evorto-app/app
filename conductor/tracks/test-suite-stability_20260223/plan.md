# Implementation Plan

## Phase 1: D0 MinIO + Endpoint-Configurable Bun S3 Client

- [~] Task: Add MinIO to local test docker stack
  - [ ] Add MinIO service definition
  - [ ] Add bucket-init step for test bucket creation
  - [ ] Ensure `bun run docker:start` (or explicit test variant) brings storage up consistently
- [ ] Task: Make S3 configuration environment-driven across environments
  - [ ] Add support for endpoint/region/bucket/access/secret env vars in storage config
  - [ ] Keep compatibility with R2 endpoint in production profile
  - [ ] Keep MinIO path-style compatible behavior
- [ ] Task: Ensure Bun-native S3 client endpoint override is used
  - [ ] Confirm storage code path uses Bun S3 client only
  - [ ] Remove assumptions that require Cloudflare-specific credentials in baseline E2E
- [ ] Task: Update CI baseline E2E storage dependency to MinIO
  - [ ] Ensure PR baseline E2E does not require Cloudflare secrets
  - [ ] Optionally add a separate manual/scheduled R2 smoke job for one upload/read check
- [ ] Task: Conductor - User Manual Verification 'D0 MinIO + Endpoint-Configurable Bun S3 Client' (Protocol in workflow.md)

## Phase 2: D2 Pinned Time/Seed + Live Clock Removal

- [ ] Task: Implement reproducibility env controls
  - [ ] Add `E2E_NOW_ISO` support for pinned test-time baseline
  - [ ] Add `E2E_SEED_KEY` support for deterministic pseudo-random seed
  - [ ] Preserve acceptable local fallback behavior
- [ ] Task: Add and propagate Playwright `testClock` fixture
  - [ ] Derive from `E2E_NOW_ISO` or seeded date source
  - [ ] Expose typed fixture for docs and functional tests
- [ ] Task: Remove `diffNow()` and other wall-clock test logic
  - [ ] Refactor `tests/docs/events/register.doc.ts`
  - [ ] Refactor `tests/docs/finance/inclusive-tax-rates.doc.ts`
  - [ ] Remove remaining `diffNow()` usage from docs/functional tests
- [ ] Task: Replace hardcoded receipt date with deterministic derived date
  - [ ] Update `tests/specs/finance/receipts-flows.spec.ts`
- [ ] Task: Add minimal server clock helper where test-affecting logic needs pinning
  - [ ] Replace direct live-clock calls in relevant server paths
- [ ] Task: Conductor - User Manual Verification 'D2 Pinned Time/Seed + Live Clock Removal' (Protocol in workflow.md)

## Phase 3: D1 Seed Profiles + Scenario Handles + Stable Template Keys

- [ ] Task: Add seed profile and scenario contract to `seedTenant`
  - [ ] Add/confirm `SeedProfile` (`demo`/`test`/`docs`)
  - [ ] Return `seedResult.scenario.events` handles for freeOpen/paidOpen/closedReg/past/draft
- [ ] Task: Replace brittle title-based template selection
  - [ ] Add stable template metadata key(s) in `helpers/add-templates.ts`
  - [ ] Update `helpers/add-events.ts` to select templates by stable key
- [ ] Task: Wire profiles in harness entrypoints
  - [ ] Ensure per-test seeding uses `profile: 'test'`
  - [ ] Ensure docs baseline seeding uses `profile: 'docs'`
  - [ ] Ensure local dev seed command uses `profile: 'demo'`
- [ ] Task: Surface scenario handles in debug/CI seed map logs
  - [ ] Include IDs/slugs in `logSeedMap` output
- [ ] Task: Conductor - User Manual Verification 'D1 Seed Profiles + Scenario Handles + Stable Template Keys' (Protocol in workflow.md)

## Phase 4: Migrate E2E Specs to Scenario-Handle Addressing

- [ ] Task: Refactor E2E tests to consume scenario handles directly
  - [ ] Replace "find open event" style selection with `seedResult.scenario...`
  - [ ] Remove dependence on demo realism and fuzzy discovery
- [ ] Task: Add minimal helper wrappers for consistent scenario consumption
  - [ ] Keep helper layer thin and explicit
- [ ] Task: Conductor - User Manual Verification 'Migrate E2E Specs to Scenario-Handle Addressing' (Protocol in workflow.md)

## Phase 5: D3 RBAC Matrix + Least-Privilege + Negative Coverage + Tenant Isolation

- [ ] Task: Document user-role matrix intent
  - [ ] Add clear JSDoc matrix in `helpers/user-data.ts`
- [ ] Task: Convert at least 3 functional specs to least-privileged users
  - [ ] Organizer/section-member for event creation flows
  - [ ] Regular user for registration flows
  - [ ] Admin for finance/admin flows
- [ ] Task: Add table-driven permission matrix tests using `permissionOverride`
  - [ ] Add capability matrix definition under `tests/support/permissions/`
  - [ ] Implement iterate-and-assert allowed/denied test coverage
- [ ] Task: Add negative permission tests for at least two gated features
  - [ ] Assert hidden UI and/or forbidden server response where possible
- [ ] Task: Replace tenant-isolation TODOs with real tax-rate separation assertions
  - [ ] Assert tenant A created resource is not visible/accessible in tenant B
- [ ] Task: Conductor - User Manual Verification 'D3 RBAC Matrix + Least-Privilege + Negative Coverage + Tenant Isolation' (Protocol in workflow.md)

## Phase 6: D4 Stripe E2E-First Reliability + Idempotency/Dedupe

- [ ] Task: Make most Stripe-related E2E deterministic via mirrored DB state
  - [ ] Prefer seeded paid/confirmed states for finance/reporting flows
  - [ ] Reduce hosted-checkout dependency to smoke-only
- [ ] Task: Keep exactly 1-2 hosted checkout smoke tests and harden them
  - [ ] Replace return URL timing waits with bounded polling against app/DB confirmation
  - [ ] Avoid fixed sleeps and add failure diagnostics
- [ ] Task: Add checkout session idempotency key
  - [ ] Derive key from transaction/registration identity
  - [ ] Cover retry behavior in tests (minimal unit where high leverage if needed)
- [ ] Task: Add webhook event dedupe and replay safety
  - [ ] Persist processed event IDs with uniqueness protection
  - [ ] Duplicate webhook returns 200 and performs no duplicate side effects
- [ ] Task: Add E2E API-level replay test (Playwright request + DB assertions)
  - [ ] Send same webhook twice
  - [ ] Assert single durable effect
- [ ] Task: Externalize Stripe account id
  - [ ] Replace hardcoded id with `STRIPE_TEST_ACCOUNT_ID` env var for paid seeding
- [ ] Task: Conductor - User Manual Verification 'D4 Stripe E2E-First Reliability + Idempotency/Dedupe' (Protocol in workflow.md)

## Phase 7: Documentation and Final Verification

- [ ] Task: Update `docs/testing.md`
  - [ ] Document exact test commands
  - [ ] Document required env vars including MinIO + `E2E_NOW_ISO` + `E2E_SEED_KEY`
  - [ ] Document docker start/stop instructions
- [ ] Task: Run final verification
  - [ ] Run `bun run test:unit` (only adjust scope if related logic changed)
  - [ ] Run `bun run test:e2e --project=local-chrome`
  - [ ] Run `bun run test:e2e:docs` (no screenshot refactor)
  - [ ] Fix regressions introduced by this track
- [ ] Task: Conductor - User Manual Verification 'Documentation and Final Verification' (Protocol in workflow.md)
