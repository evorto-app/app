import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import {
  makeRequestBoundaryMiddleware,
  requestBoundaryRouteLayers,
  resolveNodeRequestBoundary,
  resolveRequestBoundary,
} from './request-boundary';
import { runRpcIngressPolicy } from './rpc-ingress-policy';

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
      const webRequest = yield* HttpServerRequest.toWeb(downstreamRequest);
      expect(webRequest.url).toBe('https://tenant.example.com/events?view=all');
    }),
  );

  it.effect(
    'rebuilds the downstream request once with normalized origin and readable body',
    () =>
      Effect.gen(function* () {
        const requestBody = 'request body';
        const request = HttpServerRequest.fromWeb(
          new Request('http://internal.example/api/rpc?source=original', {
            body: requestBody,
            headers: {
              forwarded: 'host=attacker.example;proto=http',
              host: 'tenant.example.com',
              'x-forwarded-host': 'attacker.example',
              'x-forwarded-proto': 'https',
            },
            method: 'POST',
          }),
        );
        const response = yield* makeRequestBoundaryMiddleware({
          transportProtocol: 'http',
          trustPlatformProxy: true,
        })(
          Effect.gen(function* () {
            const normalizedRequest =
              yield* HttpServerRequest.HttpServerRequest;
            const webRequest =
              yield* HttpServerRequest.toWeb(normalizedRequest);

            expect(webRequest.url).toBe(
              'https://tenant.example.com/api/rpc?source=original',
            );
            expect(webRequest.headers.get('host')).toBe('tenant.example.com');
            expect(webRequest.headers.get('x-forwarded-proto')).toBe('https');
            expect(webRequest.headers.has('forwarded')).toBe(false);
            expect(webRequest.headers.has('x-forwarded-host')).toBe(false);
            expect(yield* normalizedRequest.text).toBe(requestBody);

            return HttpServerResponse.empty({ status: 204 });
          }),
        ).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );

        expect(response.status).toBe(204);
      }),
  );

  it.effect(
    'applies the boundary once for Bun and preserves Node direct TLS',
    () =>
      Effect.gen(function* () {
        const nodeBoundary = resolveNodeRequestBoundary({
          encryptedTransport: true,
          headers: new Headers({
            forwarded: 'host=attacker.example;proto=http',
            host: 'tenant.example.com',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'http',
          }),
          requestTarget: '/origin?source=direct-tls',
          trustPlatformProxy: false,
        });

        expect(nodeBoundary).toBeDefined();
        if (!nodeBoundary) {
          return;
        }

        const applicationRoutes = HttpRouter.add('GET', '/origin', (request) =>
          Effect.gen(function* () {
            const webRequest = yield* HttpServerRequest.toWeb(request);
            return HttpServerResponse.text(webRequest.url, {
              headers: {
                'x-observed-proto':
                  webRequest.headers.get('x-forwarded-proto') ?? '',
              },
            });
          }),
        );
        const boundaryLayer = HttpRouter.middleware()(
          makeRequestBoundaryMiddleware({
            transportProtocol: 'http',
            trustPlatformProxy: false,
          }),
          { global: true },
        );
        const routeLayers = requestBoundaryRouteLayers(
          applicationRoutes,
          boundaryLayer,
          Layer.empty,
        );
        const nodeHandler = HttpRouter.toWebHandler(
          Layer.mergeAll(...routeLayers.normalizedNode),
          { disableLogger: true },
        );
        const bunHandler = HttpRouter.toWebHandler(
          Layer.mergeAll(...routeLayers.bun),
          { disableLogger: true },
        );
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.promise(nodeHandler.dispose);
            yield* Effect.promise(bunHandler.dispose);
          }),
        );

        const nodeResponse = yield* Effect.promise(() =>
          nodeHandler.handler(
            new Request(nodeBoundary.url, {
              headers: nodeBoundary.headers,
            }),
          ),
        );
        const bunResponse = yield* Effect.promise(() =>
          bunHandler.handler(
            new Request('http://internal.example/origin?source=bun', {
              headers: {
                forwarded: 'host=attacker.example;proto=https',
                host: 'tenant.example.com',
                'x-forwarded-host': 'attacker.example',
                'x-forwarded-proto': 'https',
              },
            }),
          ),
        );

        expect(nodeResponse.status).toBe(200);
        expect(yield* Effect.promise(() => nodeResponse.text())).toBe(
          'https://tenant.example.com/origin?source=direct-tls',
        );
        expect(nodeResponse.headers.get('x-observed-proto')).toBe('https');
        expect(bunResponse.status).toBe(200);
        expect(yield* Effect.promise(() => bunResponse.text())).toBe(
          'http://tenant.example.com/origin?source=bun',
        );
        expect(bunResponse.headers.get('x-observed-proto')).toBe('http');
      }),
  );

  it.effect(
    'passes an accepted normalized RPC body to the downstream server request',
    () =>
      Effect.gen(function* () {
        const requestBody = JSON.stringify({
          _tag: 'Request',
          id: 1,
          payload: { _tag: 'ConfigTenant' },
        });
        const request = HttpServerRequest.fromWeb(
          new Request('http://internal.example/api/rpc', {
            body: requestBody,
            headers: {
              'content-type': 'application/json',
              host: 'tenant.example.com',
              origin: 'https://tenant.example.com',
              'x-forwarded-proto': 'https',
            },
            method: 'POST',
          }),
        );
        const response = yield* makeRequestBoundaryMiddleware({
          transportProtocol: 'http',
          trustPlatformProxy: true,
        })(
          Effect.gen(function* () {
            const normalizedRequest =
              yield* HttpServerRequest.HttpServerRequest;
            const webRequest =
              yield* HttpServerRequest.toWeb(normalizedRequest);
            const ingress = runRpcIngressPolicy(
              webRequest,
              () => normalizedRequest.text,
              { applicationOrigin: 'https://tenant.example.com' },
            );

            expect(ingress.accepted).toBe(true);
            if (!ingress.accepted) {
              return HttpServerResponse.empty({ status: 500 });
            }

            return HttpServerResponse.text(yield* ingress.value);
          }),
        ).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );

        expect(response.status).toBe(200);
        expect(response.body._tag).toBe('Uint8Array');
        if (response.body._tag !== 'Uint8Array') {
          throw new Error('Expected a text response body');
        }
        expect(new TextDecoder().decode(response.body.body)).toBe(requestBody);
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
      expect(response.body._tag).toBe('Uint8Array');
      if (response.body._tag !== 'Uint8Array') {
        throw new Error('Expected a text response body');
      }
      expect(new TextDecoder().decode(response.body.body)).toBe(
        'This address cannot be opened. Check the link and try again.',
      );
      expect(invoked).toBe(false);
    }),
  );
});
