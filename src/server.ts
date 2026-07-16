import type { IncomingMessage } from 'node:http';

import { AngularAppEngine } from '@angular/ssr';
import {
  createNodeRequestHandler,
  createWebRequestFromNodeRequest,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import * as OtelResource from '@effect/opentelemetry/Resource';
import * as OtelTracer from '@effect/opentelemetry/Tracer';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as Sentry from '@sentry/bun';
import { ConfigProvider, FileSystem, Path } from 'effect';
import { Effect, Fiber, Layer, Option } from 'effect';
import {
  HttpRouter as HttpLayerRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';
import { KeyValueStore } from 'effect/unstable/persistence';

import { databaseLayer } from './db';
import {
  getRequestAuthData,
  handleCallbackRequest,
  handleLoginRequest,
  handleLogoutRequest,
  loadAuthSession,
  toAbsoluteRequestUrl,
} from './server/auth/auth-session';
import { formatConfigError } from './server/config/config-error';
import { makeRuntimeConfigProvider } from './server/config/provider';
import { registrationRefundWorkerRuntimeModeConfig } from './server/config/registration-refund-worker-config';
import { RuntimeConfig } from './server/config/runtime-config';
import {
  serverNetworkConfig,
  serverTelemetryConfig,
} from './server/config/server-config';
import { resolveHttpRequestContext } from './server/context/http-request-context';
import {
  MAX_RPC_BODY_SIZE_BYTES,
  toRpcHttpServerRequest,
} from './server/effect/rpc/app-rpcs.request-handler';
import {
  appRpcHttpAppLayer,
  handleAppRpcHttpRequest,
} from './server/effect/rpc/app-rpcs.web-handler';
import { serverLoggerLayer } from './server/effect/server-logger.layer';
import {
  APPLICATION_READINESS_PATH,
  createApplicationReadinessResponse,
  createApplicationReadinessSsrRequest,
} from './server/http/application-readiness';
import { handleHealthzWebRequest } from './server/http/healthz.web-handler';
import { handleQrRegistrationCodeWebRequest } from './server/http/qr-code.web-handler';
import {
  discardNodeRequestBody,
  readNodeRequestBody,
  registerPrebufferedRequestBody,
  RequestBodyInvalidContentLengthError,
  RequestBodyReadError,
  requestBodyStreamFromBuffer,
  RequestBodyTooLargeError,
} from './server/http/request-body';
import { applySecurityHeaders } from './server/http/security-headers';
import { makeServerResponseMiddleware } from './server/http/server-response.middleware';
import {
  handleStripeWebhookWebRequest,
  MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES,
} from './server/http/stripe-webhook.web-handler';
import { handleTenantBrandAssetWebRequest } from './server/http/tenant-brand-asset.web-handler';
import { createUnknownTenantResponse } from './server/http/unknown-tenant-response';
import { runEmailOutboxProcessor } from './server/notifications/email-delivery';
import {
  launchRegistrationRefundWorker,
  runRegistrationRefundWorker,
} from './server/payments/registration-refund';
import { runExpiredRegistrationCheckoutCleanupWorker } from './server/registrations/expired-checkout-cleanup';
import { stripeClientLayer } from './server/stripe-client';
import { sanitizeRelativeRedirectPath } from './shared/auth-redirect';

const angularApp = new AngularAppEngine();
const browserDistributionUrl = new URL('../browser/', import.meta.url);
const cacheControlHeader = 'public, max-age=31536000';
const keyValueStoreDirectory = '.cache/evorto/server-kv';
const notFoundServerResponse = HttpServerResponse.empty({ status: 404 });
const rpcPath = '/rpc';
const stripeWebhookPath = '/webhooks/stripe';

const isStaticMethod = (method: string) =>
  method === 'GET' || method === 'HEAD';

const isSsrMethod = (method: string) => method === 'GET';

const safeDecodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return;
  }
};

