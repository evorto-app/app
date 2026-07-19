import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import type { DeploymentConfig } from '../config/deployment-config';

import { makeServerResponseMiddleware } from './server-response.middleware';

const makeTestHandler = Effect.fn('makeTestHandler')(function* (
  routeLayer: Layer.Layer<never, never, HttpRouter.HttpRouter>,
  applicationEnvironment: DeploymentConfig['APP_ENVIRONMENT'] = 'local',
) {
  const responseMiddlewareLayer = HttpRouter.middleware<{
    handles: unknown;
  }>()(
    (effect) =>
      makeServerResponseMiddleware(effect, { applicationEnvironment }),
    { global: true },
  );
  const webHandler = HttpRouter.toWebHandler(
    Layer.mergeAll(routeLayer, responseMiddlewareLayer),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(webHandler.dispose));
  return { handler: webHandler.handler };
});

describe('server response middleware', () => {
  it.effect('returns a sanitized JSON response for a route defect', () =>
    Effect.gen(function* () {
      const defect = new Error('sensitive internal failure');
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('GET', '/defect', Effect.die(defect)),
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/defect')),
      );

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        error: 'Internal Server Error',
      });
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
    }),
  );

  it.effect(
    'preserves a safe boundary request ID and replaces unsafe input',
    () =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'GET',
            '/ok',
            Effect.succeed(HttpServerResponse.empty()),
          ),
        );
        const preserved = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/ok', {
              headers: { 'x-request-id': 'platform_request-42' },
            }),
          ),
        );
        const replaced = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/ok', {
              headers: { 'x-request-id': 'unsafe request value' },
            }),
          ),
        );

        expect(preserved.headers.get('x-request-id')).toBe(
          'platform_request-42',
        );
        expect(replaced.headers.get('x-request-id')).not.toBe(
          'unsafe request value',
        );
      }),
  );

  it.effect('redirects browser navigation defects to the error page', () =>
    Effect.gen(function* () {
      const defect = new Error('render failure');
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('GET', '/defect', Effect.die(defect)),
      );

      const response = yield* Effect.promise(() =>
        handler(
          new Request('http://localhost/defect', {
            headers: { accept: 'text/html' },
          }),
        ),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/500');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('preserves a router miss as 404 without defect capture', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(Layer.empty);

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('preserves explicit route-not-found as 404 without capture', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('*', '*', (request) =>
          Effect.fail(new HttpServerError.RouteNotFound({ request })),
        ),
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('marks every staging response as non-indexable', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(
        HttpRouter.add(
          'GET',
          '/event',
          Effect.succeed(HttpServerResponse.text('staging event')),
        ),
        'staging',
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('https://staging.evorto.app/event')),
      );

      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }),
  );

  it.effect('preserves client aborts as 499 without defect capture', () =>
    Effect.gen(function* () {
      const clientAbortReason = Cause.makeInterruptReason().annotate(
        HttpServerError.ClientAbort.annotation,
      );
      const exit = yield* makeServerResponseMiddleware(
        Effect.failCause(Cause.fromReasons([clientAbortReason])),
      ).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request('http://localhost/slow', { method: 'POST' }),
          ),
        ),
        Effect.exit,
      );
      if (Exit.isSuccess(exit)) {
        throw new Error('Expected client abort to remain interrupted');
      }
      const [response] = yield* HttpServerError.causeResponse(exit.cause);

      expect(response.status).toBe(499);
    }),
  );
});
