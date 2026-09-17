import { describe, expect, it } from '@effect/vitest';
import {
  isUntracedServerRequestUrl,
  serverTracePolicyLayer,
  withoutServerTracing,
} from '@server/effect/server-trace-policy';
import { makeServerResponseMiddleware } from '@server/http/server-response.middleware';
import { Effect, Tracer } from 'effect';
import {
  HttpMiddleware,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

describe('server trace policy', () => {
  it('suppresses operational endpoints regardless of origin or query', () => {
    for (const url of [
      '/healthz',
      '/readyz/',
      'https://staging.evorto.app/version?probe=1',
    ]) {
      expect(isUntracedServerRequestUrl(url)).toBe(true);
    }
  });

  it('keeps application requests traceable', () => {
    for (const url of [
      '/events',
      '/rpc',
      '/events/version',
      'https://staging.evorto.app/tenant-assets/tenant/logo/file.png',
      'http://[invalid',
    ]) {
      expect(isUntracedServerRequestUrl(url)).toBe(false);
    }
  });

  it.effect('disables descendant spans within operational handlers', () =>
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan.pipe(
        Effect.withSpan('operational-child'),
        withoutServerTracing,
      );

      expect(span.spanId).toBe('noop');
    }),
  );

  it.effect(
    'prevents the built-in HTTP middleware from tracing original request URLs',
    () =>
      Effect.gen(function* () {
        const serverSpans: Tracer.NativeSpan[] = [];
        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);
            serverSpans.push(span);
            return span;
          },
        });

        for (const url of [
          'https://staging.evorto.app/healthz',
          'https://staging.evorto.app/registration-transfers?token=transfer-secret',
          'https://staging.evorto.app/callback?code=callback-secret',
        ]) {
          const request = HttpServerRequest.fromWeb(new Request(url));
          yield* HttpMiddleware.tracer(
            Effect.succeed(HttpServerResponse.empty({ status: 200 })),
          ).pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, request),
            Effect.provideService(Tracer.Tracer, tracer),
            Effect.provide(serverTracePolicyLayer),
          );
        }

        expect(serverSpans).toHaveLength(0);
      }),
  );

  it.effect(
    'keeps one sanitized application trace and preserves the handler request',
    () =>
      Effect.gen(function* () {
        for (const route of ['/callback', '/registration-transfers']) {
          const serverSpans: Tracer.NativeSpan[] = [];
          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options);
              serverSpans.push(span);
              return span;
            },
          });
          const request = HttpServerRequest.fromWeb(
            new Request(
              `https://tenant.example.com${route}?code=private-code`,
              {
                headers: { host: 'tenant.example.com' },
              },
            ),
          );
          let handlerRequestUrl: string | undefined;

          const response = yield* HttpMiddleware.tracer(
            makeServerResponseMiddleware(
              HttpServerRequest.HttpServerRequest.pipe(
                Effect.tap((handlerRequest) =>
                  Effect.sync(() => {
                    handlerRequestUrl = handlerRequest.url;
                  }),
                ),
                Effect.as(HttpServerResponse.empty({ status: 204 })),
              ),
            ),
          ).pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, request),
            Effect.provideService(Tracer.Tracer, tracer),
            Effect.provide(serverTracePolicyLayer),
          );
          yield* Effect.yieldNow;

          expect(response.status).toBe(204);
          expect(handlerRequestUrl).toContain('code=private-code');
          expect(serverSpans).toHaveLength(1);
          expect(serverSpans[0]?.attributes.get('http.route')).toBe(route);
          expect(serverSpans[0]?.attributes.get('url.path')).toBe(route);
          expect(serverSpans[0]?.attributes.has('url.query')).toBe(false);
          expect(serverSpans[0]?.attributes.get('url.full')).not.toContain(
            'private-code',
          );
        }
      }),
  );
});
