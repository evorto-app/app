import * as Rpc from 'effect/rpc/Rpc';
import * as RpcGroup from 'effect/rpc/RpcGroup';

import { AppRpcs } from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcRequestContextMiddleware } from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';

export type AppRpcHandlers = RpcGroup.HandlersFrom<
  Rpc.AddMiddleware<AppRpcRequest, typeof RpcRequestContextMiddleware>
>;
export type AppRpcRequest = RpcGroup.Rpcs<typeof AppRpcs>;
