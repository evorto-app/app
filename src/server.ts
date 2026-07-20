import type { IncomingMessage } from 'node:http';

import { AngularAppEngine } from '@angular/ssr';
import {
  createNodeRequestHandler,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { ConfigProvider, FileSystem, Path } from 'effect';
import { Effect, Fiber, Layer, Option, Schema } from 'effect';
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
import {
  deploymentConfig,
  DeploymentRuntimeConfig,
} from './server/config/deployment-config';
import { makeRuntimeConfigProvider } from './server/config/provider';
import { registrationRefundWorkerRuntimeModeConfig } from './server/config/registration-refund-worker-config';
import { RuntimeConfig } from './server/config/runtime-config';
import { serverNetworkConfig } from './server/config/server-config';
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
import { serverTelemetryLayer } from './server/effect/server-telemetry.layer';
import {
  processReceiptOrphans,
  runReceiptOrphanCleanupWorker,
} from './server/finance/receipt-orphan-cleanup';
import {
  APPLICATION_READINESS_PATH,
  createApplicationReadinessResponse,
  createApplicationReadinessSsrRequest,
} from './server/http/application-readiness';
import {
  handleBrowserErrorTelemetryWebRequest,
  MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
} from './server/http/browser-error-telemetry.web-handler';
import { handleHealthzWebRequest } from './server/http/healthz.web-handler';
import {
  handleInternalTriggerWebRequest,
  type InternalTriggerArguments,
  MAX_INTERNAL_TRIGGER_BODY_SIZE_BYTES,
} from './server/http/internal-trigger.web-handler';
import { resolveNodeRequestBoundary } from './server/http/node-request-boundary';
import { handleOpsJsonTriggerWebRequest } from './server/http/ops-trigger.web-handler';
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
import { createVersionWebResponse } from './server/http/version.web-handler';
import { EmailDelivery } from './server/integrations/email-delivery';
import { ObjectStorage } from './server/integrations/object-storage';
import {
  processDueEmailOutbox,
  runEmailOutboxProcessor,
} from './server/notifications/email-delivery';
import {
  applySchema,
  explainSchema,
  initializeEmptyStaging,
  type OpsCommandError,
  seedStaging,
} from './server/ops/schema-operations';
import {
  launchRegistrationRefundWorker,
  processDueRegistrationRefundClaims,
  runRegistrationRefundWorker,
} from './server/payments/registration-refund';
import {
  processExpiredRegistrationCheckouts,
  runExpiredRegistrationCheckoutCleanupWorker,
} from './server/registrations/expired-checkout-cleanup';
import { validateRuntimeRoleConfiguration } from './server/runtime/runtime-role';
import { stripeClientLayer } from './server/stripe-client';
import { sanitizeRelativeRedirectPath } from './shared/auth-redirect';

const angularApp = new AngularAppEngine();
const browserDistributionUrl = new URL('../browser/', import.meta.url);
const cacheControlHeader = 'public, max-age=31536000';
const keyValueStoreDirectory = '.cache/evorto/server-kv';
const notFoundServerResponse = HttpServerResponse.empty({ status: 404 });
const rpcPath = '/rpc';
const stripeWebhookPath = '/webhooks/stripe';
const browserErrorTelemetryPath = '/telemetry/browser-errors';
const workerEmailDeliveryPath = '/internal/worker/email-delivery';
const workerExpiredCheckoutCleanupPath =
  '/internal/worker/expired-checkout-cleanup';
const workerReceiptOrphanCleanupPath =
  '/internal/worker/receipt-orphan-cleanup';
const workerStripeRefundPath = '/internal/worker/stripe-refunds';
const opsSchemaExplainPath = '/internal/ops/schema-explain';
const opsSchemaApplyPath = '/internal/ops/schema-apply';
const opsSeedStagingPath = '/internal/ops/seed-staging';
const requestHandlerRuntimeConfigProvider = await Effect.runPromise(
  makeRuntimeConfigProvider(),
);
const requestBoundaryDeployment = await Effect.runPromise(
  deploymentConfig.parse(requestHandlerRuntimeConfigProvider),
);
const internalTriggerPaths = new Set([
  opsSchemaApplyPath,
  opsSchemaExplainPath,
  opsSeedStagingPath,
  workerEmailDeliveryPath,
  workerExpiredCheckoutCleanupPath,
  workerReceiptOrphanCleanupPath,
  workerStripeRefundPath,
]);

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
      const deployment = yield* DeploymentRuntimeConfig;
      const readinessWebRequest = yield* HttpServerRequest.toWeb(request);
      const ssrWebRequest = createApplicationReadinessSsrRequest(
        readinessWebRequest,
        Option.getOrUndefined(deployment.READINESS_TENANT_HOST),
      );
      const ssrResponse = yield* renderSsrWeb(
        HttpServerRequest.fromWeb(ssrWebRequest),
      );
      const readinessResponse = yield* Effect.tryPromise(() =>
        createApplicationReadinessResponse(ssrResponse),
      );

      return HttpServerResponse.fromWeb(readinessResponse);
    }),
);

