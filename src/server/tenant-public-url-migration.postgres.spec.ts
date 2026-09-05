import type { AdminTenantRpcError } from '@shared/rpc-contracts/app-rpcs/admin.errors';
import type { GlobalAdminTenantUpdateError } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import {
  adminTenantAppearanceSettingsSnapshot,
  adminTenantLegalSettingsSnapshot,
  adminTenantOrganizationSettingsSnapshot,
  adminTenantPaymentProviderSettingsSnapshot,
  adminTenantRegistrationSettingsSnapshot,
  platformTenantSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import { eq } from 'drizzle-orm';
import {
  drizzle,
  type NodePgDatabase,
  type NodePgTransaction,
} from 'drizzle-orm/node-postgres';
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
import {
  AdminTenantUpdateAppearanceSettings,
  AdminTenantUpdateLegalSettings,
  AdminTenantUpdateOrganizationSettings,
  AdminTenantUpdatePaymentProviderSettings,
  AdminTenantUpdateRegistrationSettings,
} from '../shared/rpc-contracts/app-rpcs/admin.rpcs';
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

const setupFixture = async (
  database: TestDatabase,
  setup: (transaction: NodePgTransaction<typeof relations>) => Promise<void>,
) => {
  const failures: unknown[] = [];
  try {
    await database.transaction(async (transaction) => {
      try {
        await setup(transaction);
      } catch (error) {
        failures.push(error);
        throw error;
      }
    });
  } catch (error) {
    if (!failures.includes(error)) failures.push(error);
    if (failures.length === 1) throw error;
    throw new AggregateError(
      failures,
      'Tenant URL fixture setup and rollback failed',
      {
        cause: error,
      },
    );
  }
};

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

type SettingsSection =
  | 'appearance'
  | 'legal'
  | 'organization'
  | 'paymentProvider'
  | 'platform'
  | 'registration';

const runSettingsEdit = (tenant: Tenant, kind: SettingsSection) => {
  const appearance = adminTenantAppearanceSettingsSnapshot(tenant);
  const legal = adminTenantLegalSettingsSnapshot(tenant);
  const organization = adminTenantOrganizationSettingsSnapshot(tenant);
  const payment = adminTenantPaymentProviderSettingsSnapshot(tenant);
  const registration = adminTenantRegistrationSettingsSnapshot(tenant);
  const operations: Record<
    SettingsSection,
    Effect.Effect<
      void,
      AdminTenantRpcError | GlobalAdminTenantUpdateError,
      Database | RpcAccess | StripeClient
    >
  > = {
    appearance: adminHandlers['admin.tenant.updateAppearanceSettings'](
      {
        expectedSettings: appearance,
        faviconUrl: appearance.faviconUrl ?? undefined,
        logoUrl: appearance.logoUrl ?? undefined,
        seoDescription: appearance.seoDescription ?? undefined,
        seoTitle: 'Second editor title',
        theme: appearance.theme,
      },
      {
        ...platformHandlerOptions,
        rpc: AdminTenantUpdateAppearanceSettings.middleware(
          RpcRequestContextMiddleware,
        ),
      },
    ).pipe(Effect.asVoid),
    legal: adminHandlers['admin.tenant.updateLegalSettings'](
      {
        expectedSettings: legal,
        legalNoticeText: 'Second editor notice',
        legalNoticeUrl: legal.legalNoticeUrl ?? undefined,
        termsText: legal.termsText ?? undefined,
        termsUrl: legal.termsUrl ?? undefined,
      },
      {
        ...platformHandlerOptions,
        rpc: AdminTenantUpdateLegalSettings.middleware(
          RpcRequestContextMiddleware,
        ),
      },
    ).pipe(Effect.asVoid),
    organization: adminHandlers['admin.tenant.updateOrganizationSettings'](
      {
        defaultLocation: organization.defaultLocation,
        emailSenderEmail: 'second-editor@example.test',
        emailSenderName: organization.emailSenderName ?? undefined,
        expectedSettings: organization,
        timezone: organization.timezone,
      },
      {
        ...platformHandlerOptions,
        rpc: AdminTenantUpdateOrganizationSettings.middleware(
          RpcRequestContextMiddleware,
        ),
      },
    ).pipe(Effect.asVoid),
    paymentProvider: adminHandlers[
      'admin.tenant.updatePaymentProviderSettings'
    ](
      {
        allowOther: true,
        buyEsnCardUrl: payment.discountProviders.esnCard.config.buyEsnCardUrl,
        currency: payment.currency,
        esnCardEnabled: payment.discountProviders.esnCard.status === 'enabled',
        expectedSettings: payment,
        receiptCountries: payment.receiptSettings.receiptCountries,
        refundFeesOnCancellation: payment.refundFeesOnCancellation,
      },
      {
        ...platformHandlerOptions,
        rpc: AdminTenantUpdatePaymentProviderSettings.middleware(
          RpcRequestContextMiddleware,
        ),
      },
    ).pipe(Effect.asVoid),
    platform: globalAdminHandlers['globalAdmin.tenants.update'](
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
    ).pipe(Effect.asVoid),
    registration: adminHandlers['admin.tenant.updateRegistrationSettings'](
      {
        ...registration,
        expectedSettings: registration,
        maxActiveRegistrationsPerUser: 3,
      },
      {
        ...platformHandlerOptions,
        rpc: AdminTenantUpdateRegistrationSettings.middleware(
          RpcRequestContextMiddleware,
        ),
      },
    ).pipe(Effect.asVoid),
  };
  return Effect.runPromise(
    operations[kind].pipe(
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
            permissions:
              kind === 'paymentProvider'
                ? ['admin:managePayments']
                : ['admin:changeSettings'],
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
    const failures: unknown[] = [];
    const cleanup = async (operation: () => PromiseLike<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    for (const fixture of fixtures.toReversed()) {
      const { categoryId, eventId, optionId, registrationId, userId } = fixture;
      await cleanup(() =>
        database
          .delete(platformAuditEntries)
          .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId)),
      );
      await cleanup(() =>
        database
          .delete(registrationTransfers)
          .where(eq(registrationTransfers.tenantId, fixture.tenantId)),
      );
      await cleanup(() =>
        database
          .delete(transactions)
          .where(eq(transactions.tenantId, fixture.tenantId)),
      );
      if (registrationId) {
        await cleanup(() =>
          database
            .delete(eventRegistrations)
            .where(eq(eventRegistrations.id, registrationId)),
        );
      }
      if (optionId) {
        await cleanup(() =>
          database
            .delete(eventRegistrationOptions)
            .where(eq(eventRegistrationOptions.id, optionId)),
        );
      }
      if (eventId) {
        await cleanup(() =>
          database.delete(eventInstances).where(eq(eventInstances.id, eventId)),
        );
      }
      if (categoryId) {
        await cleanup(() =>
          database
            .delete(eventTemplates)
            .where(eq(eventTemplates.categoryId, categoryId)),
        );
        await cleanup(() =>
          database
            .delete(eventTemplateCategories)
            .where(eq(eventTemplateCategories.id, categoryId)),
        );
      }
      if (userId) {
        await cleanup(() => database.delete(users).where(eq(users.id, userId)));
      }
      await cleanup(() =>
        database
          .delete(tenantPrivacyPolicyVersions)
          .where(eq(tenantPrivacyPolicyVersions.tenantId, fixture.tenantId)),
      );
      await cleanup(() =>
        database.delete(tenants).where(eq(tenants.id, fixture.tenantId)),
      );
    }
    await cleanup(() => pool.end());
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to release tenant URL migration fixtures',
        {
          cause: failures[0],
        },
      );
    }
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

    await setupFixture(database, async (transaction) => {
      await transaction.insert(tenants).values({
        domain,
        id: tenantId,
        name: `URL race ${suffix}`,
      });
      await transaction.insert(users).values({
        auth0Id: `auth0|url-race-${suffix}`,
        communicationEmail: `${suffix}@example.com`,
        email: `${suffix}@example.com`,
        firstName: 'URL',
        id: userId,
        lastName: 'Race',
      });
      await transaction.insert(eventTemplateCategories).values({
        icon: { iconColor: 0, iconName: 'circle' },
        id: categoryId,
        tenantId,
        title: 'URL migration race',
      });
      await transaction.insert(eventTemplates).values({
        categoryId,
        description: 'Tenant URL migration race fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: templateId,
        tenantId,
        title: 'URL migration race',
      });
      await transaction.insert(eventInstances).values({
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
      await transaction.insert(eventRegistrationOptions).values({
        closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
        confirmedSpots: 1,
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
      await transaction.insert(eventRegistrations).values({
        basePriceAtRegistration: 0,
        discountAmount: 0,
        eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CONFIRMED',
        tenantId,
        userId,
      });
    });

    const { promise: releaseOffer, resolve: allowOfferCommit } =
      Promise.withResolvers<undefined>();
    const { promise: offerLocked, resolve: markOfferLocked } =
      Promise.withResolvers<undefined>();
    const serviceLayer = makeDatabaseServiceLayer(databaseUrl);
    const failures: unknown[] = [];
    const operations: Promise<unknown>[] = [];
    const observeOperation = <T>(operation: Promise<T>) => {
      const observed = Promise.resolve(operation);
      operations.push(observed);
      void observed.catch((error) => {
        if (!failures.includes(error)) failures.push(error);
      });
      return observed;
    };

    try {
      const offer = observeOperation(
        Effect.runPromise(
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
        ),
      );
      await Promise.race([offerLocked, offer]);

      const migration = observeOperation(
        runUrlMigration(
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
        ),
      );

      await waitForBlockedTenantLock(pool);
      allowOfferCommit(undefined);
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
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    } finally {
      allowOfferCommit(undefined);
      for (const result of await Promise.allSettled(operations)) {
        if (result.status === 'rejected' && !failures.includes(result.reason)) {
          failures.push(result.reason);
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Tenant URL offer race failed', {
        cause: failures[0],
      });
    }
  }, 30_000);

  it('makes a concurrent URL migration observe and reject a newly committed Stripe obligation', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = makeId('tenant', suffix);
    const userId = makeId('user', suffix);
    const categoryId = makeId('category', suffix);
    const templateId = makeId('template', suffix);
    const eventId = makeId('event', suffix);
    const optionId = makeId('option', suffix);
    const registrationId = makeId('registration', suffix);
    const transactionId = makeId('checkout', suffix);
    const domain = `${suffix}.stripe-url-race.example`;
    const stripeAccountId = `acct_${suffix}`;
    const now = Date.now();
    fixtures.push({
      categoryId,
      eventId,
      optionId,
      registrationId,
      tenantId,
      transactionId,
      userId,
    });
    await setupFixture(database, async (transaction) => {
      await transaction.insert(tenants).values({
        domain,
        id: tenantId,
        name: `Stripe URL race ${suffix}`,
        stripeAccountId,
      });
      await transaction.insert(users).values({
        auth0Id: `auth0|url-race-${suffix}`,
        communicationEmail: `${suffix}@example.com`,
        email: `${suffix}@example.com`,
        firstName: 'URL',
        id: userId,
        lastName: 'Race',
      });
      await transaction.insert(eventTemplateCategories).values({
        icon: { iconColor: 0, iconName: 'circle' },
        id: categoryId,
        tenantId,
        title: 'URL migration race',
      });
      await transaction.insert(eventTemplates).values({
        categoryId,
        description: 'Tenant URL migration race fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: templateId,
        tenantId,
        title: 'URL migration race',
      });
      await transaction.insert(eventInstances).values({
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
      await transaction.insert(eventRegistrationOptions).values({
        closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
        eventId,
        id: optionId,
        isPaid: true,
        openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
        organizingRegistration: false,
        price: 1000,
        registrationMode: 'fcfs',
        reservedSpots: 1,
        spots: 10,
        title: 'Participant',
      });
      await transaction.insert(eventRegistrations).values({
        basePriceAtRegistration: 1000,
        discountAmount: 0,
        eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'PENDING',
        tenantId,
        userId,
      });
    });

    const { promise: releaseCheckout, resolve: allowCheckoutCommit } =
      Promise.withResolvers<undefined>();
    const { promise: checkoutLocked, resolve: markCheckoutLocked } =
      Promise.withResolvers<undefined>();
    const failures: unknown[] = [];
    const operations: Promise<unknown>[] = [];
    const observeOperation = <T>(operation: Promise<T>) => {
      const observed = Promise.resolve(operation);
      operations.push(observed);
      void observed.catch((error) => {
        if (!failures.includes(error)) failures.push(error);
      });
      return observed;
    };

    try {
      const checkout = observeOperation(
        Effect.runPromise(
          Database.use((effectDatabase) =>
            effectDatabase.transaction((tx) =>
              Effect.gen(function* () {
                const lockedAccount = yield* lockTenantStripeAccount(
                  tx,
                  tenantId,
                );
                expect(lockedAccount).toBe(stripeAccountId);
                yield* tx.insert(transactions).values({
                  amount: 1000,
                  currency: 'EUR',
                  eventId,
                  eventRegistrationId: registrationId,
                  executiveUserId: userId,
                  id: transactionId,
                  method: 'stripe',
                  status: 'pending',
                  stripeAccountId: lockedAccount,
                  targetUserId: userId,
                  tenantId,
                  type: 'registration',
                });
                markCheckoutLocked(undefined);
                yield* Effect.promise(() => releaseCheckout);
              }),
            ),
          ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
        ),
      );
      await Promise.race([checkoutLocked, checkout]);

      const migration = observeOperation(
        runUrlMigration(
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
        ),
      );

      await waitForBlockedTenantLock(pool);
      allowCheckoutCommit(undefined);
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
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    } finally {
      allowCheckoutCommit(undefined);
      for (const result of await Promise.allSettled(operations)) {
        if (result.status === 'rejected' && !failures.includes(result.reason)) {
          failures.push(result.reason);
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Tenant URL checkout race failed', {
        cause: failures[0],
      });
    }
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
            message:
              'This website address is already used by another organization.',
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

  it.each([
    {
      firstUpdate: { theme: 'esn' },
      kind: 'appearance',
      saved: { seoTitle: 'Second editor title' },
      unchanged: { seoTitle: null },
    },
    {
      firstUpdate: { termsText: 'First editor terms' },
      kind: 'legal',
      saved: { legalNoticeText: 'Second editor notice' },
      unchanged: { legalNoticeText: null },
    },
    {
      firstUpdate: { emailSenderName: 'First editor sender' },
      kind: 'organization',
      saved: { emailSenderEmail: 'second-editor@example.test' },
      unchanged: { emailSenderEmail: null },
    },
    {
      firstUpdate: { refundFeesOnCancellation: false },
      kind: 'paymentProvider',
      saved: { receiptSettings: { allowOther: true } },
      unchanged: { receiptSettings: { allowOther: false } },
    },
    {
      firstUpdate: { cancellationDeadlineHoursBeforeStart: 96 },
      kind: 'registration',
      saved: { maxActiveRegistrationsPerUser: 3 },
      unchanged: { maxActiveRegistrationsPerUser: 0 },
    },
    {
      firstUpdate: { theme: 'esn' },
      kind: 'platform',
      saved: { name: 'Second editor name' },
      unchanged: { name: 'Original name' },
    },
  ] as const)(
    'rejects a stale $kind form after waiting for a concurrent settings commit and allows an explicit reload',
    async ({ firstUpdate, kind, saved, unchanged }) => {
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
      const writerDatabase = drizzle({ client: writer, relations });
      const failures: unknown[] = [];
      const recordFailure = (error: unknown) => {
        if (!failures.includes(error)) failures.push(error);
      };
      let waitingSave: ReturnType<typeof runSettingsEdit> | undefined;
      try {
        await writer.query('BEGIN');
        // First editor holds the row lock used by every settings write path.
        await writerDatabase
          .update(tenants)
          .set(firstUpdate)
          .where(eq(tenants.id, tenantId));
        waitingSave = runSettingsEdit(original, kind);
        void waitingSave.catch(recordFailure);
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
        expect(current).toMatchObject(firstUpdate);
        expect(current).toMatchObject(unchanged);
        expect(
          await database.query.platformAuditEntries.findMany({
            where: { targetTenantId: tenantId },
          }),
        ).toEqual([]);

        expect(await runSettingsEdit(current, kind)).toEqual({
          status: 'success',
        });
        const persisted = await database.query.tenants.findFirst({
          where: { id: tenantId },
        });
        expect(persisted).toMatchObject(firstUpdate);
        expect(persisted).toMatchObject(saved);
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
      } catch (error) {
        recordFailure(error);
      } finally {
        try {
          await writer.query('ROLLBACK');
        } catch (error) {
          recordFailure(error);
        }
        try {
          writer.release();
        } catch (error) {
          recordFailure(error);
        }
        if (waitingSave) {
          for (const result of await Promise.allSettled([waitingSave]))
            if (result.status === 'rejected') recordFailure(result.reason);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, `${kind} settings race failed`, {
          cause: failures[0],
        });
    },
    30_000,
  );
});
