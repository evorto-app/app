import { Effect, Option } from 'effect';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../../../../shared/errors/rpc-errors';
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
        (): Effect.Effect<void, RpcUnauthorizedError> =>
          requireContext().pipe(
            Effect.flatMap((context) =>
              context.authenticated
                ? Effect.void
                : Effect.fail(
                    new RpcUnauthorizedError({
                      message: 'Authentication required',
                    }),
                  ),
            ),
          ),
      );

      const ensurePermission = Effect.fn('RpcAccess.ensurePermission')(
        (
          permission: Permission,
        ): Effect.Effect<void, RpcForbiddenError | RpcUnauthorizedError> =>
          Effect.gen(function* () {
            const context = yield* requireContext();
            if (!context.authenticated) {
              return yield* Effect.fail(
                new RpcUnauthorizedError({
                  message: 'Authentication required',
                }),
              );
            }
            if (!context.permissions.includes(permission)) {
              return yield* Effect.fail(
                new RpcForbiddenError({
                  message: 'Missing required permission',
                  permission,
                }),
              );
            }
          }),
      );

      const requireUser = Effect.fn('RpcAccess.requireUser')(
        (): Effect.Effect<User, RpcUnauthorizedError> =>
          requireContext().pipe(
            Effect.flatMap((context) =>
              context.user
                ? Effect.succeed(context.user)
                : Effect.fail(
                    new RpcUnauthorizedError({
                      message: 'Authenticated user required',
                    }),
                  ),
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
