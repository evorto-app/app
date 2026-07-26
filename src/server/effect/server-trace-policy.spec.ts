import { describe, expect, it } from '@effect/vitest';
import {
  isUntracedServerRequestUrl,
  serverTracePolicyLayer,
  withoutServerTracing,
} from '@server/effect/server-trace-policy';
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
    'prevents the built-in HTTP middleware from tracing raw request URLs',
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
          'https://staging.evorto.app/registration-transfers',
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
});
