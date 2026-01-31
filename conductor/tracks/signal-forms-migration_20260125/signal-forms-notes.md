# Signal Forms Migration Notes

Last updated: 2026-01-31

## Core Concepts

- Signal Forms use a writable signal model as the source of truth, and the form
  tree mirrors the model shape.
- Build forms with `form(modelSignal, schemaFn)` and keep schema logic colocated
  (or exported) so it can be reused.
- Use `FieldTree<T>` for shared form components. The component should accept a
  `FieldTree` input and bind child fields with `[formField]`.

## Schema Composition

- Use `schema<T>()` to define reusable schema functions.
- Use `apply()` to attach a schema to a nested object field.
- Use `applyEach()` to attach a schema to each item of an array field.

## Conditional UI

- Use `hidden()` in the schema for conditional display logic, and guard UI with
  `@if (!field.hidden()) { ... }` in templates.
- Hidden fields can keep validators; their visibility controls whether those
  validators affect the parent field state.

## Default Models

- Export a `createXFormModel()` helper per shared form to define default state.
- Keep model construction separate from component code so parent forms can reuse
  defaults and overrides.

## Patterns Used In This Repo

- Shared forms now accept only `FieldTree` inputs (no compat FormGroup input).
- Default model + schema live in `*.schema.ts` next to the form component.
- Parent feature components:
  - Create a `signal(model)` as source of truth.
  - Create `form(model, schema)` once and pass `FieldTree` to shared components.
  - Update the model signal with `set` or `update` when data is fetched.

## Next Migration Steps

1. Convert remaining feature forms to `signal` + `form`.
2. Move each form's default model + schema into a dedicated `*.schema.ts`.
3. Update templates to:
   - Use `[formField]` instead of `formControlName`.
   - Use `@if`/`@for` with `field.hidden()` and array `FieldTree` iterables.
4. Introduce `compatForm` only when an existing CVA or third-party control
   cannot be migrated yet.
5. Update e2e/doc tests for UI changes introduced by Signal Forms.
