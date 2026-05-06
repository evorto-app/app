import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { type Permission } from '@shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '@shared/rpc-contracts/app-rpcs';
import { Context, Effect, Layer, Option } from 'effect';

import { type User } from '../../../../../types/custom/user';

const rpcAccessEffect = Effect.sync(() => {
  const requireContext = Effect.fn('RpcAccess.requireContext')(
    (): Effect.Effect<RpcRequestContextShape> =>
      Effect.serviceOption(RpcRequestContext).pipe(
        Effect.flatMap((contextOption) =>
          Option.match(contextOption, {
            onNone: () => Effect.die(new Error('RpcRequestContext missing')),
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
});

type RpcAccessShape = Effect.Success<typeof rpcAccessEffect>;

export class RpcAccess extends Context.Service<RpcAccess, RpcAccessShape>()(
  '@server/effect/rpc/handlers/shared/RpcAccess',
  {
    make: rpcAccessEffect,
  },
) {
  static readonly Default = Layer.effect(RpcAccess, RpcAccess.make);

  static readonly current = () => RpcAccess.use((service) => service.current());

  static readonly ensureAuthenticated = () =>
    RpcAccess.use((service) => service.ensureAuthenticated());

  static readonly ensurePermission = (permission: Permission) =>
    RpcAccess.use((service) => service.ensurePermission(permission));

  static readonly requireUser = () =>
    RpcAccess.use((service) => service.requireUser());
}
