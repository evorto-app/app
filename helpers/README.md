# Database Seeding

This directory contains scripts for setting up and seeding the database with
development, documentation, and Playwright test data.

## Overview

The database seeding process serves two distinct goals:

- `demo` profile: plausible demo/development data for local usage
- `test` profile: deterministic fixtures for isolated Playwright tenants
- `docs` profile: deterministic shared dataset for documentation journeys

## Key Files

- `database.ts`: Main entry point for database setup and seeding
- `seed-tenant.ts`: Shared tenant seeding logic used by tests, development, and demos
- `add-events.ts`: Creates events with deterministic dates, statuses, and visibilities
- `add-roles.ts`: Sets up user roles and permissions
- `add-templates.ts`: Creates event templates
- `add-template-categories.ts`: Sets up template categories
- `user-data.ts`: Defines test users
- `seed-clock.ts`: Resolves deterministic seeded time
- `seed-falso.ts`: Resolves deterministic pseudo-random seed key

## Seeding Approach

The seeding approach is deterministic, but not every profile has the same goal:

1. **Profiles**
   - `demo` keeps the richer, more realistic local dataset.
   - `test` and `docs` expose stable scenario handles instead of relying on fuzzy discovery.

2. **Scenario Contract**
   - `seedTenant()` returns `result.scenario.events.*` handles.
   - Current scenario handles:
     - `freeOpen`
     - `paidOpen`
     - `closedReg`
     - `past`
     - `draft`
   - Playwright tests should use those handles directly.

3. **Pinned Clock + Seed Key**
   - `seed-clock.ts` honors `E2E_NOW_ISO` when provided.
   - `seed-falso.ts` honors `E2E_SEED_KEY` when provided.
   - Playwright defaults both values in code, so normal test runs do not need extra env wiring.

4. **Deterministic Events**
   - Fixed number of events per template type (3 events × 6 template types = ~18 total events)
   - Events are created relative to the seeded clock
   - Deterministic assignment of status, visibility, and creator
   - Template selection is based on stable `seedKey` metadata, not title matching

5. **Realistic Data Structure**
   - Events have appropriate registration options
   - Users have appropriate roles and permissions
   - Templates and categories are properly linked

## Running the Seeding Process

To reset and seed the development/demo database:

```bash
bun run db:reset
```

This will:

1. In linked worktrees, generate `.env.runtime` with `bun run env:runtime` and re-run it whenever the resolved Git HEAD or local runtime settings change, such as after switching worktrees or branches, rebasing or merging onto a new HEAD, changing local ports, or renaming the local project, so Neon Local keeps the correct HEAD path and isolated ports/project naming
2. Ensure schema exists and reset/seed the local database (`bun run db:setup`)

`bun run db:setup` now uses the same explicit dotenv loading as `db:push`. In CI, `.env.ci` is loaded first because `dotenv-cli` is first-wins here. For local runs, `.env.runtime` is loaded before `.env.local` and `.env`, so a present `.env.runtime` overrides the checked-in baseline env files and points the reset at the local Neon Local proxy. `bun run db:studio` uses the same chain. We keep the explicit `-e` list instead of `dotenv -c` because this repo needs `.env.local` to beat `.env`, and `dotenv-cli`'s cascade mode does not preserve that precedence here.
Bun also implicitly loads `.env.local` and `.env`, which is why the scripts keep using explicit `dotenv-cli -e` precedence instead of relying on Bun defaults.

The Neon Local container does not emit every proxied query in its default logging configuration, so `docker logs` staying quiet during `db:reset` does not mean the reset missed Docker.

Docker Compose now also runs a one-shot `db-setup` container before `evorto` starts. That service pushes schema and resets/seeds the Docker database on every stack start.

## Modifying the Seeding Process

If you need to modify the seeding process:

1. Make changes to the appropriate file(s) in the `helpers` directory
2. Test your changes by running `bun run db:reset`
3. Verify that the application displays the expected data

For Playwright tests, prefer consuming `seeded.scenario` in fixtures/specs rather
than searching for events by title, date, or incidental seeded content.
