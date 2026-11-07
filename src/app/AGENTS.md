# App Guidelines

The root `AGENTS.md` also applies, including verification and commit requirements.
This file adds app-specific guidance.

## Angular Baseline

- Use standalone components (no NgModules) and do not add `standalone: true`.
- Respect Angular strict template typing; fix template type issues at the source instead of casting around them.
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
- For TanStack Angular Query result data, rely on query status signal narrowing. Prefer `@if (query.isSuccess()) { @let data = query.data(); }` or equivalent TypeScript `isSuccess()` checks over `@if (query.data(); as data)` aliases, so templates and component code preserve Query's discriminated-union type narrowing.
- Do not reintroduce legacy tRPC client patterns.
- Do not bypass RPC type errors with cast hacks (`unknown as ...`); fix the underlying server/client contract alignment.

## UI & Design System

- Read the `design-taste-frontend` and `project-design` skills before UI design, refinement, or review. For application screens, follow Taste's `references/app-screens.md`; the marketing-page workflow applies only to actual marketing pages.
- Prefer spacing and tonal surfaces over bordered card wrappers. Do not surround ordinary page sections, ticket actions, or already-distinct surfaces with outlined cards. Use cards only when the content needs that component.

- Keep implementation details out of visible copy, badges, tooltips, accessible names, and errors. Explain what happened and what the user can do. Before adding explanatory UI, identify the decision it helps this viewer make; omit it if there is none. Configuration explanations belong beside the authorized management control, not on attendee cards.

- Prefer available Material You / Material 3 Expressive components from `@angular/material`. Use native component structure and theming before custom markup or styling. If no suitable component exists and a custom component is needed, check with the user before building it.
- Use `TwoColumnLayoutComponent` for list/detail and settings navigation layouts. Follow `src/app/shared/components/two-column-layout/README.md` for its usage, scrolling, spacing, and responsive behavior.
- Apply `appMaterialTheme` at the active page boundary. It also themes Material overlays while that page is active and restores their previous colors on navigation; do not add per-dialog color plumbing.
- Iconography standard: use Font Awesome Duotone Regular icons via `<fa-duotone-icon>` from `@fortawesome/angular-fontawesome`.
- Do not introduce new `<mat-icon>` usage. For Font Awesome icons in labeled Material buttons (including extended FABs), use `matButtonIcon class="mat-icon"` on the direct icon child. This opts into Material’s projection and native spacing/RTL rules; shared styles provide the base SVG box. Do not add per-button icon margins or size classes.
- Floating actions: use extended FAB pattern (`<button|a mat-fab extended class="fab-fixed">`) with `<fa-duotone-icon>` followed by a text label.

## App-Specific Practices

- Normalize optional string fields to `null` at submit boundaries where APIs expect `null` over empty strings.
- Paid registration/add-on controls must be unavailable with an explicit
  explanation when the tenant has no connected Stripe account.
- Transfer claim UI presents the registration, guest quantity, all included,
  free, and purchased add-on quantities, and check-in/fulfillment history as one
  fixed bundle. It must not let the recipient omit or re-quantity settled bundle
  contents. Display current base prices and recipient-current discounts only;
  source-user discounts must not appear as recipient entitlements.
- Use `consola/browser` instead of `console.*`.
- Create scoped loggers with `consola.withTag('app/<feature>')`.
