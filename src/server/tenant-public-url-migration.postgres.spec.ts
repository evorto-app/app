import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import type { GlobalAdminTenantWriteInput } from '../shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { Database, databaseLayer } from '../db/database.layer';
import { createNodePgPoolConfig } from '../db/pg-connection-config';
import { relations } from '../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  registrationTransfers,
  tenants,
  transactions,
  users,
} from '../db/schema';
import { PlatformAdministratorAuthority } from '../types/custom/platform-authority';
import { globalAdminHandlers } from './effect/rpc/handlers/global-admin.handlers';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from './effect/rpc/rpc-context-headers';
import { lockTenantStripeAccount } from './payments/pending-stripe-obligations';

const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const describeWithPostgres = databaseUrl ? describe : describe.skip;

interface TenantFixture {
  readonly categoryId?: string;
  readonly eventId?: string;
  readonly optionId?: string;
  readonly registrationId?: string;
  readonly tenantId: string;
  readonly transactionId?: string;
  readonly transferId?: string;
  readonly userId?: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeId = (prefix: string, suffix: string) =>
  `${prefix}-${suffix}`.slice(0, 20);

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

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-url-migration-test',
  kind: 'platformAdministrator',
});

const platformHeaders = {
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([]),
  [RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY]:
    encodeRpcContextHeaderJson(platformAuthority),
};

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
  throw new Error('Timed out waiting for blocked tenant URL migration lock');
};

const runUrlMigration = (
  tenant: {
    readonly currency: GlobalAdminTenantWriteInput['currency'];
    readonly domain: string;
    readonly id: string;
    readonly name: string;
    readonly stripeAccountId: null | string;
    readonly theme: GlobalAdminTenantWriteInput['theme'];
    readonly timezone: GlobalAdminTenantWriteInput['timezone'];
  },
  nextDomain: string,
  serviceLayer: ReturnType<typeof makeDatabaseServiceLayer>,
) =>
  Effect.runPromise(
    globalAdminHandlers['globalAdmin.tenants.update'](
      {
        id: tenant.id,
        reason: 'Exercise tenant public URL serialization',
        tenant: {
          currency: tenant.currency,
          domain: nextDomain,
          name: tenant.name,
          stripeAccountId: tenant.stripeAccountId,
          theme: tenant.theme,
          timezone: tenant.timezone,
        },
      },
      { headers: platformHeaders } as never,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (updatedTenant) => ({
          status: 'success' as const,
          updatedTenant,
        }),
      }),
      Effect.provide(serviceLayer),
    ),
  );

