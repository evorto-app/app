# Track Spec: E2E-First Test Overhaul (Determinism + Scenarios + RBAC + Stripe + R2 via MinIO)

## Overview

Stabilize and simplify the test suite with an E2E-first architecture: deterministic seed/data/time behavior, scenario-driven fixtures, least-privilege RBAC coverage, replay-safe Stripe handling, and local S3-compatible storage via MinIO for default test runs.

## Testing Philosophy and Scope

- Primary verification remains Playwright E2E for high-level behavior.
- No separate integration-test tier should be introduced.
- API/server validation should be implemented as Playwright E2E (request + DB assertions), not as a separate framework/suite.
- Unit tests are allowed only when high leverage for complex logic (for example idempotency helpers or clock utilities); avoid broad unit expansion.
- Docs screenshot/reporting tooling is out of scope and must not be refactored.

## Functional Requirements

### D0: Storage Determinism with MinIO (R2-compatible via Bun S3 client)

- Add MinIO to the local docker test stack (existing `docker:start` flow or a dedicated test variant):
  - MinIO service.
  - Bucket initialization step for test bucket creation.
- Make storage configuration env-driven and compatible with both MinIO and R2:
  - endpoint, region, bucket, access key, secret key.
- Ensure app storage integration uses Bun-native S3 client with endpoint override (no AWS SDK migration).
- Update baseline PR CI E2E to use MinIO by default so Cloudflare R2 secrets are not mandatory for PR runs.
- Optional: add a separate manual/scheduled R2 smoke check with one minimal upload/read flow.

Acceptance:
- Default E2E runs perform real object operations against MinIO without Cloudflare secrets.

### D1: Seed Profiles + Scenario Handles

- Add/maintain `SeedProfile = 'demo' | 'test' | 'docs'` in seeding.
- Update `seedTenant({ profile })` to return deterministic scenario handles consumed by tests, at minimum:
  - `scenario.events.freeOpen: { eventId, optionId }`
  - `scenario.events.paidOpen: { eventId, optionId }`
  - `scenario.events.closedReg: { eventId, optionId }`
  - `scenario.events.past: { eventId }`
  - `scenario.events.draft: { eventId }`
- Replace brittle title-matching seed logic:
  - Remove `.title.includes(...)` template selection in `helpers/add-events.ts`.
  - Add stable template metadata key(s) in `helpers/add-templates.ts` and select by key.
- Wire profiles to harness:
  - per-test tenant seeding uses `profile: 'test'`.
  - docs baseline tenant uses `profile: 'docs'`.
  - dev seed command uses `profile: 'demo'`.
- Ensure seed map logs include scenario handles for debug/CI diagnostics.

Acceptance:
- E2E tests reference `seedResult.scenario...` handles rather than fuzzy discovery.

### D2: Pin and Propagate Test Time

- Add reproducibility env controls:
  - `E2E_NOW_ISO` for pinned effective now.
  - `E2E_SEED_KEY` for pinned pseudo-random seed.
- Policy:
  - CI/docs runs set both to stable constants.
  - local dev may use daily fallback where desired.
- Add Playwright `testClock` fixture derived from `E2E_NOW_ISO` or `seedDate`.
- Remove wall-clock test logic:
  - eliminate all `diffNow()` usage in docs/functional tests.
  - explicitly fix docs register + inclusive-tax-rates test files.
- Replace hardcoded receipt-date literal with seed-relative/testClock-relative date.
- If server logic affecting tests depends on live clock (`Date.now`/`DateTime.local`), add minimal clock helper to read `E2E_NOW_ISO` in test mode.

Acceptance:
- Docs/functional behavior remains stable regardless of wall-clock runtime.

### D3: RBAC Least Privilege + Matrix + Negative Coverage

- Document intended test user matrix in `helpers/user-data.ts`.
- Convert at least three functional specs to least-privileged actors:
  - organizer/section-member for event creation.
  - regular user for registration flows.
  - admin for finance/admin flows.
- Build table-driven permission matrix using existing `permissionOverride` fixture:
  - capabilities, required permissions, target route/UI signal, allowed/denied expectations.
- Add negative-permission coverage for at least two gated features:
  - UI hidden and/or forbidden response where feasible.
- Upgrade tenant-isolation tax-rates spec from placeholders to real assertions.

Acceptance:
- Core flows no longer default to all-roles/admin users.
- Matrix and negative tests expose permission regressions clearly.

### D4: Stripe E2E-First Reliability + Replay Safety

#### D4.1 Most E2E flows should not require hosted checkout

- Prefer seeded mirrored DB transaction states (`paid`/`confirmed`) for most E2E finance/reporting assertions.

#### D4.2 Keep only 1-2 real hosted Checkout smoke tests

- Retain minimal real testmode checkout confidence path.
- Harden smoke flow:
  - do not rely on return URL timing.
  - poll DB/app confirmation state until success/timeout.
  - no arbitrary sleeps.

#### D4.3 Add correctness hardening for idempotency/replay

- Add checkout session idempotency key derived from transaction/registration identity.
- Add webhook event dedupe:
  - persist processed `event.id` with unique constraint.
  - duplicate event returns 200 with no repeated side effects.
- Add E2E API-level replay test (Playwright request + DB assertions) sending same webhook twice and asserting single effect.
- Replace hardcoded Stripe account id with `STRIPE_TEST_ACCOUNT_ID` env var for paid seeding.

Acceptance:
- Hosted checkout smoke no longer flakes on redirect timing.
- Replayed webhook deliveries are idempotent and side-effect safe.

## Non-Functional Requirements

- Preserve required tagging (`@track`, `@req`, `@doc`) in test files.
- Do not weaken/delete tests to force green runs.
- Keep production-side changes minimal and documented when needed for clock/idempotency/dedupe correctness.
- Stripe remains testmode-only for automated test runs.

## Requirements to Verification Mapping

- D0: verify object storage read/write path against MinIO during default E2E runs.
- D1: verify scenario-handle based test addressing and no title-based seed coupling.
- D2: verify deterministic behavior across wall-clock execution times with pinned seed/time.
- D3: verify least-privilege usage and matrix-based permission assertions including negative cases.
- D4: verify E2E-first Stripe confidence path (seeded mirror for most tests + minimal hosted smoke) and webhook replay safety.

## Acceptance Criteria

1. Default PR E2E can run without Cloudflare secrets and uses MinIO object storage.
2. Bun S3 client path is endpoint-configurable for MinIO and R2.
3. Seeding returns deterministic scenario handles used directly by E2E tests.
4. Template title-based seed selection is removed.
5. `E2E_NOW_ISO` and `E2E_SEED_KEY` are supported and documented.
6. `diffNow()`-based test discovery is removed from docs/functional tests.
7. Hardcoded receipt date is replaced by derived deterministic time.
8. At least three specs run under least-privilege roles.
9. Table-driven permission matrix coverage exists.
10. At least two negative permission tests verify denied behavior.
11. Tax-rate tenant isolation test has real cross-tenant assertions.
12. Most Stripe-related E2E flows rely on deterministic mirrored state, not hosted checkout.
13. Exactly 1-2 hosted Stripe checkout smoke tests remain and are polling-hardened.
14. Checkout session creation is idempotent for retries.
15. Webhook event replay is deduped and safe.
16. Stripe account id is env-configured (`STRIPE_TEST_ACCOUNT_ID`) and not hardcoded.
17. Updated docs include commands, env vars (including MinIO and reproducibility), and docker start/stop instructions.

## Out of Scope

- Docs screenshot styling/highlighting/reporting refactors.
- Unrelated product feature development.
- Stripe live-mode credentials/flows.
