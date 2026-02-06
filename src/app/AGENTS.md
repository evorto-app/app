# App Guidelines

- Prefer `@angular/material` components for UI when possible.
- Use viewport breakpoints (`sm:`, `md:`, `lg:`) for page layout and Tailwind v4 container queries (`@container` with `@sm:`/`@md:`/`@lg:`) for component-level responsiveness.
- Iconography standard: use Font Awesome Duotone Regular icons via `<fa-duotone-icon>` from `@fortawesome/angular-fontawesome`. Do not introduce new `<mat-icon>` usage.
- Floating actions: use the extended FAB pattern (`<button|a mat-fab extended class="fab-fixed">`) with `<fa-duotone-icon>` followed by a text label (see `/src/app/templates/template-details/template-details.component.html`).
- Signal Forms validation rule: keep `required(...)` validators even when a field is conditionally hidden via `hidden(...)`; hidden fields are excluded from validation automatically.
- Logging: use `consola` across the app (avoid direct `console.*`).
- In client code, import from `consola/browser`.
- Create scoped loggers with `consola.withTag('app/<feature>')` and use level methods (`debug`, `info`, `warn`, `error`) consistently.
