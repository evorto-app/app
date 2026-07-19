import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { Database, databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { tenants, transactions } from '../../db/schema';
import { lockTenantStripeAccount } from './pending-stripe-obligations';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([['DATABASE_URL', url]]),
        }),
      ),
    ),
  );

const waitForBlockedTenantLock = async (pool: Pool) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%tenants%FOR UPDATE%'
    `);
    if (Number(blocked.rows[0]?.count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for blocked tenant Stripe account lock');
};

describe('pending Stripe obligation account serialization', () => {
  let database: TestDatabase;
  let pool: Pool;
  const tenantIds: string[] = [];

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await database
        .delete(transactions)
        .where(eq(transactions.tenantId, tenantId));
      await database.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await pool.end();
  });

  it('makes a concurrent account update observe and reject a newly committed obligation', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `tenant-${suffix}`.slice(0, 20);
    const transactionId = `claim-${suffix}`.slice(0, 20);
    const originalAccount = `acct_${suffix}`;
    tenantIds.push(tenantId);
    await database.insert(tenants).values({
      domain: `${suffix}.stripe-lock.example`,
      id: tenantId,
      name: `Stripe lock ${suffix}`,
      stripeAccountId: originalAccount,
    });

    const { promise: releaseClaim, resolve: allowClaimCommit } =
      Promise.withResolvers<undefined>();
    const { promise: claimLocked, resolve: markClaimLocked } =
      Promise.withResolvers<undefined>();
    const claim = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          Effect.gen(function* () {
            const lockedAccount = yield* lockTenantStripeAccount(tx, tenantId);
            expect(lockedAccount).toBe(originalAccount);
            yield* tx.insert(transactions).values({
              amount: 1000,
              currency: 'EUR',
              id: transactionId,
              method: 'stripe',
              status: 'pending',
              stripeAccountId: lockedAccount,
              tenantId,
              type: 'registration',
            });
            markClaimLocked(undefined);
            yield* Effect.promise(() => releaseClaim);
          }),
        ),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    await claimLocked;

    const accountUpdate = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT "stripeAccountId" FROM tenants WHERE id = $1 FOR UPDATE',
          [tenantId],
        );
        const obligations = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
            SELECT 1
            FROM transactions
            WHERE "tenantId" = $1
              AND method = 'stripe'
              AND status = 'pending'
              AND type IN ('registration', 'refund')
          ) AS exists`,
          [tenantId],
        );
        if (obligations.rows[0]?.exists) {
          await client.query('ROLLBACK');
          return 'blocked' as const;
        }
        await client.query(
          'UPDATE tenants SET "stripeAccountId" = $1 WHERE id = $2',
          [`acct_next_${suffix}`, tenantId],
        );
        await client.query('COMMIT');
        return 'updated' as const;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
      } finally {
        client.release();
      }
    })();

    await waitForBlockedTenantLock(pool);
    allowClaimCommit(undefined);
    await claim;
    expect(await accountUpdate).toBe('blocked');

    const persistedTenant = await database.query.tenants.findFirst({
      where: { id: tenantId },
    });
    const obligation = await database.query.transactions.findFirst({
      where: { id: transactionId },
    });
    expect(persistedTenant?.stripeAccountId).toBe(originalAccount);
    expect(obligation?.stripeAccountId).toBe(originalAccount);
  }, 30_000);
});
