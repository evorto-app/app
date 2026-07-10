import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { Database, databaseLayer } from '../db/database.layer';
import { createNodePgPoolConfig } from '../db/pg-connection-config';
import { relations } from '../db/relations';
import { eventTemplateCategories, eventTemplates, tenants } from '../db/schema';
import { lockTenantCurrencyForFinancialConfiguration } from './tenant-currency-integrity';

const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const describeWithPostgres = databaseUrl ? describe : describe.skip;

type TestDatabase = NodePgDatabase<typeof relations>;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([
            ['DATABASE_URL', url],
            ['NEON_LOCAL_PROXY', String(neonLocalProxy)],
          ]),
        }),
      ),
    ),
  );

const waitForBlockedTenantCurrencyLock = async (pool: Pool) => {
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
  throw new Error('Timed out waiting for blocked tenant currency lock');
};

describeWithPostgres(
  'tenant currency financial-configuration serialization',
  () => {
    let database: TestDatabase;
    let pool: Pool;
    const categoryIds: string[] = [];
    const templateIds: string[] = [];
    const tenantIds: string[] = [];

    beforeAll(() => {
      if (!databaseUrl) return;
      pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
      database = drizzle({ client: pool, relations });
    });

    afterAll(async () => {
      if (!databaseUrl) return;
      await database
        .delete(eventTemplates)
        .where(inArray(eventTemplates.id, templateIds));
      await database
        .delete(eventTemplateCategories)
        .where(inArray(eventTemplateCategories.id, categoryIds));
      await database.delete(tenants).where(inArray(tenants.id, tenantIds));
      await pool.end();
    });

    const seedTenant = async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
      const tenantId = `currency-${suffix}`.slice(0, 20);
      const categoryId = `category-${suffix}`.slice(0, 20);
      const templateId = `template-${suffix}`.slice(0, 20);
      tenantIds.push(tenantId);
      categoryIds.push(categoryId);
      templateIds.push(templateId);
      await database.insert(tenants).values({
        canonicalRootUrl: `https://${suffix}.currency-lock.example`,
        currency: 'EUR',
        domain: `${suffix}.currency-lock.example`,
        id: tenantId,
        name: `Currency lock ${suffix}`,
      });
      await database.insert(eventTemplateCategories).values({
        icon: { iconColor: 0, iconName: 'circle' },
        id: categoryId,
        tenantId,
        title: 'Currency lock category',
      });
      return { categoryId, templateId, tenantId };
    };

    it('rejects a stale first template after a concurrent currency update commits', async () => {
      if (!databaseUrl) return;
      const fixture = await seedTenant();
      const { promise: releaseUpdate, resolve: allowUpdateCommit } =
        Promise.withResolvers<undefined>();
      const { promise: updateLocked, resolve: markUpdateLocked } =
        Promise.withResolvers<undefined>();

      const currencyUpdate = (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT currency FROM tenants WHERE id = $1 FOR UPDATE',
            [fixture.tenantId],
          );
          await client.query('UPDATE tenants SET currency = $1 WHERE id = $2', [
            'CZK',
            fixture.tenantId,
          ]);
          markUpdateLocked(undefined);
          await releaseUpdate;
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => null);
          throw error;
        } finally {
          client.release();
        }
      })();
      await updateLocked;

      const staleTemplate = Effect.runPromise(
        Database.use((effectDatabase) =>
          effectDatabase.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                fixture.tenantId,
                'EUR',
              );
              yield* transaction.insert(eventTemplates).values({
                categoryId: fixture.categoryId,
                description: 'Must not persist under a changed currency',
                icon: { iconColor: 0, iconName: 'circle' },
                id: fixture.templateId,
                tenantId: fixture.tenantId,
                title: 'Stale currency template',
              });
            }),
          ),
        ).pipe(
          Effect.flip,
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        ),
      );

      await waitForBlockedTenantCurrencyLock(pool);
      allowUpdateCommit(undefined);
      await currencyUpdate;
      const error = await staleTemplate;
      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        message:
          'Tenant currency changed while this financial configuration was being prepared',
      });
      expect(
        await database.query.eventTemplates.findFirst({
          where: { id: fixture.templateId },
        }),
      ).toBeUndefined();
    }, 30_000);

    it('makes a concurrent currency update observe the first committed template', async () => {
      if (!databaseUrl) return;
      const fixture = await seedTenant();
      const { promise: releaseTemplate, resolve: allowTemplateCommit } =
        Promise.withResolvers<undefined>();
      const { promise: templateLocked, resolve: markTemplateLocked } =
        Promise.withResolvers<undefined>();

      const templateWrite = Effect.runPromise(
        Database.use((effectDatabase) =>
          effectDatabase.transaction((transaction) =>
            Effect.gen(function* () {
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                fixture.tenantId,
                'EUR',
              );
              yield* transaction.insert(eventTemplates).values({
                categoryId: fixture.categoryId,
                description: 'First financial configuration',
                icon: { iconColor: 0, iconName: 'circle' },
                id: fixture.templateId,
                tenantId: fixture.tenantId,
                title: 'First currency template',
              });
              markTemplateLocked(undefined);
              yield* Effect.promise(() => releaseTemplate);
            }),
          ),
        ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
      );
      await templateLocked;

      const currencyUpdate = (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT currency FROM tenants WHERE id = $1 FOR UPDATE',
            [fixture.tenantId],
          );
          const dependentData = await client.query<{ exists: boolean }>(
            `SELECT EXISTS(
            SELECT 1 FROM event_templates WHERE "tenantId" = $1
          ) AS exists`,
            [fixture.tenantId],
          );
          if (dependentData.rows[0]?.exists) {
            await client.query('ROLLBACK');
            return 'blocked' as const;
          }
          await client.query('UPDATE tenants SET currency = $1 WHERE id = $2', [
            'AUD',
            fixture.tenantId,
          ]);
          await client.query('COMMIT');
          return 'updated' as const;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => null);
          throw error;
        } finally {
          client.release();
        }
      })();

      await waitForBlockedTenantCurrencyLock(pool);
      allowTemplateCommit(undefined);
      await templateWrite;
      expect(await currencyUpdate).toBe('blocked');
      expect(
        await database.query.tenants.findFirst({
          columns: { currency: true },
          where: { id: fixture.tenantId },
        }),
      ).toEqual({ currency: 'EUR' });
    }, 30_000);
  },
);
