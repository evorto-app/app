import { describe, expect, it, vi } from '@effect/vitest';
import { Cause, Effect, Exit, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
} from 'effect/unstable/http';

import { makeServerResponseMiddleware } from './server-response.middleware';

const makeTestHandler = Effect.fn('makeTestHandler')(function* (
  routeLayer: Layer.Layer<never, never, HttpRouter.HttpRouter>,
) {
  const captureException = vi.fn<(error: unknown) => void>();
  const responseMiddlewareLayer = HttpRouter.middleware<{
    handles: unknown;
  }>()(makeServerResponseMiddleware(captureException), { global: true });
  const webHandler = HttpRouter.toWebHandler(
    Layer.mergeAll(routeLayer, responseMiddlewareLayer),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(webHandler.dispose));
  return { captureException, handler: webHandler.handler };
});

describe('server response middleware', () => {
  it.effect('returns a sanitized JSON response for a route defect', () =>
    Effect.gen(function* () {
      const defect = new Error('sensitive internal failure');
      const { captureException, handler } = yield* makeTestHandler(
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
      expect(captureException).toHaveBeenCalledExactlyOnceWith(defect);
    }),
  );

  it.effect('redirects browser navigation defects to the error page', () =>
    Effect.gen(function* () {
      const defect = new Error('render failure');
      const { captureException, handler } = yield* makeTestHandler(
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
      expect(captureException).toHaveBeenCalledExactlyOnceWith(defect);
    }),
  );

  it.effect('preserves a router miss as 404 without defect capture', () =>
    Effect.gen(function* () {
      const { captureException, handler } = yield* makeTestHandler(Layer.empty);

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(captureException).not.toHaveBeenCalled();
    }),
  );

  it.effect('preserves explicit route-not-found as 404 without capture', () =>
    Effect.gen(function* () {
      const { captureException, handler } = yield* makeTestHandler(
        HttpRouter.add('*', '*', (request) =>
          Effect.fail(new HttpServerError.RouteNotFound({ request })),
        ),
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(captureException).not.toHaveBeenCalled();
    }),
  );

  it.effect('preserves client aborts as 499 without defect capture', () =>
    Effect.gen(function* () {
      const captureException = vi.fn<(error: unknown) => void>();
      const clientAbortReason = Cause.makeInterruptReason().annotate(
        HttpServerError.ClientAbort.annotation,
      );
      const exit = yield* makeServerResponseMiddleware(captureException)(
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
      expect(captureException).not.toHaveBeenCalled();
    }),
  );
});
