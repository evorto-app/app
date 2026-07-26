import { Layer } from 'effect';

import { RpcRequestContextMiddleware } from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';

export const rpcRequestContextMiddlewareLive = Layer.succeed(
  RpcRequestContextMiddleware,
  RpcRequestContextMiddleware.of((effect) => effect),
);
