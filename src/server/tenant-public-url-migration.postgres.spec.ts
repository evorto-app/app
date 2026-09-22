import type { AdminTenantRpcError } from '@shared/rpc-contracts/app-rpcs/admin.errors';
import type { GlobalAdminTenantUpdateError } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import {
  adminTenantSettingsSnapshot,
  platformTenantSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Stripe from 'stripe';

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
  tenantPrivacyPolicyVersions,
  tenants,
  transactions,
  users,
} from '../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../shared/rpc-contracts/app-rpcs';
import { AdminTenantUpdateSettings } from '../shared/rpc-contracts/app-rpcs/admin.rpcs';
import {
  GlobalAdminTenantsCreate,
  GlobalAdminTenantsUpdate,
} from '../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { PlatformAdministratorAuthority } from '../types/custom/platform-authority';
import { Tenant } from '../types/custom/tenant';
import { adminHandlers } from './effect/rpc/handlers/admin.handlers';
import { globalAdminHandlers } from './effect/rpc/handlers/global-admin.handlers';
import { RpcAccess } from './effect/rpc/handlers/shared/rpc-access.service';
import { lockTenantStripeAccount } from './payments/pending-stripe-obligations';
import { StripeClient } from './stripe-client';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

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
            ['DATABASE_TLS_REQUIRED', 'false'],
            ['DATABASE_URL', url],
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

const platformHandlerOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: GlobalAdminTenantsUpdate.middleware(RpcRequestContextMiddleware),
};

const createPlatformRequestContext = (tenant: {
  readonly currency: GlobalAdminTenantWriteInput['currency'];
  readonly domain: string;
  readonly id: string;
  readonly name: string;
  readonly stripeAccountId: null | string;
  readonly theme: GlobalAdminTenantWriteInput['theme'];
  readonly timezone: GlobalAdminTenantWriteInput['timezone'];
}): RpcRequestContextShape => ({
  authData: {},
  authenticated: true,
  permissions: [],
  platformAuthority,
  tenant: {
    cancellationDeadlineHoursBeforeStart: 0,
    currency: tenant.currency,
    defaultLocation: undefined,
    discountProviders: {
      esnCard: {
        config: {},
        status: 'disabled',
      },
    },
    domain: tenant.domain,
    id: tenant.id,
    maxActiveRegistrationsPerUser: 0,
    name: tenant.name,
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['NL'],
    },
    refundFeesOnCancellation: true,
    stripeAccountId: tenant.stripeAccountId,
    theme: tenant.theme,
    timezone: tenant.timezone,
    transferDeadlineHoursBeforeStart: 0,
  },
  user: null,
  userAssigned: false,
});

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

