# Tasks: Registration cancellation configuration

**Input**: Design documents from `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/`
**Prerequisites**: `plan.md` (required), `research.md`, `data-model.md`, `contracts/`

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: repo sanity, dependencies, linting
   → Tests: E2E tests first (incl. documentation tests), then contract/integration as needed
   → Core: models, services, API routes, UI components/pages
   → Integration: DB, middleware, logging
   → Polish: unit tests, performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness
```

## Format: `[ID] [P?] Description`
- `[P]`: Can run in parallel (different files, no dependencies)
- Include exact absolute file paths in descriptions

## Phase 3.1: Setup
- [ ] T001 Verify workspace setup and tooling
  - Run: `yarn install && yarn lint`
  - Outcome: Lint passes; confirm Angular 20 + tRPC + Drizzle in use per `AGENTS.md`. Playwright E2E will be the only test modality for this feature.

- [ ] T002 [P] Prepare Playwright e2e folder for this feature
  - Create folder: `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/`
  - Add placeholder README for scenarios to be covered (doc test will generate canonical docs).

- [ ] T003 [P] Add domain types scaffold
  - Create: `/Users/hedde/code/duplicates/evorto/src/types/cancellation.ts`
  - Export `CancellationPolicy`, `PolicyVariant`, and helpers used by both server and client (types only; no implementation yet).

## Phase 3.2: Tests First (E2E‑first TDD) — MUST FAIL before 3.3
- [ ] T004 [P] Documentation test journey (generates docs)
  - File: `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/cancellation.doc.ts`
  - Covers: tenant policy setup, option inheritance/override, cancellation before/after cutoff, refund composition visibility, hidden actions after cutoff, reason capture.

- [ ] T005 [P] E2E happy‑path: paid cancellation before cutoff with partial fees kept
  - File: `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/happy-path.spec.ts`
  - Ensures: refund initiated with `includeTransactionFees=false`, `includeAppFees=true` per tenant default; policy summary surfaced.

- [ ] T006 [P] E2E inheritance/override matrix
  - File: `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/policy-inheritance.spec.ts`
  - Ensures: template option using tenant default vs organizer override behaves correctly when creating events and cancelling.

- [ ] T007 [P] E2E permissions and visibility
  - File: `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/permissions.spec.ts`
  - Ensures: self‑cancellation allowed by policy; cancelling others requires `events:registrations:cancel:any`; no‑refund option requires `events:registrations:cancelWithoutRefund`; actions hidden/disabled otherwise.

### If migrating legacy data (applies here)
- [ ] T00A Implement migration step(s): add fields/enums (idempotent)
  - Files (new under steps/):
    - `/Users/hedde/code/duplicates/evorto/migration/steps/004_add_tenant_cancellation_policies.ts`
    - `/Users/hedde/code/duplicates/evorto/migration/steps/005_add_option_cancellation_policy_fields.ts`
    - `/Users/hedde/code/duplicates/evorto/migration/steps/006_add_registration_policy_snapshot_and_reasons.ts`
  - Changes: Columns and enum per `data-model.md`.

- [ ] T00B [P] Backfill effective policy snapshot for existing registrations
  - File: `/Users/hedde/code/duplicates/evorto/migration/steps/007_backfill_registration_policy_snapshot.ts`
  - Logic: compute effective policy from option override or tenant default using option `isPaid` and `organizingRegistration`.

- [ ] T00C Verification checks and failure handling
  - File: `/Users/hedde/code/duplicates/evorto/migration/steps/008_verify_registration_policy_snapshot.ts`
  - Checks: counts of updated rows, null checks; safe to re‑run.

- [ ] T00D Seed updates for e2e
  - File: `/Users/hedde/code/duplicates/evorto/e2e/utils/seed.ts`
  - Add seed helpers to create tenant policies, template overrides, and registrations for test scenarios.

## Phase 3.3: Core Implementation (ONLY after tests are failing)
- [ ] T011 [P] Drizzle schema: tenants.jsonb policies
  - File: `/Users/hedde/code/duplicates/evorto/src/db/schema/tenants.ts`
  - Add `cancellationPolicies` JSONB column (nullable), typed helper.

- [ ] T012 [P] Drizzle schema: template registration options fields
  - File: `/Users/hedde/code/duplicates/evorto/src/db/schema/template-registration-options.ts`
  - Add `useTenantCancellationPolicy` (boolean, default true) and optional `cancellationPolicy` (JSONB).

- [ ] T013 [P] Drizzle schema: event registration options fields
  - File: `/Users/hedde/code/duplicates/evorto/src/db/schema/event-registration-options.ts`
  - Same fields as templates; ensure copied at event creation.

- [ ] T014 [P] Drizzle schema: registration snapshot and cancellation fields
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/db/schema/event-registrations.ts`
    - `/Users/hedde/code/duplicates/evorto/src/db/schema/global-enums.ts`
  - Add: `effectiveCancellationPolicy` JSONB, `effectivePolicySource` (varchar), `cancelledAt` (timestamp), `refundTransactionId` (varchar), `cancellationReason` (enum), `cancellationReasonNote` (text). Add `cancellationReason` enum values in `global-enums.ts`.

