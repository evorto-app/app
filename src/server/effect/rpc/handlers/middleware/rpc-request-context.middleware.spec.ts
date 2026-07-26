import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { rpcRequestContextMiddlewareLive } from './rpc-request-context.middleware.live';

const trustedContext = {
  authData: {
    email: 'alice@example.com',
    sub: 'auth0|alice',
  },
  authenticated: true,
  permissions: ['users:viewAll'],
  platformAuthority: null,
  tenant: {
    currency: 'EUR',
    domain: 'tenant.example.com',
    id: 'tenant-1',
    name: 'Trusted tenant',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  },
  user: null,
  userAssigned: false,
} satisfies RpcRequestContextShape;

describe('rpc-request-context.middleware', () => {
  it.effect(
    'uses the provided typed context and ignores hostile external context headers',
    () =>
      Effect.gen(function* () {
        let observedContext: RpcRequestContextShape | undefined;
        const middleware = yield* RpcRequestContextMiddleware;
        const handler = Effect.gen(function* () {
          observedContext = yield* RpcRequestContext;
          return yield* Effect.die('stop after observing request context');
        });
        const exit = yield* middleware(handler, {
          client: undefined,
          headers: Headers.fromInput({
            'x-evorto-authenticated': 'false',
            'x-evorto-permissions': 'eyJnbG9iYWxBZG1pbjoqIjoidHJ1c3QgbWUifQ==',
            'x-evorto-tenant':
              'eyJpZCI6ImF0dGFja2VyLXRlbmFudCIsIm5hbWUiOiJBdHRhY2tlciJ9',
          }),
          payload: undefined,
          requestId: 1,
          rpc: undefined,
        } as never).pipe(Effect.exit);

        expect(exit._tag).toBe('Failure');
        expect(observedContext).toBe(trustedContext);
      }).pipe(
        Effect.provide(rpcRequestContextMiddlewareLive),
        Effect.provide(Layer.succeed(RpcRequestContext, trustedContext)),
      ),
  );
});
