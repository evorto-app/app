import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { reset } from 'drizzle-seed';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { SeedTenantOptions } from '../seed-tenant';

import { resolvePostgresIntegrationEnvironment } from './postgres-integration-environment';
import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import { relations } from '../../src/db/relations';
import * as schema from '../../src/db/schema';
import { type Database, setupDatabase } from '../../src/db/setup-database';
import { applicationTableNames } from '../../src/db/staging-database-initialization';

const seed = vi.hoisted(() => ({
  fail: true,
  failure: new Error('Injected failure after the seed marker write'),
}));

vi.mock('../seed-tenant', () => ({
  seedBaseUsers: async (database: Database) => {
    await database.insert(schema.users).values({
      auth0Id: 'fixture|seed-atomicity',
      communicationEmail: 'seed@example.invalid',
      email: 'seed@example.invalid',
      firstName: 'Seed',
      id: 'seed-atomicity-user',
      lastName: 'Fixture',
    });
  },
  seedTenant: async (database: Database, options: SeedTenantOptions) => {
    await database.insert(schema.tenants).values({
      currency: options.currency,
      domain: options.domain,
      name: options.name,
    });
    if (seed.fail && options.domain === 'staging.evorto.app')
      throw seed.failure;
  },
}));

// This case exercises the real reset, so reject non-disposable targets before
// constructing a pool even when invoked outside the canonical integration runner.
const environment = await resolvePostgresIntegrationEnvironment({
  environment: {
    ...process.env,
    POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
  },
});
const pool = new Pool(
  createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
);
const database = drizzle({ client: pool, relations });

afterAll(() => pool.end());

describe('database seed transaction', () => {
  it('rolls back reset and partial seed writes, then commits a complete retry', async () => {
    for (const tableName of applicationTableNames) {
      const result = await database.execute(
        sql`SELECT EXISTS (SELECT 1 FROM ${sql.identifier(tableName)}) AS present`,
      );
      expect(
        result.rows[0]?.['present'],
        `Refuse to reset a nonempty fixture database: ${tableName}`,
      ).toBe(false);
    }
    const failures: unknown[] = [];
    try {
      const [original] = await database
        .insert(schema.tenants)
        .values({
          domain: 'before-seed.example',
          name: 'Existing fixture before reset',
        })
        .returning();
      const options = {
        seedDate: new Date('2026-07-01T00:00:00.000Z'),
        stripeTestAccountId: 'acct_seed_fixture',
      };
      await expect(setupDatabase(database, options)).rejects.toBe(seed.failure);
      expect(await database.select().from(schema.tenants)).toEqual([original]);
      expect(
        await database.select({ id: schema.users.id }).from(schema.users),
      ).toEqual([]);

      seed.fail = false;
      await setupDatabase(database, options);
      const seededTenants = await database
        .select({ domain: schema.tenants.domain })
        .from(schema.tenants);
      expect(seededTenants.map((tenant) => tenant.domain).toSorted()).toEqual([
        'alpha.evorto.app',
        'localhost',
        'staging.evorto.app',
      ]);
      expect(
        await database.select({ id: schema.users.id }).from(schema.users),
      ).toEqual([{ id: 'seed-atomicity-user' }]);
    } catch (error) {
      failures.push(error);
    }
    try {
      await reset(database, schema);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Seed transaction proof and fixture cleanup failed',
      );
  });
});
