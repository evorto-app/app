import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveServerRpcOrigin,
  resolveTrustedServerRpcOrigin,
  ServerRpcOriginResolutionError,
} from './effect-rpc-angular-client';

describe('effect-rpc-angular-client', () => {
  const originalSsrRpcOrigin = process.env['SSR_RPC_ORIGIN'];

  beforeEach(() => {
    delete process.env['SSR_RPC_ORIGIN'];
  });

  afterEach(() => {
    if (originalSsrRpcOrigin === undefined) {
      delete process.env['SSR_RPC_ORIGIN'];
    } else {
      process.env['SSR_RPC_ORIGIN'] = originalSsrRpcOrigin;
    }
  });

  it('does not treat request-derived origins as trusted internal origins', () => {
    delete process.env['SSR_RPC_ORIGIN'];

    expect(resolveTrustedServerRpcOrigin()).toBeUndefined();
  });

  it('uses the configured server-side RPC origin before the browser-facing request origin', () => {
    process.env['SSR_RPC_ORIGIN'] = ' http://localhost:4200/ ';

    expect(
      resolveServerRpcOrigin({
        url: 'http://localhost:4577/events',
      }),
    ).toBe('http://localhost:4200');
  });

  it('uses the incoming request origin for SSR RPC calls', () => {
    expect(
      resolveServerRpcOrigin({
        url: 'https://alpha.evorto.app/events?foo=bar',
      }),
    ).toBe('https://alpha.evorto.app');
  });

  it.each(['/events?foo=bar', '://invalid-url', 'file:///tmp/rpc'])(
    'rejects an invalid Angular request origin: %s',
    (url) => {
      expect(() =>
        resolveServerRpcOrigin({
          url,
        }),
      ).toThrow(ServerRpcOriginResolutionError);
    },
  );

  it('does not use the request origin when configured SSR_RPC_ORIGIN is invalid', () => {
    process.env['SSR_RPC_ORIGIN'] = 'ftp://internal.example.com';

    expect(() =>
      resolveServerRpcOrigin({
        url: 'https://alpha.evorto.app/events',
      }),
    ).toThrow(ServerRpcOriginResolutionError);
  });

  it('fails visibly when no SSR origin source is available', () => {
    expect(() => resolveServerRpcOrigin()).toThrowError(
      new ServerRpcOriginResolutionError(
        'SSR RPC origin is unavailable: set SSR_RPC_ORIGIN or provide an absolute Angular REQUEST URL',
      ),
    );
  });
});
