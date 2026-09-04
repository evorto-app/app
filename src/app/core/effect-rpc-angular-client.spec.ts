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
    'http://localhost:4200/rpc',
    'http://localhost:4200?request=rpc',
    'http://localhost:4200#rpc',
  ])('rejects unsafe SSR_RPC_ORIGIN value: %s', (origin) => {
    process.env['SSR_RPC_ORIGIN'] = origin;

    expect(() => resolveServerRpcOrigin()).toThrow(
      ServerRpcOriginResolutionError,
    );
  });

  it('fails visibly instead of using the public request origin', () => {
    expect(() => resolveServerRpcOrigin()).toThrowError(
      new ServerRpcOriginResolutionError(
        'SSR RPC origin is unavailable: set SSR_RPC_ORIGIN to the app loopback origin',
      ),
    );
  });
});
