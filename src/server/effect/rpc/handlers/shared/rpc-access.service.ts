import { Effect } from 'effect';

import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { type User } from '../../../../../types/custom/user';

export class RpcAccess extends Effect.Service<RpcAccess>()(
  '@server/effect/rpc/handlers/shared/RpcAccess',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const context = yield* RpcRequestContext;

      const current = Effect.fn('RpcAccess.current')(
        (): Effect.Effect<RpcRequestContextShape> => Effect.succeed(context),
      );

      const ensureAuthenticated = Effect.fn('RpcAccess.ensureAuthenticated')(
        (): Effect.Effect<void, 'UNAUTHORIZED'> =>
          context.authenticated
            ? Effect.void
            : Effect.fail('UNAUTHORIZED' as const),
      );

      const ensurePermission = Effect.fn('RpcAccess.ensurePermission')(
        (permission: Permission): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
          Effect.gen(function* () {
            yield* ensureAuthenticated();
            if (!context.permissions.includes(permission)) {
              return yield* Effect.fail('FORBIDDEN' as const);
            }
          }),
      );

      const requireUser = Effect.fn('RpcAccess.requireUser')(
        (): Effect.Effect<User, 'UNAUTHORIZED'> =>
          context.user ? Effect.succeed(context.user) : Effect.fail('UNAUTHORIZED' as const),
      );

      return {
        current,
        ensureAuthenticated,
        ensurePermission,
        requireUser,
      } as const;
    }),
  },
) {}
