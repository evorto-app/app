# Plan: Signal Forms Migration (Top-Down, compatForm When Needed)

## Phase 1: Audit & Migration Map

- [x] Task: Inventory all forms and custom controls (4891566)
  - [x] List all reactive forms, validators, and async flows
  - [x] Identify all custom controls and any CVA-based controls
- [x] Task: Define migration order and compatForm usage (5f71b60)
  - [x] Migration map captured in `conductor/tracks/signal-forms-migration_20260125/migration-map.md`
  - [x] Decide where compatForm is required vs native Signal Forms
  - [x] Note any high-risk forms that need special handling
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) (e9a4288)

## Phase 2: Core Form Model Migration

- [x] Task: Migrate form models to Signal Forms (top-down) (debce74)
  - [x] Replace FormBuilder/FormGroup/FormControl with signal forms models
  - [x] Ensure validators and async flows are preserved
- [x] Task: Introduce compatForm only where needed (n/a)
  - [x] Bridge legacy controls/groups that cannot be migrated yet
- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md) (f060dfd)

## Phase 3: Custom Controls Migration

- [x] Task: Migrate custom controls to Signal Forms interfaces (533e419)
  - [x] Implement FormValueControl/FormCheckboxControl
  - [x] Replace CVA usage where applicable
  - [x] Ensure [formField] bindings work for all controls
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Template & Styling Alignment

- [ ] Task: Update templates to Signal Forms bindings
  - [ ] Replace formGroup/formControlName usage
  - [ ] Ensure validation messaging still works
- [ ] Task: Remove legacy status class reliance
  - [ ] Update styles and UI logic that depended on ng-\* classes
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)

## Phase 5: Documentation & Tests

- [ ] Task: Update doc tests and screenshots for migrated forms
- [ ] Task: Update Playwright e2e coverage for key form flows
- [ ] Task: Run full quality gates (lint/build/e2e/docs) and capture outputs
- [ ] Task: Update Knope change notes for the phase
- [ ] Task: Conductor - User Manual Verification 'Phase 5' (Protocol in workflow.md)
