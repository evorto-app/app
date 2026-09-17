import { Effect } from 'effect';

import type { RpcRequestContextShape } from '../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';

import { type Context as RequestContext } from '../../../types/custom/context';
import {
  decodeAuthSessionProfile,
  type InvalidAuthSessionError,
} from '../../auth/auth-session';

export const toRpcRequestContext = (
  context: RequestContext,
  authData: Record<string, unknown>,
): Effect.Effect<RpcRequestContextShape, InvalidAuthSessionError> =>
  decodeAuthSessionProfile(authData).pipe(
    Effect.map((profile) => ({
      authData: profile,
      authenticated: context.authentication.isAuthenticated,
      permissions: context.permissions,
      platformAuthority: context.platformAuthority ?? null,
      tenant: context.tenant,
      user: context.user ?? null,
      userAssigned: context.user !== undefined,
    })),
  );
