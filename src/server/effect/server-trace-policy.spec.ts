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
    'prevents the HTTP middleware from creating a probe root span',
    () =>
      Effect.gen(function* () {
        let serverSpan: Tracer.NativeSpan | undefined;
        const tracer = Tracer.make({
          span(options) {
            serverSpan = new Tracer.NativeSpan(options);
            return serverSpan;
          },
        });
        const request = HttpServerRequest.fromWeb(
          new Request('https://staging.evorto.app/healthz'),
        );

        yield* HttpMiddleware.tracer(
          Effect.succeed(HttpServerResponse.empty({ status: 200 })),
        ).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.provideService(Tracer.Tracer, tracer),
          Effect.provide(serverTracePolicyLayer),
        );

        expect(serverSpan).toBeUndefined();
      }),
  );
});
