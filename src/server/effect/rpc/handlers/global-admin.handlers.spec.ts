import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import {
  platformAuditEntries,
  tenantPrivacyPolicyVersions,
  tenants as tenantsTable,
} from '../../../../db/schema';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import { StripeClient } from '../../../stripe-client';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import {
  globalAdminHandlers,
  tenantPrivacyPolicyDigest,
} from './global-admin.handlers';

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const createHeaders = (
  permissions: readonly string[],
  options: { authenticated?: boolean; platformAdministrator?: boolean } = {},
) => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]:
    options.authenticated === false ? 'false' : 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson(permissions),
  [RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY]: encodeRpcContextHeaderJson(
    options.platformAdministrator === false ? null : platformAuthority,
  ),
});

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

class RotationStripeHttpClient extends Stripe.HttpClient {
  override getClientName(): string {
    return 'evorto-global-admin-rotation-test';
  }

  override makeRequest(
    ...arguments_: Parameters<
      InstanceType<typeof Stripe.HttpClient>['makeRequest']
    >
  ): Promise<RotationStripeResponse> {
    const [host, , path, method] = arguments_;
    if (
      host !== 'api.stripe.com' ||
      method !== 'GET' ||
      (path !== '/v1/tax_rates' && !path.startsWith('/v1/tax_rates?'))
    ) {
      return Promise.reject(
        new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
      );
    }
    return Promise.resolve(
      new RotationStripeResponse({
        data: [],
        has_more: false,
        object: 'list',
        url: '/v1/tax_rates',
      }),
    );
  }
}

class RotationStripeResponse extends Stripe.HttpClientResponse {
  constructor(private readonly body: unknown) {
    super(200, { 'request-id': 'req_rotation_tax_rates' });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

const provideStripeRotation = (database: object) =>
  Layer.mergeAll(
    provideDatabase(database),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_global_admin_rotation', {
        httpClient: new RotationStripeHttpClient(),
        maxNetworkRetries: 0,
      }),
    ),
  );

const createStripeAccountChangeDatabase = ({
  hasPaidEventConfiguration = false,
  hasPendingStripeObligations = false,
  hasStripeTaxRateConfiguration = false,
  nextStripeAccountId,
}: {
  readonly hasPaidEventConfiguration?: boolean;
  readonly hasPendingStripeObligations?: boolean;
  readonly hasStripeTaxRateConfiguration?: boolean;
  readonly nextStripeAccountId: null | string;
}) => {
  const operations: string[] = [];
  let capturedUpdate: Record<string, unknown> | undefined;
  let nonTaxLimitedSelectCount = 0;
  let taxRateConfigurationSelectCount = 0;
  const beforeTenant = {
    currency: 'EUR',
    domain: 'tenant.example.com',
    id: 'tenant-1',
    locale: 'de-DE',
    name: 'Tenant',
    stripeAccountId: 'acct_current',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  };
  const updateQuery = {
    returning: () => {
      operations.push('tenant-update');
      return Effect.succeed([
        { ...beforeTenant, stripeAccountId: nextStripeAccountId },
      ]);
    },
    set: (value: Record<string, unknown>) => {
      capturedUpdate = value;
      return updateQuery;
    },
    where: () => updateQuery,
  };
  const database = {
    delete: () => ({
      where: () => {
        operations.push('tax-metadata-delete');
        return Effect.void;
      },
    }),
    insert: () => ({
      values: () => {
        operations.push('audit-insert');
        return Effect.void;
      },
    }),
    query: {
      tenants: {
        findFirst: () => Effect.succeed(beforeTenant),
      },
    },
    select: (selection: Record<string, unknown>) => {
      if (Reflect.has(selection, 'currency')) {
        const lockQuery = {
          for: () => {
            operations.push('tenant-lock');
            return Effect.succeed([beforeTenant]);
          },
          from: () => lockQuery,
          where: () => lockQuery,
        };
        return lockQuery;
      }

      const isStripeTaxRateConfigurationQuery = Reflect.has(
        selection,
        'stripeTaxRateId',
      );
      const isStripeTaxRateRotationBindingQuery = Reflect.has(
        selection,
        'sourceStripeTaxRateId',
      );
      const isStripeAccountRead = Reflect.has(selection, 'stripeAccountId');
      const limitedQuery = {
        for: () => {
          operations.push('tax-rate-rotation-binding-check');
          return Effect.succeed(
            isStripeTaxRateRotationBindingQuery ? [] : [beforeTenant],
          );
        },
        from: () => limitedQuery,
        innerJoin: () => limitedQuery,
        limit: () => {
          if (isStripeAccountRead) {
            operations.push('rotated-account-check');
            return Effect.succeed([{ stripeAccountId: nextStripeAccountId }]);
          }
          if (isStripeTaxRateConfigurationQuery) {
            taxRateConfigurationSelectCount += 1;
            operations.push('tax-rate-configuration-check');
            return Effect.succeed(
              hasStripeTaxRateConfiguration &&
                taxRateConfigurationSelectCount === 1
                ? [{ stripeTaxRateId: 'txr_assigned' }]
                : [],
            );
          }

          const selectIndex = nonTaxLimitedSelectCount++;
          if (selectIndex === 0) {
            operations.push('pending-obligation-check');
            return Effect.succeed(
              hasPendingStripeObligations
                ? [{ id: 'pending-obligation-1' }]
                : [],
            );
          }

          operations.push('paid-configuration-check');
          return Effect.succeed(
            hasPaidEventConfiguration && selectIndex === 1
              ? [{ id: 'paid-configuration-1' }]
              : [],
          );
        },
        orderBy: () => limitedQuery,
        where: () => limitedQuery,
      };
      return limitedQuery;
    },
    transaction: (operation: (transaction: object) => unknown) =>
      operation(database),
    update: () => updateQuery,
  };

  return {
    capturedUpdate: () => capturedUpdate,
    database,
    operations,
  };
};

