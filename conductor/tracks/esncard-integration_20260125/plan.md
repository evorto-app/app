# Plan: ESNcard Discounts + Validation (Finish & Align)

## Phase 1: Audit & Alignment

- [ ] Task: Inventory current ESNcard-related flows (server + client) (51449da)
  - [ ] Identify external validation service integration and data flow
  - [ ] Map event pricing, registration, and scanning behavior
- [ ] Task: Define minimal data model adjustments (if needed) (3b29e8e)
  - [ ] Confirm storage for card number, expiry, and discount marker
  - [ ] Identify any breaking changes and migration steps
- [ ] Task: Document integration intent in root feature folders (0f55072)
  - [ ] Add/update root-level notes for server-side ESNcard integration
  - [ ] Add/update root-level notes for client-side ESNcard UX intent
- [ ] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) (deferred to Phase 4 per user)

## Phase 2: Backend & Integration

- [ ] Task: Implement section-level toggle gating ESNcard flows (93d4bed)
- [ ] Task: Validate ESNcard on profile save and persist expiry (ade941d)
- [ ] Task: Expose ESNcard pricing for event editors (RPC + schema) (c17c993)
- [ ] Task: Resolve lowest price at registration and mark ESNcard usage (d24ccd8)
- [ ] Task: Expose discount marker to scanning/organizer views (8c94c57)
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md) (deferred to Phase 4 per user)

## Phase 3: UI & User Flows

- [ ] Task: Event editor UI for ESNcard-specific prices (feature-enabled only) (a8a306e)
- [ ] Task: Profile UI to add ESNcard number + conditional “Buy ESNcard” CTA (ab96892)
- [ ] Task: Registration UI shows lowest price + discount notice when applied (7a5facf)
- [ ] Task: Scanning UI indicates ESNcard-discounted registration (8c94c57)
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md) (deferred to Phase 4 per user)

## Phase 4: Documentation & Tests

- [ ] Task: Create/refresh realistic seed data (empty DB baseline for dev, demos, tests) (c8232f4)
- [ ] Task: Add/refresh doc tests for ESNcard flows (profile, event editor, registration, scanning) (f3f68c5)
- [ ] Task: Add/refresh Playwright e2e coverage for validation + pricing behavior (f3f68c5)
- [ ] Task: Run full quality gates (lint/build/e2e/docs) and capture outputs
- [ ] Task: Update Knope change notes for the phase
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
