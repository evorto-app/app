import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database, type DatabaseClient } from '../../../../db';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { globalAdminHandlers } from './global-admin.handlers';

const createHeaders = (permissions: readonly string[]) => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson(permissions),
});

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

describe('globalAdminHandlers', () => {
  it.effect(
    'allows tenant reads through the explicit management permission',
    () =>
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

  it.effect('allows tenant reads through the global-admin wildcard', () =>
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
                  locale: 'en-GB',
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
      ](undefined, { headers: createHeaders(['globalAdmin:*']) } as never).pipe(
        Effect.provide(provideDatabase(database)),
      );

      expect(tenants).toEqual([
        {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          locale: 'en-GB',
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
                      locale: 'en-GB',
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
        locale: 'en-GB',
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

  it.effect(
    'rejects signed-in users without tenant-management permission',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            tenants: {
              findMany: () => Effect.fail(new Error('database should not run')),
            },
          },
        };

        const error = yield* globalAdminHandlers[
          'globalAdmin.tenants.findMany'
        ](undefined, {
          headers: createHeaders(['events:viewPublic']),
        } as never).pipe(
          Effect.provide(provideDatabase(database)),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error.permission).toBe('globalAdmin:manageTenants');
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
            exhaustedAt,
            id: 'email-1',
            kind: 'receiptReviewed',
            lastAttemptAt: exhaustedAt,
            lastError: 'Resend email request failed: 400',
            maxAttempts: 8,
            nextAttemptAt: exhaustedAt,
            recipient: 'member@example.org',
            sentAt: null,
            status: 'failed',
            subject: 'Receipt rejected',
            tenantDomain: 'section.example.org',
            tenantId: 'tenant-1',
            tenantName: 'Section',
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
        exhausted: 1,
        failed: 2,
        queued: 1,
        sending: 0,
        sent: 0,
        staleSending: 1,
        waitingForRetry: 1,
      });
      expect(overview.items).toEqual([
        expect.objectContaining({
          exhaustedAt: '2026-07-09T09:00:00.000Z',
          id: 'email-1',
          lastError: 'Resend email request failed: 400',
          status: 'failed',
        }),
      ]);
    }),
  );

  it.effect(
    'rejects tenant detail reads without tenant-management permission',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            tenants: {
              findFirst: () =>
                Effect.fail(new Error('database should not run')),
            },
          },
        };

        const error = yield* globalAdminHandlers['globalAdmin.tenants.findOne'](
          { id: 'tenant-1' },
          {
            headers: createHeaders(['events:viewPublic']),
          } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error.permission).toBe('globalAdmin:manageTenants');
      }),
  );

  it.effect('creates tenants with normalized operational settings', () =>
    Effect.gen(function* () {
      let capturedInsert: Record<string, unknown> | undefined;
      const insertQuery = {
        returning: () =>
          Effect.succeed([
            {
              currency: 'CZK',
              domain: 'section.example.org',
              id: 'tenant-1',
              locale: 'en-GB',
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
        insert: () => insertQuery,
        query: {
          tenants: {
            findFirst: () => Effect.succeed(),
          },
        },
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.create'](
        {
          currency: 'CZK',
          domain: ' https://Section.Example.Org ',
          locale: 'en-GB',
          name: ' Example Section ',
          stripeAccountId: ' acct_123 ',
          theme: 'esn',
          timezone: 'Europe/Prague',
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedInsert).toMatchObject({
        currency: 'CZK',
        domain: 'section.example.org',
        locale: 'en-GB',
        name: 'Example Section',
        stripeAccountId: 'acct_123',
        theme: 'esn',
        timezone: 'Europe/Prague',
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
            currency: 'EUR',
            domain: 'Tenant.Example.com',
            locale: 'en-GB',
            name: 'Duplicate Tenant',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Tenant domain already exists');
        expect(error.reason).toBe('tenant.example.com');
      }),
  );

  it.effect('updates tenants and clears blank Stripe account ids', () =>
    Effect.gen(function* () {
      let capturedUpdate: Record<string, unknown> | undefined;
      const updateQuery = {
        returning: () =>
          Effect.succeed([
            {
              currency: 'EUR',
              domain: 'tenant.example.com',
              id: 'tenant-1',
              locale: 'en-US',
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
      const database = {
        query: {
          tenants: {
            findFirst: () => Effect.succeed({ id: 'tenant-1' }),
          },
        },
        update: () => updateQuery,
      };

      const tenant = yield* globalAdminHandlers['globalAdmin.tenants.update'](
        {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          locale: 'en-US',
          name: 'Tenant',
          stripeAccountId: ' ',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedUpdate).toMatchObject({
        domain: 'tenant.example.com',
        name: 'Tenant',
        stripeAccountId: null,
      });
      expect(tenant.stripeConnected).toBe(false);
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
            currency: 'EUR',
            domain: 'Tenant.Example.com',
            id: 'tenant-1',
            locale: 'en-GB',
            name: 'Duplicate Tenant',
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
          { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Tenant domain already exists');
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
          currency: 'EUR',
          domain: 'section.example.org/path',
          locale: 'en-GB',
          name: 'Section',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        { headers: createHeaders(['globalAdmin:manageTenants']) } as never,
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant settings');
    }),
  );
});
