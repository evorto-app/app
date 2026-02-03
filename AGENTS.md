# Repository Guidelines

## Project Structure & Module Organization

- App code: `src/app/**` (feature areas like `events`, `finance`, `profile`).
- SSR and API: `src/server/**` (tRPC routers, middleware, webhooks) with path aliases like `@server/*`.
- Data layer: `src/db/**` (Drizzle ORM schema in `src/db/schema`).
- Shared types/utilities: `src/shared/**` and `src/types/**`.
- Tests: unit tests co-located as `*.spec.ts` in `src/**`; Playwright tests in `tests/**` (docs in `tests/docs/**`); legacy reference in `e2e/**`.
- Assets/public: `public/`; theming in `src/styles.scss` and `_theme-colors.scss`.

## Build, Test, and Development Commands

- `yarn start` — Run Angular dev server at `http://localhost:4200`.
- `yarn build` — Build client + server bundles (Angular 20 + SSR).
- `yarn serve:ssr:evorto` — Serve the built SSR server (`dist/evorto/server/server.mjs`).
- `yarn test` — Run unit tests (Jasmine/Karma).
- `yarn e2e` — Run Playwright e2e; use `yarn e2e:ui` for the UI runner.
- `yarn lint` / `yarn lint:fix` — Lint TypeScript/HTML; autofix issues.
- `yarn format` — Format with Prettier (+ Tailwind plugin).
- `yarn docker:start` — Start local services via Docker Compose; `yarn docker:stop` to stop.
- Database: `yarn migrate`, `yarn push:database`, `yarn setup:database`, `yarn reset:database`.

## Coding Style & Naming Conventions

- TypeScript strict mode and Angular strict templates are enforced (see `tsconfig.json`).
- Use standalone components, typed forms, and modern control-flow.
- Indentation: 2 spaces; filenames `kebab-case.ts`; symbols `camelCase` (vars), `PascalCase` (components/types).
- Run `yarn lint` and `yarn format` before committing.
- Prefer path aliases: `@app/*`, `@server/*`, `@db/*`, `@shared/*`, `@types/*`.

### Type Safety (Always Full Types)

- End-to-end types across the stack are mandatory.
  - Server: Use Effect `Schema` for every tRPC input and output; no `any` and no unchecked `as` casts.
  - Database: Prefer Drizzle typed schema/helpers; avoid `as any`; propagate inferred types to callers.
  - Client: Use fully typed Angular code, typed queries (`injectQuery`), and typed signals/inputs/outputs.
  - Utilities: Provide explicit, correct generic types; avoid implicit `any` in function params and returns.
- Review PRs for any introduction of `any`, `unknown` without narrowing, or unsafe `as` casts and replace with proper types.

### Type Derivation (Prefer Inference)

- Prefer derived/inferred types over hand-written ones.
  - Source of truth is the database schema (Drizzle). Derive types from schema and pass them through to routers and clients.
  - Keep object shapes single-sourced. Avoid duplicating domain types in multiple layers.
  - Use Effect `Schema` for validation, but leverage its inferred TypeScript types whenever possible.
- Only specify types explicitly when inference is insufficient or for well-defined external/public boundaries (e.g., API contracts).

### Reactive Forms (Non‑Nullable)

- Always use Angular’s reactive forms in the non‑nullable variant.
  - Construct forms via `NonNullableFormBuilder`.
  - Controls: `formBuilder.control<T>(initialValue)` with non‑nullable generics.
  - Groups: `formBuilder.group({ ... })` with typed, non‑nullable controls.
  - Do not bind `[disabled]` directly on controls; set disabled at creation or via `setDisabledState` (for CVAs) to avoid change detection issues.
  - Prefer strongly typed form models over `FormGroup<{[key:string]:FormControl}>` with `any`.

## Testing Guidelines

- Unit: place `*.spec.ts` next to the unit under test. Keep tests deterministic and fast.
- E2E: author Playwright tests in `tests/**` (docs in `tests/docs/**`); use `yarn e2e:ui` to debug; attach screenshots for UI changes. Legacy `e2e/**` is reference only.

## Research Before You Code

- For Angular work, retrieve and review the current Angular Best Practices before making changes.
  - Verify usage of: standalone components, typed (non‑nullable) reactive forms, and modern control flow (`@if`, `@for`, `@switch`).
- Confirm type safety end‑to‑end for any affected path (tRPC schemas, Drizzle models, client types).
- Scan the workspace for adjacent patterns to keep implementations consistent (permissions, routing, data loading).

## Commit & Pull Request Guidelines

- Messages: imperative mood, concise summary; reference tickets (e.g., `Sa-186: implement google places`).
- PRs: include purpose, scope, linked issues, and screenshots/GIFs for UI changes. Note any schema or migration impacts.
- For release documentation, always add a Knope change file in `.changeset/*.md`.
- Do not rely on PR titles or conventional commit prefixes as the only release documentation.
- CI passes required: build, lint, unit, and e2e (where applicable).

## Git Workflow

- We use Git Town to manage the repository workflow. Prefer `git town` commands for branching, syncing, and shipping.

## Security & Configuration

- Copy environment from `.env`/`.env.local`; never commit secrets. Stripe/Sentry helpers exist (`stripe:listen`, `sentry:sourcemaps`).
- When touching DB schema, include migration steps and local verification notes.

## Angular Best Practices

- Use standalone components (no NgModules) and don’t set `standalone: true`.
- Prefer `input()`/`output()` helpers; set `changeDetection: ChangeDetectionStrategy.OnPush`.
- Use signals for local state and `computed()` for derived values; avoid `mutate`, use `set`/`update`.
- Use native control flow: `@if`, `@for`, `@switch` and `class`/`style` bindings (not `ngIf/ngFor`, `ngClass/ngStyle`).
- Prefer `inject()` for DI and `providedIn: 'root'` for singletons.
- Use typed reactive forms; keep templates logic-light and reuse services/computed signals.
- Use `NgOptimizedImage` for static images.

## Design System & UI Standards

- Material Design 3 is the source of truth for layout, motion, and components; cite relevant M3 guidance when adding UI.
- Implement UI with Angular Material components plus Tailwind utility classes mapped via `src/styles.scss` theme tokens (no hardcoded colors).
- Use Font Awesome Duotone Regular SVG icons through `<fa-duotone-icon>`; size/color via Tailwind utilities tied to theme roles.
- Ensure responsive list–detail patterns, accessibility (WCAG 2.2 AA), and `prefers-reduced-motion` handling.
- Document new UI with a feature README design note, screenshots, and keep `.doc.ts` documentation tests in sync with UX changes.

## Documentation Tests & PR Previews

- Every feature must include `.doc.ts` documentation tests that generate the relevant user-facing documentation updates.
- Run `yarn e2e:docs` (or targeted doc test commands) during implementation to refresh the generated docs.
- Capture a preview of the generated documentation (screenshot or rendered markdown snippet) and attach it to the feature PR so reviewers can validate content.
