import { Effect, Option } from 'effect';

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
    effect: Effect.sync(() => {
      const requireContext = Effect.fn('RpcAccess.requireContext')(
        (): Effect.Effect<RpcRequestContextShape> =>
          Effect.serviceOption(RpcRequestContext).pipe(
            Effect.flatMap((contextOption) =>
              Option.match(contextOption, {
                onNone: () => Effect.dieMessage('RpcRequestContext missing'),
                onSome: (context) => Effect.succeed(context),
              }),
            ),
          ),
      );

      const current = Effect.fn('RpcAccess.current')(
        (): Effect.Effect<RpcRequestContextShape> => requireContext(),
      );

      const ensureAuthenticated = Effect.fn('RpcAccess.ensureAuthenticated')(
        (): Effect.Effect<void, 'UNAUTHORIZED'> =>
          requireContext().pipe(
            Effect.flatMap((context) =>
              context.authenticated
                ? Effect.void
                : Effect.fail('UNAUTHORIZED' as const),
            ),
          ),
      );

      const ensurePermission = Effect.fn('RpcAccess.ensurePermission')(
        (permission: Permission): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
          Effect.gen(function* () {
            const context = yield* requireContext();
            if (!context.authenticated) {
              return yield* Effect.fail('UNAUTHORIZED' as const);
            }
            if (!context.permissions.includes(permission)) {
              return yield* Effect.fail('FORBIDDEN' as const);
            }
          }),
      );

      const requireUser = Effect.fn('RpcAccess.requireUser')(
        (): Effect.Effect<User, 'UNAUTHORIZED'> =>
          requireContext().pipe(
            Effect.flatMap((context) =>
              context.user
                ? Effect.succeed(context.user)
                : Effect.fail('UNAUTHORIZED' as const),
            ),
          ),
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
