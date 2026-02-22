import type * as Scope from 'effect/Scope';

import * as HttpApp from '@effect/platform/HttpApp';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Context, Effect, Layer } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { serverLoggerLayer } from '../server-logger.layer';
import { appRpcHandlers } from './app-rpcs.handlers';
import { EventRegistrationService } from './handlers/domains/events/event-registration.service';
import { ReceiptMediaService } from './handlers/domains/finance/receipt-media.service';
import { SimpleTemplateService } from './handlers/domains/templates/simple-template.service';

class AppRpcHttpApp extends Context.Tag(
  '@server/effect/rpc/AppRpcHttpApp',
)<AppRpcHttpApp, HttpApp.Default<never, Scope.Scope>>() {}

const appRpcDependenciesLayer = Layer.mergeAll(
  EventRegistrationService.Default,
  ReceiptMediaService.Default,
  SimpleTemplateService.Default,
);
const appRpcHandlersLayer = appRpcHandlers.pipe(
  Layer.provide(appRpcDependenciesLayer),
);
const appRpcRuntimeLayer = Layer.mergeAll(
  appRpcHandlersLayer,
  RpcSerialization.layerJson,
  serverLoggerLayer,
);

export const appRpcHttpAppLayer = Layer.scoped(
  AppRpcHttpApp,
  RpcServer.toHttpApp(AppRpcs).pipe(
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
