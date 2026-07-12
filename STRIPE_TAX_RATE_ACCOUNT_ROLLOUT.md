# Stripe Tax-Rate Account Scope Rollout

Imported Stripe tax-rate metadata belongs to both a tenant and the Stripe
Connect account through which Stripe returned the rate. This rollout is an
expand step that adds account ownership while the new application moves every
read and write to tenant/account/rate scope.

- `stripeAccountId` remains nullable only while legacy rows are being verified.
- `tenant_stripe_tax_rates_tenant_stripe_unique` is newly declared in the
  Drizzle schema relative to `origin/main`. It is a live contract for the
  current `platform.taxRates.import` tenant/rate `ON CONFLICT` target, not an
  old-writer compatibility artifact. A legacy ETL helper may have created
  equivalent tenant/rate uniqueness under a different physical index name.
- New imports always persist the current locked tenant Stripe account.
- Account replacement or disconnect deletes imported tax-rate metadata before
  changing the tenant account, after pending Stripe obligations and paid
  configuration have been rejected.
- The redundant tenant/account/rate unique index is intentionally absent. A
  later contract release can make the account column non-null and reconsider
  the index shape after old application versions are gone, but tenant/rate
  uniqueness cannot be removed until the current upsert conflict target is
  migrated in the same or an earlier release.

## Required rollout sequence

Complete these steps in order. Wiring them into deployment automation is owned
by a separate change:

1. `drizzle-kit push --force` adds the nullable account column.
2. `bun run db:backfill-stripe-tax-rate-accounts` verifies and refreshes legacy
   rows, then installs the temporary rollout guards described below.
3. Release application versions that require account-owned rates only after
   both steps complete successfully.

The backfill is deliberately idempotent and may be rerun after fixing a
reported row. For each row whose `stripeAccountId` is null, it:

1. captures the tenant's current connected account;
2. retrieves that exact tax-rate ID through Stripe Connect using the captured
   account, without holding a database lock during the network request;
3. validates the provider response and percentage;
4. locks the tenant and tax-rate row in that order;
5. rejects an account or rate-ID change during verification; and
6. stamps the verified account while refreshing provider-owned `active`,
   `inclusive`, `percentage`, display-name, country, and state metadata.

This is a provider-authoritative verified reimport. It is not an inferred
`UPDATE ... FROM tenants`: the current account ID is written only after Stripe
successfully returns the exact rate through that Connect account. Missing
accounts, inaccessible rates, malformed provider data, database conflicts, and
provider errors all block the rollout. Partial progress is safe; a retry
re-verifies the remaining rows and refreshes a row that another safe run already
stamped to the same account.

Expose `DATABASE_URL` and `STRIPE_API_KEY` only to the command invocation.
Dependency installation, schema tooling, and unrelated release steps must not
inherit either credential from a broad environment. The command logs only safe
row/tenant/rate identifiers and failure categories, never credentials or
connection strings.

## Temporary rolling-deployment guards

A zero-row check alone has a race: the old application could import another
null-owned rate or rotate a tenant account between the check and completion of
the rolling application rollout. The command therefore finishes in one database
transaction that:

1. locks `public.tenants`, then `public.tenant_stripe_tax_rates`, in
   `SHARE ROW EXCLUSIVE` mode;
2. verifies that every tax-rate row has a non-null account equal to its
   tenant's non-null current account;
3. installs an idempotent tax-rate trigger that rejects inserts or updates with
   a null account;
4. installs an idempotent tenant trigger that rejects a Stripe account change
   while imported tax-rate rows remain; and
5. rechecks the invariant before committing.

Reads remain available during this transaction. A legacy writer trying to
create an unowned row fails closed. A legacy account-rotation write also fails
closed. The new application remains compatible because it writes the account
on every import and deletes all imported tax-rate rows before changing the
tenant account.

These triggers are temporary expand/contract infrastructure. They are database
integrity guards, not row-level security and not an authorization mechanism;
server-side Effect authorization remains authoritative. Remove the trigger
functions and triggers only in a later coordinated contract release that makes
`stripeAccountId` non-null and after every old writer has drained.

## Operator recovery

Do not bypass a failed backfill by directly copying `tenants.stripeAccountId`
onto tax-rate rows. Correct the reported tenant/provider configuration or
remove metadata that is no longer valid, then rerun:

```bash
DATABASE_URL=... STRIPE_API_KEY=... \
  bun run db:backfill-stripe-tax-rate-accounts
```

Use a Stripe key authorized to retrieve Connect tax rates and a database role
allowed to update these rows and install the temporary guard functions and
triggers. Never paste either value into logs, tickets, documentation, or
tracked dotenv files.

The final invariant is equivalent to:

```sql
SELECT count(*)
FROM public.tenant_stripe_tax_rates AS rate
LEFT JOIN public.tenants AS tenant ON tenant.id = rate."tenantId"
WHERE rate."stripeAccountId" IS NULL
   OR tenant.id IS NULL
   OR tenant."stripeAccountId" IS NULL
   OR rate."stripeAccountId" <> tenant."stripeAccountId";
```

Any nonzero result remains a release blocker.