- [ ] T015 [P] Shared types: CancellationPolicy and helpers
  - File: `/Users/hedde/code/duplicates/evorto/src/types/cancellation.ts`
  - Define types used by Drizzle `$type`, Effect Schema, and UI summaries.

- [ ] T016 Update register‑for‑event to snapshot effective policy at purchase
  - File: `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/register-for-event.procedure.ts`
  - Resolve variant (paid/free × regular/organizer), choose tenant default or option override, and persist `effectiveCancellationPolicy` + `effectivePolicySource`.

- [ ] T017 Implement `events.cancelRegistration` procedure
  - File (new): `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/cancel-registration.procedure.ts`
  - Behavior: permission checks; evaluate snapshot cutoff vs current `event_instances.start`; compute refund amount based on fee flags; initiate Stripe refund; update registration fields; return `CancellationResult`.

- [ ] T018 Wire procedure into events router
  - File: `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/events.router.ts`
  - Add route export for `cancelRegistration` (imports T017); ensure router is exported in app router.

- [ ] T019 Tenants router: get/set policies
  - File: `/Users/hedde/code/duplicates/evorto/src/server/trpc/admin/tenant.router.ts`
  - Add `getCancellationPolicies` and `setCancellationPolicies` procedures with Effect Schema I/O and admin permission.

- [ ] T020 Template/event option policy read/write
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/server/trpc/templates/template.router.ts`
    - `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/events.router.ts`
  - Add procedures to read/write `useTenantCancellationPolicy` and `cancellationPolicy` on template and event registration options.

- [ ] T021 UI: Admin Settings → Cancellations
  - Files (new):
    - `/Users/hedde/code/duplicates/evorto/src/app/admin/cancellation-settings/cancellation-settings.component.ts`
    - `/Users/hedde/code/duplicates/evorto/src/app/admin/cancellation-settings/cancellation-settings.component.html`
    - `/Users/hedde/code/duplicates/evorto/src/app/admin/admin.routes.ts` (update to add route)
  - Implement: non‑nullable typed form, progressive disclosure (apply‑to‑all + per‑variant overrides), Material 3 + Tailwind tokens.

- [ ] T022 UI: Registration option form — inheritance + policy editor
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/app/shared/components/forms/registration-option-form/registration-option-form.ts`
    - `/Users/hedde/code/duplicates/evorto/src/app/shared/components/forms/registration-option-form/registration-option-form.html`
  - Add: `Use tenant default` toggle; when off, show editor for `CancellationPolicy` (allow cancel, cutoff days/hours, fee flags).