const createStripeAccountUpdateInput = (stripeAccountId?: string) => ({
  id: 'tenant-1',
  reason: 'Change the connected Stripe account',
  tenant: {
    currency: 'EUR' as const,
    domain: 'tenant.example.com',
    name: 'Tenant',
    stripeAccountId,
    theme: 'evorto' as const,
    timezone: 'Europe/Berlin' as const,
  },
});

describe('globalAdminHandlers', () => {
  it.effect('allows tenant reads through explicit platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const tenants = yield* globalAdminHandlers[
        'globalAdmin.tenants.findMany'
      ](undefined, {
        headers: createHeaders(['globalAdmin:manageTenants']),
      } as never).pipe(Effect.provide(provideDatabase(database)));

      expect(tenants).toEqual([]);
    }),
  );

  it.effect('does not require tenant permissions for platform reads', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () =>
              Effect.succeed([
                {
                  currency: 'EUR',
                  domain: 'tenant.example.com',
                  id: 'tenant-1',
                  locale: 'de-DE',
                  name: 'Tenant',
                  stripeAccountId: 'acct_123',
                  theme: 'esn',
                  timezone: 'Europe/Berlin',
                },
              ]),
          },
        },
      };

      const tenants = yield* globalAdminHandlers[
        'globalAdmin.tenants.findMany'
      ](undefined, { headers: createHeaders([]) } as never).pipe(
        Effect.provide(provideDatabase(database)),
      );

      expect(tenants).toEqual([
        {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          locale: 'de-DE',
          name: 'Tenant',
          stripeAccountId: 'acct_123',
          stripeConnected: true,
          theme: 'esn',
          timezone: 'Europe/Berlin',
        },
      ]);
    }),
  );

  it.effect('returns one tenant for global-admin detail review', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: ({ where }: { where: { id: string } }) =>
              Effect.succeed(
                where.id === 'tenant-1'
                  ? {
                      currency: 'EUR',
                      domain: 'tenant.example.com',
                      id: 'tenant-1',
                      locale: 'de-DE',
                      name: 'Tenant',
                      stripeAccountId: null,
                      theme: 'evorto',
                      timezone: 'Europe/Berlin',
                    }
                  : undefined,
              ),
          },
        },
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'tenant-1' },
        {
          headers: createHeaders(['globalAdmin:manageTenants']),
        } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(tenant).toEqual({
        currency: 'EUR',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        locale: 'de-DE',
        name: 'Tenant',
        stripeAccountId: null,
        stripeConnected: false,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      });
    }),
  );

  it.effect('returns null for missing global-admin tenant details', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.succeed(),
          },
        },
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'missing-tenant' },
        {
          headers: createHeaders(['globalAdmin:manageTenants']),
        } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(tenant).toBeNull();
    }),
  );

  it.effect('rejects signed-in users without explicit platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findMany'](
        undefined,
        {
          headers: createHeaders(['globalAdmin:manageTenants'], {
            platformAdministrator: false,
          }),
        } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Platform administrator authority required');
    }),
  );

  it.effect('rejects anonymous tenant reads before querying tenants', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findMany'](
        undefined,
        {
          headers: {
            [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'false',
            [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
              'globalAdmin:manageTenants',
            ]),
            [RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY]:
              encodeRpcContextHeaderJson(platformAuthority),
          },
        } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcUnauthorizedError');
    }),
  );

  it.effect('summarizes email outbox retry and exhaustion state', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:00:00.000Z');
      const exhaustedAt = new Date('2026-07-09T09:00:00.000Z');
      const selectResults = [
        [
          { status: 'failed', total: 2 },
          { status: 'queued', total: 1 },
        ],
        [{ total: 1 }],
        [{ total: 1 }],
        [{ total: 1 }],
        [
          {
            attempts: 8,
            createdAt: now,
            deliveryUnknownAt: null,
            exhaustedAt,
            id: 'email-1',
            kind: 'receiptReviewed',
            lastAttemptAt: exhaustedAt,
            lastError: 'tem email request failed with HTTP 400',
            maxAttempts: 8,
            nextAttemptAt: exhaustedAt,
            provider: 'tem',
            providerMessageId: null,
            recipient: 'member@example.org',
            sentAt: null,
            status: 'failed',
            subject: 'Receipt rejected',
            suppressedAt: null,
            tenantDomain: 'section.example.org',
            tenantId: 'tenant-1',
            tenantName: 'Section',
            tenantTimezone: 'Australia/Brisbane',
            updatedAt: exhaustedAt,
          },
        ],
      ];
      const select = vi.fn(() => {
        const result = selectResults.shift();
        if (!result) {
          throw new Error('unexpected select');
        }
        return {
          from: () => ({
            groupBy: () => Effect.succeed(result),
            innerJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Effect.succeed(result),
                }),
              }),
            }),
            where: () => Effect.succeed(result),
          }),
        };
      });
      const database = { select };

      const overview = yield* globalAdminHandlers[
        'globalAdmin.emailOutbox.findOverview'
      ](undefined, {
        headers: createHeaders(['globalAdmin:manageTenants']),
      } as never).pipe(Effect.provide(provideDatabase(database)));

      expect(overview.summary).toEqual({
        deliveryUnknown: 0,
        exhausted: 1,
        failed: 2,
        queued: 1,
        sending: 0,
        sent: 0,
        staleSending: 1,
        suppressed: 0,
        waitingForRetry: 1,
      });
      expect(select).toHaveBeenNthCalledWith(
        5,
        expect.objectContaining({ tenantTimezone: expect.anything() }),
      );
      expect(overview.items).toEqual([
        expect.objectContaining({
          exhaustedAt: '2026-07-09T09:00:00.000Z',
          id: 'email-1',
          lastError: 'tem email request failed with HTTP 400',
          status: 'failed',
          tenantTimezone: 'Australia/Brisbane',
        }),
      ]);
    }),
  );

  it.effect('returns application append-only platform audit entries', () =>
    Effect.gen(function* () {
      const createdAt = new Date('2026-07-10T09:15:00.000Z');
      const after = {
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          currency: 'EUR',
          domain: 'section.example.org',
          id: 'tenant-1',
          locale: 'de-DE',
          name: 'Section',
          stripeAccountId: null,
          stripeConnected: false,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
      } as const;
      const selectQuery = {
        from: () => selectQuery,
        leftJoin: () => selectQuery,
        limit: () =>
          Effect.succeed([
            {
              action: 'tenant.create' as const,
              actorEmail: 'platform@example.org',
              actorId: 'auth0|platform-admin',
              after,
              before: null,
              createdAt,
              id: 'audit-1',
              reason: 'Provision requested by section board',
              targetTenantId: 'tenant-1',
              targetTenantName: 'Section',
            },
          ]),
        orderBy: () => selectQuery,
      };
      const database = { select: () => selectQuery };

      const entries = yield* globalAdminHandlers[
        'globalAdmin.platformAudit.findMany'
      ](undefined, { headers: createHeaders([]) } as never).pipe(
        Effect.provide(provideDatabase(database)),
      );

      expect(entries).toEqual([
        expect.objectContaining({
          action: 'tenant.create',
          actorId: 'auth0|platform-admin',
          createdAt: '2026-07-10T09:15:00.000Z',
          reason: 'Provision requested by section board',
          targetTenantId: 'tenant-1',
          targetTenantName: 'Section',
        }),
      ]);
    }),
  );

  it.effect('rejects tenant detail reads without platform authority', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
        { id: 'tenant-1' },
        {
          headers: createHeaders(['globalAdmin:manageTenants'], {
            platformAdministrator: false,
          }),
        } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Platform administrator authority required');
    }),
  );

  it.effect('creates tenants with normalized operational settings', () =>
    Effect.gen(function* () {
      let capturedAudit: Record<string, unknown> | undefined;
      let capturedInsert: Record<string, unknown> | undefined;
      let capturedPrivacyPolicy: Record<string, unknown> | undefined;
      const insertQuery = {
        returning: () =>
          Effect.succeed([
            {
              currency: 'CZK',
              domain: 'section.example.org',
              id: 'tenant-1',
              locale: 'de-DE',
              name: 'Example Section',
              stripeAccountId: 'acct_123',
              theme: 'esn',
              timezone: 'Europe/Prague',
            },
          ]),
        values: (value: Record<string, unknown>) => {
          capturedInsert = value;
          return insertQuery;
        },
      };
      const database = {
        insert: (table: unknown) => {
          if (table === tenantsTable) {
            return insertQuery;
          }
          if (table === tenantPrivacyPolicyVersions) {
            return {
              values: (value: Record<string, unknown>) => {
                capturedPrivacyPolicy = value;
                return {
                  returning: () => Effect.succeed([{ id: 'policy-1' }]),
                };
              },
            };
          }

          expect(table).toBe(platformAuditEntries);
          return {
            values: (value: Record<string, unknown>) => {
              capturedAudit = value;
              return Effect.void;
            },
          };
        },
        query: {
          tenants: {
            findFirst: () => Effect.succeed(),
          },
        },
        transaction: (operation: (transaction: object) => unknown) =>
          operation(database),
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: ' Section privacy policy ',
            privacyPolicyUrl: '',
          },
          reason: ' Provision requested by section board ',
          tenant: {
            currency: 'CZK',
            domain: ' https://Section.Example.Org ',
            name: ' Example Section ',
            stripeAccountId: ' acct_123 ',
            theme: 'esn',
            timezone: 'Europe/Prague',
          },
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedInsert).toMatchObject({
        currency: 'CZK',
        domain: 'section.example.org',
        locale: 'de-DE',
        name: 'Example Section',
        privacyPolicyText: 'Section privacy policy',
        privacyPolicyUrl: null,
        stripeAccountId: 'acct_123',
        theme: 'esn',
        timezone: 'Europe/Prague',
      });
      expect(capturedAudit).toMatchObject({
        action: 'tenant.create',
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        before: null,
        reason: 'Provision requested by section board',
        targetTenantId: 'tenant-1',
      });
      expect(capturedAudit?.['after']).toMatchObject({
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          domain: 'section.example.org',
          id: 'tenant-1',
          privacyPolicyDigestSha256: tenantPrivacyPolicyDigest({
            privacyPolicyText: 'Section privacy policy',
            privacyPolicyUrl: null,
          }),
          privacyPolicyVersionId: 'policy-1',
        },
      });
      expect(JSON.stringify(capturedAudit?.['after'])).not.toContain(
        'Section privacy policy',
      );
      expect(JSON.stringify(capturedAudit?.['after'])).not.toContain(
        'privacyPolicyUrl',
      );
      expect(capturedPrivacyPolicy).toEqual({
        createdByUserId: null,
        privacyPolicyText: 'Section privacy policy',
        privacyPolicyUrl: null,
        tenantId: 'tenant-1',
        version: 1,
      });
      expect(tenant).toMatchObject({
        domain: 'section.example.org',
        name: 'Example Section',
        stripeAccountId: 'acct_123',
        stripeConnected: true,
      });
    }),
  );

  it.effect(
    'maps duplicate tenant domains to bad requests before inserting',
    () =>
      Effect.gen(function* () {
        const database = {
          insert: () => {
            throw new Error('insert should not run');
          },
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'existing-tenant' }),
            },
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
          {
            initialPrivacyPolicy: {
              privacyPolicyText: 'Tenant privacy policy',
              privacyPolicyUrl: '',
            },
            reason: 'Provision requested by tenant board',
            tenant: {
              currency: 'EUR',
              domain: 'Tenant.Example.com',
              name: 'Duplicate Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Organization domain already exists');
        expect(error.reason).toBe('tenant.example.com');
      }),
  );

  it.effect('requires an initial privacy policy before tenant creation', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.fail(new Error('database should not run')),
          },
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: ' ',
            privacyPolicyUrl: '',
          },
          reason: 'Provision requested by tenant board',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com',
            name: 'Tenant',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        { headers: createHeaders([]) } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toContain('privacy policy');
    }),
  );

  it.effect('updates tenants and clears blank Stripe account ids', () =>
    Effect.gen(function* () {
      let capturedAudit: Record<string, unknown> | undefined;
      let capturedUpdate: Record<string, unknown> | undefined;
      let deletedTaxMetadata = false;
      const beforeTenant = {
        currency: 'EUR',
        domain: 'tenant.example.com',
        id: 'tenant-1',
        locale: 'de-DE',
        name: 'Tenant before update',
        stripeAccountId: 'acct_previous',
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      };
      const updateQuery = {
        returning: () =>
          Effect.succeed([
            {
              currency: 'EUR',
              domain: 'tenant.example.com',
              id: 'tenant-1',
              locale: 'de-DE',
              name: 'Tenant',
              stripeAccountId: null,
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          ]),
        set: (value: Record<string, unknown>) => {
          capturedUpdate = value;
          return updateQuery;
        },
        where: () => updateQuery,
      };
      const selectQuery = {
        for: () => Effect.succeed([beforeTenant]),
        from: () => selectQuery,
        where: () => selectQuery,
      };
      const pendingObligationsQuery = {
        from: () => pendingObligationsQuery,
        innerJoin: () => pendingObligationsQuery,
        limit: () => Effect.succeed([]),
        where: () => pendingObligationsQuery,
      };
      let selectCount = 0;
      const database = {
        delete: () => ({
          where: () => {
            deletedTaxMetadata = true;
            return Effect.void;
          },
        }),
        insert: (table: unknown) => ({
          values: (value: Record<string, unknown>) => {
            expect(table).toBe(platformAuditEntries);
            capturedAudit = value;
            return Effect.void;
          },
        }),
        query: {
          tenants: {
            findFirst: () => Effect.succeed({ id: 'tenant-1' }),
          },
        },
        select: () =>
          selectCount++ === 0 ? selectQuery : pendingObligationsQuery,
        transaction: (operation: (transaction: object) => unknown) =>
          operation(database),
        update: () => updateQuery,
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
        {
          id: 'tenant-1',
          reason: ' Tenant requested a support correction ',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com',
            name: 'Tenant',
            stripeAccountId: ' ',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedUpdate).toMatchObject({
        domain: 'tenant.example.com',
        locale: 'de-DE',
        name: 'Tenant',
        stripeAccountId: null,
      });
      expect(deletedTaxMetadata).toBe(true);
      expect(capturedAudit).toMatchObject({
        action: 'tenant.update',
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        reason: 'Tenant requested a support correction',
        targetTenantId: 'tenant-1',
      });
      expect(capturedAudit?.['before']).toMatchObject({
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          name: 'Tenant before update',
          stripeAccountId: 'acct_previous',
        },
      });
      expect(capturedAudit?.['after']).toMatchObject({
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          locale: 'de-DE',
          name: 'Tenant',
          stripeAccountId: null,
        },
      });
      expect(tenant.stripeConnected).toBe(false);
    }),
  );

  it.effect('blocks Stripe account changes while obligations are pending', () =>
    Effect.gen(function* () {
      const beforeSelect = {
        for: () =>
          Effect.succeed([
            {
              currency: 'EUR',
              domain: 'tenant.example.com',
              id: 'tenant-1',
              locale: 'de-DE',
              name: 'Tenant',
              stripeAccountId: 'acct_current',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          ]),
        from: () => beforeSelect,
        where: () => beforeSelect,
      };
      const obligationsSelect = {
        from: () => obligationsSelect,
        limit: () => Effect.succeed([{ id: 'pending-checkout' }]),
        where: () => obligationsSelect,
      };
      let selectCount = 0;
      const update = vi.fn(() => {
        throw new Error('tenant update should not run');
      });
      const insert = vi.fn(() => {
        throw new Error('audit insert should not run');
      });
      const database = {
        insert,
        query: {
          tenants: {
            findFirst: () => Effect.succeed({ id: 'tenant-1' }),
          },
        },
        select: () => (selectCount++ === 0 ? beforeSelect : obligationsSelect),
        transaction: (operation: (transaction: object) => unknown) =>
          operation(database),
        update,
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
        {
          id: 'tenant-1',
          reason: 'Migrate the connected Stripe account',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com',
            name: 'Tenant',
            stripeAccountId: 'acct_next',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        { headers: createHeaders([]) } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'Stripe account cannot change while registration Checkouts or refunds are pending',
      );
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'allows Stripe account rotation after locking when no tax-rate bindings exist',
    () =>
      Effect.gen(function* () {
        const fixture = createStripeAccountChangeDatabase({
          hasPaidEventConfiguration: true,
          nextStripeAccountId: 'acct_next',
        });

        const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          createStripeAccountUpdateInput('acct_next'),
          { headers: createHeaders([]) } as never,
        ).pipe(Effect.provide(provideStripeRotation(fixture.database)));

        expect(fixture.capturedUpdate()?.['stripeAccountId']).toBe('acct_next');
        expect(tenant.stripeAccountId).toBe('acct_next');
        expect(fixture.operations).toEqual([
          'tenant-lock',
          'pending-obligation-check',
          'tax-rate-rotation-binding-check',
          'tax-rate-rotation-binding-check',
          'tax-rate-rotation-binding-check',
          'tax-rate-rotation-binding-check',
          'tax-metadata-delete',
          'tenant-update',
          'rotated-account-check',
          'audit-insert',
        ]);
      }),
  );

  it.effect(
    'blocks Stripe disconnect while tax-rate bindings remain assigned',
    () =>
      Effect.gen(function* () {
        const fixture = createStripeAccountChangeDatabase({
          hasStripeTaxRateConfiguration: true,
          nextStripeAccountId: null,
        });
        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          createStripeAccountUpdateInput(),
          {
            headers: createHeaders([]),
          } as never,
        ).pipe(Effect.provide(provideDatabase(fixture.database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Stripe account cannot be disconnected while tax rates remain assigned',
        );
        expect(fixture.operations).not.toContain('tax-metadata-delete');
        expect(fixture.operations).not.toContain('tenant-update');
        expect(fixture.operations).not.toContain('audit-insert');
      }),
  );

  it.effect(
    'rejects a true disconnect with paid configuration before tax cleanup or mutation',
    () =>
      Effect.gen(function* () {
        const fixture = createStripeAccountChangeDatabase({
          hasPaidEventConfiguration: true,
          hasStripeTaxRateConfiguration: true,
          nextStripeAccountId: null,
        });

        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          createStripeAccountUpdateInput(),
          {
            headers: createHeaders([]),
          } as never,
        ).pipe(Effect.provide(provideDatabase(fixture.database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Stripe account cannot be disconnected while paid event configuration exists',
        );
        expect(fixture.operations).toEqual([
          'tenant-lock',
          'pending-obligation-check',
          'paid-configuration-check',
        ]);
      }),
  );

  it.effect(
    'blocks public URL migrations for pending Stripe links or active transfer offers after locking the tenant',
    () =>
      Effect.gen(function* () {
        const scenarios = [
          {
            activeRegistrationTransfers: false,
            pendingStripeObligations: true,
            reasonFragment: 'pending Stripe Checkout or refund',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: false,
            reasonFragment: 'active registration transfer',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: true,
            reasonFragment:
              'pending Stripe Checkout or refund and every active registration transfer',
          },
        ] as const;

        for (const scenario of scenarios) {
          const beforeTenant = {
            currency: 'EUR' as const,
            domain: 'tenant.example.com',
            id: 'tenant-1',
            locale: 'de-DE',
            name: 'Tenant',
            stripeAccountId: 'acct_current',
            theme: 'evorto' as const,
            timezone: 'Europe/Berlin' as const,
          };
          const lockTenant = vi.fn(() => Effect.succeed([beforeTenant]));
          const beforeSelect = {
            for: lockTenant,
            from: () => beforeSelect,
            where: () => beforeSelect,
          };
          const limitedSelect = (rows: readonly { id: string }[]) => {
            const query = {
              from: () => query,
              limit: () => Effect.succeed(rows),
              where: () => query,
            };
            return query;
          };
          const selectResults = [
            beforeSelect,
            limitedSelect(
              scenario.pendingStripeObligations
                ? [{ id: 'pending-checkout' }]
                : [],
            ),
            limitedSelect(
              scenario.activeRegistrationTransfers
                ? [{ id: 'active-transfer' }]
                : [],
            ),
          ];
          const select = vi.fn(() => {
            const result = selectResults.shift();
            if (!result) {
              throw new Error('unexpected select');
            }
            return result;
          });
          const update = vi.fn(() => {
            throw new Error('tenant update should not run');
          });
          const insert = vi.fn(() => {
            throw new Error('audit insert should not run');
          });
          const database = {
            insert,
            query: {
              tenants: {
                findFirst: () => Effect.succeed({ id: 'tenant-1' }),
              },
            },
            select,
            transaction: (operation: (transaction: object) => unknown) =>
              operation(database),
            update,
          };

          const error = yield* globalAdminHandlers[
            'globalAdmin.tenants.update'
          ](
            {
              id: 'tenant-1',
              reason: 'Move the tenant to its verified replacement domain',
              tenant: {
                currency: 'EUR',
                domain: 'new.example.com',
                name: 'Tenant',
                stripeAccountId: 'acct_current',
                theme: 'evorto',
                timezone: 'Europe/Berlin',
              },
            },
            { headers: createHeaders([]) } as never,
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error._tag).toBe('GlobalAdminTenantUrlMigrationBlockedError');
          if (error._tag !== 'GlobalAdminTenantUrlMigrationBlockedError') {
            return yield* Effect.die(
              new Error('Expected a typed tenant URL migration error'),
            );
          }
          expect(error).toMatchObject({
            activeRegistrationTransfers: scenario.activeRegistrationTransfers,
            pendingStripeObligations: scenario.pendingStripeObligations,
            tenantId: 'tenant-1',
          });
          expect(error.reason).toContain(scenario.reasonFragment);
          expect(lockTenant).toHaveBeenCalledWith('update');
          expect(select).toHaveBeenCalledTimes(3);
          expect(update).not.toHaveBeenCalled();
          expect(insert).not.toHaveBeenCalled();
        }
      }),
  );

  it.effect(
    'blocks audited platform currency overrides when template prices already exist',
    () =>
      Effect.gen(function* () {
        const beforeTenant = {
          currency: 'EUR' as const,
          domain: 'tenant.example.com',
          id: 'tenant-1',
          locale: 'de-DE',
          name: 'Tenant',
          stripeAccountId: null,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        };
        const beforeSelect = {
          for: () => Effect.succeed([beforeTenant]),
          from: () => beforeSelect,
          where: () => beforeSelect,
        };
        const update = vi.fn(() => {
          throw new Error('tenant update should not run');
        });
        const insert = vi.fn(() => {
          throw new Error('audit insert should not run');
        });
        const database = {
          insert,
          query: {
            eventInstances: {
              findFirst: () => {
                throw new Error(
                  'event query should not run after template hit',
                );
              },
            },
            eventTemplates: {
              findFirst: () => Effect.succeed({ id: 'template-1' }),
            },
            financeReceipts: {
              findFirst: () => {
                throw new Error(
                  'receipt query should not run after template hit',
                );
              },
            },
            tenants: {
              findFirst: () => Effect.succeed({ id: 'tenant-1' }),
            },
            transactions: {
              findFirst: () => {
                throw new Error(
                  'transaction query should not run after template hit',
                );
              },
            },
          },
          select: () => beforeSelect,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update,
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            id: 'tenant-1',
            reason: 'Switch the tenant to Australian dollars',
            tenant: {
              currency: 'AUD',
              domain: 'tenant.example.com',
              name: 'Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders([]) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Tenant currency is locked by existing financial configuration',
        );
        expect(error.reason).toContain('dedicated currency migration');
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'allows non-Stripe tenant edits when the connected account is unchanged',
    () =>
      Effect.gen(function* () {
        const beforeTenant = {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          locale: 'de-DE',
          name: 'Tenant before update',
          stripeAccountId: 'acct_current',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        };
        const beforeSelect = {
          for: () => Effect.succeed([beforeTenant]),
          from: () => beforeSelect,
          where: () => beforeSelect,
        };
        const updateQuery = {
          returning: () =>
            Effect.succeed([{ ...beforeTenant, name: 'Tenant after update' }]),
          set: () => updateQuery,
          where: () => updateQuery,
        };
        const select = vi.fn(() => beforeSelect);
        const database = {
          insert: () => ({ values: () => Effect.void }),
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'tenant-1' }),
            },
          },
          select,
          transaction: (operation: (transaction: object) => unknown) =>
            operation(database),
          update: () => updateQuery,
        };

        const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            id: 'tenant-1',
            reason: 'Correct the tenant display name',
            tenant: {
              currency: 'EUR',
              domain: 'tenant.example.com',
              name: 'Tenant after update',
              stripeAccountId: 'acct_current',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders([]) } as never,
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(tenant.name).toBe('Tenant after update');
        expect(select).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect(
    'maps duplicate tenant domains to bad requests before updating',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            tenants: {
              findFirst: () => Effect.succeed({ id: 'other-tenant' }),
            },
          },
          update: () => {
            throw new Error('update should not run');
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.update'](
          {
            id: 'tenant-1',
            reason: 'Tenant requested a domain correction',
            tenant: {
              currency: 'EUR',
              domain: 'Tenant.Example.com',
              name: 'Duplicate Tenant',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Organization domain already exists');
        expect(error.reason).toBe('tenant.example.com');
      }),
  );

  it.effect('rejects invalid tenant domains before mutating tenants', () =>
    Effect.gen(function* () {
      const database = {
        insert: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          initialPrivacyPolicy: {
            privacyPolicyText: 'Tenant privacy policy',
            privacyPolicyUrl: '',
          },
          reason: 'Provision requested by tenant board',
          tenant: {
            currency: 'EUR',
            domain: 'section.example.org/path',
            name: 'Section',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant settings');
    }),
  );

  it.effect(
    'rejects credential-like domains before deriving a trusted origin',
    () =>
      Effect.gen(function* () {
        const database = {
          insert: () => {
            throw new Error('database should not be touched');
          },
          query: {
            tenants: {
              findFirst: () =>
                Effect.fail(new Error('database should not be touched')),
            },
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.create'](
          {
            initialPrivacyPolicy: {
              privacyPolicyText: 'Tenant privacy policy',
              privacyPolicyUrl: '',
            },
            reason: 'Provision requested by tenant board',
            tenant: {
              currency: 'EUR',
              domain: 'section.example.org@attacker.invalid',
              name: 'Section',
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Invalid tenant settings');
        expect(error.reason).toContain('single host name');
      }),
  );
});
