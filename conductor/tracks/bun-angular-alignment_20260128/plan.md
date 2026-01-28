# Implementation Plan

## Phase 1: Baseline + Inventory
- [ ] Task: Capture fresh Angular CLI + Bun baseline for comparison
    - [ ] Define test intent (likely none; analysis-only)
    - [ ] Generate a fresh Angular CLI project using Bun in a temp directory
    - [ ] Record a concise diff summary of configs/scripts vs current repo
    - [ ] Verify the comparison notes are complete and actionable
    - [ ] Commit changes (notes only, if applicable)
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Inventory Node/Express runtime usage
    - [ ] Define test intent (likely none; analysis-only)
    - [ ] Identify Node/Express entrypoints, adapters, deps, and config touchpoints
    - [ ] Map SSR server flow and route handling
    - [ ] Verify inventory is complete
    - [ ] Commit changes (notes only, if applicable)
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Baseline + Inventory' (Protocol in workflow.md)

## Phase 2: Tooling + Config Alignment
- [ ] Task: Align package manager + scripts to Bun baseline
    - [ ] Define test intent (lint/build at end of phase)
    - [ ] Update scripts/lockfiles to Bun-first workflow
    - [ ] Remove Node/Express-only scripts and dependencies
    - [ ] Verify scripts and deps align with baseline where applicable
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Align Angular workspace configs to baseline
    - [ ] Define test intent (lint/build at end of phase)
    - [ ] Review Angular Best Practices before changes
    - [ ] Update angular.json/tsconfig/eslint/prettier config to match baseline where appropriate
    - [ ] Verify SSR config remains intact
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Tooling + Config Alignment' (Protocol in workflow.md)

## Phase 3: Bun-First SSR Runtime (Remove Express)
- [ ] Task: Remove Express runtime wiring and Node-only server code
    - [ ] Define test intent (build/SSR run)
    - [ ] Remove Express entrypoints, middleware, and adapters
    - [ ] Ensure SSR server remains functional under Bun
    - [ ] Verify route setup and SSR responses remain intact
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Validate SSR routes and server startup under Bun
    - [ ] Define test intent (SSR smoke run)
    - [ ] Run SSR server and verify primary routes respond
    - [ ] Verify no regressions to route setup
    - [ ] Commit changes (if any)
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Bun-First SSR Runtime (Remove Express)' (Protocol in workflow.md)

## Phase 4: Effect Integration Across Server + Data
- [ ] Task: Introduce Effect patterns in server RPC boundaries
    - [ ] Define test intent (if needed)
    - [ ] Adapt server handlers to Effect-based flow where applicable
    - [ ] Verify behavior parity with existing RPC procedures
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Adopt Drizzle Effect/SQL integration in data access
    - [ ] Define test intent (if needed)
    - [ ] Update DB access paths to use Effect/SQL
    - [ ] Verify type safety and schema alignment
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Update shared utilities to Effect-friendly patterns
    - [ ] Define test intent (if needed)
    - [ ] Refactor shared helpers/types for Effect usage
    - [ ] Verify no type safety regressions
    - [ ] Commit changes
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Effect Integration Across Server + Data' (Protocol in workflow.md)

## Phase 5: Verification + Documentation
- [ ] Task: Run quality gates for full migration
    - [ ] Define test intent (lint/build/e2e/docs)
    - [ ] Run lint + build + e2e + e2e:docs per workflow
    - [ ] Resolve any issues
    - [ ] Commit changes (if any)
    - [ ] Attach git notes summary
    - [ ] Update plan with commit SHA
    - [ ] Commit plan update
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Verification + Documentation' (Protocol in workflow.md)
