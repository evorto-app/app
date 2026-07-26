import type * as Types from 'effect/Types';

import { Effect } from 'effect';
import {
  HttpMiddleware,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import type { DeploymentConfig } from '../config/deployment-config';

import { isUntracedServerRequestUrl } from '../effect/server-trace-policy';
import { applySecurityHeaders } from './security-headers';

const notFoundServerResponse = HttpServerResponse.empty({ status: 404 });
const requestIdPattern = /^[a-zA-Z0-9_-]{1,64}$/u;
const qrRegistrationPath = /^\/qr\/registration\/[^/]+\/?$/u;
const tenantBrandAssetPath = /^\/tenant-assets\/[^/]+\/[^/]+\/[^/]+\/?$/u;

export const safeServerRequestRoute = (requestUrl: string): string => {
  let pathname: string;
  try {
    pathname = new URL(requestUrl, 'http://localhost').pathname;
  } catch {
    return '/';
  }

  if (qrRegistrationPath.test(pathname)) {
    return '/qr/registration/:registrationId';
  }
  if (tenantBrandAssetPath.test(pathname)) {
    return '/tenant-assets/:tenantId/:kind/:fileName';
  }
  return pathname;
};

export const resolveRequestId = (configuredRequestId: string | undefined) =>
  configuredRequestId && requestIdPattern.test(configuredRequestId)
    ? configuredRequestId
    : crypto.randomUUID();

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

export const makeServerResponseMiddleware = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  options: {
    readonly applicationEnvironment?: DeploymentConfig['APP_ENVIRONMENT'];
  } = {},
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest | R
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestId = resolveRequestId(request.headers['x-request-id']);
    const safeRoute = safeServerRequestRoute(request.url);
    const traceAnnotations = {
      'http.request.method': request.method,
      'http.route': safeRoute,
      'server.request.id': requestId,
    };

    const handledEffect = effect.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
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
          return createInternalErrorResponse(request);
        }),
      ),
      Effect.catchDefect((defect) =>
        Effect.gen(function* () {
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
          return createInternalErrorResponse(request);
        }),
      ),
      Effect.map((response) => {
        const securedResponse = applySecurityHeaders(response);
        const environmentResponse =
          options.applicationEnvironment === 'staging'
            ? HttpServerResponse.setHeader(
                securedResponse,
                'x-robots-tag',
                'noindex, nofollow',
              )
            : securedResponse;

        return HttpServerResponse.setHeader(
          environmentResponse,
          'x-request-id',
          requestId,
        );
      }),
      Effect.annotateLogs({ requestId }),
      Effect.annotateSpans(traceAnnotations),
    );

    if (isUntracedServerRequestUrl(request.url)) {
      return yield* handledEffect;
    }

    const safeTraceRequest = request.modify({ url: safeRoute });
    return yield* HttpMiddleware.tracer(
      Effect.annotateCurrentSpan(traceAnnotations).pipe(
        Effect.andThen(handledEffect),
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      ),
    ).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        safeTraceRequest,
      ),
      Effect.provideService(HttpMiddleware.TracerDisabledWhen, () => false),
    );
  });
