# App Guidelines

- Prefer `@angular/material` components for UI when possible.
- Use viewport breakpoints (`sm:`, `md:`, `lg:`) for page layout and Tailwind v4 container queries (`@container` with `@sm:`/`@md:`/`@lg:`) for component-level responsiveness.
- Logging: use `consola` across the app (avoid direct `console.*`).
- In client code, import from `consola/browser`.
- Create scoped loggers with `consola.withTag('app/<feature>')` and use level methods (`debug`, `info`, `warn`, `error`) consistently.
