import { describe, expect, it } from 'vitest';

import { resolveServerRpcOrigin } from './effect-rpc-angular-client';

describe('effect-rpc-angular-client', () => {
  it('uses the incoming request origin for SSR RPC calls', () => {
    expect(
      resolveServerRpcOrigin({
        url: 'https://alpha.evorto.app/events?foo=bar',
      }),
    ).toBe('https://alpha.evorto.app');
  });

  it('uses forwarded headers when SSR request urls are relative', () => {
    expect(
      resolveServerRpcOrigin({
        headers: new Headers({
          host: 'internal.evorto.local',
          'x-forwarded-host': 'alpha.evorto.app',
          'x-forwarded-proto': 'https',
        }),
        url: '/events?foo=bar',
      }),
    ).toBe('https://alpha.evorto.app');
  });

  it('falls back to forwarded headers when the SSR request url is malformed', () => {
    expect(
      resolveServerRpcOrigin({
        headers: new Headers({
          'x-forwarded-host': 'beta.evorto.app',
          'x-forwarded-proto': 'https',
        }),
        url: '://invalid-url',
      }),
    ).toBe('https://beta.evorto.app');
  });

  it('falls back to the local dev origin when no SSR request is available', () => {
    expect(resolveServerRpcOrigin()).toBe('http://localhost:4200');
  });
});