const versionRouteLayer = HttpLayerRouter.add('GET', '/version', () =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    return HttpServerResponse.fromWeb(
      createVersionWebResponse({
        environment: deployment.APP_ENVIRONMENT,
        imageDigest: Option.getOrElse(
          deployment.APP_IMAGE_DIGEST,
          () => 'development',
        ),
        revision: Option.getOrElse(
          deployment.APP_REVISION,
          () => 'development',
        ),
      }),
    );
  }),
);

const browserErrorTelemetryRouteLayer = HttpLayerRouter.add(
  'POST',
  browserErrorTelemetryPath,
  (request) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpServerRequest.toWeb(request);
      const response = yield* handleBrowserErrorTelemetryWebRequest(webRequest);
      return HttpServerResponse.fromWeb(response);
    }),
);

const handleWorkerTrigger = <A, E, R>(
  request: HttpServerRequest.HttpServerRequest,
  operation: (arguments_: InternalTriggerArguments) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);
    if (runtimeRole.role !== 'worker' || runtimeRole.triggerMode !== 'http') {
      return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
    }

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const webResponse = yield* handleInternalTriggerWebRequest(
      webRequest,
      operation,
    );
    return HttpServerResponse.fromWeb(webResponse);
  });

const workerEmailDeliveryRouteLayer = HttpLayerRouter.add(
  'POST',
  workerEmailDeliveryPath,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) =>
      processDueEmailOutbox(limit ?? 10).pipe(
        Effect.map((processed) => ({ processed })),
      ),
    ),
);

const workerExpiredCheckoutCleanupRouteLayer = HttpLayerRouter.add(
  'POST',
  workerExpiredCheckoutCleanupPath,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) =>
      processExpiredRegistrationCheckouts(
        limit === undefined ? {} : { batchSize: limit },
      ),
    ),
);

const workerStripeRefundRouteLayer = HttpLayerRouter.add(
  'POST',
  workerStripeRefundPath,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) =>
      processDueRegistrationRefundClaims(limit),
    ),
);

const workerReceiptOrphanCleanupRouteLayer = HttpLayerRouter.add(
  'POST',
  workerReceiptOrphanCleanupPath,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) =>
      processReceiptOrphans(limit === undefined ? {} : { batchSize: limit }),
    ),
);

const EmptyOpsArguments = Schema.Struct({});
const ApplySchemaArguments = Schema.Struct({
  planDigest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
});
const SeedStagingArguments = Schema.Struct({
  confirmation: Schema.Literal('reset-and-seed-staging'),
});
const InitializeStagingArguments = Schema.Struct({
  mode: Schema.Literal('initialize-empty'),
});
const StagingDataArguments = Schema.Union([
  InitializeStagingArguments,
  SeedStagingArguments,
]);

const handleOpsTrigger = <S extends Schema.Constraint, A, R>(
  request: HttpServerRequest.HttpServerRequest,
  schema: S,
  operation: (arguments_: S['Type']) => Effect.Effect<A, OpsCommandError, R>,
) =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);
    if (runtimeRole.role !== 'ops') {
      return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
    }

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const webResponse = yield* handleOpsJsonTriggerWebRequest(
      webRequest,
      schema,
      operation,
    );
    return HttpServerResponse.fromWeb(webResponse);
  });

