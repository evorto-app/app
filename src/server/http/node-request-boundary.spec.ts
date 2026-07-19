import { describe, expect, it } from '@effect/vitest';

import { resolveNodeRequestBoundary } from './node-request-boundary';

const resolve = (
  headers: Record<string, string>,
  overrides: Partial<Parameters<typeof resolveNodeRequestBoundary>[0]> = {},
) =>
  resolveNodeRequestBoundary({
    headers: new Headers(headers),
    requestTarget: '/events?view=all',
    socketEncrypted: false,
    trustPlatformProxy: false,
    ...overrides,
  });

describe('Node request boundary', () => {
  it('uses Host and removes forwarded host variants', () => {
    const result = resolve({
      forwarded: 'host=attacker.example',
      host: 'staging.evorto.app',
      'x-forwarded-host': 'attacker.example',
    });

    expect(result?.url).toBe('http://staging.evorto.app/events?view=all');
    expect(result?.headers.has('forwarded')).toBe(false);
    expect(result?.headers.has('x-forwarded-host')).toBe(false);
  });

  it('trusts a normalized forwarded protocol only at the configured boundary', () => {
    const untrusted = resolve({
      host: 'staging.evorto.app',
      'x-forwarded-proto': 'https',
    });
    const trusted = resolve(
      {
        host: 'staging.evorto.app',
        'x-forwarded-proto': ' HTTPS ',
      },
      { trustPlatformProxy: true },
    );

    expect(untrusted?.url).toBe('http://staging.evorto.app/events?view=all');
    expect(untrusted?.headers.has('x-forwarded-proto')).toBe(false);
    expect(trusted?.url).toBe('https://staging.evorto.app/events?view=all');
    expect(trusted?.headers.get('x-forwarded-proto')).toBe('https');
  });

  it('rejects malformed hosts and cross-origin request targets', () => {
    expect(resolve({ host: 'attacker.example/path' })).toBeUndefined();
    expect(
      resolve(
        { host: 'staging.evorto.app' },
        { requestTarget: '//attacker.example/path' },
      ),
    ).toBeUndefined();
  });

  it('supports local IPv6 and direct TLS requests', () => {
    const result = resolve({ host: '[::1]:4200' }, { socketEncrypted: true });

    expect(result?.url).toBe('https://[::1]:4200/events?view=all');
  });
});
