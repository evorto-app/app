import type * as Scope from 'effect/Scope';

import { Context, Effect, Layer } from 'effect';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization';
import * as RpcServer from 'effect/unstable/rpc/RpcServer';

import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { RuntimeConfig } from '../../config/runtime-config';
import { ObjectStorage } from '../../integrations/object-storage';
import { RegistrationTransferService } from '../../registrations/registration-transfer.service';
import { stripeClientLayer } from '../../stripe-client';
import { serverLoggerLayer } from '../server-logger.layer';
import { appRpcHandlers, ServerAppRpcs } from './app-rpcs.handlers';
import { EventRegistrationService } from './handlers/events/event-registration.service';
import { ReceiptMediaService } from './handlers/finance/receipt-media.service';
import { rpcRequestContextMiddlewareLive } from './handlers/middleware/rpc-request-context.middleware.live';
import { RpcAccess } from './handlers/shared/rpc-access.service';

type AppRpcHttpAppShape = (
  request: HttpServerRequest.HttpServerRequest,
  requestContext: RpcRequestContextShape,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>;

class AppRpcHttpApp extends Context.Service<
  AppRpcHttpApp,
  AppRpcHttpAppShape
>()('@server/effect/rpc/AppRpcHttpApp') {}

// The largest current RPC upload is a 5 MiB brand asset encoded as base64.
// Eight MiB leaves room for that encoding and the RPC envelope.
export const MAX_RPC_BODY_SIZE_BYTES = 8 * 1024 * 1024;

const objectStorageLayer = ObjectStorage.Default;
const receiptMediaLayer = ReceiptMediaService.Default.pipe(
  Layer.provide(objectStorageLayer),
);
const appRpcDependenciesLayer = Layer.mergeAll(
  EventRegistrationService.Default,
  RegistrationTransferService.Default,
  RpcAccess.Default,
  objectStorageLayer,
  receiptMediaLayer,
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

const makeAppRpcHttpApp: AppRpcHttpAppShape = (request, requestContext) =>
  RpcServer.toHttpEffect(ServerAppRpcs).pipe(
    Effect.provide(appRpcRuntimeLayer),
    Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    Effect.provideService(RpcRequestContext, requestContext),
  );

export const appRpcHttpAppLayer = Layer.succeed(
  AppRpcHttpApp,
  makeAppRpcHttpApp,
);

export const handleAppRpcHttpRequest = (
  request: HttpServerRequest.HttpServerRequest,
  requestContext: RpcRequestContextShape,
) =>
  AppRpcHttpApp.use((appRpcHttpApp) => appRpcHttpApp(request, requestContext));
