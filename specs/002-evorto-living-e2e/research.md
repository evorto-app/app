# Research: Evorto Living E2E Baseline

Date: 2025-09-13  
Spec: /Users/hedde/code/evorto/specs/002-evorto-living-e2e/spec.md  
Branch: 002-evorto-living-e2e

## Scope Confirmation
Establish deterministic, isolated, multi-tenant end-to-end (Playwright) baseline covering core journeys (account creation, template/category management, event lifecycle, free registration, roles/permissions, unlisted visibility, profile, scanning) PLUS narrative documentation generation (.doc.ts) excluding finance, tax, discounts, and paid registration for initial regression set (paid path only appears as future/omitted in baseline regression tests; its documentation journey is deferred/out-of-scope for now per user instructions to exclude finance-related flows). Payment simulation kept out until finance scope unlocked.

## Provided Execution Environment (User Arguments Ingested)
- Runner: Existing Playwright config with separate projects (docs vs functional).  
- Base URL: via PLAYWRIGHT_TEST_BASE_URL.  
- Dev server reuse: webServer settings already in config.  
- CI behavior: Same yarn commands locally (yarn e2e, yarn e2e:docs). Retries enabled on CI; single worker when CI=true.  
- Secrets: DATABASE_URL + Auth0 Management creds required only for first‑time account doc journey; skip gracefully if absent.  
- Tenant model: Fresh, per-run tenant + cookie `evorto-tenant` injection; strict isolation, idempotent seeding.  
- Baseline seed content: icons, template categories, roles (user/organizer/admin), templates, predictable events (upcoming free, upcoming paid, past) with open registration windows relative to now.  
- Exclusions: tax, discounts, finance data & assertions.  
- Auth states: Reuse existing storage states (Admin/Organizer/User/Default); refresh only if stale.  
- Optional narrative: First-time account provisioning doc tagged @needs-auth0.  
- Documentation reporter: Needs env overrides (DOCS_OUT_DIR, DOCS_IMG_OUT_DIR) with safe defaults.  
- Tagging: Out-of-scope (tax/discount/finance) excluded via tag or directory skip; invert grep in CI.  
- Artifacts: Markdown per journey + screenshots folder, uploaded as CI artifacts.  

## Decisions & Rationale
### D1: Per-Run Tenant Seeding Mechanism
- Decision: Implement a setup project (Playwright global/setup or dedicated setup test) that calls a Node helper to create tenant + seed baseline data, storing tenant id and setting cookie for subsequent projects.
- Rationale: Ensures isolation and deterministic test outcomes, satisfies FR-001 / FR-029 / FR-030.
- Alternatives: Reusing a static shared tenant (rejected: cross-run contamination risk), DB snapshot restore (heavier infra, slower).

### D2: Time-Relative Event Windows
- Decision: Seed events with start times offset from current Date.now() (e.g., +2h free, +3h paid, -2h past) and registration open now until start - 5m (ensures open state when tests run).
- Rationale: Stable assertions without reliance on wall clock minute boundaries; satisfies FR-003, FR-033, FR-037.
- Alternatives: Fixed hard-coded timestamps (fragile when crossing boundary), cron pre-seeding (adds infra complexity).

### D3: Paid Registration Path Handling (Out of Scope for Regression)
- Decision: Exclude paid path functional regression test; keep placeholder design note for future enabling. Documentation journey for paid registration removed for baseline; treat finance-related UI as absent.
- Rationale: User request to exclude finance; reduces maintenance while core baseline matures.
- Alternatives: Stub payment simulation (adds complexity to seed & harness prematurely).

### D4: Living Documentation Reporter Parameterization
- Decision: Extend current custom documentation reporter to read DOCS_OUT_DIR and DOCS_IMG_OUT_DIR with defaults (e.g., `./test-results/docs` & `./test-results/docs/images`).
- Rationale: Allows CI artifact path control; supports local exploration; satisfies FR-036.
- Alternatives: Hard-coded path (inflexible), environment-specific branching (adds complexity).

### D5: Storage State Reuse
- Decision: Pre-generate & cache storage states (JSON) keyed by role; refresh only if login flow broken or older than threshold (e.g., 24h) OR tenant mismatch (fresh tenant invalidates states that rely on tenant-scope claims—if tenant encoded, regenerate).
- Rationale: Performance & reliability; satisfies readiness and reduces flakiness.
- Alternatives: Always login (slower), global shared cookie injection (risks leakage between roles).

### D6: Tagging & Skips
- Decision: Use `test.describe.configure({ mode: 'serial' })` only for journeys needing sequential continuity (e.g., narrative doc). Tag @needs-auth0 and skip dynamically when env vars missing. Tag out-of-scope with @finance or move to `e2e/tests/finance-disabled/` not loaded by default.
- Rationale: Deterministic runs & explicit skip semantics.
- Alternatives: Conditional test registration (harder to grep), global filter logic (less explicit).

### D7: Permission Override Harness
- Decision: Provide helper (e.g., `e2e/fixtures/permissions.ts`) enabling role permission injection via backend endpoint or direct DB update inside test transaction prior to scenario.
- Rationale: Supports FR-018, FR-019, FR-039 consistently.
- Alternatives: Manual UI role editing each test (slow), broad super-admin bypass (reduces coverage fidelity).

