import { Effect, Layer, Option } from 'effect';

import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
} from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';

export const rpcRequestContextMiddlewareLive = Layer.succeed(
  RpcRequestContextMiddleware,
  RpcRequestContextMiddleware.of((effect) =>
    Effect.serviceOption(RpcRequestContext).pipe(
      Effect.flatMap((contextOption) =>
        Option.match(contextOption, {
          onNone: () =>
            Effect.die(new Error('RpcRequestContext missing at RPC boundary')),
          onSome: (context) =>
            effect.pipe(Effect.provideService(RpcRequestContext, context)),
        }),
      ),
    ),
  ),
);
