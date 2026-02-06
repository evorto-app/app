# Implementation Plan — Tax Rates (Stripe-Synced, Read-Only)

## Phase 1 — Discovery & Target Alignment

- [x] Task: Review current implementation and map to spec
  - [x] Identify existing Stripe tax rate sync behavior
  - [x] Identify current permissions and admin routes
  - [x] Identify event pricing tax rate selection flow
  - [x] Identify payment creation tax rate forwarding
  - [x] Identify registration persistence of tax rate data
- [x] Task: Gap analysis and alignment plan
  - [x] List mismatches vs spec (explicit sync trigger, inclusive-only, required selection, etc.)
  - [x] Decide needed data/model changes (if any)
  - [x] Confirm affected screens/routes/components
- [x] Task: Define test intent for alignment work (e2e/doc first)
  - [x] Identify doc tests to update or add (.doc.ts)
  - [x] Identify Playwright e2e coverage needed
- [ ] Task: Conductor - User Manual Verification 'Discovery & Target Alignment' (Protocol in workflow.md)

## Phase 2 — Stripe Tax Rate Sync (Explicit, Read-Only, Inclusive-Only)

- [x] Task: Define sync API contract and permissions
  - [x] Ensure `admin:tax` gating for sync + list
  - [x] Confirm Effect Schema input/output types
- [x] Task: Implement explicit sync trigger path
  - [x] Add server endpoint/action for manual sync
  - [x] Ensure read-only behavior enforced
  - [x] Filter/reject non-inclusive tax rates
- [x] Task: Persist synced tax rates for tenant (if needed)
  - [x] Update data layer / models (if required)
  - [x] Ensure inferred types propagate to clients
- [ ] Task: Add/adjust tests for sync behavior (e2e/doc)
  - [ ] Doc test for admin tax list + sync action
  - [ ] E2E for permission-gated sync
- [ ] Task: Conductor - User Manual Verification 'Stripe Tax Rate Sync' (Protocol in workflow.md)

## Phase 3 — Admin Tax Rate List (Read-Only)

- [x] Task: Admin route wiring
  - [x] Ensure route under `admin/` and `admin:tax` permission
- [x] Task: UI for read-only tax rate list
  - [x] Use Material 3 components + theme tokens
  - [x] Show inclusive-only tax rates
  - [x] Provide explicit "Sync from Stripe" action
- [ ] Task: Add/adjust tests for admin list
  - [ ] Doc test updates for admin list screen
  - [ ] E2E coverage for read-only list and sync action
- [ ] Task: Conductor - User Manual Verification 'Admin Tax Rate List' (Protocol in workflow.md)

## Phase 4 — Event Pricing Integration

- [x] Task: Pricing UI rules
  - [x] Require tax rate for paid options
  - [x] Hide selector for free options
- [x] Task: Tax rate selection data flow
  - [x] Surface available inclusive tax rates in selection UI
  - [x] Ensure type safety for selected tax rate
- [ ] Task: Add/adjust tests for pricing UI
  - [ ] Doc test updates for pricing flow
  - [ ] E2E coverage for required selection
- [ ] Task: Conductor - User Manual Verification 'Event Pricing Integration' (Protocol in workflow.md)

## Phase 5 — Payments & Registration Recording

- [x] Task: Stripe payment creation alignment
  - [x] Forward selected Stripe tax rate to payment
- [x] Task: Registration persistence
  - [x] Store tax_rate_id + snapshot fields (name, percentage, inclusive/exclusive)
  - [x] Ensure consistent types across server/client
- [ ] Task: Add/adjust tests for payment + registration
  - [ ] E2E coverage to verify tax rate used and persisted
  - [ ] Doc test updates if user-visible
- [ ] Task: Conductor - User Manual Verification 'Payments & Registration Recording' (Protocol in workflow.md)

## Phase 6 — QA, Docs, and Final Verification

- [ ] Task: Documentation updates and design notes
  - [ ] Update feature README design note
  - [ ] Refresh `.doc.ts` outputs
- [ ] Task: Full verification pass
  - [ ] Run `yarn lint`
  - [x] Run `yarn build`
  - [ ] Run `yarn e2e`
  - [ ] Run `yarn e2e:docs`
- [ ] Task: Conductor - User Manual Verification 'QA, Docs, and Final Verification' (Protocol in workflow.md)

## Verification Notes (2026-02-06)

- `yarn build` passes.
- `yarn lint` currently fails on pre-existing issues outside this track:
  - `src/app/shared/components/controls/editor/editor.component.ts`
  - `src/server/trpc/templates/template-category.router.ts`
  - `src/server/utils/rich-text-sanitize.ts`
  - `tests/specs/templates/templates.test.ts`
- `yarn e2e` and `yarn e2e:docs` fail in shared auth setup (`tests/setup/authentication.setup.ts`) with timeout waiting for navigation to `/events`.
