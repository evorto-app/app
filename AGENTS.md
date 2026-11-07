# Repository Guidelines

## Linear Issue-First Workflow

Linear is the shared source of truth for planned and active Evorto work. Use the
`evorto` team (`EVO`) in <https://linear.app/evorto> so collaborators can see plans,
avoid duplicate work, and add missing context before implementation.

- Before implementation or repository edits, search existing Linear issues and
  related branches/PRs. Reuse the canonical issue when the work overlaps; do not
  create a second competing plan or silently take over someone else's work.
- Create or update the issue **before starting work**, including work requested
  in chat. Record the goal, scope, proposed approach, acceptance criteria,
  dependencies, and verification plan. Keep this proportional to the change.
- Make ownership and status visible before implementation. Identify the person
  or agent doing the work, coordinate overlapping efforts, and link related
  issues. Split independent work into linked issues with clear boundaries.
- Call out missing product/history context and open decisions explicitly so
  Lukas can add what he knows. Ask a specific question and wait when its answer
  could materially change scope or behavior; do not turn an assumption into a
  decision. Routine work with sufficient context need not wait for approval.
- Keep the issue current as the plan changes. Record blockers, decisions,
  meaningful progress, and handoffs there instead of leaving them only in chat
  or a local plan. Put newly discovered follow-up work in issues before starting
  it, and distinguish required scope from optional follow-ups.
- Include the `EVO-<number>` identifier in commits and PRs, and link the resulting
  PR or direct commit back to the issue. Close it only after recording what
  shipped, the verification performed, and any remaining follow-ups.
- If Linear is unavailable, report the blocker and prepare a draft plan without
  starting implementation. Do not silently bypass issue-first coordination.

This workflow does not replace the verification, branching, release-note, or
publication requirements below. Direct-to-main permission for one change is not
standing permission for later changes.

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

- `bun run dev:start` - resolve local settings in memory and run the Angular dev server on the resolved `APP_HOST_PORT`.
- `bun run build:app` - build client + server bundles.
- `bun run test:unit` - run unit tests.
- `bun run test:unit:server` - run server unit tests.
- `bun run test:integration:postgres` - run the fail-closed PostgreSQL 17 integration suite.
- `bun run test:integration:postgres:local` - run that suite with supported local dotenv configuration.
- `bun run test:e2e` - run Playwright e2e.
- `bun run test:e2e:baseline` - run complete functional and documentation baselines with shared setup and guide export.
- `bun run test:e2e:docs` - run Playwright documentation tests.
- `bun run test:e2e:integration` - run credential-gated integration Playwright projects.
- `bun run test:e2e:live-esncard:release` - run the full live-provider release certification locally.
- `bun run test:e2e:install` - install the local Playwright browser binaries.
- `bun run lint` - lint with autofix.
- `bun run format:check` - verify formatting without changing files.
- `bun run format:write` - format with Prettier.
- `bun run docker:start` / `bun run docker:stop` - start/stop local services;
  `docker:start` may reset local data and should leave enough seeded data to
  get going from zero.
- `bun run docker:resume` - bring back the existing `db`, `minio`, `stripe`,
  and `evorto` containers without recreating them or rerunning the one-shot
  setup services; it refuses incomplete or unsuccessfully initialized stacks.
- `bun run db:push`, `bun run db:reset` - database commands.

## Local Environment

Codex environment setup refreshes a clean worktree to the parent/source branch
tip before installing dependencies and generating `.env.dev`. If local changes
already exist, setup skips branch refresh rather than overwriting work.
For a new linked worktree, setup also copies a missing `.env` from the primary
checkout with owner-only permissions. An existing worktree `.env` is preserved.

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

