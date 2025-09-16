# Tasks: Inclusive Tax Rates (Tenant‑Scoped, Tax‑Inclusive Pricing)

**Input**: Design documents from `/specs/001-inclusive-tax-rates/`
**Prerequisites**: `plan.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `e2e-plan.md`, `migration.md`

## Legend & Conventions
`[P]` = Can execute in parallel (different files / no direct dependency). Tasks without `[P]` are ordered and must complete before dependents.
Each task lists primary file(s) it creates or edits. If multiple tasks would touch same file, only the first is `[ ]` (sequential) and later related tasks omit `[P]` to avoid parallel conflicts.
Numbering: T001, T002 ... (no gaps). Migration / validation / implementation strictly follow TDD: write failing tests first (E2E + contract) before implementing.

## High‑Level Dependency Order
1. Setup & Migration Scaffolding
2. Failing E2E Scenarios (RED)
3. Contract Tests (RED)
4. Model / Schema Adjustments
5. Validation & Service Logic
6. Endpoint Implementations / Enhancements
7. Frontend UI (Admin Import, Creator Forms, Labels)
8. Checkout Wiring Enhancements
9. Logging & Observability
10. Polish (unit tests, performance, docs)

---
## Phase 3.1: Setup & Migration Foundation

- [ ] T001 Create unique index DDL & idempotent migration step `migration/steps/001_add_unique_index_tenant_stripe_tax_rates.ts` (unique `(tenantId,stripeTaxRateId)`) and register in `migration/index.ts`.
- [ ] T002 Implement migration step to assign default tax rate to legacy paid options & seed sample rates (dev-only) `migration/steps/002_backfill_and_seed_tax_rates.ts` (reads `tenant.stripeReducedTaxRate`, logs each assignment, skips in production).
- [ ] T003 [P] Add new permission constant `admin:manageTaxes` and migration or seeding grant (extend role seeding) in `migration/steps/003_add_admin_manage_taxes_permission.ts` + update `src/db/schema/roles.ts` or permission mapping util.
- [ ] T004 [P] Update documentation: append migration details section to `migration.md` summarizing new steps (add verification queries) & link in `plan.md` Progress Tracking.

## Phase 3.2: Tests First (E2E Scenarios RED)
Write E2E tests exactly as spec; they MUST fail before implementation. Use new folder `e2e/tests/finance/tax-rates/` for organization where applicable.

- [ ] T005 E2E: Admin imports rates `e2e/tests/finance/tax-rates/admin-import-tax-rates.spec.ts` (covers FR-001,002,004,006,007,016,024). Ensure permission denial path.
- [ ] T006 [P] E2E: Creator paid option requires compatible rate `e2e/tests/templates/paid-option-requires-tax-rate.spec.ts` (FR-008,009,010,018) includes clone/bulk negative test.
- [ ] T007 [P] E2E: Inclusive price labels display `e2e/tests/events/price-labels-inclusive.spec.ts` (FR-011,017,022) includes fallback unresolved case placeholder (should fail until logic added).
- [ ] T008 [P] E2E: Checkout attaches tax rate & final price `e2e/tests/finance/checkout-uses-tax-rate-id.spec.ts` (FR-012,013 (happy path attach),015,021 warn assertion placeholder).
- [ ] T009 [P] E2E: Fallback when rate unavailable `e2e/tests/finance/fallback-unavailable-rate.spec.ts` (FR-013,017,021) simulate removal/inactive state.
- [ ] T010 [P] E2E: Discount reduces to zero -> treat free `e2e/tests/discounts/discount-reduces-inclusive-price.spec.ts` (FR-014 + zero threshold case).
- [ ] T011 [P] E2E: Tenant isolation for tax rates `e2e/tests/permissions/tenant-isolation-tax-rates.spec.ts` (FR-003,019).
- [ ] T012 [P] E2E: Zero percent inclusive rate explicit coverage `e2e/tests/finance/zero-percent-inclusive-rate.spec.ts` (FR-022) independent focus.
- [ ] T013 [P] E2E: Audit & logging import/unavailability `e2e/tests/finance/audit-logging-import-and-unavailability.spec.ts` (FR-021,023) capturing structured logs.

## Phase 3.3: Contract / Schema Tests (RED)
Each contract file gets a failing contract test exercising validation boundaries & permission errors. (Already some implementation exists; ensure tests assert required future behaviors like permission `admin:manageTaxes` not `admin:changeSettings`.)

- [ ] T014 Contract test: `admin.tenant.listStripeTaxRates` `tests/contract/tax-rates/admin.tenant.listStripeTaxRates.spec.ts` ensure permission gate, shape, includes incompatible (inactive/exclusive) flagged.
- [ ] T015 [P] Contract test: `admin.tenant.importStripeTaxRates` `tests/contract/tax-rates/admin.tenant.importStripeTaxRates.spec.ts` includes: rejects incompatible, counts imported/skipped.
- [ ] T016 [P] Contract test: `admin.tenant.listImportedTaxRates` `tests/contract/tax-rates/admin.tenant.listImportedTaxRates.spec.ts` verifies tenant isolation.
- [ ] T017 [P] Contract test: `taxRates.listActive` `tests/contract/tax-rates/taxRates.listActive.spec.ts` ensures only inclusive+active returned; permission rules when authenticated missing `templates:view`.
- [ ] T018 [P] Contract test: Template create/update tax validation `tests/contract/tax-rates/templates.validation.spec.ts` (all three error codes, success path).
- [ ] T019 [P] Contract test: Event create tax validation `tests/contract/tax-rates/events.create.validation.spec.ts` (same rules, codes).
- [ ] T020 [P] Contract test: Event register (checkout tax rate attach) `tests/contract/tax-rates/events.registerForEvent.spec.ts` asserts tax_rates array presence/absence, inactive warning placeholder.

## Phase 3.4: Core Data & Validation Implementation

- [ ] T021 Add unique index DDL executed by migration (verify generated SQL or manual) & ensure Drizzle schema comment note in `src/db/schema/tenant-stripe-tax-rates.ts`.
- [ ] T022 Implement permission constant & usage shift from `admin:changeSettings` to `admin:manageTaxes` in affected routers: `src/server/trpc/admin/tenant.router.ts` endpoints (listStripeTaxRates, importStripeTaxRates, listImportedTaxRates) & add meta requiredPermissions arrays.
- [ ] T023 [P] Introduce shared validation utility `src/server/utils/validate-tax-rate.ts` enforcing rules (reusable by templates/events/register) returning discriminated union with error codes.
- [ ] T024 Integrate validation in template create/update (`src/server/trpc/templates/template.router.ts`) before DB writes (fail fast) using utility (remove duplication). Add logging for validation errors.
- [ ] T025 Integrate validation in event creation procedure (`src/server/trpc/events/events.router.ts` or specific create file if exists) similarly.
- [ ] T026 Enhance register-for-event procedure (`src/server/trpc/events/register-for-event.procedure.ts`) to: (a) compute effective price already present; (b) attach tax rate (already attaches) add warning log if inactive/incompatible; (c) skip if effectivePrice<=0 treat as free (remove tax rate & set unit_amount=0).
- [ ] T027 [P] Add fallback inclusive label resolver in shared helper `src/shared/price/format-inclusive-tax-label.ts` (input: { percentage?: string|null; displayName?: string|null } | unresolved flag) → string label.
- [ ] T028 Add query for active list optimization (projection) `src/server/trpc/tax-rates/tax-rates.router.ts` limiting fields + test adjustments.

## Phase 3.5: Frontend UI Implementation

- [ ] T029 Admin UI: Tax Rates settings page component `src/app/admin/settings/tax-rates/tax-rates-page.component.ts` listing imported rates & import button (TanStack Query queries + permission guard).
- [ ] T030 [P] Admin UI: Import dialog component `src/app/admin/settings/tax-rates/import-tax-rates-dialog.component.ts` (lists provider rates, disables incompatible, multi-select, calls import mutation, refreshes lists).
- [ ] T031 [P] Creator Forms: Extend template simple mode form to include tax rate select `src/app/templates/simple-template-form.component.ts` connecting to `taxRates.listActive` (reactive control: required when isPaid, disabled when free, clears value on toggle).
- [ ] T032 [P] Creator Forms: Event creation form update `src/app/events/create-event-form.component.ts` similar behaviors.
- [ ] T033 [P] Display Layer: Reusable component/pipe `src/app/shared/components/inclusive-price-label/inclusive-price-label.component.ts` using helper; fallback label logic.
- [ ] T034 [P] Event & Template detail views integrate inclusive label component (touch each needed file; group modifications sequentially if same file else parallel). Files: `src/app/events/event-details.component.ts`, `src/app/templates/template-details.component.ts`.

## Phase 3.6: Logging & Observability

- [ ] T035 Structured log events additions `src/server/utils/logging.ts` (or existing logger) for: import.success, import.skipIncompatible, validation.error(code), checkout.inactiveRateWarning, label.fallbackUsed, migration.assignment.
- [ ] T036 [P] Emit logging calls in tenant router import endpoints & validation utility; update tests to assert log presence (E2E log capture harness if available).
- [ ] T037 [P] Emit fallback label log in display component (development mode guard optional).

## Phase 3.7: Polish & Verification

- [ ] T038 Unit tests: validation utility `tests/unit/validate-tax-rate.spec.ts` (error codes coverage, compatible path) [P].
- [ ] T039 Performance check script (simple timer around active list & import) `tests/performance/tax-rates.performance.spec.ts` ensuring <200ms average (simulate DB) (non-flaky) [P].
- [ ] T040 Documentation test (doc/spec rendering) `tests/docs/tax-rates-label.doc.ts` verifying label formatting examples (if feature helpful) [P].
- [ ] T041 Update `quickstart.md` completion checklist: mark tasks done & add any deviations.
- [ ] T042 [P] Update `e2e/tests/test-inventory.md` adding new specs & FR coverage mapping lines.
- [ ] T043 [P] Remove obsolete permission references (`admin:changeSettings` for tax endpoints) & search codebase for leftover strings.
- [ ] T044 Final verification run: all E2E + contract + unit tests green; update Progress Tracking in `plan.md` Phase 3 + 5 marks.

## Dependency Summary
- Migration steps (T001-T003) precede E2E if tests rely on schema/permission (run once; tests assume presence).
- All E2E (T005-T013) & contract tests (T014-T020) fail first before implementation tasks T021+.
- Permission switch (T022) required before contract tests expecting new permission pass (tests initially fail against old behavior).
- Validation utility (T023) required before template/event integration tasks (T024, T025) & checkout enhancement (T026).
- Frontend creator/admin components (T029-T034) depend on stable endpoints & validation.
- Logging tasks (T035-T037) after core logic & UI integrated to capture flows.
- Polish tasks (T038+) after feature behavior complete.

## Parallel Execution Guidance Examples

Example 1 (After T020 complete, start implementation wave):
```
Parallel Batch A:
  Run T023 (validation utility)
  Run T027 (label helper)
  Run T028 (active list optimization)
