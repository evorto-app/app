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

Start with the nearest applicable module guidance:

- `src/app/AGENTS.md`
- `src/server/AGENTS.md`
- `src/db/AGENTS.md`
- `tests/AGENTS.md`

More specific guidance also exists deeper in some subtrees (for example `src/server/config/AGENTS.md`).

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
- Prefer inferred/derived types from Drizzle schema and Effect schema outputs.
- Prefer TypeScript return type inference for functions. Add an explicit return type only when it is genuinely needed for clarity, API boundaries, overloads, recursion, or to prevent an incorrect inferred type from escaping.
- Avoid `any`, unchecked `as`, and `unknown` without narrowing.
- Do not use `unknown as ...` (or similar cast bypasses) to force client types to compile; fix the source type contract/runtime mismatch instead.

## Error Handling Discipline

- Never hide defects by swallowing errors.
- If an error is expected and recoverable, map it explicitly to a typed/domain outcome.
- If an error is unexpected, fail loudly and keep enough context to debug root cause.
- Prefer preventing repeated failures with follow-up fixes/tests over adding silent fallbacks.

## Conventions

- TypeScript strict mode is enforced.
- Indentation: 2 spaces; filenames `kebab-case.ts`; symbols `camelCase` and `PascalCase`.
- Prefer path aliases: `@app/*`, `@server/*`, `@db/*`, `@shared/*`, `@types/*`.
- Run `bun run lint:fix` before `bun run lint:check`.

## Testing Guidelines

- Keep unit tests deterministic and close to source files.
- Use Playwright tests in `tests/**` as the active e2e suite.

## Commit & Pull Request Guidelines

- Commit messages: imperative mood, concise scope.
- PRs: include purpose, scope, schema/runtime impact, and UI evidence where relevant.
- For releases, add a Knope change file in `.changeset/*.md`.

## Git Workflow

- Use Git Town commands for branch management and shipping.
- For substantial work in a new worktree created from `main`, immediately run `git town hack <branch-name>` in that worktree before making commits.

## Security & Configuration

- Never commit secrets.
- In CI, do not rely on `.env` files. Use explicit environment variables or generated runtime env artifacts instead.

## Agent Editing Workflow

- After editing a file, run WebStorm `get_file_problems` on that file when possible before finishing.
- WebStorm MCP tools are available; prefer sequential `get_file_problems` checks (parallel runs can timeout).
