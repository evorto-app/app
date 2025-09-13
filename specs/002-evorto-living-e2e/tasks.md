# Tasks: Evorto Living E2E Baseline

Feature Directory: `specs/002-evorto-living-e2e`
Date: 2025-09-13
Branch: `002-evorto-living-e2e`

Legend:
- [P] = Can run in parallel with other [P] tasks (different files / no shared blocking dependency)
- Depends: Explicit predecessor task IDs that must complete first
- Output: Expected artifact(s) or change(s)

Guiding Rules (Applied):
- Setup before everything else
- Test-first (contract/integration/doc tests before implementation)
- Models (entity seed scaffolds) before services/helpers, before reporter refactor, before test additions that rely on them
- Independent file creations marked [P]
- Same file modifications kept sequential (no [P])

## High-Level Dependency Blocks
- Quick Run Order: A → B → C → D → E → F → G → H → I

A. Inventory & Tagging
B. Seeding & Isolation
C. Storage State Refresh
D. Permission Overrides
E. Reporter Refactor
F. Test Additions & Normalization
G. Screenshot Helper
H. CI Workflow
I. Verification & Hardening / Docs updates

---
## Task List

### Setup & Inventory
T001. Create test inventory doc [P]
- Action: Generate `e2e/tests/test-inventory.md` enumerating existing `.doc.ts` and functional tests; tag gaps.
- Depends: (none)
- Output: `e2e/tests/test-inventory.md`

T002. Tag out-of-scope finance tests (initial) 
- Action: Add `@finance` tag to all tests under `e2e/tests/finance/**` and any paid/discount flows (e.g., `profile/discounts.doc.ts`).
- Depends: T001
- Output: Updated test files with `@finance` tag

T003. Adjust paid flow steps in `events/register.doc.ts` 
- Action: Wrap paid registration steps with `test.step` + tag `@finance` ensuring free path remains baseline.
- Depends: T002
- Output: Modified `e2e/tests/events/register.doc.ts`

T004. Conditional skip for first-time account journey 
- Action: In `e2e/tests/users/create-account.doc.ts`, add `test.skip(!process.env.AUTH0_CLIENT_ID, 'Auth0 creds missing')` at top.
- Depends: T003
- Output: Updated doc test implementing dynamic skip

### Seeding & Isolation (Models / Helpers First)
T005. Seed helper skeleton test-first [P]
- Action: Add failing test `e2e/tests/seed/seed-baseline.test.ts` asserting presence of seeded tenant + categories map (will fail until helper implemented).
- Depends: T004
- Output: New failing test file

T006. Implement `e2e/utils/seed.ts` helper
- Action: Create function `seedBaseline({ runId }): Promise<SeedResult>` performing tenant/category/template/event/registration seeding with deterministic names and console map log `[seed-map]`.
- Depends: T005
- Output: `e2e/utils/seed.ts`

T007. Integrate seed into global setup
- Action: Extend existing `e2e/setup/database.setup.ts` to invoke `seedBaseline` after `setupDatabase(...)`; persist `{ runId, tenantId }` to `.e2e-runtime.json`.
- Depends: T006
- Output: Updated setup file + `.e2e-runtime.json` generation

T008. Tenant cookie fixture [P]
- Action: Update `e2e/fixtures/base-test.ts` adding fixture to set `evorto-tenant` cookie from `.e2e-runtime.json`.
- Depends: T007
- Output: Modified fixture file

### Storage State Refresh
T009. Failing test for stale state logic [P]
- Action: Add test `e2e/tests/auth/storage-state-refresh.test.ts` expecting regeneration when fake old mtime injected.
- Depends: T008
- Output: New failing test

T010. Implement freshness + tenant match logic
- Action: Update `helpers/user-data.ts` to check age (<24h) & tenant match; implement regeneration path.
- Depends: T009
- Output: Modified `helpers/user-data.ts`

T011. Create state generation script [P]
- Action: Add `e2e/utils/generate-states.ts` CLI script to (re)login roles when stale.
- Depends: T010
- Output: New script file

### Permission Overrides
T012. Failing test for permission override [P]
- Action: Add `e2e/tests/permissions/override.test.ts` verifying applying diff before navigation changes effective permissions.
- Depends: T011
- Output: New failing test

T013. Implement `permissions-override` helper
- Action: Create `e2e/utils/permissions-override.ts` with `applyPermissionDiff({ roleName, add, remove })` using DB helper.
- Depends: T012
- Output: Helper file

T014. Expose permissionOverride fixture
- Action: Update `e2e/fixtures/parallel-test.ts` adding fixture hooking into navigation.
- Depends: T013
- Output: Modified fixture file

### Reporter Refactor
T015. Failing reporter param test [P]
- Action: Add test `e2e/tests/reporter/reporter-paths.test.ts` to assert env vars adjust output dirs (will fail initially).
- Depends: T014
- Output: New failing test

