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
  it.effect('allows tenant reads through the global-admin wildcard', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          tenants: {
            findMany: () =>
              Effect.succeed([
                {
                  domain: 'tenant.example.com',
                  id: 'tenant-1',
                  name: 'Tenant',
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
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant',
        },
      ]);
    }),
  );
});