const opsSchemaExplainRouteLayer = HttpLayerRouter.add(
  'POST',
  opsSchemaExplainPath,
  (request) =>
    handleOpsTrigger(request, EmptyOpsArguments, () =>
      Effect.gen(function* () {
        const deployment = yield* DeploymentRuntimeConfig;
        const plan = yield* explainSchema();
        return {
          digest: plan.digest,
          safe: plan.safe,
          schemaHash: Option.getOrElse(
            deployment.APP_SCHEMA_HASH,
            () => 'unconfigured',
          ),
          statementTypes: plan.statementTypes,
          unsafeReasons: plan.unsafeReasons,
        };
      }),
    ),
);

const opsSchemaApplyRouteLayer = HttpLayerRouter.add(
  'POST',
  opsSchemaApplyPath,
  (request) =>
    handleOpsTrigger(request, ApplySchemaArguments, ({ planDigest }) =>
      applySchema(planDigest),
    ),
);

const opsSeedStagingRouteLayer = HttpLayerRouter.add(
  'POST',
  opsSeedStagingPath,
  (request) =>
    handleOpsTrigger(request, StagingDataArguments, (arguments_) =>
      Effect.gen(function* () {
        const deployment = yield* DeploymentRuntimeConfig;
        if (deployment.APP_ENVIRONMENT !== 'staging') {
          return {
            reason: 'staging-only' as const,
            seeded: false as const,
          };
        }
        return 'confirmation' in arguments_
          ? yield* seedStaging(arguments_.confirmation)
          : yield* initializeEmptyStaging();
      }),
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
}>()(
  (effect) =>
    makeServerResponseMiddleware(effect, {
      applicationEnvironment: requestBoundaryDeployment.APP_ENVIRONMENT,
    }),
  { global: true },
);

const bootstrapReadinessRouteLayer = HttpLayerRouter.add(
  'GET',
  APPLICATION_READINESS_PATH,
  () =>
    Effect.succeed(
      HttpServerResponse.empty({
        headers: { 'Cache-Control': 'no-store' },
        status: 204,
      }),
    ),
);

const bootstrapRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  bootstrapReadinessRouteLayer,
  responseMiddlewareLayer,
);

const webRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  applicationReadinessRouteLayer,
  versionRouteLayer,
  browserErrorTelemetryRouteLayer,
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

const workerRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  versionRouteLayer,
  workerEmailDeliveryRouteLayer,
  workerExpiredCheckoutCleanupRouteLayer,
  workerReceiptOrphanCleanupRouteLayer,
  workerStripeRefundRouteLayer,
  responseMiddlewareLayer,
);
const configuredWorkerRoutesLayer = workerRoutesLayer.pipe(
  Layer.provide(EmailDelivery.Default),
);

const opsRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  versionRouteLayer,
  opsSchemaExplainRouteLayer,
  opsSchemaApplyRouteLayer,
  opsSeedStagingRouteLayer,
  responseMiddlewareLayer,
);

const keyValueStoreLayer = KeyValueStore.layerFileSystem(
  keyValueStoreDirectory,
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, Path.layer)));
const otelLayer = serverTelemetryLayer;

let cachedRequestHandler: ((request: Request) => Promise<Response>) | undefined;

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
    ObjectStorage.Default,
    otelLayer,
    serverLoggerLayer,
    appRpcHttpAppLayer,
    stripeClientLayer,
    DeploymentRuntimeConfig.Default,
    RuntimeConfig.Default,
    ConfigProvider.layer(requestHandlerRuntimeConfigProvider),
  );
  const requestRuntimeLayer = handlerRuntimeLayer.pipe(
    Layer.provideMerge(configuredDatabaseLayer),
  );
  const handlerAppLayer = webRoutesLayer.pipe(
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
  if (normalizedPathname === browserErrorTelemetryPath) {
    return MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES;
  }
  if (internalTriggerPaths.has(normalizedPathname)) {
    return MAX_INTERNAL_TRIGGER_BODY_SIZE_BYTES;
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

const nodeRequestHeaders = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers.append(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    }
  }
  return headers;
};

