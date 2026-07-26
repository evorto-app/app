import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  makeRequestBoundaryMiddleware,
  resolveRequestBoundary,
} from './request-boundary';

const resolve = (
  headers: Record<string, string>,
  overrides: Partial<Parameters<typeof resolveRequestBoundary>[0]> = {},
) =>
  resolveRequestBoundary({
    headers: new Headers(headers),
    requestTarget: '/events?view=all',
    transportProtocol: 'http',
    trustPlatformProxy: false,
    ...overrides,
  });

describe('request boundary', () => {
  it('uses Host and removes forwarded host variants', () => {
    const result = resolve({
      forwarded: 'host=attacker.example',
      host: 'staging.evorto.app',
      'x-forwarded-host': 'attacker.example',
    });

    expect(result?.url).toBe('http://staging.evorto.app/events?view=all');
    expect(result?.headers.has('forwarded')).toBe(false);
    expect(result?.headers.has('x-forwarded-host')).toBe(false);
    expect(result?.headers.get('host')).toBe('staging.evorto.app');
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
    expect(untrusted?.headers.get('x-forwarded-proto')).toBe('http');
    expect(trusted?.url).toBe('https://staging.evorto.app/events?view=all');
    expect(trusted?.headers.get('x-forwarded-proto')).toBe('https');
  });

  it.each(['ftp', 'https, http', ''])(
    'rejects malformed trusted forwarded protocol %j',
    (forwardedProtocol) => {
      expect(
        resolve(
          {
            host: 'staging.evorto.app',
            'x-forwarded-proto': forwardedProtocol,
          },
          { trustPlatformProxy: true },
        ),
      ).toBeUndefined();
    },
  );

  it('rejects duplicated trusted forwarded protocol values', () => {
    const headers = new Headers([
      ['host', 'staging.evorto.app'],
      ['x-forwarded-proto', 'https'],
      ['x-forwarded-proto', 'http'],
    ]);

    expect(
      resolveRequestBoundary({
        headers,
        requestTarget: '/events',
        transportProtocol: 'http',
        trustPlatformProxy: true,
      }),
    ).toBeUndefined();
  });

  it('deletes deprecated protocol variants instead of using them as fallbacks', () => {
    const result = resolve({
      host: 'staging.evorto.app',
      'x-forwarded-protocol': 'https',
    });

    expect(result?.protocol).toBe('http');
    expect(result?.headers.get('x-forwarded-proto')).toBe('http');
    expect(result?.headers.has('x-forwarded-protocol')).toBe(false);
  });

  it('rejects malformed hosts and cross-origin request targets', () => {
    expect(resolve({ host: 'attacker.example/path' })).toBeUndefined();
    expect(resolve({ host: 'attacker..example' })).toBeUndefined();
    expect(resolve({ host: 'attacker.example.' })).toBeUndefined();
    expect(
      resolve(
        { host: 'staging.evorto.app' },
        { requestTarget: '//attacker.example/path' },
      ),
    ).toBeUndefined();
  });

  it('supports local IPv6 and direct TLS requests', () => {
    const result = resolve(
      { host: '[::1]:4200' },
      { transportProtocol: 'https' },
    );

    expect(result?.url).toBe('https://[::1]:4200/events?view=all');
    expect(result?.headers.get('x-forwarded-proto')).toBe('https');
  });

  it.effect('provides only normalized headers to downstream handlers', () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(
        new Request('http://internal.example/events?view=all', {
          headers: {
            forwarded: 'host=attacker.example;proto=http',
            host: 'tenant.example.com',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
            'x-forwarded-protocol': 'http',
          },
        }),
      );
      let downstreamRequest: HttpServerRequest.HttpServerRequest | undefined;

      const response = yield* makeRequestBoundaryMiddleware({
        transportProtocol: 'http',
        trustPlatformProxy: true,
      })(
        HttpServerRequest.HttpServerRequest.pipe(
          Effect.tap((normalizedRequest) =>
            Effect.sync(() => {
              downstreamRequest = normalizedRequest;
            }),
          ),
          Effect.as(HttpServerResponse.empty({ status: 204 })),
        ),
      ).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(204);
      expect(downstreamRequest?.url).toBe('/events?view=all');
      expect(downstreamRequest?.headers.host).toBe('tenant.example.com');
      expect(downstreamRequest?.headers['x-forwarded-proto']).toBe('https');
      expect('forwarded' in (downstreamRequest?.headers ?? {})).toBe(false);
      expect('x-forwarded-host' in (downstreamRequest?.headers ?? {})).toBe(
        false,
      );
      expect('x-forwarded-protocol' in (downstreamRequest?.headers ?? {})).toBe(
        false,
      );
    }),
  );

  it.effect('rejects invalid trusted protocol before invoking downstream', () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(
        new Request('http://internal.example/events', {
          headers: {
            host: 'tenant.example.com',
            'x-forwarded-proto': 'file',
          },
        }),
      );
      let invoked = false;

      const response = yield* makeRequestBoundaryMiddleware({
        transportProtocol: 'http',
        trustPlatformProxy: true,
      })(
        Effect.sync(() => {
          invoked = true;
          return HttpServerResponse.empty({ status: 204 });
        }),
      ).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(400);
      expect(invoked).toBe(false);
    }),
  );
});
