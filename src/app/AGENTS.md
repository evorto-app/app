# App Guidelines

## Angular Baseline

- Use standalone components (no NgModules) and do not add `standalone: true`.
- Prefer `inject()` for DI and `providedIn: 'root'` for singleton services.
- Use `ChangeDetectionStrategy.OnPush` for components.
- Use signals for local state, `computed()` for derived state, and `effect()` for side effects.
- Use native control flow (`@if`, `@for`, `@switch`) and class/style bindings.

## Forms (Signal Forms First)

- Use Angular Signal Forms APIs for new form work.
- Migrate touched form surfaces toward Signal Forms instead of adding new Reactive Forms usage.
- Keep validation at schema/field level, and keep templates logic-light.
- Validation rule: keep `required(...)` validators even when fields are conditionally hidden via `hidden(...)`; hidden fields are excluded from validation automatically.

## RPC/Data Access

- Use the typed Effect RPC Angular client via `AppRpc.injectClient()`.
- Prefer generated query/mutation helpers (`queryOptions`, `mutationOptions`, keys/filters) with TanStack Angular Query.
- Do not reintroduce legacy tRPC client patterns.
- Do not bypass RPC type errors with cast hacks (`unknown as ...`); fix the underlying server/client contract alignment.

## UI & Design System

- Prefer `@angular/material` components where suitable.
- Use viewport breakpoints (`sm:`, `md:`, `lg:`) for page layout and Tailwind v4 container queries (`@container` with `@sm:`/`@md:`/`@lg:`) for component-level responsiveness.
- Iconography standard: use Font Awesome Duotone Regular icons via `<fa-duotone-icon>` from `@fortawesome/angular-fontawesome`.
- Do not introduce new `<mat-icon>` usage.
- Floating actions: use extended FAB pattern (`<button|a mat-fab extended class="fab-fixed">`) with `<fa-duotone-icon>` followed by a text label.

## App-Specific Practices

- Normalize optional string fields to `null` at submit boundaries where APIs expect `null` over empty strings.
- Use `consola/browser` instead of `console.*`.
- Create scoped loggers with `consola.withTag('app/<feature>')`.
- After editing an app file, run WebStorm `get_file_problems` on that file when possible before finishing.
