import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import { Context as RequestContext } from '../../../types/custom/context';
import { RequestBodyTooLargeError } from '../../http/request-body';
import {
  MAX_RPC_BODY_SIZE_BYTES,
  toRpcHttpServerRequest,
} from './app-rpcs.request-handler';
import { RPC_CONTEXT_HEADERS } from './rpc-context-headers';

const requestContext = Schema.decodeUnknownSync(RequestContext)({
  authentication: { isAuthenticated: false },
  permissions: [],
  tenant: {
    currency: 'EUR',
    domain: 'tenant.example.com',
    id: 'tenant-1',
    locale: 'en-GB',
    name: 'Tenant',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  },
});

const platformRequestContext = Schema.decodeUnknownSync(RequestContext)({
  ...requestContext,
  authentication: { isAuthenticated: true },
  permissions: ['globalAdmin:manageTenants'],
  platformAuthority: {
    actorEmail: 'platform@example.org',
    actorId: 'auth0|platform-admin',
    kind: 'platformAdministrator',
  },
});

describe('toRpcHttpServerRequest', () => {
  it.effect('preserves an accepted body while adding RPC context headers', () =>
    Effect.gen(function* () {
      const body = JSON.stringify({ _tag: 'TestRpc' });
      const request = new Request('https://tenant.example.com/rpc', {
        body,
        method: 'POST',
      });

      const rpcRequest = yield* toRpcHttpServerRequest(
        request,
        requestContext,
        {},
      );

      expect(yield* rpcRequest.text).toBe(body);
      expect(rpcRequest.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED]).toBe(
        'false',
      );
      expect(rpcRequest.headers[RPC_CONTEXT_HEADERS.TENANT]).toBeTruthy();
    }),
  );

  it.effect('rejects an RPC body declared above the route limit', () =>
    Effect.gen(function* () {
      const request = new Request('https://tenant.example.com/rpc', {
        body: '{}',
        headers: {
          'content-length': String(MAX_RPC_BODY_SIZE_BYTES + 1),
        },
        method: 'POST',
      });

      const error = yield* toRpcHttpServerRequest(
        request,
        requestContext,
        {},
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RequestBodyTooLargeError);
      expect(error.maxBytes).toBe(MAX_RPC_BODY_SIZE_BYTES);
    }),
  );

  it.effect('forwards explicit platform authority independently of users', () =>
    Effect.gen(function* () {
      const rpcRequest = yield* toRpcHttpServerRequest(
        new Request('https://tenant.example.com/rpc'),
        platformRequestContext,
        { sub: 'auth0|platform-admin' },
      );

      expect(
        rpcRequest.headers[RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY],
      ).toBeTruthy();
      expect(rpcRequest.headers[RPC_CONTEXT_HEADERS.USER_ASSIGNED]).toBe(
        'false',
      );
    }),
  );
});
