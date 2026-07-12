import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { tenants, tenantStripeTaxRates } from '../../db/schema';
import {
  createRequireOwnedStripeTaxRateTriggerSql,
  createRequireTaxRateCleanupBeforeAccountChangeTriggerSql,
  dropRequireOwnedStripeTaxRateTriggerSql,
  dropRequireTaxRateCleanupBeforeAccountChangeTriggerSql,
  requireOwnedStripeTaxRateFunctionSql,
  requireTaxRateCleanupBeforeAccountChangeFunctionSql,
} from './stripe-tax-rate-account-backfill';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

type TestDatabase = NodePgDatabase<typeof relations>;

const dropGuardStatements = [
  dropRequireOwnedStripeTaxRateTriggerSql,
  dropRequireTaxRateCleanupBeforeAccountChangeTriggerSql,
  'DROP FUNCTION IF EXISTS public.evorto_require_owned_tenant_stripe_tax_rate()',
  'DROP FUNCTION IF EXISTS public.evorto_require_tax_rate_cleanup_before_account_change()',
];

describe('Stripe tax-rate account rollout guards', () => {
  let database: TestDatabase;
  let pool: Pool;
  const rateIds: string[] = [];
  const tenantIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });

    await pool.query(requireOwnedStripeTaxRateFunctionSql);
    await pool.query(dropRequireOwnedStripeTaxRateTriggerSql);
    await pool.query(createRequireOwnedStripeTaxRateTriggerSql);
    await pool.query(requireTaxRateCleanupBeforeAccountChangeFunctionSql);
    await pool.query(dropRequireTaxRateCleanupBeforeAccountChangeTriggerSql);
    await pool.query(createRequireTaxRateCleanupBeforeAccountChangeTriggerSql);
  });

  afterAll(async () => {
    if (rateIds.length > 0) {
      await database
        .delete(tenantStripeTaxRates)
        .where(inArray(tenantStripeTaxRates.id, rateIds));
    }
    if (tenantIds.length > 0) {
      await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    }
    for (const statement of dropGuardStatements) {
      await pool.query(statement);
    }
    await pool.end();
  });

  it('rejects null ownership and requires cleanup before account rotation', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `guard-${suffix}`.slice(0, 20);
    const validRateRowId = `rate-${suffix}`.slice(0, 20);
    const nullInsertRowId = `null-${suffix}`.slice(0, 20);
    const accountId = `acct_${suffix}`;
    const nextAccountId = `acct_next_${suffix}`;
    tenantIds.push(tenantId);
    rateIds.push(validRateRowId, nullInsertRowId);

    await database.insert(tenants).values({
      domain: `${suffix}.tax-rate-guard.example`,
      id: tenantId,
      name: `Tax-rate guard ${suffix}`,
      stripeAccountId: accountId,
    });

    await expect(
      pool.query(
        `INSERT INTO public.tenant_stripe_tax_rates
          (id, "tenantId", "stripeTaxRateId", "stripeAccountId")
         VALUES ($1, $2, $3, NULL)`,
        [nullInsertRowId, tenantId, `txr_null_${suffix}`],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await database.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'VAT',
      id: validRateRowId,
      inclusive: true,
      percentage: '19',
      stripeAccountId: accountId,
      stripeTaxRateId: `txr_${suffix}`,
      tenantId,
    });

    await expect(
      pool.query(
        `UPDATE public.tenant_stripe_tax_rates
         SET "stripeAccountId" = NULL
         WHERE id = $1`,
        [validRateRowId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `UPDATE public.tenants
         SET "stripeAccountId" = $1
         WHERE id = $2`,
        [nextAccountId, tenantId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await database
      .delete(tenantStripeTaxRates)
      .where(
        and(
          eq(tenantStripeTaxRates.id, validRateRowId),
          eq(tenantStripeTaxRates.tenantId, tenantId),
        ),
      );
    await database
      .update(tenants)
      .set({ stripeAccountId: nextAccountId })
      .where(eq(tenants.id, tenantId));

    const updatedTenant = await database.query.tenants.findFirst({
      columns: { stripeAccountId: true },
      where: { id: tenantId },
    });
    expect(updatedTenant?.stripeAccountId).toBe(nextAccountId);
  });
});
