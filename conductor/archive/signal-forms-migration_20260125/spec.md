# Spec: Signal Forms Migration (Top-Down, compatForm When Needed)

## Overview

Migrate all existing forms to Angular Signal Forms using a top-down approach. Prefer native Signal Forms for migrated code, and use `compatForm` only when legacy `FormControl`/`FormGroup` integration is required. (Guide: `https://angular.dev/guide/forms/signals/migration`)

## Functional Requirements

### Migration Scope

- Migrate all existing forms in the codebase to Signal Forms.
- Prefer native Signal Forms APIs for new form models.
- Use `compatForm` only for legacy controls/groups that cannot be reasonably replaced yet. (Guide: `https://angular.dev/guide/forms/signals/migration`)

### Custom Controls

- Migrate all custom form controls to Signal Forms.
- Follow Angular's Signal Forms custom control guidance. (Guide: `https://angular.dev/guide/forms/signals/custom-controls`)

### Form Model & Template Updates

- Replace reactive form model definitions with Signal Form models.
- Update templates to bind to Signal Form fields.
- Ensure validators and async behaviors are preserved or re-implemented.

### Styling & Status Indicators

- Do not preserve legacy status classes (`ng-valid`, `ng-dirty`, etc.).
- Update any styles or UI logic that relied on those classes to Signal-Forms-appropriate patterns.

### Documentation & Testing

- Update documentation tests and e2e flows to reflect Signal Forms.
- Run full quality gates (lint/build/e2e/docs) as part of this track.

## Non-Functional Requirements

- Keep the migration readable and maintainable.
- Follow Angular's recommended migration approach for Signal Forms. (Guide: `https://angular.dev/guide/forms/signals/migration`)
- Allow breaking changes (pre-release) to simplify and improve structure.

## Acceptance Criteria

- Every existing form is migrated to Signal Forms or bridged via `compatForm` where necessary.
- All custom form controls are migrated to Signal Forms.
- No reliance on legacy status classes remains.
- All affected tests and docs are updated.
- Full lint/build/e2e/docs pass for the migrated state.

## Out of Scope

- Re-implementing third-party form controls that are already Signal-Forms compatible.
- Creating a generic migration framework beyond what is needed for this codebase.
