import * as HttpServer from '@effect/platform/HttpServer';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Layer, Logger } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { appRpcHandlers } from './app-rpcs.handlers';

const appRpcLayer = Layer.mergeAll(
  appRpcHandlers,
  RpcSerialization.layerJson,
  HttpServer.layerContext,
  Logger.replace(Logger.defaultLogger, Logger.prettyLoggerDefault),
);
const { handler: rpcWebHandler } = RpcServer.toWebHandler(AppRpcs, {
  layer: appRpcLayer,
});

export const handleAppRpcWebRequest = (request: Request): Promise<Response> =>
  rpcWebHandler(request);