### D8: Selector Strategy
- Decision: Prefer role + accessible name (`getByRole('button', { name: /Create Template/i })`), fallback to `data-testid` only if semantics absent; add minimal testids for ambiguous elements.
- Rationale: Resilience & readability (FR-028, FR-031).
- Alternatives: CSS nth-child (brittle), XPath (verbose).

### D9: Screenshot Capture Discipline
- Decision: Only capture at state boundaries (after form create, after list update, after registration success) and use focused locators (`locator.screenshot()`) vs full-page unless context needed.
- Rationale: Keeps docs concise & storage lean.
- Alternatives: Full-page every step (noisy, slower).

### D10: CI Workflow Integration
- Decision: Pipeline order: build deps → start services (`docker:start-test`) → run seeding/setup project → run functional regression (parallel workers except if CI=true sets 1 worker) → run docs project (serial) → upload Playwright HTML + docs artifacts.
- Rationale: Mirrors user guidelines; isolates docs after regression to avoid cross-artifact interference.
- Alternatives: Interleave docs & regression (race conditions on seed churn).

### D11: Deterministic Naming
- Decision: Use run-scoped suffix (timestamp or nanoid) for tenant and entities where uniqueness required, but categories/templates names stable base + run suffix for clarity; store the deterministic map in test context.
- Rationale: Prevent collisions (FR-029) while enabling assertion of expected names (FR-034).
- Alternatives: Pure random names (hard to assert), static names (collision risk across concurrent CI jobs).

### D12: Documentation Markdown Format
- Decision: Front matter: `---\ntitle: <Journey Title>\n---` plus optional permissions callout block; image refs relative `./images/<file>`.
- Rationale: Meets FR-040, FR-041.
- Alternatives: Additional metadata (unnecessary now).

### D13: First-Time Account Journey
- Decision: Single `.doc.ts` file with conditional `test.skip(!process.env.AUTH0_CLIENT_ID, 'Auth0 creds missing')`; cleans up created user at end via management API if creds present.
- Rationale: Avoid orphan accounts; gracefully skipped when creds absent.
- Alternatives: Always run & fail (breaks CI), maintain static seed user (not truly first-time path).

### D14: Scanning Flow Coverage
- Decision: Seed at least one registration and then simulate scan by referencing seeded registration code/ID; reflect status transition to 'attended'.
- Rationale: Validates scanning UI core behavior (FR-024, FR-025).
- Alternatives: UI-driven pre-registration inside scanning test (slower, duplicates flows).

## Open Questions Resolved
No remaining NEEDS CLARIFICATION markers; assumptions documented inline with decisions.

## Constitution Alignment
- Simplicity: Single repo project (web app already structured). Only adding test helpers + reporter param; no extra projects.  
- Libraries: Reusing existing Angular + server libs; no new abstraction layers.  
- E2E-First: All regression & doc tests authored before modifying seeding scripts where feasible; seed helpers added concurrently but assertion-first flows.  
- Migration: Not directly applicable (no legacy data transformation beyond seeding). Omit migration.md.  

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Time-based flakiness | Intermittent failures | Relative offsets + generous window margins |
| Auth state staleness | Spurious auth failures | Age + tenant consistency check & regeneration |
| Reporter path misconfig | Missing artifacts in CI | Defaults + explicit env var logging at start |
| Over-seeding or collisions | Flaky assertions | Deterministic naming map persisted in context |
| Skipped paid path leaves gap | Future coverage drift | Placeholder note + clearly tagged out-of-scope |
| Permission override complexity | Slower tests | Central helper with minimal operations |

## Summary of Outcomes
Research complete; decisions support deterministic, maintainable baseline focusing on core non-financial journeys with living documentation and clear CI artifact strategy.

## Cross-Reference Addendum (Implementation Files)
| Decision | File(s) To Create / Modify | Notes |
|----------|---------------------------|-------|
| D1, D2, D11 | `e2e/utils/seed.ts`, `e2e/setup/database.setup.ts` | Per-run tenant + event time offsets + naming map |
| D4, D12 | `e2e/reporters/documentation-reporter.ts` | Introduce env path parameters + front matter normalization |
| D5 | `helpers/user-data.ts`, `e2e/utils/generate-states.ts` | Freshness & tenant validation for storage states |
| D6 | Playwright config, test files | Tag @finance, conditional skip @needs-auth0 |
| D7 | `e2e/utils/permissions-override.ts` | Programmatic permission diffs before navigation |
| D9 | `e2e/utils/doc-screenshot.ts` | Focused screenshot helper abstraction |
| D13 | `e2e/tests/users/create-account.doc.ts` | Add Auth0 env conditional skip + cleanup logic |
| D14 | `e2e/tests/scanning/scanner.test.ts` | Functional scanning test (attendance transition) |

## Performance Measurement Placeholder
After initial implementation: record two sequential full runs (functional + docs) capturing total duration, docs overhead %, and seed duration to update this section.


## Status Update — 2025-09-13
Implemented in codebase and CI:
- T020 Unlisted visibility regression
- T021 Free registration regression
- T022 Selector normalization across suites
- T023 Screenshot helper contract
- T024 doc-screenshot helper + integration
- T025 CI workflow for baseline runs
- T026 Excluded @finance in docs runs

Pending next: T027–T030 (determinism check, quickstart adjustments if any gaps, performance metrics capture, plan gate confirmation).
