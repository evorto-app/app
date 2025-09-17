````markdown
# Tasks: Tenant‑wide Discount Enablement with ESNcard

Input: Design docs from `/Users/hedde/code/evorto/specs/003-discount-cards-expand/`
Prerequisites present: `plan.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

Execution Flow (main)
```
1. Load plan.md, research.md, data-model.md, contracts/, quickstart.md
2. Generate tasks by category (setup → tests → core → integration → polish)
3. Apply task rules (tests before implementation; [P] for independent files)
4. Number tasks sequentially (T001, T002, ...)
5. Add dependency notes and parallel examples
```

Format: `[ID] [P?] Description`
- [P] = Can run in parallel (different files, no direct dependencies)
- Every task includes exact absolute file paths

Paths & Tech Context
- Monorepo root: `/Users/hedde/code/evorto`
- Web app (Angular 20 + Node/tRPC/Drizzle). E2E: Playwright in `/Users/hedde/code/evorto/e2e`

---

## Phase 3.1: Setup

- [ ] T001 Validate enums and provider catalog exist (no-code gate)
  - Verify `discount_type` includes `'esnCard'` and `discount_card_status` exists in `/Users/hedde/code/evorto/src/db/schema/global-enums.ts`.
  - Verify provider catalog and ESN adapter presence in `/Users/hedde/code/evorto/src/server/discounts/providers/index.ts`.
  - Dependency notes: Enables later tasks; no code changes required if present.

- [ ] T002 [P] Prepare E2E test directories for this feature
  - Create folders under `/Users/hedde/code/evorto/e2e/tests/discounts/` and `/Users/hedde/code/evorto/e2e/tests/contracts/discounts/` if missing.
  - Add a shared E2E fixture scaffold if needed at `/Users/hedde/code/evorto/e2e/fixtures/discounts-fixtures.ts` (import existing auth/storage-state helpers).

---

## Phase 3.2: Tests First (E2E‑first TDD) — MUST FAIL before Phase 3.3

Contract tests (1 per contract file)
- [ ] T003 [P] Contract test: discounts.catalog → `getTenantProviders`
  - File: `/Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.catalog.spec.ts`
  - Assert output schema: `{ type: 'esnCard', status: 'enabled'|'disabled', config: object }[]`

- [ ] T004 [P] Contract test: discounts.setTenantProviders (permissions + validation)
  - File: `/Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.setTenantProviders.spec.ts`
  - Assert admin requirement; update persists to `tenants.discount_providers` JSONB; invalid config rejected.

- [ ] T005 [P] Contract test: discounts.cards (getMyCards, upsertMyCard, deleteMyCard)
  - File: `/Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.cards.crud.spec.ts`
  - Assert immediate validation on upsert; uniqueness `(type, identifier)` enforced; provider disabled blocks upsert; delete removes user’s card.
  - **Status**: Blocked in automation until stable ESNcard test identifiers are available (flows currently skipped in Playwright).

- [ ] T006 [P] Contract test: events.pricing.selection applied during `registerForEvent`
  - File: `/Users/hedde/code/evorto/e2e/tests/contracts/events/events.pricing.selection.spec.ts`
  - Assert: lowest eligible discount chosen; tie‑breakers; validity on event start; free path sets confirmed and writes snapshot.

- [ ] T007 [P] Contract test: templates.discounts.duplication on event create from template
  - File: `/Users/hedde/code/evorto/e2e/tests/contracts/templates/templates.discounts.duplication.spec.ts`
  - Assert: `template_registration_options.discounts` JSON copied to corresponding `event_registration_options.discounts`.

Integration/E2E documentation tests (user journeys from quickstart)
- [ ] T008 [P] Documentation test: end‑to‑end journey
  - File: `/Users/hedde/code/evorto/e2e/tests/discounts/discounts.doc.ts`
  - Steps: admin enables ESN; user adds/validates ESN card; create template with ESN discounted price; create event from template; register and see discounted/zero price; participants list shows discount; toggle ESN off then ensure new card upsert blocked.
  - **Status**: Blocked pending deterministic ESNcard test numbers; doc test currently short‑circuits when numbers are unavailable.

- [ ] T009 [P] E2E: permissions and visibility
  - File: `/Users/hedde/code/evorto/e2e/tests/discounts/discounts-permissions.spec.ts`
  - Assert non‑admins cannot call `setTenantProviders`; profile UI respects provider disabled state (CTA visibility per config).

- [ ] T010 [P] E2E: pricing edge cases
  - File: `/Users/hedde/code/evorto/e2e/tests/discounts/discounts-pricing-edges.spec.ts`
  - Assert: tie‑breaker equals base → prefer base; otherwise alphabetical by provider type; validity on event start date filter.

If migrating legacy data (TypeScript ETL)
- [ ] T00A [P] Migration step: consolidate option discounts into JSONB
  - File: `/Users/hedde/code/evorto/migration/steps/discounts-consolidate-option-discounts.ts`
  - Read from `template_registration_option_discounts` and `event_registration_option_discounts`; write deterministic JSON arrays to new `discounts` fields.

- [ ] T00B [P] Migration step: backfill registration snapshots
  - File: `/Users/hedde/code/evorto/migration/steps/registration-snapshots-backfill.ts`
  - Compute base vs paid and infer `appliedDiscountType`, `appliedDiscountedPrice`, `discountAmount` per `/specs/003-discount-cards-expand/migration.md`.

- [ ] T00C Migration verification & reporting
  - File: `/Users/hedde/code/evorto/migration/steps/discounts-migration-verify.ts`
  - Counts, spot checks, anomaly CSV; idempotency checks.

- [ ] T00D [P] Update seeds/helpers for testability (if needed)
  - Files: `/Users/hedde/code/evorto/helpers/*.ts` and `/Users/hedde/code/evorto/migration/index.ts`
  - Ensure minimal data to exercise discounts in e2e.

---

## Phase 3.3: Core Implementation (ONLY after tests are failing)

Data model changes (Drizzle)
- [ ] T011 [P] Add `discounts` JSONB to template options
  - File: `/Users/hedde/code/evorto/src/db/schema/template-registration-options.ts`
  - Field: `discounts?: Array<{ discountType: 'esnCard'; discountedPrice: number }>` (JSONB) with validation helpers.

- [ ] T012 [P] Add `discounts` JSONB to event options
  - File: `/Users/hedde/code/evorto/src/db/schema/event-registration-options.ts`
  - Same shape as template; ensure serialization and typing.

- [ ] T013 [P] Add snapshot columns to registrations
  - File: `/Users/hedde/code/evorto/src/db/schema/event-registrations.ts`
  - Columns: `basePriceAtRegistration` (int, NOT NULL), `appliedDiscountType` (enum, nullable), `appliedDiscountedPrice` (int, nullable), `discountAmount` (int, nullable).

- [ ] T014 Update schema index & exports
  - File: `/Users/hedde/code/evorto/src/db/schema/index.ts`
  - Export updated models; add any needed relations/types.

Server (tRPC + services)
- [ ] T015 Implement `discounts.setTenantProviders` with Effect Schema validation and permission checks
  - File: `/Users/hedde/code/evorto/src/server/trpc/discounts/discounts.router.ts`
  - Input schema: `{ providers: Array<{ type: 'esnCard', status: 'enabled'|'disabled', config: unknown }> }`; persist to `tenants.discount_providers`.

- [ ] T016 Implement/normalize `discounts.getTenantProviders`
  - File: `/Users/hedde/code/evorto/src/server/trpc/discounts/discounts.router.ts`
  - Normalize DB JSON against hard‑coded catalog in `/Users/hedde/code/evorto/src/server/discounts/providers/index.ts`.

- [ ] T017 Implement user card CRUD + validation (getMyCards, upsertMyCard, deleteMyCard)
  - File: `/Users/hedde/code/evorto/src/server/trpc/discounts/discounts.router.ts`
  - Upsert triggers provider adapter validation immediately; enforce platform‑wide `(type, identifier)` uniqueness and provider‑enabled guard.

- [ ] T018 Ensure ESN provider adapter behavior and error mapping
  - File: `/Users/hedde/code/evorto/src/server/discounts/providers/index.ts`
  - Timeouts, unavailable → `unverified` with actionable message; map expiration to `validTo`.

- [ ] T019 Pricing selection + snapshot in registration flow
  - File: `/Users/hedde/code/evorto/src/server/trpc/events/register-for-event.procedure.ts`
  - Filter credentials by provider enabled and validity on event start; tie‑breakers; zero‑price → immediate confirm; persist all snapshot columns.

- [ ] T020 Duplicate template discounts JSON to event options on event create
  - File: `/Users/hedde/code/evorto/src/server/trpc/templates/template.router.ts`
  - When creating an event from a template, copy `discounts` arrays to the new option IDs.

- [ ] T021 Input/output validation with Effect Schema for all above procedures
  - Files: `/Users/hedde/code/evorto/src/server/trpc/discounts/discounts.router.ts`, `/Users/hedde/code/evorto/src/server/trpc/events/register-for-event.procedure.ts`, `/Users/hedde/code/evorto/src/server/trpc/templates/template.router.ts`

- [ ] T022 Structured logging for provider toggles, validation calls, pricing selection
  - Files: same as T015–T020; include timings and outcomes.

Client (Angular 20)
- [ ] T023 Admin: Discounts settings UI (enable/disable + config)
  - Add component: `/Users/hedde/code/evorto/src/app/admin/discounts-settings/discounts-settings.component.ts`
  - Wire route & navigation: `/Users/hedde/code/evorto/src/app/admin/admin.routes.ts`
  - Use Material 3 + Tailwind tokens; call `discounts.getTenantProviders`/`setTenantProviders`.

- [ ] T024 Profile: Discount cards manager UI
  - Update: `/Users/hedde/code/evorto/src/app/profile/user-profile/user-profile.component.ts`
  - Show ESN section when enabled; CRUD via tRPC; display validation status and CTA (configurable).

- [ ] T025 Templates: Registration option form — add ESN discounted price field(s)
  - Update: `/Users/hedde/code/evorto/src/app/shared/components/forms/registration-option-form/registration-option-form.ts`
  - Non‑nullable typed reactive controls; enforce `discountedPrice <= base price` client‑side (server also validates).

- [ ] T026 Events: Price display and warnings
  - Update: `/Users/hedde/code/evorto/src/app/events/event-details/event-details.component.ts`
  - Show discounted price when applicable; warn if user card expires before event start.

---

## Phase 3.4: Integration & Middleware

- [ ] T027 Ensure DB integrations for new fields (queries, inserts, updates)
  - Files: `/Users/hedde/code/evorto/src/server/trpc/**/*.ts` touching events/templates/discounts; update Drizzle selects/inserts to include new JSONB and snapshot columns.

- [ ] T028 Auth/permissions middleware for `setTenantProviders`
  - Files: `/Users/hedde/code/evorto/src/server/middleware/*.ts`, `/Users/hedde/code/evorto/src/server/trpc/discounts/discounts.router.ts`
  - Require `admin:changeSettings`.

- [ ] T029 Request/response logging
  - Files: `/Users/hedde/code/evorto/src/server/utils/*` or directly in procedures; ensure no PII in logs.

---

## Phase 3.5: Polish

- [ ] T030 [P] Unit tests for pricing selection pure logic (extract function and test)
  - Files: add `/Users/hedde/code/evorto/src/server/trpc/events/pricing-selection.spec.ts` (or co‑located spec) covering tie‑breakers and validity filter.

- [ ] T031 Performance validations
  - Smoke timing: DB queries under p95 200ms; registration flow pricing selection remains O(n) over discounts; capture basic timings in logs.

- [ ] T032 [P] Documentation updates & preview assets
  - Ensure `.doc.ts` test generates docs; capture screenshot or rendered markdown snippet for PR.

- [ ] T033 Cleanup old table usage (defer drop)
  - Remove code paths relying on per‑option discount tables; mark tables for later removal after migration verification (no schema drop in this iteration).

- [ ] T034 Run quickstart.md end‑to‑end manually
  - Follow `/Users/hedde/code/evorto/specs/003-discount-cards-expand/quickstart.md`; ensure behavior and copy matches.

---

## Dependencies
- Phase 3.2 tests (T003–T010) before Phase 3.3 implementation (T011+)
- Data model tasks (T011–T014) unblock server tasks (T015–T022)
- Server tasks unblock client UI tasks (T023–T026)
- Middleware/auth (T028) required for protected routes
- Migration tasks (T00A–T00D) can run in parallel with tests but before any deprecation cleanup

---

## Parallel Execution Examples

Launch contract tests together ([P] tasks on different files):
```
Task: "Create /Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.catalog.spec.ts and implement assertions"
Task: "Create /Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.setTenantProviders.spec.ts and implement assertions"
Task: "Create /Users/hedde/code/evorto/e2e/tests/contracts/discounts/discounts.cards.crud.spec.ts and implement assertions"
Task: "Create /Users/hedde/code/evorto/e2e/tests/contracts/events/events.pricing.selection.spec.ts and implement assertions"
Task: "Create /Users/hedde/code/evorto/e2e/tests/contracts/templates/templates.discounts.duplication.spec.ts and implement assertions"
```

Build core DB model changes in parallel ([P], different files):
```
Task: "Update /Users/hedde/code/evorto/src/db/schema/template-registration-options.ts to add discounts JSONB"
Task: "Update /Users/hedde/code/evorto/src/db/schema/event-registration-options.ts to add discounts JSONB"
Task: "Update /Users/hedde/code/evorto/src/db/schema/event-registrations.ts to add snapshot columns"
```

Run E2E suites in parallel ([P]):
```
Task: "Run Playwright doc test /Users/hedde/code/evorto/e2e/tests/discounts/discounts.doc.ts"
Task: "Run Playwright spec /Users/hedde/code/evorto/e2e/tests/discounts/discounts-permissions.spec.ts"
Task: "Run Playwright spec /Users/hedde/code/evorto/e2e/tests/discounts/discounts-pricing-edges.spec.ts"
```

---

## Validation Checklist
- All contracts have corresponding tests (T003–T007)
- All entities/fields have model tasks (T011–T014)
- All tests scheduled before implementation
- [P] tasks touch different files only
- Every task specifies absolute file path(s)
- Migration steps planned with verification (T00A–T00D)

````