const resolveStaticPath = (pathname: string) =>
  Effect.gen(function* () {
    const decodedPath = safeDecodePath(pathname);
    if (!decodedPath || decodedPath.includes('\u{0}')) {
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
) => {
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

const decodePathSegment = (value: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('/') || decoded.includes('\\')
      ? undefined
      : decoded;
  } catch {
    return;
  }
};

const extractTenantBrandAsset = (
  request: HttpServerRequest.HttpServerRequest,
) => {
  const requestUrl = toAbsoluteRequestUrl(request);
  const match = /^\/tenant-assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    requestUrl.pathname,
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    return;
  }

  const tenantId = decodePathSegment(match[1]);
  const kind = decodePathSegment(match[2]);
  const fileName = decodePathSegment(match[3]);
  if (!tenantId || !kind || !fileName) {
    return;
  }

  return {
    fileName,
    kind,
    tenantId,
  };
};

const renderSsrWeb = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const authSession = yield* loadAuthSession(request);
    const requestContextOption = yield* resolveHttpRequestContext(
      request,
      authSession,
    ).pipe(
      Effect.map((context) => Option.fromNullishOr(context)),
      Effect.catchTag('HttpRequestTenantNotFoundError', () =>
        Effect.succeed(Option.none()),
      ),
    );
    if (Option.isNone(requestContextOption)) {
      return null;
    }
    const requestContext = requestContextOption.value;

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const renderedResponse = yield* Effect.tryPromise(() =>
      angularApp.handle(webRequest, requestContext),
    );

    return renderedResponse;
  });

const renderSsr = (request: HttpServerRequest.HttpServerRequest) =>
  renderSsrWeb(request).pipe(
    Effect.map((renderedResponse) =>
      renderedResponse
        ? HttpServerResponse.fromWeb(renderedResponse)
        : createUnknownTenantResponse(request.method),
    ),
  );

const healthRouteLayer = HttpLayerRouter.add('*', '/healthz', (request) =>
  Effect.gen(function* () {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const response = yield* Effect.tryPromise(() =>
        handleHealthzWebRequest(),
      );
      if (request.method === 'HEAD') {
        return HttpServerResponse.empty({
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        });
      }
      return HttpServerResponse.fromWeb(response);
    }

    return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
  }),
);

const applicationReadinessRouteLayer = HttpLayerRouter.add(
  'GET',
  APPLICATION_READINESS_PATH,
  (request) =>
    Effect.gen(function* () {
      const readinessWebRequest = yield* HttpServerRequest.toWeb(request);
      const ssrWebRequest =
        createApplicationReadinessSsrRequest(readinessWebRequest);
      const ssrResponse = yield* renderSsrWeb(
        HttpServerRequest.fromWeb(ssrWebRequest),
      );
      const readinessResponse = yield* Effect.tryPromise(() =>
        createApplicationReadinessResponse(ssrResponse),
      );

      return HttpServerResponse.fromWeb(readinessResponse);
    }),
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
        sanitizeRelativeRedirectPath(
          requestUrl.searchParams.get('redirectUrl'),
        ) ?? '/';

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
      const authSession = yield* loadAuthSession(request);
      const requestContextOption = yield* resolveHttpRequestContext(
        request,
        authSession,
      ).pipe(
        Effect.map((context) => Option.fromNullishOr(context)),
        Effect.catchTag('HttpRequestTenantNotFoundError', () =>
          Effect.succeed(Option.none()),
        ),
      );
      if (Option.isNone(requestContextOption)) {
        return notFoundServerResponse;
      }
      const requestContext = requestContextOption.value;

      const registrationId = extractRegistrationId(request);
      if (!registrationId) {
        return HttpServerResponse.text('Registration id missing', {
          status: 400,
        });
      }

      const webRequest = yield* HttpServerRequest.toWeb(request);
      const webResponse = yield* handleQrRegistrationCodeWebRequest(
        webRequest,
        registrationId,
        requestContext,
      );

      return HttpServerResponse.fromWeb(webResponse);
    }),
);