Local `test:e2e`, `test:e2e:baseline`, `test:e2e:ui`, `test:e2e:docs`, `db:*`, and `docker:*`
package scripts use `env:run` to resolve an invocation-private environment in memory.
They never read the shared `.env.dev` snapshot. Use these scripts or
`bun run env:run -- <command>` instead of chaining `env:runtime` and `dotenv`.
`env:runtime` remains an atomic, owner-only `.env.dev` snapshot writer for
standalone inspection. Child commands preserve process environment values over
`.env.dev.local`, generated runtime defaults, and `.env`, in that order.

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
- Use Angular Material components and Tailwind styling with the existing semantic theme tokens.
- For UI design, refinement, and review, read `.agents/skills/design-taste-frontend/SKILL.md` and `.agents/skills/project-design/SKILL.md`. Taste replaces the former `uncodixfy` and `material-3` skills; project requirements govern stack, tokens, accessibility, and behavior.
- Use Effect RPC and Effect Schema for API boundaries.
- Use Drizzle as the source of truth for persisted shapes.
- Use Stripe as the source of truth for payment state.
- Keep tenant isolation, auth, payments, registration, and permissions explicit.

## Deployment and Schema

- Scaleway deployments explain and apply the Drizzle schema through the private
  `ops` role before releasing the worker and web roles at the same digest.
- Review schema changes for compatibility with the currently deployed app. Use
  expand/contract steps for destructive or otherwise backward-incompatible
  changes unless the release is explicitly coordinated as a maintenance window.

## Vendored Repositories

- External source repositories are vendored under `repos/` as read-only reference material.
- When writing Effect code, read `repos/effect/LLMS.md` first, then inspect `repos/effect/packages/**` for Effect v4 implementation details, tests, module structure, and idiomatic patterns.
- When changing Drizzle schema, queries, migrations, or relational query behavior, inspect `repos/drizzle/drizzle-orm/src/**`, `repos/drizzle/drizzle-orm/tests/**`, and `repos/drizzle/integration-tests/**` for current upstream behavior and examples.
- Prefer vendored upstream sources over web search or generated guesses when library behavior or composition is unclear.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code must continue importing from normal package dependencies such as `effect`, `@effect/platform-bun`, `@effect/sql-pg`, and `drizzle-orm`.

## Verification

- Before any push, PR update, or other action that can trigger CI, run the full
  local equivalent of every CI test suite that the change will trigger. Every
  collected test must pass: zero failures, skips, todos, fixmes, expected
  failures, retries/flakes, interrupted tests, or focused tests. Missing local
  services, environment variables, or credentials are blockers to resolve, not
  reasons to defer coverage to CI. CI confirms an already-green local result;
  it is never the first full test run.
- After every file edit, run `bun run lint` and `bun run format:write`.
- Lint covers application, test, helper, and root TypeScript config sources
  while excluding vendored `repos/`. Node-side helper/config tooling uses the
  shared TypeScript correctness rules without Angular UI or deterministic
  sort-order rules.
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
- Prefer path aliases: `@app/*`, `@server/*`, `@db/*`, `@shared/*`, `@helpers/*`.
- Import `src/types/**` directly; TypeScript reserves the `@types/*` package
  namespace and rejects that path form in production builds.
- For Effect reference and usage patterns, consult the local Effect source at `/Users/hedde/code/effect` when behavior or recommended composition is unclear.

## Commit, PR, and Release Notes

- Use feature branches and GitHub PRs; do not push changes directly to `main`.
- Fetch and inspect the current base before starting work and before proposing
  review. Preserve uncommitted work and coordinate overlapping branches.
- Use ordinary Git and the GitHub CLI or website for branch and PR management.
- For multi-phase work, use [GitHub stacked PRs](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)
  with one reviewable branch per phase. The optional `gh stack` extension can
  manage local stacks; keep each PR based on its immediate predecessor.
- Request Copilot review on every PR and address actionable comments before
  treating the reviewed head as ready.
- Commit messages should be imperative and concise.
- PRs should include purpose, scope, schema/runtime impact, and UI evidence where relevant.
- Every PR needs a new Knope change file in `.changeset/*.md`, including
  test-only and CI-only changes. The hosted Knope Bot enforces this requirement.
- Before starting full verification, check that the PR diff includes its change
  file. `knope --validate` checks configuration and file validity; it does not
  check whether the current PR adds a change file.
