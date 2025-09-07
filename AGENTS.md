# Repository Guidelines

## Project Structure & Module Organization
- App code: `src/app/**` (feature areas like `events`, `finance`, `profile`).
- SSR and API: `src/server/**` (tRPC routers, middleware, webhooks) with path aliases like `@server/*`.
- Data layer: `src/db/**` (Drizzle ORM schema in `src/db/schema`).
- Shared types/utilities: `src/shared/**` and `src/types/**`.
- Tests: unit tests co-located as `*.spec.ts` in `src/**`; e2e in `e2e/**` (Playwright).
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

## Testing Guidelines
- Unit: place `*.spec.ts` next to the unit under test. Keep tests deterministic and fast.
- E2E: author Playwright tests in `e2e/**`; use `yarn e2e:ui` to debug; attach screenshots for UI changes.

## Commit & Pull Request Guidelines
- Messages: imperative mood, concise summary; reference tickets (e.g., `Sa-186: implement google places`).
- PRs: include purpose, scope, linked issues, and screenshots/GIFs for UI changes. Note any schema or migration impacts.
- CI passes required: build, lint, unit, and e2e (where applicable).

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
