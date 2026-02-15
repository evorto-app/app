import { AngularAppEngine } from '@angular/ssr';
import {
  FileSystem,
  HttpLayerRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  Path,
} from '@effect/platform';
import { BunHttpServerRequest } from '@effect/platform-bun';
import * as Sentry from '@sentry/node';
import consola from 'consola';
import { Effect, Layer } from 'effect';

import {
  getRequestAuthData,
  handleCallbackRequest,
  handleLoginRequest,
  handleLogoutRequest,
  loadAuthSession,
  toAbsoluteRequestUrl,
} from '../auth/auth-session';
import { resolveHttpRequestContext } from '../context/http-request-context';
import { handleAppRpcRequestWithContext } from '../effect/rpc/app-rpcs.request-handler';
import { handleHealthzWebRequest } from './healthz.web-handler';
import { handleQrRegistrationCodeWebRequest } from './qr-code.web-handler';
import { applySecurityHeaders } from './security-headers';
import { handleStripeWebhookWebRequest } from './stripe-webhook.web-handler';
import {
  resolveWebhookRateLimitKey,
  WebhookRateLimit,
} from './webhook-rate-limit';

const angularApp = new AngularAppEngine();
const browserDistributionUrl = new URL('../../browser/', import.meta.url);
const cacheControlHeader = 'public, max-age=31536000';
const notFoundServerResponse = HttpServerResponse.empty({ status: 404 });

const sanitizeRedirectPath = (value: null | string): string | undefined => {
  if (!value) {
    return;
  }

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('://')
  ) {
    return;
  }

  return value;
};

const isStaticMethod = (method: string): boolean =>
  method === 'GET' || method === 'HEAD';

const safeDecodePath = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return;
  }
};

const resolveStaticPath = (pathname: string) =>
  Effect.gen(function* () {
    const decodedPath = safeDecodePath(pathname);
    if (!decodedPath || decodedPath.includes('\u0000')) {
      return;
    }

    const relativePath = decodedPath.startsWith('/')
      ? decodedPath.slice(1)
      : decodedPath;
    if (!relativePath) {
      return;
    }

    const path = yield* Path.Path;
    const basePath = yield* path.fromFileUrl(browserDistributionUrl);
    const normalizedBasePath = path.normalize(basePath);
    const targetPath = path.normalize(
      path.join(normalizedBasePath, relativePath),
    );

    const basePrefix = normalizedBasePath.endsWith(path.sep)
      ? normalizedBasePath
      : `${normalizedBasePath}${path.sep}`;

    if (!targetPath.startsWith(basePrefix)) {
      return;
    }

    return targetPath;
  });

const tryServeStatic = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    if (!isStaticMethod(request.method)) {
      return;
    }

    const requestUrl = toAbsoluteRequestUrl(request);
    if (requestUrl.pathname.endsWith('/')) {
      return;
    }

    const targetPath = yield* resolveStaticPath(requestUrl.pathname);
    if (!targetPath) {
      return;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(targetPath);
    if (!exists) {
      return;
    }

    return yield* HttpServerResponse.file(targetPath, {
      headers: {
        'Cache-Control': cacheControlHeader,
      },
    });
  });

const extractRegistrationId = (
  request: HttpServerRequest.HttpServerRequest,
): string | undefined => {
  const requestUrl = toAbsoluteRequestUrl(request);
  const match = /^\/qr\/registration\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match?.[1]) {
    return;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return;
  }
};

const renderSsr = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const authSession = yield* loadAuthSession(request);
    const requestContext = yield* Effect.tryPromise(() =>
      resolveHttpRequestContext(request, authSession),
    );

    const webRequest = BunHttpServerRequest.toRequest(request);
    const renderedResponse = yield* Effect.tryPromise(() =>
      angularApp.handle(webRequest, requestContext),
    );

    return renderedResponse
      ? HttpServerResponse.fromWeb(renderedResponse)
      : notFoundServerResponse;
  });

const healthRouteLayer = HttpLayerRouter.add('GET', '/healthz', () =>
  Effect.tryPromise(() => handleHealthzWebRequest()).pipe(
    Effect.map((response) => HttpServerResponse.fromWeb(response)),
  ),
);

const loginRouteLayer = HttpLayerRouter.add('GET', '/login', (request) =>
  handleLoginRequest(request),
);

const callbackRouteLayer = HttpLayerRouter.add('GET', '/callback', (request) =>
  handleCallbackRequest(request),
);

