import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { Database, databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  tenants,
  users,
} from '../../db/schema';
import { tenantHasPaidEventConfiguration } from './paid-event-configuration';
import { lockTenantStripeAccount } from './pending-stripe-obligations';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

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

const waitForBlockedTenantLock = async (pool: Pool): Promise<void> => {
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
  throw new Error('Timed out waiting for blocked tenant account lock');
};

describe('event-create Stripe account serialization', () => {
  let database: TestDatabase;
  let pool: Pool;
  const cleanup: {
    categoryId: string;
    eventId: string;
    optionId: string;
    templateId: string;
    tenantId: string;
    userId: string;
  }[] = [];

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    for (const fixture of cleanup.toReversed()) {
      await database
        .delete(eventRegistrationOptions)
        .where(eq(eventRegistrationOptions.id, fixture.optionId));
      await database
        .delete(eventInstances)
        .where(eq(eventInstances.id, fixture.eventId));
      await database
        .delete(eventTemplates)
        .where(eq(eventTemplates.id, fixture.templateId));
      await database
        .delete(eventTemplateCategories)
        .where(eq(eventTemplateCategories.id, fixture.categoryId));
      await database.delete(users).where(eq(users.id, fixture.userId));
      await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
    }
    await pool.end();
  });

  it('makes a concurrent disconnect wait for and observe the committed paid graph', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 7);
    const tenantId = `t-${suffix}`;
    const userId = `u-${suffix}`;
    const categoryId = `c-${suffix}`;
    const templateId = `tpl-${suffix}`;
    const eventId = `e-${suffix}`;
    const optionId = `o-${suffix}`;
    const stripeAccountId = `acct_${suffix}`;
    cleanup.push({
      categoryId,
      eventId,
      optionId,
      templateId,
      tenantId,
      userId,
    });

    await database.insert(tenants).values({
      domain: `${suffix}.event-create-lock.example`,
      id: tenantId,
      name: `Event lock ${suffix}`,
      stripeAccountId,
    });
    await database.insert(users).values({
      auth0Id: `auth0|${suffix}`,
      communicationEmail: `${suffix}@example.test`,
      email: `${suffix}@example.test`,
      firstName: 'Event',
      id: userId,
      lastName: 'Creator',
    });
    const icon = { iconColor: 0, iconName: 'calendar:fas' } as const;
    await database.insert(eventTemplateCategories).values({
      icon,
      id: categoryId,
      tenantId,
      title: 'Category',
    });
    await database.insert(eventTemplates).values({
      categoryId,
      description: '<p>Template</p>',
      icon,
      id: templateId,
      tenantId,
      title: 'Template',
    });

    const { promise: createReleaseSignal, resolve: allowCreateCommit } =
      Promise.withResolvers<undefined>();
    const { promise: graphWritten, resolve: markGraphWritten } =
      Promise.withResolvers<undefined>();
    const eventCreate = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          Effect.gen(function* () {
            const lockedAccount = yield* lockTenantStripeAccount(tx, tenantId);
            expect(lockedAccount).toBe(stripeAccountId);
            const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const end = new Date(start.getTime() + 60 * 60 * 1000);
            yield* tx.insert(eventInstances).values({
              creatorId: userId,
              description: '<p>Event</p>',
              end,
              icon,
              id: eventId,
              start,
              templateId,
              tenantId,
              title: 'Event',
            });
            yield* tx.insert(eventRegistrationOptions).values({
              closeRegistrationTime: start,
              eventId,
              id: optionId,
              isPaid: true,
              openRegistrationTime: new Date(),
              organizingRegistration: false,
              price: 1000,
              registrationMode: 'fcfs',
              spots: 10,
              title: 'Participant',
            });
            markGraphWritten(undefined);
            yield* Effect.promise(() => createReleaseSignal);
          }),
        ),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    await graphWritten;

    const disconnect = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          Effect.gen(function* () {
            yield* lockTenantStripeAccount(tx, tenantId);
            if (yield* tenantHasPaidEventConfiguration(tx, tenantId)) {
              return 'blocked' as const;
            }
            yield* tx
              .update(tenants)
              .set({ stripeAccountId: null })
              .where(eq(tenants.id, tenantId));
            return 'disconnected' as const;
          }),
        ),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );

    let createReleased = false;
    const releaseCreate = (): void => {
      if (createReleased) return;
      createReleased = true;
      allowCreateCommit(undefined);
    };
    try {
      await waitForBlockedTenantLock(pool);
      releaseCreate();
      await eventCreate;
      expect(await disconnect).toBe('blocked');
      expect(
        await database.query.tenants.findFirst({ where: { id: tenantId } }),
      ).toMatchObject({ stripeAccountId });
    } finally {
      releaseCreate();
      await Promise.all([
        eventCreate.catch(() => null),
        disconnect.catch(() => null),
      ]);
    }
  }, 30_000);
});
