import * as Headers from '@effect/platform/Headers';
import { describe, expect, it } from 'vitest';

import { RPC_CONTEXT_HEADERS, encodeRpcContextHeaderJson } from '../../rpc-context-headers';
import { decodeRpcRequestContextFromHeaders } from './rpc-request-context.middleware.live';

describe('rpc-request-context.middleware', () => {
  it('decodes rpc request context headers', () => {
    const headers = Headers.fromInput({
      [RPC_CONTEXT_HEADERS.AUTH_DATA]: encodeRpcContextHeaderJson({
        email: 'alice@example.com',
        sub: 'auth0|abc',
      }),
      [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
      [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
        'users:viewAll',
      ]),
      [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson({
        currency: 'EUR',
        defaultLocation: null,
        discountProviders: null,
        domain: 'example.org',
        id: 'tenant-1',
        locale: 'en',
        name: 'Example Tenant',
        receiptSettings: null,
        stripeAccountId: null,
        theme: 'evorto',
        timezone: 'Europe/Prague',
      }),
      [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson({
        attributes: [],
        auth0Id: 'auth0|abc',
        email: 'alice@example.com',
        firstName: 'Alice',
        iban: null,
        id: 'user-1',
        lastName: 'Example',
        paypalEmail: null,
        permissions: ['users:viewAll'],
        roleIds: ['role-1'],
      }),
      [RPC_CONTEXT_HEADERS.USER_ASSIGNED]: 'true',
    });

    const decoded = decodeRpcRequestContextFromHeaders(headers);

    expect(decoded.authenticated).toBe(true);
    expect(decoded.userAssigned).toBe(true);
    expect(decoded.tenant.id).toBe('tenant-1');
    expect(decoded.user?.id).toBe('user-1');
    expect(decoded.permissions).toEqual(['users:viewAll']);
    expect(decoded.authData.sub).toBe('auth0|abc');
  });
});
