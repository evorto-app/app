import { Schema } from 'effect';

import { type RpcRequestContextShape } from '../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { UsersAuthData } from '../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { type Context as RequestContext } from '../../../types/custom/context';

export const toRpcRequestContext = (
  context: RequestContext,
  authData: Record<string, unknown>,
): RpcRequestContextShape => ({
  authData: Schema.decodeUnknownSync(UsersAuthData)(authData),
  authenticated: context.authentication.isAuthenticated,
  permissions: context.permissions,
  platformAuthority: context.platformAuthority ?? null,
  tenant: context.tenant,
  user: context.user ?? null,
  userAssigned: context.user !== undefined,
});
