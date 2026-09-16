import { Effect, Schema } from 'effect';

import type { RpcRequestContextShape } from '../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';

import { UsersAuthData } from '../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { type Context as RequestContext } from '../../../types/custom/context';
import { InvalidAuthSessionError } from '../../auth/auth-session';

export const toRpcRequestContext = (
  context: RequestContext,
  authData: Record<string, unknown>,
): Effect.Effect<RpcRequestContextShape, InvalidAuthSessionError> =>
  Schema.decodeUnknownEffect(UsersAuthData)(authData).pipe(
    Effect.mapError(
      () =>
        new InvalidAuthSessionError({
          message:
            'Auth0 session profile claims do not match the application contract',
          reason: 'unusable-session-cookie',
        }),
    ),
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