const tenantBrandAssetRouteLayer = HttpLayerRouter.add(
  'GET',
  '/tenant-assets/:tenantId/:kind/:fileName',
  (request) =>
    Effect.gen(function* () {
      const asset = extractTenantBrandAsset(request);
      if (!asset) {
        return HttpServerResponse.text('Asset not found', { status: 404 });
      }

      const webResponse = yield* handleTenantBrandAssetWebRequest(asset);

      return HttpServerResponse.fromWeb(webResponse);
    }),
);

const stripeWebhookRouteLayer = HttpLayerRouter.add(
  'POST',
  stripeWebhookPath,
  (request) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpServerRequest.toWeb(request);
      const webResponse = yield* handleStripeWebhookWebRequest(webRequest);

      return HttpServerResponse.fromWeb(webResponse);
    }),
);

const rpcRouteLayer = HttpLayerRouter.add('POST', rpcPath, (request) =>
  Effect.gen(function* () {
    const authSession = yield* loadAuthSession(request);
    const requestContextOption = yield* resolveHttpRequestContext(
      request,
      authSession,
    ).pipe(
      Effect.map((context) => Option.fromNullishOr(context)),
      Effect.catchTag('HttpRequestTenantNotFoundError', () =>
        Effect.succeed(Option.none()),
      ),
    );
    if (Option.isNone(requestContextOption)) {
      return notFoundServerResponse;
    }
    const requestContext = requestContextOption.value;

    const webRequest = yield* HttpServerRequest.toWeb(request);
    return yield* toRpcHttpServerRequest(
      webRequest,
      requestContext,
      getRequestAuthData(authSession),
    ).pipe(
      Effect.flatMap((rpcRequest) => handleAppRpcHttpRequest(rpcRequest)),
      Effect.catchTags({
        RequestBodyInvalidContentLengthError: (error) =>
          Effect.logWarning('RPC request has invalid Content-Length').pipe(
            Effect.annotateLogs({ contentLength: error.contentLength }),
            Effect.as(
              HttpServerResponse.text('Invalid Content-Length', {
                status: 400,
              }),
            ),
          ),
        RequestBodyReadError: (error) =>
          Effect.logWarning('Failed to read RPC request body').pipe(
            Effect.annotateLogs({
              error:
                error.cause instanceof Error
                  ? error.cause.message
                  : String(error.cause),
            }),
            Effect.as(
              HttpServerResponse.text('Unable to read request body', {
                status: 400,
              }),
            ),
          ),
        RequestBodyTooLargeError: (error) =>
          Effect.logWarning('RPC request body exceeded route limit').pipe(
            Effect.annotateLogs({ maxBytes: error.maxBytes }),
            Effect.as(
              HttpServerResponse.text('Payload too large', { status: 413 }),
            ),
          ),
      }),
    );
  }),
);

const staticAndAngularCatchAllLayer = HttpLayerRouter.add('*', '*', (request) =>
  Effect.gen(function* () {
    const staticResponse = yield* tryServeStatic(request);
    if (staticResponse) {
      return staticResponse;
    }

    if (isSsrMethod(request.method)) {
      return yield* renderSsr(request);
    }

    return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
  }),
);

const responseMiddlewareLayer = HttpLayerRouter.middleware<{
  handles: unknown;
}>()(makeServerResponseMiddleware(Sentry.captureException), { global: true });

const routesLayer = Layer.mergeAll(
  healthRouteLayer,
  applicationReadinessRouteLayer,
  loginRouteLayer,
  callbackRouteLayer,
  logoutRouteLayer,
  forwardLoginRouteLayer,
  qrCodeRouteLayer,
  tenantBrandAssetRouteLayer,
  stripeWebhookRouteLayer,
  rpcRouteLayer,
  staticAndAngularCatchAllLayer,
  responseMiddlewareLayer,
);