- [ ] T023 UI: Event registration option component — reflect policy and allow edit
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/app/events/event-registration-option/event-registration-option.component.ts`
    - `/Users/hedde/code/duplicates/evorto/src/app/events/event-registration-option/event-registration-option.component.html`
  - Show summary and allow edit per permissions; bind to new tRPC procedures.

- [ ] T024 UI: Registration details — cancel action with reason
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/app/events/event-active-registration/event-active-registration.component.ts`
    - `/Users/hedde/code/duplicates/evorto/src/app/events/event-active-registration/event-active-registration.component.html`
  - Add: policy summary; show/hide cancel action based on snapshot; reason selection (enum) with optional note; confirm dialog.

## Phase 3.4: Integration
- [ ] T025 [P] Structured logging on cancellation attempts/decisions/refunds
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/cancel-registration.procedure.ts`
    - `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/register-for-event.procedure.ts`
  - Log: policy source, cutoff evaluation, refund amount, fee inclusion flags, actor and permissions.

- [ ] T026 [P] Permission guards and UI visibility
  - Files:
    - Server: `/Users/hedde/code/duplicates/evorto/src/server/trpc/events/cancel-registration.procedure.ts`
    - Client: `/Users/hedde/code/duplicates/evorto/src/app/events/event-active-registration/event-active-registration.component.ts`
  - Ensure: guards match new permissions `events:registrations:cancel:any` and `events:registrations:cancelWithoutRefund`.

- [ ] T027 [P] Schema index and type plumbing
  - Files:
    - `/Users/hedde/code/duplicates/evorto/src/db/schema/index.ts` (export new fields if needed)
    - `/Users/hedde/code/duplicates/evorto/src/server/trpc/app-router.ts` (ensure routers expose new procedures)
  - Ensure: end‑to‑end types compile with Effect Schema.

## Phase 3.5: Polish
- [ ] T028 Performance validations
  - Verify: cancellation evaluation O(1); DB ops p95 < 200ms; refund initiation bounded by Stripe/tRPC latency.

- [ ] T029 [P] Update generated docs and feature design note
  - Files:
    - Generated from `/Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/cancellation.doc.ts`
    - Add feature README note with Material 3 references and screenshots under `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/`

- [ ] T030 Run quickstart and manual checks
  - Follow: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/quickstart.md`
  - Confirm: all acceptance criteria covered.

## Dependencies
- T004–T007 must be authored and failing before T011+.
- T011–T015 (models/types) before T016–T020 (services/endpoints).
- T016–T020 before T021–T024 (UI surfaces) and T025–T027 (integration wiring).
- Migration tasks T00A–T00D can run in parallel with tests (no implementation dependencies) but must be applied before E2E passes.
- Polish (T028–T030) after core is green.

## Parallel Execution Examples
```
# Launch test authoring in parallel (different files):
Task: "Create doc test at /Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/cancellation.doc.ts"
Task: "Create E2E happy path at /Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/happy-path.spec.ts"
Task: "Create E2E permissions at /Users/hedde/code/duplicates/evorto/e2e/tests/registration-cancellation/permissions.spec.ts"

# Launch model/schema edits in parallel after tests exist:
Task: "Edit tenants schema at /Users/hedde/code/duplicates/evorto/src/db/schema/tenants.ts"
Task: "Edit template options schema at /Users/hedde/code/duplicates/evorto/src/db/schema/template-registration-options.ts"
Task: "Edit event options schema at /Users/hedde/code/duplicates/evorto/src/db/schema/event-registration-options.ts"
Task: "Edit registrations schema at /Users/hedde/code/duplicates/evorto/src/db/schema/event-registrations.ts and global enums at /Users/hedde/code/duplicates/evorto/src/db/schema/global-enums.ts"
```

## Validation Checklist
- [ ] All entities have model tasks (tenants/options/registrations) (T011–T014)
- [ ] All tests come before implementation (sections ordered accordingly)
- [ ] Parallel tasks only modify different files
- [ ] Each task specifies exact absolute path
- [ ] Migration mapping/backfills defined; verification checks and seed updates planned (T00A–T00D)
- [ ] E2E-only test strategy acknowledged (no unit/contract tests in this plan)
