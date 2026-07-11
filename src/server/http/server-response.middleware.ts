import type * as Types from 'effect/Types';

import { Effect } from 'effect';
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { applySecurityHeaders } from './security-headers';

const notFoundServerResponse = HttpServerResponse.empty({ status: 404 });

const isRouteNotFoundError = (error: unknown) =>
  error instanceof HttpServerError.RouteNotFound ||
  (HttpServerError.isHttpServerError(error) &&
    error.reason instanceof HttpServerError.RouteNotFound);

export const createInternalErrorResponse = (
  request: HttpServerRequest.HttpServerRequest,
) => {
  const acceptHeader = request.headers['accept'] ?? '';
  if (typeof acceptHeader === 'string' && acceptHeader.includes('text/html')) {
    return HttpServerResponse.redirect('/500', { status: 303 });
  }

  return HttpServerResponse.jsonUnsafe(
    { error: 'Internal Server Error' },
    { status: 500 },
  );
};

export const makeServerResponseMiddleware =
  (captureException: (error: unknown) => void) =>
  <E, R>(
    effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Types.unhandled,
    HttpServerRequest.HttpServerRequest | R
  > =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;

          if (isRouteNotFoundError(error)) {
            return notFoundServerResponse;
          }

          yield* Effect.logError('Unhandled server error').pipe(
            Effect.annotateLogs({
              error:
                error instanceof Error
                  ? {
                      message: error.message,
                      name: error.name,
                      stack: error.stack,
                    }
                  : String(error),
            }),
          );
          captureException(error);
          return createInternalErrorResponse(request);
        }),
      ),
      Effect.catchDefect((defect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;

          yield* Effect.logError('Unhandled server defect').pipe(
            Effect.annotateLogs({
              error:
                defect instanceof Error
                  ? {
                      message: defect.message,
                      name: defect.name,
                      stack: defect.stack,
                    }
                  : String(defect),
            }),
          );
          captureException(defect);
          return createInternalErrorResponse(request);
        }),
      ),
      Effect.map((response) => applySecurityHeaders(response)),
    );