const logoutRouteLayer = HttpLayerRouter.add('GET', '/logout', (request) =>
  handleLogoutRequest(request),
);

const forwardLoginRouteLayer = HttpLayerRouter.add(
  'GET',
  '/forward-login',
  (request) =>
    Effect.sync(() => {
      const requestUrl = toAbsoluteRequestUrl(request);
      const redirectPath =
        sanitizeRedirectPath(requestUrl.searchParams.get('redirectUrl')) ?? '/';

      const target = new URL('/login', requestUrl.origin);
      target.searchParams.set('redirectUrl', redirectPath);

      return HttpServerResponse.redirect(`${target.pathname}${target.search}`);
    }),
);

const qrCodeRouteLayer = HttpLayerRouter.add(
  'GET',
  '/qr/registration/:registrationId',
  (request) =>
    Effect.gen(function* () {
      const registrationId = extractRegistrationId(request);
      if (!registrationId) {
        return HttpServerResponse.text('Registration id missing', {
          status: 400,
        });
      }

      const webRequest = BunHttpServerRequest.toRequest(request);
      const webResponse = yield* Effect.tryPromise(() =>
        handleQrRegistrationCodeWebRequest(webRequest, registrationId),
      );

      return HttpServerResponse.fromWeb(webResponse);
    }),
);

const stripeWebhookRouteLayer = HttpLayerRouter.add(
  'POST',
  '/webhooks/stripe',
  (request) =>
    Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;
      const rateLimitKey = resolveWebhookRateLimitKey(request);
      const rateLimitResult = yield* rateLimit.consume(rateLimitKey);
      if (!rateLimitResult.allowed) {
        return HttpServerResponse.text('Too many requests', {
          headers: {
            'Retry-After': String(rateLimitResult.retryAfterSeconds),
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
          },
          status: 429,
        });
      }

      const webRequest = BunHttpServerRequest.toRequest(request);
      const webResponse = yield* Effect.tryPromise(() =>
        handleStripeWebhookWebRequest(webRequest),
      );

      return HttpServerResponse.fromWeb(webResponse);
    }),
);

const rpcRouteLayer = HttpLayerRouter.add('POST', '/rpc', (request) =>
  Effect.gen(function* () {
    const authSession = yield* loadAuthSession(request);
    const requestContext = yield* Effect.tryPromise(() =>
      resolveHttpRequestContext(request, authSession),
    );

    const webRequest = BunHttpServerRequest.toRequest(request);
    const rpcWebResponse = yield* Effect.tryPromise(() =>
      handleAppRpcRequestWithContext(
        webRequest,
        requestContext,
        getRequestAuthData(authSession),
      ),
    );

    return HttpServerResponse.fromWeb(rpcWebResponse);
  }),
);

const staticAndAngularCatchAllLayer = HttpLayerRouter.add('*', '*', (request) =>
  Effect.gen(function* () {
    const staticResponse = yield* tryServeStatic(request);
    if (staticResponse) {
      return staticResponse;
    }

    if (request.method === 'GET') {
      return yield* renderSsr(request);
    }

    return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
  }),
);

const securityHeadersMiddlewareLayer = HttpLayerRouter.middleware(
  (effect) =>
    effect.pipe(Effect.map((response) => applySecurityHeaders(response))),
  { global: true },
);

export const routesLayer = Layer.mergeAll(
  healthRouteLayer,
  loginRouteLayer,
  callbackRouteLayer,
  logoutRouteLayer,
  forwardLoginRouteLayer,
  qrCodeRouteLayer,
  stripeWebhookRouteLayer,
  rpcRouteLayer,
  staticAndAngularCatchAllLayer,
  securityHeadersMiddlewareLayer,
);

const createInternalErrorResponse = (
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse => {
  const acceptHeader = request.headers['accept'] ?? '';
  if (typeof acceptHeader === 'string' && acceptHeader.includes('text/html')) {
    return HttpServerResponse.redirect('/500', { status: 303 });
  }

  return HttpServerResponse.unsafeJson(
    { error: 'Internal Server Error' },
    { status: 500 },
  );
};

export const withSsrFallback = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        if (error instanceof HttpServerError.RouteNotFound) {
          return notFoundServerResponse;
        }

        consola.error(error);
        Sentry.captureException(error);
        return createInternalErrorResponse(request);
      }),
    ),
  );
