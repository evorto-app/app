# Repository Guidelines

## Context Discipline

- Keep relevant technical and operational context in repository files (track docs, handoff notes, revisit logs, and module-level `AGENTS.md` files).
- Update context files when reality changes, assumptions are invalidated, or new constraints are discovered.
- Prefer small, dated updates in files over implicit context in chat history.

## Project Structure & Module Organization

- App code: `src/app/**`.
- Server runtime and APIs: `src/server/**`.
- Data layer: `src/db/**`.
- Shared contracts/types/utilities: `src/shared/**` and `src/types/**`.
- Tests: unit tests as `*.spec.ts` in `src/**`; Playwright tests in `tests/**`; legacy reference in `e2e/**`.
- Assets/public: `public/`; theming in `src/styles.scss` and `_theme-colors.scss`.

Module-local guidance lives in:
- `src/app/AGENTS.md`
- `src/server/AGENTS.md`
- `src/db/AGENTS.md`
- `tests/AGENTS.md`

## Build, Test, and Development Commands

- `bun run dev:start` — run Angular dev server at `http://localhost:4200`.
- `bun run build:app` — build client + server bundles.
- `bun run serve:ssr` — serve the built SSR server.
- `bun run test:unit` — run unit tests.
- `bun run test:e2e` — run Playwright e2e.
- `bun run lint:fix` / `bun run lint:check` — lint with autofix and verification.
- `bun run format:write` — format with Prettier.
- `bun run docker:start` / `bun run docker:stop` — start/stop local services.
- Database: `bun run db:migrate`, `bun run db:push`, `bun run db:setup`, `bun run db:reset`.

## Type Safety (Always Full Types)

- End-to-end types are mandatory.
- Server boundaries must use Effect `Schema` for validated input/output.
- Prefer inferred/derived types from Drizzle schema and Effect schema outputs.
- Avoid `any`, unchecked `as`, and `unknown` without narrowing.

## Conventions

- TypeScript strict mode and Angular strict templates are enforced.
- Indentation: 2 spaces; filenames `kebab-case.ts`; symbols `camelCase` and `PascalCase`.
- Prefer path aliases: `@app/*`, `@server/*`, `@db/*`, `@shared/*`, `@types/*`.
- Run `bun run lint:fix` before `bun run lint:check`.

## Testing Guidelines

- Keep unit tests deterministic and close to source files.
- Use Playwright tests in `tests/**` as the active e2e suite.
- When touching schema or auth/runtime paths, include local verification notes.

## Commit & Pull Request Guidelines

- Commit messages: imperative mood, concise scope.
- PRs: include purpose, scope, schema/runtime impact, and UI evidence where relevant.
- For releases, add a Knope change file in `.changeset/*.md`.

## Git Workflow

- Use Git Town commands for branch management and shipping.

## Security & Configuration

- Never commit secrets.
- Bun loads `.env.local` and `.env` automatically.
- In CI, provide explicit env files in workflow steps rather than runtime dotenv wiring.
