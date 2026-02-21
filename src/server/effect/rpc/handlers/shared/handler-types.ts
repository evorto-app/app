import * as RpcGroup from '@effect/rpc/RpcGroup';

import { AppRpcs } from '../../../../../shared/rpc-contracts/app-rpcs';

export type AppRpcRequest = RpcGroup.Rpcs<typeof AppRpcs>;
export type AppRpcHandlers = RpcGroup.HandlersFrom<AppRpcRequest>;
