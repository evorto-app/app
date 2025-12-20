# AGENTS.md

## About Spec Kit & Specify

GitHub Spec Kit provides the project structure, templates, and workflows that power our Spec-Driven Development (SDD) process. The Specify CLI bootstraps these assets, keeps them up to date, and integrates with multiple coding assistants (Codex CLI, Claude Code, Gemini CLI, Copilot, Windsurf, and more). Each agent receives the same core workflow:

1. `/speckit.constitution` – establish project principles and quality gates.
2. `/speckit.specify` – capture user intent as structured specs.
3. `/speckit.plan` – produce implementation plans and technical decisions.
4. `/speckit.tasks` – generate executable task lists (tests first).
5. `/speckit.implement` – execute the plan while respecting the constitution.

When working outside a Git branch (e.g., detached head, sandbox, downloaded archive), set the `SPECIFY_FEATURE` environment variable to the feature directory name (for example: `SPECIFY_FEATURE=001-inclusive-tax-rates`). This allows the scripts under `scripts/bash/` to resolve the correct paths.

## Supported AI Agents (Quick Reference)

| Agent              | Directory              | Format   | CLI Tool       | Notes            |
| ------------------ | ---------------------- | -------- | -------------- | ---------------- |
| Claude Code        | `.claude/commands/`    | Markdown | `claude`       | Anthropic CLI    |
| Gemini CLI         | `.gemini/commands/`    | TOML     | `gemini`       | Google CLI       |
| GitHub Copilot     | `.github/prompts/`     | Markdown | —              | VS Code IDE      |
| Cursor             | `.cursor/commands/`    | Markdown | `cursor-agent` | Cursor CLI       |
| Qwen Code          | `.qwen/commands/`      | TOML     | `qwen`         | Alibaba CLI      |
| opencode           | `.opencode/command/`   | Markdown | `opencode`     | opencode CLI     |
| Codex CLI          | `.codex/commands/`     | Markdown | `codex`        | This environment |
| Windsurf           | `.windsurf/workflows/` | Markdown | —              | Windsurf IDE     |
| Kilo Code          | `.kilocode/rules/`     | Markdown | —              | Kilo Code IDE    |
| Auggie CLI         | `.augment/rules/`      | Markdown | `auggie`       | Augment CLI      |
| Roo Code           | `.roo/rules/`          | Markdown | —              | Roo IDE          |
| CodeBuddy CLI      | `.codebuddy/commands/` | Markdown | `codebuddy`    | CodeBuddy CLI    |
| Amazon Q Developer | `.amazonq/prompts/`    | Markdown | `q`            | Amazon Q CLI     |
| Amp                | `.agents/commands/`    | Markdown | `amp`          | Amp CLI          |

All scripts referenced by the command files live under `scripts/bash/` (POSIX) or `scripts/powershell/`. Ensure execute permissions are preserved (`chmod +x scripts/bash/*.sh`) when updating from upstream.

## Codex CLI Notes

- Set `CODEX_HOME=$(pwd)/.codex` before using slash commands locally.
- Commands such as `/speckit.plan` invoke the Bash scripts in `scripts/bash/` and copy results into `specs/<feature>/`.
- Optional enhancement commands `/speckit.clarify`, `/speckit.analyze`, and `/speckit.checklist` are available once the core loop is healthy.

## Evorto Repository Agent Prompt

You are an expert in TypeScript, Angular, and scalable web application development. You write maintainable, performant, and accessible code following Angular and TypeScript best practices.

### TypeScript Best Practices

- Use strict type checking.
- Prefer type inference when the type is obvious.
- Avoid the `any` type; when information is uncertain prefer `unknown` and narrow it safely.

### Angular Best Practices

- Always use standalone components over NgModules and do not set `standalone: true` manually—it is the default.
- Implement lazy loading for feature routes to keep bundles lean.
- Manage local state with signals and derive values with `computed()`.
- Declare host bindings inside the `host` object of the decorator instead of using `@HostBinding` or `@HostListener`.
- Use `NgOptimizedImage` for static images and remember it does not work with inline base64 sources.

### Components

- Keep components small and focused on a single responsibility.
- Use the `input()` and `output()` helpers instead of decorators.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` and favor inline templates for small components.
- Prefer reactive, non-nullable forms instead of template-driven forms.
- Avoid `ngClass` and `ngStyle`; rely on `class` and `style` bindings.

### State Management

- Use signals for local component state.
- Use `computed()` for derived state.
- Keep state transformations pure and predictable.
- Never call `mutate` on signals; use `set` or `update`.

### Templates

- Keep templates simple and avoid complex logic.
- Use the native control flow syntax (`@if`, `@for`, `@switch`) instead of structural directives.
- Use the `async` pipe to handle observables.

### Services

- Design services around a single responsibility.
- Provide singleton services with `providedIn: 'root'`.
- Use the `inject()` function rather than constructor injection.

## Tooling Requirements

- Use Yarn v4 (Berry) for all workspace commands. Do not run `npm`, `pnpm`, or global Playwright binaries—always execute scripts through `yarn <script>` so the repo-managed plugins and constraints apply.

## Project Structure & Module Organization

- App code: `src/app/**` (feature areas like `events`, `finance`, `profile`).
- SSR and API: `src/server/**` (tRPC routers, middleware, webhooks) with path aliases like `@server/*`.
- Data layer: `src/db/**` (Drizzle ORM schema in `src/db/schema`).
- Shared types/utilities: `src/shared/**` and `src/types/**`.
- Tests: unit tests co-located as `*.spec.ts` in `src/**`; e2e in `e2e/**` (Playwright).
- Assets/public: `public/`; theming in `src/styles.scss` and `_theme-colors.scss`.

## Build, Test, and Development Commands

- After every task, run `yarn build` to surface compile or SSR errors before hand-off.
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

- E2E: author Playwright tests in `e2e/**`; use `yarn e2e:ui` to debug; attach screenshots for UI changes.
- Discount card validation requires external ESN data that we cannot seed. Leave any ESN-number-dependent scenarios skipped/fixme'd until stable fixtures exist.

## Research Before You Code

- For Angular work, retrieve and review the current Angular Best Practices before making changes.
  - Verify usage of standalone components, typed (non‑nullable) reactive forms, and modern control flow (`@if`, `@for`, `@switch`).
- Confirm type safety end‑to‑end for any affected path (tRPC schemas, Drizzle models, client types).
- Scan the workspace for adjacent patterns to keep implementations consistent (permissions, routing, data loading).
- Use the Context7 documentation tools to pull the latest guidance for any library or dependency that is part of the current task before making changes.

## Commit & Pull Request Guidelines

- Messages: imperative mood, concise summary; reference tickets (e.g., `Sa-186: implement google places`).
- PRs: include purpose, scope, linked issues, and screenshots/GIFs for UI changes. Note any schema or migration impacts.
- CI passes required: build, lint, unit, and e2e (where applicable).

## Security & Configuration

- Copy environment from `.env`/`.env.local`; never commit secrets. Stripe/Sentry helpers exist (`stripe:listen`, `sentry:sourcemaps`).
- When touching DB schema, include migration steps and local verification notes.

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