const keyValueStoreLayer = KeyValueStore.layerFileSystem(
  keyValueStoreDirectory,
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, Path.layer)));
const otelLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { PACKAGE_VERSION } = yield* serverTelemetryConfig;

    return OtelTracer.layerGlobal.pipe(
      Layer.provide(
        OtelResource.layer({
          serviceName: 'evorto-server',
          ...Option.match(PACKAGE_VERSION, {
            onNone: () => ({}),
            onSome: (serviceVersion) => ({ serviceVersion }),
          }),
        }),
      ),
    );
  }),
);

let cachedRequestHandler: ((request: Request) => Promise<Response>) | undefined;
const requestHandlerRuntimeConfigProvider = await Effect.runPromise(
  makeRuntimeConfigProvider(),
);

const getRequestHandler = () => {
  if (cachedRequestHandler) {
    return cachedRequestHandler;
  }

  const configuredDatabaseLayer = databaseLayer.pipe(
    Layer.provide(ConfigProvider.layer(requestHandlerRuntimeConfigProvider)),
  );
  const handlerRuntimeLayer = Layer.mergeAll(
    BunHttpServer.layerHttpServices,
    BunFileSystem.layer,
    Path.layer,
    keyValueStoreLayer,
    otelLayer,
    serverLoggerLayer,
    appRpcHttpAppLayer,
    stripeClientLayer,
    RuntimeConfig.Default,
    ConfigProvider.layer(requestHandlerRuntimeConfigProvider),
  );
  const requestRuntimeLayer = handlerRuntimeLayer.pipe(
    Layer.provideMerge(configuredDatabaseLayer),
  );
  const handlerAppLayer = routesLayer.pipe(
    HttpLayerRouter.provideRequest(requestRuntimeLayer),
  );
  const { handler: serverHandler } =
    HttpLayerRouter.toWebHandler(handlerAppLayer);

  cachedRequestHandler = (request: Request) => serverHandler(request);

  return cachedRequestHandler;
};

const requestPathname = (url: string | undefined) => {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
};

const requestBodyLimit = (method: string, pathname: string) => {
  if (method !== 'POST') {
    return;
  }
  const normalizedPathname = pathname.replace(/\/+$/u, '') || '/';
  if (normalizedPathname === rpcPath) {
    return MAX_RPC_BODY_SIZE_BYTES;
  }
  if (normalizedPathname === stripeWebhookPath) {
    return MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES;
  }
  return;
};

const requestBodyErrorResponse = (error: unknown) => {
  let response: HttpServerResponse.HttpServerResponse | undefined;
  if (error instanceof RequestBodyInvalidContentLengthError) {
    response = HttpServerResponse.text('Invalid Content-Length', {
      status: 400,
    });
  } else if (error instanceof RequestBodyReadError) {
    response = HttpServerResponse.text('Unable to read request body', {
      status: 400,
    });
  } else if (error instanceof RequestBodyTooLargeError) {
    response = HttpServerResponse.text('Payload too large', { status: 413 });
  }

  return response
    ? HttpServerResponse.toWeb(applySecurityHeaders(response))
    : undefined;
};

const toNodeWebRequest = async (request: IncomingMessage) => {
  const method = request.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return createWebRequestFromNodeRequest(request);
  }

  const maxBytes = requestBodyLimit(method, requestPathname(request.url));
  if (maxBytes === undefined) {
    // The Effect router has no other body-bearing routes. Fail closed before
    // adapting the raw Node stream, and never wait for an untrusted body to
    // reach EOF merely to return the route's not-found response.
    discardNodeRequestBody(request);
    return HttpServerResponse.toWeb(
      applySecurityHeaders(notFoundServerResponse),
    );
  }

  const body = await Effect.runPromise(readNodeRequestBody(request, maxBytes));
  const metadata = createWebRequestFromNodeRequest(request);

  const webRequestInit = {
    body: requestBodyStreamFromBuffer(body),
    duplex: 'half',
    headers: metadata.headers,
    method,
    signal: metadata.signal,
  } satisfies RequestInit & { duplex: 'half' };

  return registerPrebufferedRequestBody(
    new Request(metadata.url, webRequestInit),
    body,
  );
};

