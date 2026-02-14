Migration Scripts (Legacy → New)

Overview

- Supports per‑feature incremental migration from `old/` schema to `src/db/schema`.
- Defaults to a non‑destructive, idempotent mode with tenant reuse.
- Validates flows via E2E (and optional `.doc.ts` documentation tests) as part of feature delivery.
- Final execution of the migration will be a ONE‑GO run at cut‑over; per‑feature usage is for developing scripts only.

Environment Variables

- `MIGRATION_CLEAR_DB` (default: `false`)
  - When `true`, clears the target DB before migration. Use only for clean reimports.
- `MIGRATION_ALLOW_REUSE_TENANT` (default: `true`)
  - When `true`, if a tenant with the target domain exists, migration continues using it.
- `MIGRATE_TENANTS`
  - Comma‑separated `oldShortName:newDomain` pairs.
  - Example: `MIGRATE_TENANTS="tumi:localhost,tumi:evorto.fly.dev"`
- `MIGRATE_FEATURES`
  - Comma‑separated subset of: `users,tenants,roles,assignments,templates,events`.
  - Example: `MIGRATE_FEATURES="users,tenants,assignments"`

Defaults and Backfills

- New columns must provide sensible defaults/backfills or adapt legacy values.
- Example patterns implemented:
  - Users: upsert by `auth0Id`, default `communicationEmail` to `email`.
  - Tenants: upsert by `domain`.
  - User assignments: upsert unique `(userId, tenantId)`, then ensure role relations are created idempotently.

Idempotency

- Insertions use `onConflictDoNothing` (or update) on unique keys where possible.
- Assignment role linking re‑queries the final state to avoid index misalignment.
- Reusing tenants enables migrating subsets without dropping the DB.

Running

```bash
# Typical per‑feature import for local tenant without resetting DB
MIGRATE_TENANTS="tumi:localhost" MIGRATE_FEATURES="users,tenants,roles,assignments" bun run db:migrate

# Clean reimport (use with care)
MIGRATION_CLEAR_DB=true bun run db:migrate

# Final one‑go migration (example)
MIGRATION_CLEAR_DB=true MIGRATION_ALLOW_REUSE_TENANT=false \
  MIGRATE_TENANTS="tumi:your-domain" bun run db:migrate
```

Notes

- Tests document and verify the new platform features; no parity tests are required.
- Migration is data‑only (TypeScript ETL old → new). No schema DDL, redirects, routing changes, or feature flags in this phase.
- Where a 1:1 mapping is not possible, document defaults/backfills in `conductor/tracks/<track_id>/spec.md` (Migration Notes section).
- Each feature should update seed data so the feature is testable without running the migration.