const toNodeWebRequest = async (request: IncomingMessage) => {
  const method = request.method ?? 'GET';
  const headers = nodeRequestHeaders(request);
  const requestBoundary = resolveNodeRequestBoundary({
    headers,
    requestTarget: request.url,
    socketEncrypted:
      'encrypted' in request.socket && request.socket.encrypted === true,
    trustPlatformProxy: requestBoundaryDeployment.TRUST_PLATFORM_PROXY,
  });
  if (!requestBoundary) {
    discardNodeRequestBody(request);
    return HttpServerResponse.toWeb(
      applySecurityHeaders(
        HttpServerResponse.text('Invalid Host or request target', {
          status: 400,
        }),
      ),
    );
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(requestBoundary.url, {
      headers: requestBoundary.headers,
      method,
    });
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

  const webRequestInit = {
    body: requestBodyStreamFromBuffer(body),
    duplex: 'half',
    headers: requestBoundary.headers,
    method,
  } satisfies RequestInit & { duplex: 'half' };

  return registerPrebufferedRequestBody(
    new Request(requestBoundary.url, webRequestInit),
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
  const configuredDeployment = deploymentConfig
    .parse(requestHandlerRuntimeConfigProvider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid deployment configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
  const deployment = yield* configuredDeployment;
  const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);

  if (runtimeRole.role === 'worker' && runtimeRole.triggerMode === 'poll') {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const registrationRefundWorkerMode =
          yield* registrationRefundWorkerRuntimeModeConfig
            .parse(requestHandlerRuntimeConfigProvider)
            .pipe(
              Effect.mapError(
                (error) =>
                  new Error(
                    `Invalid registration refund worker configuration:\n${formatConfigError(error)}`,
                  ),
              ),
            );
        const databaseContext = yield* Layer.build(configuredDatabaseLayer);
        const stripeClientContext = yield* Layer.build(
          configuredStripeClientLayer,
        );
        const configProviderLayer = ConfigProvider.layer(
          requestHandlerRuntimeConfigProvider,
        );
        const emailDeliveryContext = yield* Layer.build(
          EmailDelivery.Default.pipe(Layer.provide(configProviderLayer)),
        );

        yield* runEmailOutboxProcessor.pipe(
          Effect.provide(databaseContext),
          Effect.provide(emailDeliveryContext),
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
        yield* runReceiptOrphanCleanupWorker.pipe(
          Effect.provide(databaseContext),
          Effect.provide(ObjectStorage.Default),
          Effect.provide(configProviderLayer),
          Effect.forkScoped,
        );
        yield* Effect.logInfo('Polling worker started').pipe(
          Effect.annotateLogs({ role: runtimeRole.role }),
        );
        return yield* Effect.never;
      }),
    );
  }

  const { PORT: port } = yield* configuredServerConfig;
  const commonRuntimeLayer = Layer.mergeAll(
    BunHttpServer.layer({ port }),
    otelLayer,
    serverLoggerLayer,
    DeploymentRuntimeConfig.Default,
    ConfigProvider.layer(requestHandlerRuntimeConfigProvider),
  );
  const serverLayer = runtimeRole.bootstrap
    ? HttpLayerRouter.serve(bootstrapRoutesLayer).pipe(
        Layer.provide(commonRuntimeLayer),
      )
    : runtimeRole.role === 'web'
      ? HttpLayerRouter.serve(webRoutesLayer).pipe(
          Layer.provide(
            Layer.mergeAll(
              commonRuntimeLayer,
              BunFileSystem.layer,
              Path.layer,
              keyValueStoreLayer,
              ObjectStorage.Default,
              appRpcHttpAppLayer,
              stripeClientLayer,
              RuntimeConfig.Default,
            ),
          ),
        )
      : runtimeRole.role === 'worker'
        ? HttpLayerRouter.serve(configuredWorkerRoutesLayer).pipe(
            Layer.provide(
              Layer.mergeAll(
                commonRuntimeLayer,
                ObjectStorage.Default,
                stripeClientLayer,
              ),
            ),
          )
        : HttpLayerRouter.serve(opsRoutesLayer).pipe(
            Layer.provide(commonRuntimeLayer),
          );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const serverFiber =
        runtimeRole.bootstrap || runtimeRole.role === 'ops'
          ? yield* Layer.launch(serverLayer).pipe(Effect.forkScoped)
          : yield* Effect.gen(function* () {
              const databaseContext = yield* Layer.build(
                configuredDatabaseLayer,
              );
              return yield* Layer.launch(serverLayer).pipe(
                Effect.provide(databaseContext),
                Effect.forkScoped,
              );
            });
      yield* Effect.logInfo('Bun Effect server listening').pipe(
        Effect.annotateLogs({
          bootstrap: runtimeRole.bootstrap,
          port,
          role: runtimeRole.role,
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