const requestHandler = createNodeRequestHandler(
  async (request, response, next) => {
    try {
      const adaptedRequest = await toNodeWebRequest(request);
      const webResponse =
        adaptedRequest instanceof Response
          ? adaptedRequest
          : await getRequestHandler()(adaptedRequest);
      await writeResponseToNodeResponse(webResponse, response);
    } catch (error) {
      const errorResponse = requestBodyErrorResponse(error);
      if (errorResponse) {
        await writeResponseToNodeResponse(errorResponse, response);
        return;
      }
      next(error);
    }
  },
);

export { requestHandler as reqHandler };

const serveEffect = Effect.gen(function* () {
  const configuredDatabaseLayer = databaseLayer.pipe(
    Layer.provide(ConfigProvider.layer(requestHandlerRuntimeConfigProvider)),
  );
  const configuredStripeClientLayer = stripeClientLayer.pipe(
    Layer.provide(ConfigProvider.layer(requestHandlerRuntimeConfigProvider)),
  );
  const configuredServerConfig = serverNetworkConfig
    .parse(requestHandlerRuntimeConfigProvider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid server configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
  const configuredRegistrationRefundWorkerMode =
    registrationRefundWorkerRuntimeModeConfig
      .parse(requestHandlerRuntimeConfigProvider)
      .pipe(
        Effect.mapError(
          (error) =>
            new Error(
              `Invalid server configuration:\n${formatConfigError(error)}`,
            ),
        ),
      );
  const { PORT: port } = yield* configuredServerConfig;
  const registrationRefundWorkerMode =
    yield* configuredRegistrationRefundWorkerMode;

  const serverLayer = HttpLayerRouter.serve(routesLayer).pipe(
    Layer.provide(
      Layer.mergeAll(
        BunHttpServer.layer({ port }),
        BunFileSystem.layer,
        Path.layer,
        keyValueStoreLayer,
        otelLayer,
        serverLoggerLayer,
        appRpcHttpAppLayer,
        stripeClientLayer,
        RuntimeConfig.Default,
        ConfigProvider.layer(requestHandlerRuntimeConfigProvider),
      ),
    ),
  );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const databaseContext = yield* Layer.build(configuredDatabaseLayer);
      const stripeClientContext = yield* Layer.build(
        configuredStripeClientLayer,
      );
      const serverFiber = yield* Layer.launch(serverLayer).pipe(
        Effect.provide(databaseContext),
        Effect.forkScoped,
      );
      yield* runEmailOutboxProcessor.pipe(
        Effect.provide(databaseContext),
        Effect.provide(
          ConfigProvider.layer(requestHandlerRuntimeConfigProvider),
        ),
        Effect.forkScoped,
      );
      yield* runExpiredRegistrationCheckoutCleanupWorker.pipe(
        Effect.provide(databaseContext),
        Effect.provide(stripeClientContext),
        Effect.forkScoped,
      );
      yield* launchRegistrationRefundWorker(
        registrationRefundWorkerMode,
        runRegistrationRefundWorker.pipe(
          Effect.provide(databaseContext),
          Effect.provide(stripeClientContext),
        ),
      );
      yield* Effect.logInfo('Bun Effect server listening').pipe(
        Effect.annotateLogs({
          port,
          url: `http://localhost:${port}`,
        }),
      );
      return yield* Fiber.join(serverFiber);
    }),
  );
});

if (import.meta.main) {
  BunRuntime.runMain(serveEffect as Effect.Effect<never, unknown, never>);
}