```
Then sequentially apply dependent tasks:
```
After T023 -> T024, T025 can proceed.
After T024+T025 -> T026.
```

Example 2 (Frontend wave after server stable):
```
Parallel Batch B:
  T029 Admin page
  T030 Import dialog
  T031 Template form
  T032 Event form
  T033 Label component
```
Then integrate labels into detail views (T034) once components exist.

Example 3 (Polish batch):
```
Parallel Batch C:
  T038 Unit tests
  T039 Performance test
  T040 Documentation test
  T042 Update test inventory
  T043 Remove obsolete permission references
```

## Task Agent Command Samples
(Adjust ID to execute specific tasks)
```
/specify run task T005
/specify run task T014
/specify run task T029
```
Where each task command would: open referenced file(s), implement described change, run relevant tests.

## Validation Checklist (Filled by Executor)
- [ ] All contracts have tests (T014-T020)
- [ ] All entities have model tasks (tenant_stripe_tax_rates already exists; index & validation tasks present T021-T023)
- [ ] All tests precede implementation (ordering maintained)
- [ ] Parallel tasks touch disjoint files
- [ ] Migration + permission changes defined
- [ ] Logging coverage tasks present
- [ ] Edge cases (0%, discount to zero, fallback) covered in tests

## Notes
- Some endpoint base implementations exist; contract tests intentionally assert enhanced permission & validation to drive refactors.
- If Stripe credentials absent in CI, E2E tests should stub provider layer (inject mock or boundary intercept) focusing on payload shapes and DB side-effects.
- Keep test data isolated per file (unique tenant slugs) for parallel safety.

---
*Generated via tasks.prompt.md using Constitution 1.0.0 guidelines.*
