Migration Scripts (Legacy → New)

Overview

- Supports per‑feature incremental migration from `old/` schema to `src/db/schema`.
- Defaults to a non‑destructive, idempotent mode with tenant reuse.
- Imports data only. Install the exact current target schema with
  `bun run db:push`; files in `migration/steps/**` must not create or alter it.
- Validates flows via E2E (and optional `.doc.ts` documentation tests) as part of feature delivery.
- Final execution of the migration will be a ONE‑GO run at cut‑over; per‑feature usage is for developing scripts only.

Environment Variables

- `MIGRATION_CLEAR_DB` (default: `false`)
  - When `true`, clears the target DB before migration. This is allowed only
    with `MIGRATION_CUTOVER_CONFIRMED=direct-new-schema`.
- `MIGRATION_CUTOVER_CONFIRMED`
  - Set to `direct-new-schema` only for the coordinated one-go cutover. The
    guard also requires a separate source and target, an explicit tenant list,
    all migration features, and `MIGRATION_ALLOW_REUSE_TENANT=false`.
- `MIGRATION_ALLOW_REUSE_TENANT` (default: `true`)
  - When `true`, if a tenant with the target domain exists, migration continues using it.
- `MIGRATE_TENANTS`
  - Comma‑separated `oldShortName:newDomain` pairs.
  - Example: `MIGRATE_TENANTS="tumi:localhost,tumi:evorto.fly.dev"`
- `MIGRATE_FEATURES`
  - Comma‑separated subset of: `users,tenants,roles,assignments,templates,events`.
  - Assignments require roles, templates require roles, and events require both
    templates and roles. Incomplete selections are rejected before any target
    writes.
  - Example: `MIGRATE_FEATURES="users,tenants,roles,assignments"`

Defaults and Backfills

- New columns must provide sensible defaults/backfills or adapt legacy values.
- Example patterns implemented:
  - Users: upsert by `auth0Id`, default `communicationEmail` to `email`.
  - Tenants: upsert by `domain` and preserve the legacy Stripe Connect account.
  - User assignments: upsert unique `(userId, tenantId)`, then ensure role relations are created idempotently.
  - Stripe tax rates: retrieve the exact legacy reduced and regular IDs through
    the legacy Connect account, persist provider metadata with that account ID,
    and assign the verified reduced rate to migrated paid options. Missing,
    mismatched, inactive, or exclusive paid-option tax configuration blocks the
    import. No synthetic tax IDs or environment-specific fallback rates exist.

Release Blockers

The current ETL does not preserve registration records, payment and refund
history, add-on purchases, acquisition snapshots, fulfillment history,
reimbursement records, or event and product submission questions. If a selected
legacy tenant has any registration, transaction, product line-item,
collected-fee, cost-item, receipt, or event-submission-item rows, the events
preflight stops before the target can be cleared. Line items are included
because free purchases, quantities, and pickup history may exist without a
transaction. Collected fees, cost items, and receipts are included because
their application-fee, refund, and reimbursement accounting is independent
from transactions. Do not bypass this guard. A production cutover remains
blocked until a dedicated history importer and reconciliation checks are
implemented and reviewed.

Provider lookup failure, a missing legacy Connect account, or ambiguous tax
provenance also blocks the run. Fix the source configuration or extend the ETL
with an evidence-backed mapping; never substitute a fabricated tax rate.

Idempotency

- Insertions use `onConflictDoNothing` (or update) on unique keys where possible.
- Assignment role linking re‑queries the final state to avoid index misalignment.
- Reusing tenants enables migrating subsets without dropping the DB.

Running

```bash
# Typical per‑feature import for local tenant without resetting DB
MIGRATE_TENANTS="tumi:localhost" MIGRATE_FEATURES="users,tenants,roles,assignments" bun run db:migrate

# Clean one-go import into a separate target (use with care)
MIGRATION_CLEAR_DB=true \
  MIGRATION_CUTOVER_CONFIRMED=direct-new-schema \
  MIGRATION_ALLOW_REUSE_TENANT=false \
  MIGRATE_TENANTS="tumi:localhost" \
  bun run db:migrate

# Final one‑go migration (example)
# This remains blocked while the source contains unsupported history.
MIGRATION_CLEAR_DB=true \
  MIGRATION_CUTOVER_CONFIRMED=direct-new-schema \
  MIGRATION_ALLOW_REUSE_TENANT=false \
  MIGRATE_TENANTS="tumi:your-domain" bun run db:migrate
```

Coordinated Cutover

The relaunch uses the current Drizzle schema directly. It does not mutate the
legacy schema in place and does not run an expand/contract compatibility layer.
The legacy database and new target database must be separate, and
`LEGACY_DATABASE_URL` must use read-only source credentials. Legacy migration
is a separate best-effort project and is not part of the Scaleway hosting
cutover.

1. Pass every local test suite completely before beginning the cutover.
2. Enter externally enforced maintenance and drain HTTP writers, jobs, and
   Stripe webhook delivery. Snapshot the untouched legacy source.
3. Install the current Drizzle schema into the separate empty target.
4. Confirm the history importer and reconciliation named under Release Blockers
   have been implemented before running the confirmed one-go TypeScript import.
5. Validate row counts, tenant ownership, Stripe provenance, registrations,
   acquisitions, add-on lots, fulfillment history, and refund allocations. Any
   missing or ambiguous record blocks deployment.
6. Deploy the new application against the target while maintenance remains in
   force, and prove every old application instance has stopped before reopening
   writers and webhook delivery.

Before the first new-target write, rollback means leaving the target unused and
resuming the unchanged legacy application and database. After new-target writes
begin, there is no automatic rollback to the legacy schema; that would require
a separately reviewed reverse data transfer.

Notes

- Tests document and verify the new platform features; no parity tests are required.
- Migration is data‑only (TypeScript ETL old → new). Schema DDL for the current app schema is applied via `bun run db:push`, not via files in `migration/steps/**`.
- Where a 1:1 mapping is not possible, document defaults/backfills in `conductor/tracks/<track_id>/spec.md` (Migration Notes section).
- Each feature should update seed data so the feature is testable without running the migration.
