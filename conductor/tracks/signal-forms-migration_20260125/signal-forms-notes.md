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
- For child forms, export the child model + initial state + schema and apply it in
  the parent schema, then pass the nested `FieldTree` into the child component.
- Prefer extracting larger schemas into standalone files and reusing them via
  `apply()`/`applyEach()` for maintainability. citeturn2view0turn3view2

## Conditional UI

- Use `hidden()` in the schema for conditional display logic, and guard UI with
  `@if (!field.hidden()) { ... }` in templates.
- Hidden fields can keep validators; their visibility controls whether those
  validators affect the parent field state.
- Avoid `required`, `min`, etc. DOM attributes on inputs bound with `[formField]`;
  use schema validators (`required`, `min`, etc.) instead.

## Avoiding Loops

- Avoid `effect`-based syncing between input data and form state when it causes
  loops. Prefer `linkedSignal` to derive a writable model from input signals and
  keep the form in sync without repeated patching.
- If you need to reset child fields based on another field, use explicit event
  handlers (e.g., `change`) rather than `effect` when effects cause loops.
- The child-form guidance warns about `effect`-driven resets causing loops; use
  event handlers for dependent field resets instead. citeturn1view0

## Submitting Forms

- Prefer native `(submit)` on the `<form>` element.
- Use `submit(form, async () => { ... })` to run async work and let Signal Forms
  manage submission state. It only runs when the form is valid and marks fields
  as touched for error display. citeturn0search0turn0search2
- Use `form().submitting()` to disable submit buttons while the `submit()` helper
  is running.
- To disable the entire form while submitting, add a schema-level `disabled()`
  rule on the root form based on `formState.submitting()`.

Example:

```
onSubmit(event: Event) {
  event.preventDefault();
  submit(this.loginForm, async () => {
    const credentials = this.loginModel();
    console.log('Logging in with:', credentials);
    // Add your login logic here
  });
}
```

## Updating Form Models Programmatically

- Replace the entire model with `modelSignal.set(...)` when loading API data or
  resetting the form.
- Use field-level updates when you only need to change one value:
  `field().value.set(...)` or `field().value.update(...)`. These propagate back
  to the model automatically.

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