const waitForBlockedDomainWrite = async (pool: Pool) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%tenants%'
        AND query NOT ILIKE '%FOR UPDATE%'
        AND (query ILIKE 'insert%' OR query ILIKE 'update%')
    `);
    if (Number(blocked.rows[0]?.count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a tenant-domain uniqueness collision');
};

class NoNetworkStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'tenant-url-fixture';
  }
  override makeRequest(): Promise<never> {
    return Promise.reject(
      new Error('Unexpected Stripe request during tenant URL migration'),
    );
  }
}
const stripeClient = new Stripe('sk_test_tenant_url_fixture', {
  httpClient: new NoNetworkStripeHttpClient(),
  maxNetworkRetries: 0,
});

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
        expectedSettings: platformTenantSettingsSnapshot(tenant),
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
      platformHandlerOptions,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (updatedTenant) => ({
          status: 'success' as const,
          updatedTenant,
        }),
      }),
      Effect.provide(
        Layer.mergeAll(
          RpcAccess.Default,
          Layer.succeed(StripeClient, stripeClient),
          Layer.succeed(
            RpcRequestContext,
            createPlatformRequestContext(tenant),
          ),
        ),
      ),
      Effect.provide(serviceLayer),
    ),
  );

const runSettingsEdit = (tenant: Tenant, kind: 'ordinary' | 'platform') => {
  const snapshot = adminTenantSettingsSnapshot(tenant);
  const operation: Effect.Effect<
    void,
    AdminTenantRpcError | GlobalAdminTenantUpdateError,
    Database | RpcAccess | StripeClient
  > =
    kind === 'ordinary'
      ? adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: snapshot.receiptSettings.allowOther,
            buyEsnCardUrl:
              snapshot.discountProviders.esnCard.config.buyEsnCardUrl,
            cancellationDeadlineHoursBeforeStart:
              snapshot.cancellationDeadlineHoursBeforeStart,
            currency: snapshot.currency,
            defaultLocation: snapshot.defaultLocation,
            emailSenderEmail: snapshot.emailSenderEmail ?? undefined,
            emailSenderName: snapshot.emailSenderName ?? undefined,
            esnCardEnabled:
              snapshot.discountProviders.esnCard.status === 'enabled',
            expectedSettings: snapshot,
            faviconUrl: snapshot.faviconUrl ?? undefined,
            legalNoticeText: snapshot.legalNoticeText ?? undefined,
            legalNoticeUrl: snapshot.legalNoticeUrl ?? undefined,
            logoUrl: snapshot.logoUrl ?? undefined,
            maxActiveRegistrationsPerUser:
              snapshot.maxActiveRegistrationsPerUser,
            receiptCountries: snapshot.receiptSettings.receiptCountries,
            refundFeesOnCancellation: snapshot.refundFeesOnCancellation,
            seoDescription: snapshot.seoDescription ?? undefined,
            seoTitle: 'Second editor title',
            stripeAccountId: snapshot.stripeAccountId ?? undefined,
            termsText: snapshot.termsText ?? undefined,
            termsUrl: snapshot.termsUrl ?? undefined,
            theme: snapshot.theme,
            timezone: snapshot.timezone,
            transferDeadlineHoursBeforeStart:
              snapshot.transferDeadlineHoursBeforeStart,
          },
          {
            ...platformHandlerOptions,
            rpc: AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(Effect.asVoid)
      : globalAdminHandlers['globalAdmin.tenants.update'](
          {
            expectedSettings: platformTenantSettingsSnapshot(tenant),
            id: tenant.id,
            reason: 'Second editor correction',
            tenant: {
              ...platformTenantSettingsSnapshot(tenant),
              name: 'Second editor name',
            },
          },
          platformHandlerOptions,
        ).pipe(Effect.asVoid);
  return Effect.runPromise(
    operation.pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(
        Layer.mergeAll(
          RpcAccess.Default,
          Layer.succeed(StripeClient, stripeClient),
          Layer.succeed(RpcRequestContext, {
            ...createPlatformRequestContext({
              ...tenant,
              stripeAccountId: tenant.stripeAccountId ?? null,
            }),
            permissions: ['admin:changeSettings'],
            tenant,
          }),
        ),
      ),
      Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
    ),
  );
};

describe('tenant public URL migration serialization', () => {
  let database: TestDatabase;
  const fixtures: TenantFixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
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
      await database
        .delete(tenantPrivacyPolicyVersions)
        .where(eq(tenantPrivacyPolicyVersions.tenantId, fixture.tenantId));
      await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
    }
    await pool.end();
  });

  it('makes a concurrent URL migration observe and reject a newly committed active transfer offer', async () => {
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
      reviewedAt: new Date(),
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
      basePriceAtRegistration: 0,
      discountAmount: 0,
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
  it.each(['create', 'update'] as const)(
    'returns a typed domain conflict when a concurrent %s loses the unique-domain write',
    async (kind) => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
      const sourceId = makeId('source', suffix);
      const competingId = makeId('winner', suffix);
      const nextDomain = `${suffix}.claimed-domain.example`;
      const originalDomain = `${suffix}.source-domain.example`;
      fixtures.push({ tenantId: sourceId }, { tenantId: competingId });
      await database.insert(tenants).values({
        domain: originalDomain,
        id: sourceId,
        name: 'Original organization',
      });
      const original = Schema.decodeUnknownSync(Tenant)(
        await database.query.tenants.findFirst({ where: { id: sourceId } }),
      );
      const context = createPlatformRequestContext({
        ...original,
        stripeAccountId: original.stripeAccountId ?? null,
      });
      const input = {
        currency: original.currency,
        domain: nextDomain,
        name: 'Losing organization',
        theme: original.theme,
        timezone: original.timezone,
      };
      const operation =
        kind === 'create'
          ? globalAdminHandlers['globalAdmin.tenants.create'](
              {
                initialPrivacyPolicy: {
                  privacyPolicyText: 'Fixture privacy policy',
                  privacyPolicyUrl: '',
                },
                reason: 'Exercise concurrent domain creation',
                tenant: input,
              },
              {
                ...platformHandlerOptions,
                rpc: GlobalAdminTenantsCreate.middleware(
                  RpcRequestContextMiddleware,
                ),
              },
            )
          : globalAdminHandlers['globalAdmin.tenants.update'](
              {
                expectedSettings: platformTenantSettingsSnapshot(original),
                id: sourceId,
                reason: 'Exercise concurrent domain update',
                tenant: input,
              },
              platformHandlerOptions,
            );
      const writer = await pool.connect();
      let transactionOpen = false;
      const failures: unknown[] = [];
      let waitingResult: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await writer.query('BEGIN');
        transactionOpen = true;
        await writer.query(
          'INSERT INTO tenants (id, domain, name) VALUES ($1, $2, $3)',
          [competingId, nextDomain, 'Winning organization'],
        );
        // This uncommitted claim is invisible to the handler preflight, but
        // PostgreSQL makes the real INSERT/UPDATE wait on its unique index.
        waitingResult = Promise.allSettled([
          Effect.runPromise(
            operation.pipe(
              Effect.match({
                onFailure: (error) => ({ error, status: 'failure' as const }),
                onSuccess: (tenant) => ({ status: 'success' as const, tenant }),
              }),
              Effect.provide(
                Layer.mergeAll(
                  RpcAccess.Default,
                  Layer.succeed(StripeClient, stripeClient),
                  Layer.succeed(RpcRequestContext, context),
                ),
              ),
              Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
            ),
          ),
        ]);
        await waitForBlockedDomainWrite(pool);
        await writer.query('COMMIT');
        transactionOpen = false;
        const [result] = await waitingResult;
        if (!result)
          throw new Error('Expected the losing domain operation result');
        if (result.status === 'rejected') throw result.reason;
        expect(result.value).toMatchObject({
          error: {
            _tag: 'RpcBadRequestError',
            message: 'Organization domain already exists',
            reason: nextDomain,
          },
          status: 'failure',
        });
        expect(
          await database.query.tenants.findFirst({ where: { id: sourceId } }),
        ).toMatchObject({
          domain: originalDomain,
          name: 'Original organization',
        });
        expect(
          await database.query.tenants.findMany({
            where: { domain: nextDomain },
          }),
        ).toMatchObject([{ id: competingId, name: 'Winning organization' }]);
        expect(
          await database.query.platformAuditEntries.findMany({
            where: { targetTenantId: sourceId },
          }),
        ).toEqual([]);
        expect(
          await database.query.tenantPrivacyPolicyVersions.findMany({
            where: { tenantId: sourceId },
          }),
        ).toEqual([]);
      } catch (error) {
        failures.push(error);
      } finally {
        if (transactionOpen) {
          try {
            await writer.query('ROLLBACK');
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          writer.release();
        } catch (error) {
          failures.push(error);
        }
        for (const result of (await waitingResult) ?? []) {
          if (result.status === 'rejected' && !failures.includes(result.reason))
            failures.push(result.reason);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Concurrent domain-write regression failed',
        );
    },
    30_000,
  );

  it.each(['ordinary', 'platform'] as const)(
    'rejects a stale %s form after waiting for a concurrent settings commit and allows an explicit reload',
    async (kind) => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
      const tenantId = makeId('edit', suffix);
      fixtures.push({ tenantId });
      await database.insert(tenants).values({
        domain: `${suffix}.settings-race.example`,
        id: tenantId,
        name: 'Original name',
      });
      const original = Schema.decodeUnknownSync(Tenant)(
        await database.query.tenants.findFirst({ where: { id: tenantId } }),
      );
      const writer = await pool.connect();
      let waitingSave: ReturnType<typeof runSettingsEdit> | undefined;
      try {
        await writer.query('BEGIN');
        // First editor owns the same row lock as both settings handlers.
        await writer.query('UPDATE tenants SET theme = $1 WHERE id = $2', [
          'esn',
          tenantId,
        ]);
        waitingSave = runSettingsEdit(original, kind);
        const observation = await Promise.allSettled([
          waitForBlockedTenantLock(pool),
        ]);
        await writer.query('COMMIT');
        const outcome = await waitingSave;
        if (observation[0].status === 'rejected') throw observation[0].reason;
        expect(outcome).toMatchObject({
          error: { _tag: 'TenantSettingsConflictError' },
          status: 'failure',
        });
        const current = Schema.decodeUnknownSync(Tenant)(
          await database.query.tenants.findFirst({ where: { id: tenantId } }),
        );
        expect(current).toMatchObject({ name: 'Original name', theme: 'esn' });
        expect(current.seoTitle).toBeNull();
        expect(
          await database.query.platformAuditEntries.findMany({
            where: { targetTenantId: tenantId },
          }),
        ).toEqual([]);

        // Reloading supplies the new original values; the other editor's theme survives.
        expect(await runSettingsEdit(current, kind)).toEqual({
          status: 'success',
        });
        const saved = await database.query.tenants.findFirst({
          where: { id: tenantId },
        });
        expect(saved?.theme).toBe('esn');
        expect(kind === 'ordinary' ? saved?.seoTitle : saved?.name).toBe(
          kind === 'ordinary' ? 'Second editor title' : 'Second editor name',
        );
        const audits = await database.query.platformAuditEntries.findMany({
          where: { targetTenantId: tenantId },
        });
        expect(audits).toHaveLength(kind === 'platform' ? 1 : 0);
        if (kind === 'platform') {
          expect(audits[0]?.before).toMatchObject({
            state: { name: 'Original name', theme: 'esn' },
          });
          expect(audits[0]?.after).toMatchObject({
            state: { name: 'Second editor name', theme: 'esn' },
          });
        }
      } finally {
        try {
          await writer.query('ROLLBACK');
        } finally {
          writer.release();
        }
        if (waitingSave) await waitingSave;
      }
    },
    30_000,
  );
});
