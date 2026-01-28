# Implementation Plan — Tax Rates (Stripe-Synced, Read-Only)

## Phase 1 — Discovery & Target Alignment
- [ ] Task: Review current implementation and map to spec
    - [ ] Identify existing Stripe tax rate sync behavior
    - [ ] Identify current permissions and admin routes
    - [ ] Identify event pricing tax rate selection flow
    - [ ] Identify payment creation tax rate forwarding
    - [ ] Identify registration persistence of tax rate data
- [ ] Task: Gap analysis and alignment plan
    - [ ] List mismatches vs spec (explicit sync trigger, inclusive-only, required selection, etc.)
    - [ ] Decide needed data/model changes (if any)
    - [ ] Confirm affected screens/routes/components
- [ ] Task: Define test intent for alignment work (e2e/doc first)
    - [ ] Identify doc tests to update or add (.doc.ts)
    - [ ] Identify Playwright e2e coverage needed
- [ ] Task: Conductor - User Manual Verification 'Discovery & Target Alignment' (Protocol in workflow.md)

## Phase 2 — Stripe Tax Rate Sync (Explicit, Read-Only, Inclusive-Only)
- [ ] Task: Define sync API contract and permissions
    - [ ] Ensure `admin:tax` gating for sync + list
    - [ ] Confirm Effect Schema input/output types
- [ ] Task: Implement explicit sync trigger path
    - [ ] Add server endpoint/action for manual sync
    - [ ] Ensure read-only behavior enforced
    - [ ] Filter/reject non-inclusive tax rates
- [ ] Task: Persist synced tax rates for tenant (if needed)
    - [ ] Update data layer / models (if required)
    - [ ] Ensure inferred types propagate to clients
- [ ] Task: Add/adjust tests for sync behavior (e2e/doc)
    - [ ] Doc test for admin tax list + sync action
    - [ ] E2E for permission-gated sync
- [ ] Task: Conductor - User Manual Verification 'Stripe Tax Rate Sync' (Protocol in workflow.md)

## Phase 3 — Admin Tax Rate List (Read-Only)
- [ ] Task: Admin route wiring
    - [ ] Ensure route under `admin/` and `admin:tax` permission
- [ ] Task: UI for read-only tax rate list
    - [ ] Use Material 3 components + theme tokens
    - [ ] Show inclusive-only tax rates
    - [ ] Provide explicit “Sync from Stripe” action
- [ ] Task: Add/adjust tests for admin list
    - [ ] Doc test updates for admin list screen
    - [ ] E2E coverage for read-only list and sync action
- [ ] Task: Conductor - User Manual Verification 'Admin Tax Rate List' (Protocol in workflow.md)

## Phase 4 — Event Pricing Integration
- [ ] Task: Pricing UI rules
    - [ ] Require tax rate for paid options
    - [ ] Hide selector for free options
- [ ] Task: Tax rate selection data flow
    - [ ] Surface available inclusive tax rates in selection UI
    - [ ] Ensure type safety for selected tax rate
- [ ] Task: Add/adjust tests for pricing UI
    - [ ] Doc test updates for pricing flow
    - [ ] E2E coverage for required selection
- [ ] Task: Conductor - User Manual Verification 'Event Pricing Integration' (Protocol in workflow.md)

## Phase 5 — Payments & Registration Recording
- [ ] Task: Stripe payment creation alignment
    - [ ] Forward selected Stripe tax rate to payment
- [ ] Task: Registration persistence
    - [ ] Store tax_rate_id + snapshot fields (name, percentage, inclusive/exclusive)
    - [ ] Ensure consistent types across server/client
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
    - [ ] Run `yarn build`
    - [ ] Run `yarn e2e`
    - [ ] Run `yarn e2e:docs`
- [ ] Task: Conductor - User Manual Verification 'QA, Docs, and Final Verification' (Protocol in workflow.md)