T016. Refactor documentation reporter
- Action: Modify `e2e/reporters/documentation-reporter.ts` to support `DOCS_OUT_DIR`, `DOCS_IMG_OUT_DIR`, per-journey folders, path logging, optional permissions callout.
- Depends: T015
- Output: Updated reporter

T017. Front matter normalization test [P]
- Action: Add test asserting only `title` line remains and permissions callout rendered when YAML front matter includes Permissions. May require helper to parse generated md.
- Depends: T016
- Output: New test file (passes after T016 adjustments if implemented fully)

### Core Test Additions & Normalization
T018. Scanning regression test [P]
- Action: Add `e2e/tests/scanning/scanner.test.ts` (functional) verifying registration -> attendance transition.
- Depends: T017
- Output: New test file

T019. Smoke app load test [P]
- Action: Create `e2e/tests/smoke/app-load.test.ts` verifying homepage & templates list.
- Depends: T017
- Output: New smoke test

T020. Unlisted visibility test [P]
- Action: Add `e2e/tests/events/unlisted-visibility.test.ts` verifying restricted listing & direct access rules.
- Depends: T017
- Output: New test file

T021. Free registration regression test [P]
- Action: Add `e2e/tests/events/free-registration.test.ts` asserting success page & capacity decrement.
- Depends: T017
- Output: New test file

T022. Selector normalization pass (sequential)
- Action: Update existing regression tests to prefer role/text selectors; introduce minimal `data-testid` only where needed.
- Depends: T021 (ensures new tests established baseline style)
- Output: Modified existing test files

### Screenshot Helper
T023. Failing test for screenshot helper [P]
- Action: Add test ensuring helper wraps locator.screenshot & returns relative path.
- Depends: T022
- Output: New failing test

T024. Implement `doc-screenshot` helper
- Action: Create `e2e/utils/doc-screenshot.ts` and refactor any direct screenshot usage in a couple doc tests (incremental) while keeping old API re-export.
- Depends: T023
- Output: Helper file + updated doc tests

### CI Workflow
T025. CI workflow draft [P]
- Action: Create `.github/workflows/e2e-baseline.yml` with sequence: install → docker services → run functional → run docs (with tag exclusion for @finance) → upload artifacts.
- Depends: T024
- Output: New workflow file

T026. Configure finance tag exclusion
- Action: Adjust Playwright docs project or CI command to invert grep excluding @finance tagged tests.
- Depends: T025
- Output: Updated config/workflow

### Verification & Hardening
T027. Dual-run determinism check
- Action: Execute two local runs; if differences in docs or seed naming aside from runId suffix, adjust seed. (Documentation note only—update research.md with performance after).
- Depends: T026
- Output: Verified determinism notes

T028. Update quickstart with env examples
- Action: Add DOCS_OUT_DIR / DOCS_IMG_OUT_DIR examples & tag usage confirmation (if not already) to `quickstart.md`.
- Depends: T027
- Output: Modified `quickstart.md`

T029. Performance metrics entry
- Action: Record full run duration x2; append section to `research.md` Performance placeholder.
- Depends: T028
- Output: Updated `research.md`

T030. Final plan gate confirmation
- Action: Update `plan.md` Progress Tracking (Phase 3-5 partial) once tasks executed.
- Depends: T029
- Output: Modified `plan.md`

---
## Parallel Execution Guidance
Example parallel batches (after prerequisites met):
- Batch 1: T001, T005, T008 (all [P] and independent) using agents:
  - /task run T001
  - /task run T005
  - /task run T008
- Batch 2 (post T010): T011, T012, T015 (independent helpers/tests)
- Batch 3 (post T017): T018, T019, T020, T021 (new regression tests)
- Batch 4 (post T022): T023, T025 (helper test + CI workflow)

Ensure dependencies (Depends field) are satisfied before batching.

---
## File Map Reference
- Seed & Isolation: `e2e/utils/seed.ts`, `e2e/setup/database.setup.ts`, `.e2e-runtime.json`
- Storage States: `helpers/user-data.ts`, `e2e/utils/generate-states.ts`
- Permissions: `e2e/utils/permissions-override.ts`, `e2e/fixtures/parallel-test.ts`
- Reporter: `e2e/reporters/documentation-reporter.ts`
- Tests (new): scanning, smoke, unlisted, free-registration, seed, reporter-paths, front-matter, storage-state-refresh, permissions override
- Screenshot Helper: `e2e/utils/doc-screenshot.ts`
- CI: `.github/workflows/e2e-baseline.yml`

---
## Completion Definition
All tasks considered complete when:
- New tests pass (excluding intentionally failing ones until implementation steps complete)
- Reporter outputs correct directory structure with env overrides
- Two sequential full runs produce deterministic docs other than timestamp/runId suffix
- Tags & skips properly exclude finance and optional Auth0 journey
- CI workflow produces uploaded artifacts

---
## Next Steps After Tasks
Execute tasks sequentially honoring dependencies; use failing tests to drive helper & reporter implementations. After completion, proceed with performance tuning or expanding scope (finance, paid registration) in a future feature.
