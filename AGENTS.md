# Repository Guidelines

## Context Discipline

- Keep repository knowledge in small, relevant files.
- Use this file as the map, not the full manual.
- Read the nearest applicable guidance before editing:
  - root product/system context
  - module-level `AGENTS.md`
  - local README files
- Update context files when reality changes, assumptions are invalidated, or new constraints are discovered.
- Prefer small, accurate updates over large stale manuals.

## Root Context Files

- `PRODUCT.md` - product goals, personas, core workflows, domain concepts, and product invariants.
- `ARCHITECTURE.md` - high-level system shape, architectural boundaries, and where to look first for common changes.
- `QUALITY.md` - behavior-focused verification guidance, Browser/Playwright expectations, and done criteria.

Keep these files concise. Put implementation-specific guidance in the nearest module-level `AGENTS.md` or README.

## Project Structure

- App code: `src/app/**`
- Server runtime and APIs: `src/server/**`
- Data layer: `src/db/**`
- Shared contracts/types/utilities: `src/shared/**` and `src/types/**`
- Unit tests: `*.spec.ts` in `src/**`
- Playwright tests: `tests/**`
- Legacy e2e reference: `e2e/**`
- Assets/public: `public/`
- Theming: `src/styles.scss` and `_theme-colors.scss`

Start with the nearest applicable module guidance:

- `src/app/AGENTS.md`
- `src/server/AGENTS.md`
- `src/db/AGENTS.md`
- `tests/AGENTS.md`

More specific guidance may exist deeper in some subtrees.

## Build, Test, and Development Commands

- `bun run dev:start` - run Angular dev server at `http://localhost:4200`.
- `bun run build:app` - build client + server bundles.
- `bun run test:unit` - run unit tests.
- `bun run test:unit:server` - run server unit tests.
- `bun run test:e2e` - run Playwright e2e.
- `bun run test:e2e:docs` - run Playwright documentation tests.
- `bun run lint` - lint with autofix.
- `bun run format:write` - format with Prettier.
- `bun run docker:start` / `bun run docker:stop` - start/stop local services.
- `bun run db:migrate`, `bun run db:push`, `bun run db:reset` - database commands.

## Local Environment

Supported local env files:

- `.env` - untracked developer secrets
- `.env.dev.local` - tracked shared dev config
- `.env.dev` - generated worktree override from `bun run env:runtime`

Unsupported files:

- `.env.local`
- `.env.runtime`
- `.env.ci`

In CI, do not rely on tracked or generated dotenv artifacts. Use GitHub Actions `env`, `vars`, and `secrets`.

For runtime/test details, read:

- `tests/README.md`
- `helpers/README.md`
- `src/server/config/AGENTS.md`

## Type Safety

- End-to-end types are mandatory.
- Prefer inferred/derived types from Drizzle schema and Effect schema outputs.
- Prefer TypeScript return type inference unless explicit return types clarify a boundary or prevent incorrect inference from escaping.
- Avoid `any`, unchecked `as`, and `unknown` without narrowing.
- Do not use `unknown as ...` or similar cast bypasses to force client/server types to compile.
- Fix the source type contract or runtime mismatch instead.

## Error Handling

- Do not swallow defects.
- If an error is expected and recoverable, map it explicitly to a typed/domain outcome.
- If an error is unexpected, fail loudly and preserve enough context to debug it.
- RPC and Effect error channels use `Schema.TaggedError` end to end.
- Do not introduce string-literal business errors in contracts or handlers.
- Only expected recoverable failures belong in typed error unions.
- When an external unknown error must cross a typed boundary, wrap it in a tagged error field using `Schema.Defect`.

## Architecture Guardrails

- Angular app guidance lives in `src/app/AGENTS.md`.
- Server/runtime guidance lives in `src/server/AGENTS.md`.
- Database guidance lives in `src/db/AGENTS.md`.
- Use Angular Material components, Material 3 design direction, and Tailwind styling.
- Use Effect RPC and Effect Schema for API boundaries.
- Use Drizzle as the source of truth for persisted shapes.
- Use Stripe as the source of truth for payment state.
- Keep tenant isolation, auth, payments, registration, and permissions explicit.

## Verification

- After every file edit, run `bun run lint` and `bun run format:write`.
- Markdown-only edits do not need a WebStorm `get_file_problems` pass.
- Before calling WebStorm `get_file_problems` on edited files, run `bun run lint`.
- After editing non-Markdown files, run WebStorm `get_file_problems` on those files when possible.
- Prefer sequential `get_file_problems` checks; parallel runs can time out.
- For UI behavior changes, use Browser verification where useful and add/update Playwright coverage for durable behavior.
- For generated documentation flows, keep Playwright docs current.
- See `QUALITY.md` for done criteria and Browser/Playwright guidance.

## Conventions

- TypeScript strict mode is enforced.
- Indentation: 2 spaces.
- Filenames: `kebab-case.ts`.
- Symbols: `camelCase` and `PascalCase`.
- Prefer path aliases: `@app/*`, `@server/*`, `@db/*`, `@shared/*`, `@types/*`.
- For Effect reference and usage patterns, consult the local Effect source at `/Users/hedde/code/effect` when behavior or recommended composition is unclear.

## Commit, PR, and Release Notes

- Use Git Town commands for branch management and shipping.
- For substantial work in a new worktree created from `main`, immediately run `git town hack <branch-name>` before making commits.
- For large multi-phase work, keep an assembly branch plus one reviewable child branch per phase or slice.
- Create stacked child branches with `git town append <branch-name>`.
- Run `git town sync --stack` before starting work and before proposing review.
- Open PRs with `git town propose`.
- Commit messages should be imperative and concise.
- PRs should include purpose, scope, schema/runtime impact, and UI evidence where relevant.
- For release-relevant work, add a Knope change file in `.changeset/*.md`.
