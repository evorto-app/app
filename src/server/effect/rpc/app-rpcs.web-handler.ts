import type * as Scope from 'effect/Scope';

import * as HttpApp from '@effect/platform/HttpApp';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Context, Effect, Layer } from 'effect';

import { serverLoggerLayer } from '../server-logger.layer';
import { appRpcHandlers, ServerAppRpcs } from './app-rpcs.handlers';
import { EventRegistrationService } from './handlers/events/event-registration.service';
import { ReceiptMediaService } from './handlers/finance/receipt-media.service';
import { rpcRequestContextMiddlewareLive } from './handlers/middleware/rpc-request-context.middleware.live';
import { RpcAccess } from './handlers/shared/rpc-access.service';
import { SimpleTemplateService } from './handlers/templates/simple-template.service';

class AppRpcHttpApp extends Context.Tag(
  '@server/effect/rpc/AppRpcHttpApp',
)<AppRpcHttpApp, HttpApp.Default<never, Scope.Scope>>() {}

const appRpcDependenciesLayer = Layer.mergeAll(
  EventRegistrationService.Default,
  RpcAccess.Default,
  ReceiptMediaService.Default,
  SimpleTemplateService.Default,
);
const appRpcHandlersLayer = appRpcHandlers.pipe(
  Layer.provide(appRpcDependenciesLayer),
);
const appRpcRuntimeLayer = Layer.mergeAll(
  appRpcHandlersLayer,
  rpcRequestContextMiddlewareLive,
  RpcSerialization.layerJson,
  serverLoggerLayer,
);

export const appRpcHttpAppLayer = Layer.scoped(
  AppRpcHttpApp,
  RpcServer.toHttpApp(ServerAppRpcs).pipe(
    Effect.provide(appRpcRuntimeLayer),
  ),
);

export const handleAppRpcHttpRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  AppRpcHttpApp.pipe(
    Effect.flatMap((appRpcHttpApp) =>
      appRpcHttpApp.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
