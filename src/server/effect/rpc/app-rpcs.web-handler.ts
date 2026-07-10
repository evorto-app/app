import type * as Scope from 'effect/Scope';

import { Context, Effect, Layer } from 'effect';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization';
import * as RpcServer from 'effect/unstable/rpc/RpcServer';

import { RuntimeConfig } from '../../config/runtime-config';
import { RegistrationTransferService } from '../../registrations/registration-transfer.service';
import { stripeClientLayer } from '../../stripe-client';
import { serverLoggerLayer } from '../server-logger.layer';
import { appRpcHandlers, ServerAppRpcs } from './app-rpcs.handlers';
import { EventRegistrationService } from './handlers/events/event-registration.service';
import { ReceiptMediaService } from './handlers/finance/receipt-media.service';
import { rpcRequestContextMiddlewareLive } from './handlers/middleware/rpc-request-context.middleware.live';
import { RpcAccess } from './handlers/shared/rpc-access.service';
import { SimpleTemplateService } from './handlers/templates/simple-template.service';

class AppRpcHttpApp extends Context.Service<
  AppRpcHttpApp,
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >
>()('@server/effect/rpc/AppRpcHttpApp') {}

const appRpcDependenciesLayer = Layer.mergeAll(
  EventRegistrationService.Default,
  RegistrationTransferService.Default,
  RpcAccess.Default,
  ReceiptMediaService.Default,
  SimpleTemplateService.Default,
  RuntimeConfig.Default,
  stripeClientLayer,
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

export const appRpcHttpAppLayer = Layer.effect(AppRpcHttpApp)(
  RpcServer.toHttpEffect(ServerAppRpcs).pipe(
    Effect.provide(appRpcRuntimeLayer),
  ),
);

export const handleAppRpcHttpRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  AppRpcHttpApp.use((appRpcHttpApp) =>
    appRpcHttpApp.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    ),
  );
