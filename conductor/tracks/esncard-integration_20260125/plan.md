# Plan: ESNcard Discounts + Validation (Finish & Align)

## Phase 1: Audit & Alignment
- [ ] Task: Inventory current ESNcard-related flows (server + client)
    - [ ] Identify external validation service integration and data flow
    - [ ] Map event pricing, registration, and scanning behavior
- [ ] Task: Define minimal data model adjustments (if needed)
    - [ ] Confirm storage for card number, expiry, and discount marker
    - [ ] Identify any breaking changes and migration steps
- [ ] Task: Document integration intent in root feature folders
    - [ ] Add/update root-level notes for server-side ESNcard integration
    - [ ] Add/update root-level notes for client-side ESNcard UX intent
- [ ] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Backend & Integration
- [ ] Task: Implement section-level toggle gating ESNcard flows
- [ ] Task: Validate ESNcard on profile save and persist expiry
- [ ] Task: Expose ESNcard pricing for event editors (RPC + schema)
- [ ] Task: Resolve lowest price at registration and mark ESNcard usage
- [ ] Task: Expose discount marker to scanning/organizer views
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: UI & User Flows
- [ ] Task: Event editor UI for ESNcard-specific prices (feature-enabled only)
- [ ] Task: Profile UI to add ESNcard number + conditional “Buy ESNcard” CTA
- [ ] Task: Registration UI shows lowest price + discount notice when applied
- [ ] Task: Scanning UI indicates ESNcard-discounted registration
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Documentation & Tests
- [ ] Task: Create/refresh realistic seed data (empty DB baseline for dev, demos, tests)
- [ ] Task: Add/refresh doc tests for ESNcard flows (profile, event editor, registration, scanning)
- [ ] Task: Add/refresh Playwright e2e coverage for validation + pricing behavior
- [ ] Task: Run full quality gates (lint/build/e2e/docs) and capture outputs
- [ ] Task: Update Knope change notes for the phase
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
