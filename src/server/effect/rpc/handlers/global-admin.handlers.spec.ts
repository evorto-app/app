import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { globalAdminHandlers } from './global-admin.handlers';

const createHeaders = (permissions: readonly string[]) => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson(permissions),
});

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
        } as never).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
        );

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
        Effect.provide(Layer.succeed(Database, database as never)),
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
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

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
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

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
          Effect.provide(Layer.succeed(Database, database as never)),
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
      ).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcUnauthorizedError');
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
        ).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
          Effect.flip,
        );

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
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

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
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(capturedUpdate).toMatchObject({
        domain: 'tenant.example.com',
        name: 'Tenant',
        stripeAccountId: null,
      });
      expect(tenant.stripeConnected).toBe(false);
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
      ).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant settings');
    }),
  );
});
