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
          stripeConnected: true,
          theme: 'esn',
          timezone: 'Europe/Berlin',
        },
      ]);
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
});
