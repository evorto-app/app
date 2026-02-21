import * as HttpApp from '@effect/platform/HttpApp';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Context, Effect, Layer } from 'effect';
import type * as Scope from 'effect/Scope';

import { databaseLayer } from '../../../db';
import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { serverLoggerLayer } from '../server-logger.layer';
import { appRpcHandlers } from './app-rpcs.handlers';

class AppRpcHttpApp extends Context.Tag(
  '@server/effect/rpc/AppRpcHttpApp',
)<AppRpcHttpApp, HttpApp.Default<never, Scope.Scope>>() {}

const appRpcDependenciesLayer = Layer.mergeAll(
  appRpcHandlers,
  RpcSerialization.layerJson,
  serverLoggerLayer,
);

export const appRpcHttpAppLayer = Layer.scoped(
  AppRpcHttpApp,
  RpcServer.toHttpApp(AppRpcs).pipe(
    Effect.provide(appRpcDependenciesLayer),
    Effect.provide(databaseLayer),
  ),
);

export const handleAppRpcHttpRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.flatMap(AppRpcHttpApp, (appRpcHttpApp) =>
    appRpcHttpApp.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    ),
  );
