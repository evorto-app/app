# Test Suite Audit Report

_Date: 2026-02-23 · Scope: system-level review of automated tests_

---

## Table of Contents

1. [How to Run Tests](#1-how-to-run-tests)
2. [Test Suite Map](#2-test-suite-map)
3. [Top 10 Brittleness Drivers](#3-top-10-brittleness-drivers)
4. [Recommended Target Architecture](#4-recommended-target-architecture)
5. [Prioritized Improvement Plan](#5-prioritized-improvement-plan)
6. [Quick Wins](#6-quick-wins)

---

## 1. How to Run Tests

### Local Development

| Tier | Command | Prerequisites |
|------|---------|---------------|
| Unit tests | `bun run test:unit` | `bun install` (uses Angular 21 built-in test builder) |
| E2E – functional | `bun run test:e2e --project=local-chrome` | Docker, database, Auth0 + Stripe env vars |
| E2E – docs | `bun run test:e2e:docs` | Same as functional; writes screenshots to `test-results/docs/` |
| E2E – UI mode | `bun run test:e2e:ui` | Same as functional; opens Playwright inspector |
| E2E – setup only | `bun run test:e2e:states` | Runs auth setup project only |

**Required environment variables** (defined in `tests/support/config/environment.ts`):

| Variable | Used for |
|----------|----------|
| `DATABASE_URL` | Neon PostgreSQL connection |
| `CLIENT_ID` / `CLIENT_SECRET` / `ISSUER_BASE_URL` / `SECRET` | Auth0 OIDC for the running app |
| `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe test-mode payment integration |
| `AUTH0_MANAGEMENT_CLIENT_ID` / `AUTH0_MANAGEMENT_CLIENT_SECRET` | Auth0 Management API (user creation/cleanup) |
| `CLOUDFLARE_*` | Cloudflare R2 + Images (required in CI) |

Start local services with `bun run docker:start` (PostgreSQL via Neon local, Stripe CLI listener). Stop with `bun run docker:stop`.

### CI (GitHub Actions)

Workflow: `.github/workflows/e2e-baseline.yml`

- Trigger: push to `main`/`develop`, pull requests, manual dispatch
- Runner: `ubuntu-latest`, timeout 60 min
- Steps: checkout → Bun 1.3.7 → install → Playwright browsers → write `.env` → Docker compose → functional tests → doc tests → upload artifacts
- Functional tests: `bun run test:e2e --project=local-chrome`
- Doc tests: `bunx playwright test --project=docs --grep-invert "@finance"` (with custom documentation reporter)
- Artifacts: `playwright-test-results` (7 days), `e2e-docs` (14 days)
- Retries: 1 (CI), 0 (local). `maxFailures: 1` on CI to fail-fast.

---

## 2. Test Suite Map

### Tier 1: Unit Tests (12 files)

Location: `src/**/*.spec.ts`

| Area | File | What it covers |
|------|------|----------------|
| Database | `src/db/database.layer.spec.ts` | Database layer integration |
| Server – R2 | `src/server/integrations/cloudflare-r2.spec.ts` | Cloudflare R2 storage |
| Server – RPC | `src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts` | Template service |
| Server – RPC | `src/server/effect/rpc/handlers/shared/rpc-error-mappers.spec.ts` | Error mapping |
| Server – RPC | `src/server/effect/rpc/handlers/handlers-coverage.spec.ts` | Handler coverage check |
| Server – RPC | `src/server/effect/rpc/handlers/finance/receipt-media.service.spec.ts` | Receipt media processing |
| Server – RPC | `src/server/effect/rpc/handlers/finance/finance.handlers.spec.ts` | Finance handlers |
| Server – RPC | `src/server/effect/rpc/handlers/users.handlers.spec.ts` | User handlers |
| Server – RPC | `src/server/effect/rpc/handlers/middleware/rpc-request-context.middleware.spec.ts` | Request context middleware |
| Server – RPC | `src/server/effect/rpc/handlers/events/event-registration.service.spec.ts` | Event registration |
| Server – RPC | `src/server/effect/rpc/handlers/events/events.handlers.spec.ts` | Event handlers |
| Client | `src/app/shared/pipes/registration-start-offset.pipe.spec.ts` | Registration offset pipe |

Runner: Angular 21 built-in test builder (`@angular/build:unit-test`). Configured in `angular.json`.

### Tier 2: E2E – Functional (18 spec files)

Location: `tests/specs/**`

| Area | File | Key flows |
|------|------|-----------|
| Smoke | `specs/smoke/load-application.test.ts` | Basic app load |
| Auth | `specs/auth/storage-state-refresh.test.ts` | Auth state freshness |
| Events | `specs/events/events.test.ts` | Create event from template |
| Events | `specs/events/free-registration.test.ts` | Free event registration E2E |
| Events | `specs/events/unlisted-visibility.test.ts` | Unlisted event visibility |
| Events | `specs/events/price-labels-inclusive.spec.ts` | Inclusive price labels |
| Templates | `specs/templates/templates.test.ts` | Template CRUD |
| Templates | `specs/templates/paid-option-requires-tax-rate.spec.ts` | Tax rate validation |
| Template categories | `specs/template-categories/template-categories.test.ts` | Category CRUD |
| Finance | `specs/finance/tax-rates/admin-import-tax-rates.spec.ts` | Stripe tax rate import |
| Finance | `specs/finance/receipts-flows.spec.ts` | Receipt submit/approve/refund |
| Permissions | `specs/permissions/tenant-isolation-tax-rates.spec.ts` | Tenant isolation (6 tests, mostly TODO) |
| Permissions | `specs/permissions/override.test.ts` | Permission diff application |
| Seed | `specs/seed/seed-baseline.test.ts` | Seed integrity validation |
| Discounts | `specs/discounts/esn-discounts.test.ts` | ESN card discounts |
| Scanning | `specs/scanning/scanner.test.ts` | QR code scanning |
| Reporting | `specs/reporting/reporter-paths.test.ts` | Reporter path validation |
| Screenshot | `specs/screenshot/doc-screenshot.test.ts` | Screenshot utility testing |

### Tier 3: E2E – Documentation (14 doc files)

Location: `tests/docs/**`

These tests generate screenshots + markdown that are consumed by a Next.js documentation app.

| Area | File | Doc coverage |
|------|------|--------------|
| Events | `docs/events/register.doc.ts` | Free + paid event registration walkthrough |
| Events | `docs/events/event-management.doc.ts` | Event list, creation, attendee management |
| Events | `docs/events/event-approval.doc.ts` | Approval workflow with rejection/resubmission |
| Events | `docs/events/unlisted-user.doc.ts` | Unlisted event user perspective |
| Events | `docs/events/unlisted-admin.doc.ts` | Unlisted event admin perspective |
| Finance | `docs/finance/inclusive-tax-rates.doc.ts` | Inclusive tax rate configuration |
| Finance | `docs/finance/finance-overview.doc.ts` | Finance overview dashboard |
| Templates | `docs/templates/templates.doc.ts` | Template management walkthrough |
| Template cat. | `docs/template-categories/categories.doc.ts` | Category management |
| Users | `docs/users/create-account.doc.ts` | Account creation flow |
| Profile | `docs/profile/user-profile.doc.ts` | User profile page |
| Profile | `docs/profile/discounts.doc.ts` | Discount cards |
| Roles | `docs/roles/roles.doc.ts` | Role management |
| Template | `docs/template.doc.ts` | Generic template doc |

Output structure (configurable via `DOCS_OUT_DIR` / `DOCS_IMG_OUT_DIR`):

```
test-results/docs/
├── images/                 # PNG screenshots (highlighted elements)
├── <group-slug>/
│   ├── index.md            # Generated markdown with embedded images
│   └── *.png               # Screenshots for that group
```

Custom reporter: `tests/support/reporters/documentation-reporter.ts` + helpers in `tests/support/reporters/documentation-reporter/`.

### Test Infrastructure

| Component | Location | Purpose |
|-----------|----------|---------|
| Fixture hierarchy | `tests/support/fixtures/` | `base-test` → `parallel-test` → `permissions-test` / `axe-test` |
| Auth setup | `tests/setup/authentication.setup.ts` | Auth0 login, storage state persistence |
| DB setup | `tests/setup/database.setup.ts` | Database reset + baseline tenant seed |
| Seed engine | `helpers/seed-tenant.ts` | Orchestrates full tenant seeding |
| Seed clock | `helpers/seed-clock.ts` | Deterministic date anchoring |
| Faker seeding | `helpers/seed-falso.ts` | Scope-based deterministic fake data |
| User data | `helpers/user-data.ts` | 6 pre-defined test users with roles |
| Stripe card | `tests/support/utils/fill-test-card.ts` | Test card 4242… form fill |
| Permissions | `tests/support/utils/permissions-override.ts` | Runtime permission mutations |
| Doc screenshots | `tests/support/reporters/documentation-reporter/take-screenshot.ts` | Element highlighting + capture |

### Tagging System

All tests are required to have one of:
- `@track(id)` — links to a tracking spec
- `@req(id)` — links to a requirement
- `@doc(id)` — links to a documentation section

Enforced by CI grep patterns and the custom documentation reporter.

---

## 3. Top 10 Brittleness Drivers

### B-01: Stripe Checkout Redirect Timeout (Critical)

**File:** `tests/docs/events/register.doc.ts:195`
**Symptom:** `page.waitForURL(/\/events/)` times out after 180 s (3 min)
**Evidence:** CI run `22284149602` failed on this exact line; failed on both initial run and retry
**Root cause:** After Stripe hosted checkout, the redirect back to the app is unreliable. Stripe's test-mode checkout page may delay the return redirect, the webhook confirming payment may arrive late, or the app may not respond quickly enough after a cold-start reconnect. The 3-minute timeout is already generous.
**Impact:** This is the **most frequent flake** observed in recent CI runs.

### B-02: Time-Coupled Event Discovery (High)

**Files:** `tests/docs/events/register.doc.ts:40-49`, `tests/docs/finance/inclusive-tax-rates.doc.ts`
**Symptom:** Tests find events by checking `openRegistrationTime.diffNow() < 0` and `closeRegistrationTime.diffNow() > 0`, meaning they only match events whose registration window spans "right now".
**Root cause:** The seed creates events relative to `getSeedDate()` (start of today UTC). Registration windows open 14 days before the event and close 2 hours before. If seed runs early in the day and the doc test runs later, or if the CI runner is slow, windows may shift. More critically, `DateTime.diffNow()` uses live clock, making results non-deterministic across different execution times.
**Impact:** Tests can fail to find matching events on some days or at certain times of day.

### B-03: Seed-Data Coupling via Template Title Matching (High)

**File:** `helpers/add-events.ts:95-115`
**Symptom:** Event creation filters templates by `.title.includes('hike')`, `.title.includes('City Tour')`, `.title.includes('Trip')`, etc.
**Root cause:** If template titles in `helpers/add-templates.ts` change, the `addEvents()` function silently produces zero events for that category and throws a generic error. The string matching is brittle and undocumented.
**Impact:** Any refactor of template names breaks event seeding, which cascades to all tests.

### B-04: Hardcoded Date in Receipt Seeding (Medium)

**File:** `tests/specs/finance/receipts-flows.spec.ts:90`
**Symptom:** `receiptDate: new Date('2026-02-01T00:00:00.000Z')` — hardcoded absolute date.
**Root cause:** When this date moves into the past relative to any future validation logic, the test may break.
**Impact:** Time bomb — will become stale over time.

### B-05: Hardcoded Stripe Account ID (Medium)

**File:** `helpers/seed-tenant.ts:20`
**Symptom:** `const defaultStripeAccountId = 'acct_1Qs6S5PPcz51fqyK'` — a real Stripe test-mode account ID baked into the seeder.
**Root cause:** If this account is deactivated, rotated, or its capabilities change, all paid-event tests break. No fallback or validation that the account is still functional.
**Impact:** Single point of failure for all Stripe-related tests.

### B-06: Incomplete Tenant Isolation Tests (Medium)

**File:** `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts`
**Symptom:** 6 tests exist but 5 of them are TODO placeholders with only `expect(heading).toBeVisible()` assertions. They test navigation, not actual isolation.
**Root cause:** The permission/isolation test strategy was scaffolded but never completed.
**Impact:** False sense of coverage — isolation bugs would not be caught.

### B-07: Single-User-Role Test Coverage (Medium)

**Files:** Most tests use `defaultStateFile` (the "all roles" user) or `adminStateFile`
**Symptom:** Almost no tests exercise the app as a `user`-role or `organizer`-role user in functional specs. The `register.doc.ts` uses `userStateFile` but is the exception.
**Root cause:** Using the admin/all-roles user bypasses permission checks. Real users with limited roles may see different UI, get 403 errors, or have hidden navigation.
**Impact:** Permission bugs are invisible in tests.

### B-08: Screenshot Instability from Animations and Timing (Low-Medium)

**File:** `tests/support/reporters/documentation-reporter/take-screenshot.ts:9`
**Symptom:** `await page.waitForTimeout(1000)` — a fixed 1-second delay before every screenshot.
**Root cause:** Angular animations, Material component transitions, and lazy-loaded content may not stabilize within 1 second. The retry logic (5 attempts) handles DOM detachment but not visual instability.
**Impact:** Doc screenshots may capture mid-animation frames, loading spinners, or partially rendered content.

### B-09: Cross-Test Event State Pollution via Registrations (Low-Medium)

**Files:** `tests/docs/events/register.doc.ts`, `tests/specs/events/free-registration.test.ts`
**Symptom:** Registration tests mutate event state (fill spots, change registration status). While `parallel-test.ts` creates a per-test tenant (via `seedTenant` with a unique `runId`), doc tests that run serially share state.
**Root cause:** The `docs` project tests share the same seeded tenant. If test A registers a user for an event, test B may not find an available spot.
**Impact:** Order-dependent failures in the `docs` project.

### B-10: Auth0 Rate Limiting and External Dependency (Low)

**File:** `tests/support/fixtures/base-test.ts:84-101`
**Symptom:** `newUser` fixture calls Auth0 Management API to create and delete users. Under parallel test execution, Auth0 rate limits may throttle requests.
**Root cause:** External service dependency in test fixtures. No retry logic for rate-limit responses.
**Impact:** Intermittent failures under high parallelism or when Auth0 has degraded performance.

---

## 4. Recommended Target Architecture

### 4.1 Test Data Strategy: Deterministic Fixtures

**Current state:** `parallel-test.ts` creates a fresh tenant per test via `seedTenant()`. This is a good foundation but the doc tests share a single baseline tenant created in `database.setup.ts`.

**Recommended approach:**

1. **Per-test tenants (functional tests):** Already implemented via `parallel-test.ts`. Keep this pattern.

2. **Shared-but-immutable tenant (doc tests):** The `docs` project should seed its own tenant in a `docs.setup.ts` file, creating a known dataset that doc tests read from but never mutate. Registration tests that need to mutate state should clone the event or use a dedicated "registration target" event.

3. **Factory functions over inline queries:** Extract event/registration/user lookup logic (currently inline in each test) into reusable factory-style helpers:

   ```typescript
   // Proposed: tests/support/factories/event-queries.ts
   export const findOpenFreeEvent = (events, userId, registrations) => { ... };
   export const findOpenPaidEvent = (events, userId, registrations) => { ... };
   ```

4. **Decouple from template titles:** Replace string-matching in `helpers/add-events.ts` with template metadata (e.g., a `category` field or tag) instead of `title.includes('hike')`.

### 4.2 Time Strategy: Stable Event-State Scenarios

**Current state:** `seed-clock.ts` anchors to start-of-day UTC. Events are created relative to this anchor. But tests query event state using `DateTime.diffNow()`, re-introducing live-clock dependency.

**Recommended approach:**

1. **Inject a test clock into fixtures:**

   ```typescript
   // Proposed: extend base-test.ts
   testClock: async ({ seedDate }, use) => {
     // All "now" references in tests use this fixed point
     await use(DateTime.fromJSDate(seedDate).plus({ hours: 12 }));
   },
   ```

2. **Replace `diffNow()` with `diff(testClock)` in test queries:**

   ```typescript
   // Before (brittle):
   DateTime.fromJSDate(option.openRegistrationTime).diffNow().milliseconds < 0
   // After (deterministic):
   DateTime.fromJSDate(option.openRegistrationTime).diff(testClock).milliseconds < 0
   ```

3. **Event-state factories:**

   ```typescript
   // Proposed: helpers/event-state-factory.ts
   export const createUpcomingEvent = (seedNow: DateTime) => { ... };
   export const createPastEvent = (seedNow: DateTime) => { ... };
   export const createClosedRegistrationEvent = (seedNow: DateTime) => { ... };
   export const createDraftEvent = (seedNow: DateTime) => { ... };
   ```

4. **Avoid hardcoded dates:** Replace `new Date('2026-02-01T00:00:00.000Z')` with `seedDate` or relative dates.

### 4.3 Stripe Strategy

**Current state:** Tests use a real Stripe test-mode account (`acct_1Qs6S5PPcz51fqyK`), Stripe CLI webhook listener in Docker, and the `4242424242424242` test card.

**Recommended tiered approach:**

| Tier | Strategy | Use case |
|------|----------|----------|
| Unit tests | **Mock Stripe SDK responses** | Validate business logic (price calculation, tax application, registration state machine) without network calls |
| Integration tests | **Stripe test mode + webhook simulation** | Validate checkout flow, webhook handling, payment intent lifecycle. Use `stripe trigger` CLI commands instead of driving the hosted checkout UI |
| E2E – functional | **Real Stripe test mode** (current approach) | Keep for smoke-level paid registration test, but reduce to 1-2 tests max |
| E2E – docs | **Record/replay or mock route** | Use `page.route()` to intercept Stripe checkout redirects and return a predictable response. This eliminates the 3-min timeout flake |

**Specific recommendations:**

1. **Add Stripe checkout mock for doc tests:** In `register.doc.ts`, after clicking "Pay now", use `page.route('**/checkout.stripe.com/**', ...)` to return a success redirect immediately. This removes the external dependency for documentation screenshots.

2. **Validate Stripe account on startup:** Add a health check in `database.setup.ts` that verifies the Stripe account is accessible before running tests.

3. **Move Stripe account ID to env var:** Replace the hardcoded `acct_1Qs6S5PPcz51fqyK` with a `STRIPE_TEST_ACCOUNT_ID` environment variable.

### 4.4 RBAC Strategy

**Current state:** 6 pre-defined users in `helpers/user-data.ts` with roles `all`, `admin`, `none`, `user`, `organizer`, `none`. The `permissionOverride` fixture allows runtime permission mutations. Most functional tests use the `all`-roles user.

**Recommended approach:**

1. **Permission matrix definition:**

   | User | Roles | Expected access |
   |------|-------|-----------------|
   | `testuser1` (all) | Admin + Section member + Trial member + Helper + Regular user | Full access — use for setup only |
   | `admin` | Admin + Regular user | Admin panel, tax rates, approvals |
   | `organizer` | Section member + Trial member + Regular user | Template view, event creation, event organizing |
   | `user` | Regular user | Event browsing, registration |
   | `testuser2` (none) | _No tenant roles_ | Should see "no access" or tenant selection |

2. **Minimum-privilege test policy:** Each functional test should use the **least-privileged user** that can perform the action, with `permissionOverride` to add only the specific permissions being tested.

3. **Negative permission tests:** For each permission-gated feature, add a test that verifies a user _without_ the permission gets an appropriate response (403, hidden UI element, redirect).

4. **Doc test permission annotations:** Each doc test should declare its required permissions in the test metadata, so the documentation reporter can include "Required permissions: ..." in the generated markdown.

   ```typescript
   test('...', async ({ ... }, testInfo) => {
     testInfo.annotations.push({
       type: 'permissions',
       description: 'events:viewPublic, events:register',
     });
   });
   ```

### 4.5 Stable Screenshot Settings for Doc Tests

**Current state:** Screenshots use full-page capture with element highlighting (pink outline). A 1-second wait precedes each capture. Animations are not explicitly disabled.

**Recommended approach:**

1. **Disable Angular animations in test mode:**

   ```typescript
   // In base-test.ts page fixture or docs setup
   await page.addStyleTag({
     content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }'
   });
   ```

2. **Wait for network idle instead of fixed timeout:**

   ```typescript
   // Replace: await page.waitForTimeout(1000);
   // With:
   await page.waitForLoadState('networkidle');
   await page.waitForTimeout(200); // minimal settling time
   ```

3. **Consistent viewport size:** Enforce a fixed viewport in `playwright.config.ts` for the `docs` project:

   ```typescript
   { name: 'docs', use: { viewport: { width: 1280, height: 720 } } }
   ```

4. **Hide dynamic content:** Use CSS injection to hide timestamps, relative-time labels ("3 hours ago"), and loading skeletons before screenshots.

5. **Font loading:** Ensure fonts are fully loaded before first screenshot with `document.fonts.ready`.

---

## 5. Prioritized Improvement Plan

### Week 1-2: Stability & Quick Wins

| # | Issue | Effort | Files to change |
|---|-------|--------|-----------------|
| 1 | **Fix Stripe checkout timeout in doc test** — Add graceful fallback (already partially done in latest code with `.catch()` pattern, but needs testing) | S | `tests/docs/events/register.doc.ts` |
| 2 | **Replace `diffNow()` with seed-relative time checks** — Pass `seedDate` into event-finding queries | S | `tests/docs/events/register.doc.ts`, `tests/docs/finance/inclusive-tax-rates.doc.ts` |
| 3 | **Remove hardcoded date in receipts test** — Use `seedDate` fixture | XS | `tests/specs/finance/receipts-flows.spec.ts:90` |
| 4 | **Extract event-finder factories** — Centralize event lookup logic | M | New file: `tests/support/factories/event-queries.ts` |
| 5 | **Add animation-disable CSS to doc screenshots** | XS | `tests/support/reporters/documentation-reporter/take-screenshot.ts` |
| 6 | **Move Stripe account ID to environment variable** | XS | `helpers/seed-tenant.ts`, `.env.local`, CI workflow |
| 7 | **Document test user permission matrix** | S | `helpers/user-data.ts` (as JSDoc) |

### Weeks 3-6: RBAC & Test Data Improvements

| # | Issue | Effort | Files to change |
|---|-------|--------|-----------------|
| 8 | **Complete tenant isolation tests** — Replace TODO placeholders with real assertions | L | `tests/specs/permissions/tenant-isolation-tax-rates.spec.ts` |
| 9 | **Add negative-permission tests** — Verify 403/hidden-UI for each permission gate | L | New spec files in `tests/specs/permissions/` |
| 10 | **Switch functional tests to least-privilege users** — Use `userStateFile` / `organizerStateFile` where appropriate | M | Multiple spec files |
| 11 | **Add doc-test permission annotations** — Attach required permissions to doc test metadata | M | All `tests/docs/**/*.doc.ts` files |
| 12 | **Create event-state factory helpers** — Upcoming, past, closed, draft scenarios | M | New file: `helpers/event-state-factory.ts` |
| 13 | **Decouple template title matching** — Use template metadata/tags instead of `title.includes()` | M | `helpers/add-events.ts`, `helpers/add-templates.ts` |

### Weeks 7+: Stripe Mocking & Advanced Isolation

| # | Issue | Effort | Files to change |
|---|-------|--------|-----------------|
| 14 | **Add Stripe route mocking for doc tests** — Eliminate external dependency for docs screenshots | L | `tests/docs/events/register.doc.ts`, new mock helper |
| 15 | **Add Stripe webhook simulation tests** — Use `stripe trigger` for payment lifecycle testing | L | New spec files, Docker compose update |
| 16 | **Create per-project tenant isolation for docs** — Separate `docs.setup.ts` with immutable seed | M | New setup file, `playwright.config.ts` |
| 17 | **Add Auth0 retry/rate-limit handling** — Backoff for Management API calls in `newUser` fixture | S | `tests/support/fixtures/base-test.ts` |
| 18 | **Add seed health-check assertions** — Verify Stripe account accessibility on seed | S | `tests/setup/database.setup.ts` |

---

## 6. Quick Wins

These 5 changes would likely reduce flakes the fastest, with minimal risk:

### QW-1: Use Seed-Relative Time Instead of `diffNow()` in Event Discovery

**Where:** `tests/docs/events/register.doc.ts:40-49`
**What:** Replace `DateTime.fromJSDate(option.openRegistrationTime).diffNow()` with `.diff(DateTime.fromJSDate(seedDate))` (seedDate is already available from the fixture).
**Why:** Removes live-clock dependency; event discovery becomes deterministic regardless of wall-clock time.

### QW-2: Remove Hardcoded Date `2026-02-01` in Receipts Test

**Where:** `tests/specs/finance/receipts-flows.spec.ts:90`
**What:** Replace `new Date('2026-02-01T00:00:00.000Z')` with `seedDate` from the test fixture (add `seedDate` to the destructured test arguments).
**Why:** Prevents the date from becoming stale; aligns with the seed-relative pattern used elsewhere.

### QW-3: Disable CSS Animations Before Doc Screenshots

**Where:** `tests/support/reporters/documentation-reporter/take-screenshot.ts`
**What:** Before the screenshot, inject a style tag that sets `animation-duration: 0s` and `transition-duration: 0s` on all elements.
**Why:** Eliminates visual instability from Material animations, reduces need for the 1-second wait.

### QW-4: Add Stripe Checkout Fallback in Paid Registration Doc Test

**Where:** `tests/docs/events/register.doc.ts:194-201`
**What:** The current code already has a graceful fallback pattern (`.catch(() => false)` with goto fallback). Ensure the test also handles the case where the Stripe redirect lands on a payment-pending page (partially done; verify the retry logic covers all branches).
**Why:** Reduces the 3-minute timeout to the configured 60-second attempt + graceful fallback.

### QW-5: Log Seed Map in CI for Debugging

**Where:** `tests/setup/database.setup.ts`
**What:** Ensure `logSeedMap: true` is set for CI runs. The seed map includes tenant domain, event titles, and paid/free status — invaluable for debugging "No event found" errors.
**Why:** When a test fails with "No paid event found", the seed map shows exactly what was seeded.

---

## Appendix A: Fixture Hierarchy

```
@playwright/test (base)
  └── base-test.ts
        ├── database (Drizzle + PG Pool)
        ├── seedDate (getSeedDate())
        ├── falsoSeed (deterministic faker)
        ├── newUser (Auth0 Management API)
        ├── tenantDomain (.e2e-runtime.json)
        └── page (tenant cookie injection)
              └── parallel-test.ts
                    ├── seeded (seedTenant() per test)
                    ├── tenant, roles, templates, events, registrations
                    ├── permissionOverride (applyPermissionDiff)
                    └── discounts (ESN card seeding)
                          ├── permissions-test.ts (re-export)
                          └── axe-test.ts (accessibility)
```

## Appendix B: Seed Data Flow

```
database.setup.ts (runs once)
  └── seedTenant(database, { domain: 'localhost', ensureUsers: true })
        ├── seedBaseUsers()              → 6 users from user-data.ts
        ├── createTenant()               → tenant with stripeAccountId
        ├── addTaxRates()                → 3 Stripe tax rates (0%, 7%, 19%)
        ├── addIcons()                   → FontAwesome icon set
        ├── addRoles()                   → 5 roles with permission sets
        ├── addUsersToRoles()            → User-role assignments
        ├── addTemplateCategories()      → Template categories
        ├── addTemplates()               → Templates with registration options
        ├── addEvents()                  → 3 events per template (past/present/future)
        ├── addRegistrations()           → Realistic registration patterns
        └── addFinanceReceipts()         → Sample finance receipts

parallel-test.ts (runs per test)
  └── seedTenant(database, { domain: 'e2e-<runId>' })
        └── (same flow as above, isolated tenant)
```

## Appendix C: Permission Definitions

From `helpers/add-roles.ts`:

| Role | Permissions | Is Default User | Is Default Organizer |
|------|------------|-----------------|---------------------|
| Admin | `ALL_PERMISSIONS` | No | No |
| Section member | `events:create`, `events:viewPublic`, `templates:view`, `internal:viewInternalPages` | No | Yes |
| Trial member | `events:create`, `events:viewPublic`, `templates:view`, `internal:viewInternalPages` | No | Yes |
| Helper | `events:viewPublic`, `templates:view`, `internal:viewInternalPages` | No | No |
| Regular user | `events:viewPublic` | Yes | No |
