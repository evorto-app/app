import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { adminHandlers } from './admin.handlers';

describe('adminHandlers role permissions', () => {
  it.effect('findMany requires role management permission', () =>
    Effect.gen(function* () {
      const error = yield* adminHandlers['admin.roles.findMany']({}, {
        headers: {
          [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
          [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([]),
        },
      } as never).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('admin:manageRoles');
    }),
  );
});
