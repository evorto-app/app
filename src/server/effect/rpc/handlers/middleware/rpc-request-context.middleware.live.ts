import type { Headers } from '@effect/platform';

import { Effect, Layer, Schema } from 'effect';

import { type Permission } from '../../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { RpcRequestContextMiddleware } from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { UsersAuthData } from '../../../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

export const decodeRpcRequestContextFromHeaders = (headers: Headers.Headers) => ({
  authData: decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.AUTH_DATA], UsersAuthData),
  authenticated: headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true',
  permissions: decodeHeaderJson(
    headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
    ConfigPermissions,
  ) as readonly Permission[],
  tenant: decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.TENANT], Tenant),
  user: decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  userAssigned: headers[RPC_CONTEXT_HEADERS.USER_ASSIGNED] === 'true',
});

export const rpcRequestContextMiddlewareLive = Layer.succeed(
  RpcRequestContextMiddleware,
  RpcRequestContextMiddleware.of(({ headers }) =>
    Effect.sync(() => decodeRpcRequestContextFromHeaders(headers)),
  ),
);