describeWithPostgres('tenant public URL migration serialization', () => {
  let database: TestDatabase;
  const fixtures: TenantFixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    for (const fixture of fixtures.toReversed()) {
      await database
        .delete(platformAuditEntries)
        .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId));
      await database
        .delete(registrationTransfers)
        .where(eq(registrationTransfers.tenantId, fixture.tenantId));
      await database
        .delete(transactions)
        .where(eq(transactions.tenantId, fixture.tenantId));
      if (fixture.registrationId) {
        await database
          .delete(eventRegistrations)
          .where(eq(eventRegistrations.id, fixture.registrationId));
      }
      if (fixture.optionId) {
        await database
          .delete(eventRegistrationOptions)
          .where(eq(eventRegistrationOptions.id, fixture.optionId));
      }
      if (fixture.eventId) {
        await database
          .delete(eventInstances)
          .where(eq(eventInstances.id, fixture.eventId));
      }
      if (fixture.categoryId) {
        await database
          .delete(eventTemplates)
          .where(eq(eventTemplates.categoryId, fixture.categoryId));
        await database
          .delete(eventTemplateCategories)
          .where(eq(eventTemplateCategories.id, fixture.categoryId));
      }
      if (fixture.userId) {
        await database.delete(users).where(eq(users.id, fixture.userId));
      }
      await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
    }
    await pool.end();
  });

  it('makes a concurrent URL migration observe and reject a newly committed active transfer offer', async () => {
    if (!databaseUrl) return;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = makeId('tenant', suffix);
    const userId = makeId('user', suffix);
    const categoryId = makeId('category', suffix);
    const templateId = makeId('template', suffix);
    const eventId = makeId('event', suffix);
    const optionId = makeId('option', suffix);
    const registrationId = makeId('registration', suffix);
    const transferId = makeId('transfer', suffix);
    const domain = `${suffix}.url-race.example`;
    const now = Date.now();
    const fixture = {
      categoryId,
      eventId,
      optionId,
      registrationId,
      tenantId,
      transferId,
      userId,
    } satisfies TenantFixture;
    fixtures.push(fixture);

    await database.insert(tenants).values({
      domain,
      id: tenantId,
      name: `URL race ${suffix}`,
    });
    await database.insert(users).values({
      auth0Id: `auth0|url-race-${suffix}`,
      communicationEmail: `${suffix}@example.com`,
      email: `${suffix}@example.com`,
      firstName: 'URL',
      id: userId,
      lastName: 'Race',
    });
    await database.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'URL migration race',
    });
    await database.insert(eventTemplates).values({
      categoryId,
      description: 'Tenant URL migration race fixture',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId,
      title: 'URL migration race',
    });
    await database.insert(eventInstances).values({
      creatorId: userId,
      description: 'Tenant URL migration race event',
      end: new Date(now + 8 * 24 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      start: new Date(now + 7 * 24 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId,
      tenantId,
      title: 'URL migration race event',
    });
    await database.insert(eventRegistrationOptions).values({
      closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
      eventId,
      id: optionId,
      isPaid: false,
      openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'Participant',
    });
    await database.insert(eventRegistrations).values({
      eventId,
      id: registrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      tenantId,
      userId,
    });

    const { promise: releaseOffer, resolve: allowOfferCommit } =
      Promise.withResolvers<undefined>();
    const { promise: offerLocked, resolve: markOfferLocked } =
      Promise.withResolvers<undefined>();
    const serviceLayer = makeDatabaseServiceLayer(databaseUrl);
    const offer = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .select({ id: eventRegistrations.id })
              .from(eventRegistrations)
              .where(eq(eventRegistrations.id, registrationId))
              .for('update');
            const lockedTenants = yield* tx
              .select({
                domain: tenants.domain,
              })
              .from(tenants)
              .where(eq(tenants.id, tenantId))
              .for('update');
            expect(lockedTenants[0]?.domain).toBe(domain);
            yield* tx.insert(registrationTransfers).values({
              claimCodeHash: createHash('sha256')
                .update(`code-${suffix}`)
                .digest('hex'),
              claimTokenHash: createHash('sha256')
                .update(`token-${suffix}`)
                .digest('hex'),
              eventId,
              expiresAt: new Date(now + 24 * 60 * 60 * 1000),
              id: transferId,
              registrationOptionId: optionId,
              sourceRegistrationId: registrationId,
              sourceSpotCount: 1,
              sourceUserId: userId,
              status: 'open',
              tenantId,
            });
            markOfferLocked(undefined);
            yield* Effect.promise(() => releaseOffer);
          }),
        ),
      ).pipe(Effect.provide(serviceLayer)),
    );
    await offerLocked;

    const migration = runUrlMigration(
      {
        currency: 'EUR',
        domain,
        id: tenantId,
        name: `URL race ${suffix}`,
        stripeAccountId: null,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      },
      `${suffix}.next-url.example`,
      makeDatabaseServiceLayer(databaseUrl),
    );

    try {
      await waitForBlockedTenantLock(pool);
    } finally {
      allowOfferCommit(undefined);
    }
    await offer;
    const outcome = await migration;

    expect(outcome).toMatchObject({
      error: {
        _tag: 'GlobalAdminTenantUrlMigrationBlockedError',
        activeRegistrationTransfers: true,
        pendingStripeObligations: false,
      },
      status: 'failure',
    });
    const persistedTenant = await database.query.tenants.findFirst({
      where: { id: tenantId },
    });
    expect(persistedTenant?.domain).toBe(domain);
  }, 30_000);

  it('makes a concurrent URL migration observe and reject a newly committed Stripe obligation', async () => {
    if (!databaseUrl) return;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = makeId('tenant', suffix);
    const transactionId = makeId('checkout', suffix);
    const domain = `${suffix}.stripe-url-race.example`;
    const stripeAccountId = `acct_${suffix}`;
    fixtures.push({ tenantId, transactionId });
    await database.insert(tenants).values({
      domain,
      id: tenantId,
      name: `Stripe URL race ${suffix}`,
      stripeAccountId,
    });

    const { promise: releaseCheckout, resolve: allowCheckoutCommit } =
      Promise.withResolvers<undefined>();
    const { promise: checkoutLocked, resolve: markCheckoutLocked } =
      Promise.withResolvers<undefined>();
    const checkout = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          Effect.gen(function* () {
            const lockedAccount = yield* lockTenantStripeAccount(tx, tenantId);
            expect(lockedAccount).toBe(stripeAccountId);
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
            markCheckoutLocked(undefined);
            yield* Effect.promise(() => releaseCheckout);
          }),
        ),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    await checkoutLocked;

    const migration = runUrlMigration(
      {
        currency: 'EUR',
        domain,
        id: tenantId,
        name: `Stripe URL race ${suffix}`,
        stripeAccountId,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      },
      `${suffix}.next-stripe-url.example`,
      makeDatabaseServiceLayer(databaseUrl),
    );

    try {
      await waitForBlockedTenantLock(pool);
    } finally {
      allowCheckoutCommit(undefined);
    }
    await checkout;
    const outcome = await migration;

    expect(outcome).toMatchObject({
      error: {
        _tag: 'GlobalAdminTenantUrlMigrationBlockedError',
        activeRegistrationTransfers: false,
        pendingStripeObligations: true,
      },
      status: 'failure',
    });
    const persistedTenant = await database.query.tenants.findFirst({
      where: { id: tenantId },
    });
    expect(persistedTenant?.domain).toBe(domain);
  }, 30_000);
});
