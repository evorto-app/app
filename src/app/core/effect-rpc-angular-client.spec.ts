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

  it('uses the configured loopback origin for server-side RPC calls', () => {
    process.env['SSR_RPC_ORIGIN'] = ' http://localhost:4200/ ';

    expect(resolveServerRpcOrigin()).toBe('http://localhost:4200');
  });

  it.each([
    '://invalid-url',
    'file:///tmp/rpc',
    'ftp://localhost:4200',
    'https://alpha.evorto.app',
    'http://user:password@localhost:4200',
    'http://localhost:',
    'http://localhost:/',
    'https://localhost:',
    'https://localhost:/',
    'http://127.0.0.1:',
    'http://127.0.0.1:/',
    'https://[::1]:',
    'https://[::1]:/',
    'http://localhost:4200/rpc',
    'http://localhost:4200/.',
    'http://localhost:4200/..',
    'http://localhost:4200/rpc/..',
    'http://localhost:4200/%2e',
    'http://localhost:4200/%2e%2e',
    'http://localhost:4200/rpc/%2e%2e',
    'http://localhost:4200\\',
    String.raw`http:\\localhost:4200`,
    'http:/localhost:4200',
    'http://local\nhost:4200',
    'http://local\thost:4200',
    'http://localhost:4200?request=rpc',
    'http://localhost:4200#rpc',
  ])('rejects unsafe SSR_RPC_ORIGIN value: %s', (origin) => {
    process.env['SSR_RPC_ORIGIN'] = origin;

    expect(() => resolveServerRpcOrigin()).toThrow(
      ServerRpcOriginResolutionError,
    );
  });

  it.each([
    ['http://127.0.0.1:4200/', 'http://127.0.0.1:4200'],
    ['http://[::1]:4200/', 'http://[::1]:4200'],
    ['HTTPS://LOCALHOST:443/', 'https://localhost'],
    ['http://localhost:80/', 'http://localhost'],
    ['https://127.0.0.1:443/', 'https://127.0.0.1'],
    ['https://[::1]:443/', 'https://[::1]'],
    ['https://localhost:8443/', 'https://localhost:8443'],
  ])('preserves valid loopback origin %s', (origin, expected) => {
    process.env['SSR_RPC_ORIGIN'] = origin;

    expect(resolveServerRpcOrigin()).toBe(expected);
  });

  it('fails visibly instead of using the public request origin', () => {
    expect(() => resolveServerRpcOrigin()).toThrowError(
      new ServerRpcOriginResolutionError(
        'SSR RPC origin is unavailable: set SSR_RPC_ORIGIN to the app loopback origin',
      ),
    );
  });
});
