import { expect, layer, vi } from '@effect/vitest';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect, Layer } from 'effect';

import { Database, type DatabaseClient } from '../../../../db';
import {
  platformAuditEntries,
  tenantPrivacyPolicyVersions,
  tenants as tenantsTable,
} from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import {
  GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE,
  globalAdminHandlers,
  tenantPrivacyPolicyDigest,
} from './global-admin.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const createHeaders = (
  _permissions: readonly string[],
  _options: { authenticated?: boolean; platformAdministrator?: boolean } = {},
) => ({});

const createRequestContext = (
  permissions: readonly Permission[],
  options: { authenticated?: boolean; platformAdministrator?: boolean } = {},
) =>
  ({
    authData: {},
    authenticated: options.authenticated !== false,
    permissions,
    platformAuthority:
      options.platformAdministrator === false ? null : platformAuthority,
    tenant: {
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    },
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;

const globalAdminHandlerLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(
    RpcRequestContext,
    createRequestContext(['globalAdmin:manageTenants']),
  ),
);

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

layer(globalAdminHandlerLayer)('globalAdminHandlers', (it) => {
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
          name: 'Tenant',
          paymentsConfigured: true,
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
        name: 'Tenant',
        paymentsConfigured: false,
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
      ).pipe(
        Effect.provideService(
          RpcRequestContext,
          createRequestContext(['globalAdmin:manageTenants'], {
            platformAdministrator: false,
          }),
        ),
        Effect.provide(provideDatabase(database)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Evorto administrator access required');
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
          headers: {},
        } as never,
      ).pipe(
        Effect.provideService(
          RpcRequestContext,
          createRequestContext(['globalAdmin:manageTenants'], {
            authenticated: false,
          }),
        ),
        Effect.provide(provideDatabase(database)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcUnauthorizedError');
    }),
  );

  it.effect(
    'summarizes single-dispatch state and bounds an incident-first detail page',
    () =>
      Effect.gen(function* () {
        let itemLimit: number | undefined;
        let itemOrderByExpressions: readonly unknown[] = [];
        const selectResults = [
          [
            { status: 'failed', total: 2 },
            { status: 'queued', total: 1 },
          ],
          [{ total: 1 }],
          [
            {
              deliveryUnknownAt: null,
              id: 'email-1',
              kind: 'receiptReviewed',
              lastAttemptAt: null,
              recipient: 'member@example.org',
              sentAt: null,
              status: 'failed',
              subject: 'Receipt rejected',
              suppressedAt: null,
              tenantDomain: 'section.example.org',
              tenantName: 'Section',
              tenantTimezone: 'Australia/Brisbane',
            },
            {
              deliveryUnknownAt: null,
              id: 'email-2',
              kind: 'registrationConfirmed',
              lastAttemptAt: new Date('2026-07-10T09:15:00.000Z'),
              recipient: 'sent@example.org',
              sentAt: new Date('2026-07-10T09:15:01.000Z'),
              status: 'sent',
              subject: 'Ticket confirmed',
              suppressedAt: null,
              tenantDomain: 'section.example.org',
              tenantName: 'Section',
              tenantTimezone: 'Australia/Brisbane',
            },
            {
              deliveryUnknownAt: null,
              id: 'email-3',
              kind: 'registrationConfirmed',
              lastAttemptAt: new Date('2026-07-10T09:15:00.000Z'),
              recipient: 'incomplete@example.org',
              sentAt: null,
              status: 'sent',
              subject: 'Ticket confirmed',
              suppressedAt: null,
              tenantDomain: 'section.example.org',
              tenantName: 'Section',
              tenantTimezone: 'Australia/Brisbane',
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
                  orderBy: (...expressions: readonly unknown[]) => {
                    itemOrderByExpressions = expressions;
                    return {
                      limit: (limit: number) => {
                        itemLimit = limit;
                        return Effect.succeed(result);
                      },
                    };
                  },
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
          failed: 2,
          queued: 1,
          sending: 0,
          sent: 0,
          staleSending: 1,
          suppressed: 0,
        });
        expect(select).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({ tenantTimezone: expect.anything() }),
        );
        expect(itemOrderByExpressions).toHaveLength(3);
        expect(itemLimit).toBe(100);
        expect(overview.items).toEqual([
          expect.objectContaining({
            id: 'email-1',
            recordIncomplete: true,
            status: 'failed',
            tenantTimezone: 'Australia/Brisbane',
          }),
          expect.objectContaining({
            id: 'email-2',
            recordIncomplete: false,
            status: 'sent',
          }),
          expect.objectContaining({
            id: 'email-3',
            recordIncomplete: true,
            status: 'sent',
          }),
        ]);
        expect(overview.items[0]).not.toHaveProperty('lastError');
        expect(overview.items[0]).not.toHaveProperty('provider');
        expect(overview.items[0]).not.toHaveProperty('tenantId');
      }),
  );

  it.effect('returns a bounded, deterministically ordered audit page', () =>
    Effect.gen(function* () {
      const createdAt = new Date('2026-07-10T09:15:00.000Z');
      const after = {
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          currency: 'EUR',
          domain: 'section.example.org',
          id: 'tenant-1',
          name: 'Section',
          paymentsConfigured: false,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
      } as const;
      const rows = Array.from(
        { length: GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1 },
        (_, index) => ({
          action: 'tenant.create' as const,
          actorEmail: 'platform@example.org',
          actorId: 'auth0|platform-admin',
          after,
          before: null,
          createdAt,
          id: `audit-${(index + 1).toString().padStart(3, '0')}`,
          reason: 'Provision requested by section board',
          targetTenantId: 'tenant-1',
          targetTenantName: 'Section',
        }),
      );
      let limit: number | undefined;
      let orderByExpressions: readonly SQL[] = [];
      let whereExpression: SQL | undefined;
      const selectQuery = {
        from: () => selectQuery,
        leftJoin: () => selectQuery,
        limit: (nextLimit: number) => {
          limit = nextLimit;
          return Effect.succeed(rows);
        },
        orderBy: (...expressions: readonly SQL[]) => {
          orderByExpressions = expressions;
          return selectQuery;
        },
        where: (expression: SQL | undefined) => {
          whereExpression = expression;
          return selectQuery;
        },
      };
      const database = { select: () => selectQuery };

      const page = yield* globalAdminHandlers[
        'globalAdmin.platformAudit.findMany'
      ]({ cursor: null }, { headers: createHeaders([]) } as never).pipe(
        Effect.provide(provideDatabase(database)),
      );

      expect(whereExpression).toBeUndefined();
      expect(limit).toBe(GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1);
      expect(
        orderByExpressions.map(
          (expression) => new PgDialect().sqlToQuery(expression).sql,
        ),
      ).toEqual([
        '"platform_audit_entries"."created_at" desc',
        '"platform_audit_entries"."id" asc',
      ]);
      expect(page.items).toHaveLength(GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE);
      expect(page.items[0]).toEqual(
        expect.objectContaining({
          action: 'tenant.create',
          createdAt: '2026-07-10T09:15:00.000Z',
          id: 'audit-001',
          reason: 'Provision requested by section board',
          targetTenantName: 'Section',
        }),
      );
      expect(page.items[0]).not.toHaveProperty('actorId');
      expect(page.items[0]).not.toHaveProperty('targetTenantId');
      expect(page.items[0]?.after).toEqual({
        resourceType: 'tenant',
        state: {
          currency: 'EUR',
          domain: 'section.example.org',
          name: 'Section',
          paymentsConfigured: false,
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
      });
      expect(page.items.at(-1)?.id).toBe('audit-050');
      expect(page.nextCursor).toEqual({
        createdAt: '2026-07-10T09:15:00.000Z',
        id: 'audit-050',
      });
    }),
  );

  it.effect('projects formatted descriptions as readable audit text', () =>
    Effect.gen(function* () {
      const rows = [
        {
          action: 'event.update' as const,
          actorEmail: 'platform@example.org',
          actorId: 'auth0|platform-admin',
          after: {
            resourceId: 'event-1',
            resourceType: 'event' as const,
            state: {
              description:
                '<p>Welcome <strong>everyone</strong>.</p><ul><li>Bring ID</li></ul>',
            },
          },
          before: {
            resourceId: 'event-1',
            resourceType: 'event' as const,
            state: { description: '<p>Welcome.</p>' },
          },
          createdAt: new Date('2026-07-10T09:15:00.000Z'),
          id: 'audit-001',
          reason: 'Clarify arrival details',
          targetTenantId: 'tenant-1',
          targetTenantName: 'Section',
        },
      ];
      const selectQuery = {
        from: () => selectQuery,
        leftJoin: () => selectQuery,
        limit: () => Effect.succeed(rows),
        orderBy: () => selectQuery,
        where: () => selectQuery,
      };

      const page = yield* globalAdminHandlers[
        'globalAdmin.platformAudit.findMany'
      ]({ cursor: null }, { headers: createHeaders([]) } as never).pipe(
        Effect.provide(provideDatabase({ select: () => selectQuery })),
      );

      expect(page.items[0]?.before?.state.description).toBe('Welcome.');
      expect(page.items[0]?.after?.state.description).toBe(
        'Welcome everyone. Bring ID',
      );
      expect(JSON.stringify(page)).not.toContain('<p>');
    }),
  );

  it.effect(
    'summarizes a same-count tax-rate refresh without returning provider records',
    () =>
      Effect.gen(function* () {
        const createdAt = new Date('2026-07-10T09:15:00.000Z');
        const rows = [
          {
            action: 'taxRates.import' as const,
            actorEmail: 'platform@example.org',
            actorId: 'auth0|platform-admin',
            after: {
              resourceId: 'internal-tax-rate-batch',
              resourceType: 'taxRateBatch' as const,
              state: {
                rates: [
                  {
                    active: true,
                    country: 'DE',
                    displayName: 'Current standard rate',
                    inclusive: true,
                    percentage: '19',
                    state: null,
                    stripeAccountId: 'acct_server_only',
                    stripeTaxRateId: 'txr_standard',
                  },
                  {
                    active: true,
                    country: 'DE',
                    displayName: 'Reduced',
                    inclusive: true,
                    percentage: '7',
                    state: null,
                    stripeAccountId: 'acct_server_only',
                    stripeTaxRateId: 'txr_reduced',
                  },
                ],
              },
            },
            before: {
              resourceId: 'internal-tax-rate-batch',
              resourceType: 'taxRateBatch' as const,
              state: {
                rates: [
                  {
                    active: true,
                    country: 'DE',
                    displayName: 'Old standard rate',
                    inclusive: true,
                    percentage: '19',
                    state: null,
                    stripeAccountId: 'acct_server_only',
                    stripeTaxRateId: 'txr_standard',
                  },
                  {
                    active: true,
                    country: 'DE',
                    displayName: 'Reduced',
                    inclusive: true,
                    percentage: '7',
                    state: null,
                    stripeAccountId: 'acct_server_only',
                    stripeTaxRateId: 'txr_reduced',
                  },
                ],
              },
            },
            createdAt,
            id: 'audit-001',
            reason: 'Add the current tax rates',
            targetTenantId: 'tenant-1',
            targetTenantName: 'Section',
          },
        ];
        const selectQuery = {
          from: () => selectQuery,
          leftJoin: () => selectQuery,
          limit: () => Effect.succeed(rows),
          orderBy: () => selectQuery,
          where: () => selectQuery,
        };

        const page = yield* globalAdminHandlers[
          'globalAdmin.platformAudit.findMany'
        ]({ cursor: null }, { headers: createHeaders([]) } as never).pipe(
          Effect.provide(provideDatabase({ select: () => selectQuery })),
        );

        expect(page.items[0]?.before).toEqual({
          resourceType: 'taxRateBatch',
          state: { taxRateCount: 2 },
        });
        expect(page.items[0]?.after).toEqual({
          resourceType: 'taxRateBatch',
          state: { taxRateCount: 2, taxRateUpdatedCount: 1 },
        });
        expect(JSON.stringify(page)).not.toContain('acct_server_only');
        expect(JSON.stringify(page)).not.toContain('txr_standard');
        expect(JSON.stringify(page)).not.toContain('internal-tax-rate-batch');
      }),
  );

  it.effect('continues after equal timestamps by ascending audit id', () =>
    Effect.gen(function* () {
      const cursor = {
        createdAt: '2026-07-10T09:15:00.000Z',
        id: 'audit-050',
      };
      let whereExpression: SQL | undefined;
      const selectQuery = {
        from: () => selectQuery,
        leftJoin: () => selectQuery,
        limit: () => Effect.succeed([]),
        orderBy: () => selectQuery,
        where: (expression: SQL | undefined) => {
          whereExpression = expression;
          return selectQuery;
        },
      };
      const database = { select: () => selectQuery };

      const page = yield* globalAdminHandlers[
        'globalAdmin.platformAudit.findMany'
      ]({ cursor }, { headers: createHeaders([]) } as never).pipe(
        Effect.provide(provideDatabase(database)),
      );

      expect(page).toEqual({ items: [], nextCursor: null });
      if (!whereExpression) {
        throw new Error('Expected an audit cursor predicate');
      }
      const cursorQuery = new PgDialect().sqlToQuery(whereExpression);
      expect(cursorQuery.sql).toContain(
        '"platform_audit_entries"."created_at" < $1',
      );
      expect(cursorQuery.sql).toContain(
        '"platform_audit_entries"."created_at" = $2',
      );
      expect(cursorQuery.sql).toContain('"platform_audit_entries"."id" > $3');
      expect(cursorQuery.sql).toContain(' or ');
      expect(cursorQuery.sql).toContain(' and ');
      expect(cursorQuery.params).toEqual([
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
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
      ).pipe(
        Effect.provideService(
          RpcRequestContext,
          createRequestContext(['globalAdmin:manageTenants'], {
            platformAdministrator: false,
          }),
        ),
        Effect.provide(provideDatabase(database)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.message).toBe('Evorto administrator access required');
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
              name: 'Example Section',
              stripeAccountId: null,
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
            theme: 'esn',
            timezone: 'Europe/Prague',
          },
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedInsert).toMatchObject({
        currency: 'CZK',
        domain: 'section.example.org',
        name: 'Example Section',
        stripeAccountId: null,
        theme: 'esn',
        timezone: 'Europe/Prague',
      });
      expect(capturedInsert).not.toHaveProperty('privacyPolicyText');
      expect(capturedInsert).not.toHaveProperty('privacyPolicyUrl');
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
          paymentsConfigured: false,
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
        paymentsConfigured: false,
      });
      expect(tenant).not.toHaveProperty('stripeAccountId');
      expect(JSON.stringify(capturedAudit)).not.toContain('stripeAccountId');
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
        expect(error.message).toBe(
          'This website address is already used by another organization.',
        );
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
      expect(error.message).toBe(
        'Add privacy policy text or enter a valid privacy policy web address.',
      );
      expect(error.reason).toBeUndefined();
    }),
  );

  it.effect(
    'updates tenant settings without changing the payment account',
    () =>
      Effect.gen(function* () {
        let capturedAudit: Record<string, unknown> | undefined;
        let capturedUpdate: Record<string, unknown> | undefined;
        const beforeTenant = {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
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
                name: 'Tenant',
                stripeAccountId: 'acct_previous',
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
        const database = {
          insert: (table: unknown) => ({
            values: (value: Record<string, unknown>) => {
              expect(table).toBe(platformAuditEntries);
              capturedAudit = value;
              return Effect.void;
            },
          }),
          query: {
            tenants: {
              findFirst: () =>
                Effect.succeed({
                  id: 'tenant-1',
                  stripeAccountId: 'acct_previous',
                }),
            },
          },
          select: () => selectQuery,
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
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(capturedUpdate).toMatchObject({
          domain: 'tenant.example.com',
          name: 'Tenant',
        });
        expect(capturedUpdate).not.toHaveProperty('stripeAccountId');
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
            paymentsConfigured: true,
          },
        });
        expect(capturedAudit?.['after']).toMatchObject({
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: {
            name: 'Tenant',
            paymentsConfigured: true,
          },
        });
        expect(JSON.stringify(capturedAudit)).not.toContain('stripeAccountId');
        expect(tenant.paymentsConfigured).toBe(true);
        expect(tenant).not.toHaveProperty('stripeAccountId');
      }),
  );

  it.effect(
    'blocks public URL migrations for pending payment links or active transfer offers after locking the tenant',
    () =>
      Effect.gen(function* () {
        const scenarios = [
          {
            activeRegistrationTransfers: false,
            pendingStripeObligations: true,
            reasonFragment: 'every payment or refund',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: false,
            reasonFragment: 'active ticket transfer',
          },
          {
            activeRegistrationTransfers: true,
            pendingStripeObligations: true,
            reasonFragment: 'every payment, refund, and active ticket transfer',
          },
        ] as const;

        for (const scenario of scenarios) {
          const beforeTenant = {
            currency: 'EUR' as const,
            domain: 'tenant.example.com',
            id: 'tenant-1',
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
                findFirst: () =>
                  Effect.succeed({
                    id: 'tenant-1',
                    stripeAccountId: 'acct_current',
                  }),
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
            message: "The organization's public address cannot be changed yet.",
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
          name: 'Tenant',
          stripeAccountId: 'acct_current',
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
              findFirst: () =>
                Effect.succeed({
                  id: 'tenant-1',
                  stripeAccountId: 'acct_current',
                }),
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
          'Currency cannot be changed after financial information has been added.',
        );
        expect(error.reason).toBe(
          'This organization already has templates, events, receipts, or payments. Keep the current currency to save these settings.',
        );
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'updates ordinary tenant settings without exposing the payment account',
    () =>
      Effect.gen(function* () {
        const beforeTenant = {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
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
              findFirst: () =>
                Effect.succeed({
                  id: 'tenant-1',
                  stripeAccountId: 'acct_current',
                }),
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
              theme: 'evorto',
              timezone: 'Europe/Berlin',
            },
          },
          { headers: createHeaders([]) } as never,
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(tenant.name).toBe('Tenant after update');
        expect(tenant.paymentsConfigured).toBe(true);
        expect(tenant).not.toHaveProperty('stripeAccountId');
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
        expect(error.message).toBe(
          'This website address is already used by another organization.',
        );
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
      expect(error.message).toBe(
        'Enter a name and a valid public address for this organization.',
      );
      expect(error.reason).toBeUndefined();
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
        expect(error.message).toBe(
          'Enter a name and a valid public address for this organization.',
        );
        expect(error.reason).toBeUndefined();
      }),
  );
});
