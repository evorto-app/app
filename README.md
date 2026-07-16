# Evorto

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) and is maintained on Angular 22 with Bun-first tooling.

## Prerequisites

- Bun 1.3.14 is the package manager and app runtime baseline.
- Node 24.15.0 is required for Angular CLI package scripts while Angular 22
  rejects Bun's current Node compatibility version.
- Docker Compose 2.24.0 or later is required for the local Docker-backed runtime and E2E flows.

Move Angular CLI package scripts back to direct Bun execution when Bun exposes a
Node version accepted by Angular CLI.

## Local Environment Files

This repo uses three local env files:

- `.env` — untracked developer secrets
- `.env.dev.local` — tracked shared default dev config
- `.env.dev` — generated worktree-specific overrides via `bun run env:runtime`

When Codex initializes a new linked worktree, it copies a missing `.env` from
the primary checkout with owner-only permissions. It leaves an existing
worktree `.env` unchanged, while `.env.dev` remains generated per worktree.

Use `.env.example` as the no-secret checklist for values that must be copied
into `.env` or exported before Docker can start. `bun run docker:check` reports
which required values are still missing before any Docker containers are
stopped, reset, or started.

`bun run docker:start` intentionally resets the Docker-backed local runtime.
When a Docker stack has already been initialized and you only need to bring
stopped containers back, use `bun run docker:resume` to avoid container
recreation.

Use `bun run docker:ps` to inspect the generated worktree Compose project.
Bare `docker compose ps` does not load `.env.dev`, so it can show an empty
project even while the isolated worktree stack is running.

`.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo.

## Git workflow

This repository uses Git Town to manage branching, syncing, and shipping. Prefer `git town` commands for daily workflow.

For large multi-phase changes, keep an assembly branch plus one child branch per reviewable phase. Create the next branch with `git town append`, keep the stack current with `git town sync --stack`, and open PRs with `git town propose`.

## Release documentation

We use Knope for release notes.

- Always add a change file in `.changeset/*.md` for release-relevant work.
- Target the single package as `default` in change-file frontmatter, followed by
  the appropriate `patch`, `minor`, or `major` change type.
- Do not rely on conventional commits or PR titles as release documentation.
- Knope Bot prepares the version, changelog, and GitHub draft in the
  `knope/release` pull request. After that pull request merges, the release
  workflow publishes only the exact draft whose tag points to the merged commit
  and only after production provider certification passes. Do not manually
  publish the draft or run a second release command around this gate.

## Development server

To start a local development server, run:

```bash
bun run dev:start
```

Once the server is running, open the generated `BASE_URL` from `.env.dev`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
bun run dev:ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
bun run dev:ng generate --help
```

## Building

To build the project run:

```bash
bun run build:app
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Mandatory local CI gate

Before any push, PR update, or other action that can trigger CI, the exact local
equivalent of every triggered CI suite must pass completely. Run the canonical,
unfiltered commands below against the commit that will be pushed:

```bash
bun install --frozen-lockfile
bun run release:validate
bun run format:write
bun run format:check
bun run lint
git diff --exit-code
test -z "$(git status --porcelain=v1)"
bun run test:unit:server
bun run test:unit
bun run test:integration:postgres:local
bun run build:app
bun run test:e2e
bun run test:e2e:docs
```

Every collected test must pass with zero skips, todos, fixmes, expected
failures, retries/flakes, interruptions, or focused tests. Missing services,
credentials, environment variables, or local tools block the gate; they are not
reasons to defer a suite to CI. Commands with forwarded file, filter, project,
shard, `--changed`, or reporter arguments are useful diagnostics but never
satisfy the final gate. See [QUALITY.md](QUALITY.md) for the done criteria and
[tests/README.md](tests/README.md) for the disposable PostgreSQL prerequisite.

The block above is the normal pull-request baseline. Any caller-forwarded
selector beyond a canonical package script that reduces collection is
diagnostic-only, including file arguments, `--filter`, `--grep`,
`--grep-invert`, `--include`, `--last-failed`, `--related`, project, shard,
`--changed`, or reporter overrides. Before any push, PR update, merge, or
release that triggers provider certification, the local provider gate requires
both commands, in this order:

```bash
bun run test:e2e:integration
bun run test:e2e:live-esncard:release
```

The integration command requires the approved Auth0 Management and Google Maps
credentials. The second command requires both protected ESNcard provider
identifiers—one active and one permanently expired—and certifies only the
ESNcard provider portion. Both runs must pass entirely with the same
zero-failure, zero-skip, zero-todo, zero-fixme,
zero-expected-failure, zero-retry/flake, zero-interruption, and zero-focused-test
rule before CI is attempted.

The **Production Provider Certification** workflow is configured to repeat both
provider runs behind the `esncard-release-certification` GitHub environment once
that environment is provisioned and protected. The baseline E2E secret set and
certification environment supply a test-mode `STRIPE_TEST_API_KEY`, which is
mapped to the application's `STRIPE_API_KEY` name only inside test steps.
Production Stripe credentials remain separate and must be exposed only to the
operational command that requires them.

Stripe tax-rate metadata always belongs to a non-null connected account. The
fresh target schema enforces that shape directly, while server writers share the
tenant-row serialization lock with account rotation. Legacy tax rates must be
provider-verified and written with their account ownership by the separate data
transfer; there is no nullable-row rollout or production backfill command.

The final Playwright runs must exercise the exact checkout being pushed. Stop
an unknown reused server and let the gate own a fresh stack, or start the exact
checkout yourself and verify its provenance; a successful `/readyz` response
alone does not prove commit identity.

## Running unit tests

To execute Angular/UI unit tests, use the following command:

```bash
bun run test:unit
```

## Running end-to-end tests

Install the matching Playwright browsers once after dependency install or Playwright upgrades:

```bash
bun run test:e2e:install
```

Local runs use Playwright's bundled Chromium by default. For exploratory runs
on a machine that already has Google Chrome installed, set
`E2E_BROWSER_CHANNEL=chrome` instead of downloading the bundled browser.

For end-to-end (e2e) testing, run:

```bash
bun run test:e2e
```

To run documentation tests:

```bash
bun run test:e2e:docs
```

For advanced Playwright flows, forward extra arguments to the core scripts:

```bash
bun run test:e2e -- --headed --workers 1
bun run test:e2e -- --project=setup
bun run test:e2e:docs -- --project=docs-integration
```

For deterministic runtime/test setup and Playwright project details, see [tests/README.md](tests/README.md) and [helpers/README.md](helpers/README.md).

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
