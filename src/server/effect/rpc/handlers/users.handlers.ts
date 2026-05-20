import type { Headers } from 'effect/unstable/http';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { UserConflictError } from '@shared/rpc-contracts/app-rpcs/users.errors';
import { and, count, eq, ilike, inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  roles,
  rolesToTenantUsers,
  users,
  usersToTenants,
} from '../../../../db/schema';
import {
  includesPermission,
  type Permission,
} from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { UsersAuthData } from '../../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const decodeHeaderJson = <A>(
  value: string | undefined,
  schema: Schema.Decoder<A>,
): A => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, RpcForbiddenError | RpcUnauthorizedError> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!includesPermission(permission, currentPermissions)) {
      return yield* Effect.fail(
        new RpcForbiddenError({ message: 'Forbidden', permission }),
      );
    }
  });

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const decodeAuthDataHeader = (headers: Headers.Headers) =>
  decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.AUTH_DATA], UsersAuthData);

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, RpcUnauthorizedError> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );
    }
    return user;
  });

export const normalizeUsersFindManySearch = (
  search: string | undefined,
): string | undefined => {
  const trimmed = search?.trim();
  const escaped = trimmed
    ?.replaceAll('\\', '\\\\')
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);
  return escaped ? `%${escaped}%` : undefined;
};

const mapCreateAccountUnexpectedError = (error: unknown) =>
  error instanceof UserConflictError ? Effect.fail(error) : Effect.die(error);

const resolveRegistrationPaymentState = (
  transactions: readonly { status: string; type: string }[],
): 'cancelled' | 'notRequired' | 'pending' | 'recorded' => {
  const registrationTransactions = transactions.filter(
    (transaction) => transaction.type === 'registration',
  );
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'pending',
    )
  ) {
    return 'pending';
  }
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'successful',
    )
  ) {
    return 'recorded';
  }
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'cancelled',
    )
  ) {
    return 'cancelled';
  }

  return 'notRequired';
};

const resolvePendingRegistrationCheckoutUrl = (
  transactions: readonly {
    method?: string;
    status: string;
    stripeCheckoutUrl?: null | string;
    type: string;
  }[],
): null | string =>
  transactions.find(
    (transaction) =>
      transaction.method === 'stripe' &&
      transaction.status === 'pending' &&
      transaction.type === 'registration' &&
      transaction.stripeCheckoutUrl,
  )?.stripeCheckoutUrl ?? null;

export const userHandlers = {
  'users.authData': (_payload, options) =>
    Effect.sync(() => decodeAuthDataHeader(options.headers)),
  'users.createAccount': (input, options) =>
    Effect.gen(function* () {
      yield* ensureAuthenticated(options.headers);
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const authData = decodeAuthDataHeader(options.headers);
      const auth0Id = authData.sub?.trim();
      const email = authData.email?.trim();

      if (!auth0Id || !email) {
        return yield* Effect.fail(
          new RpcUnauthorizedError({ message: 'Authentication required' }),
        );
      }

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const existingUser = yield* tx.query.users.findFirst({
                columns: {
                  id: true,
                },
                where: {
                  auth0Id,
                },
              });

              let userId = existingUser?.id;
              if (!userId) {
                const createdUsers = yield* tx
                  .insert(users)
                  .values({
                    auth0Id,
                    communicationEmail: input.communicationEmail,
                    email,
                    firstName: input.firstName,
                    lastName: input.lastName,
                  })
                  .returning({
                    id: users.id,
                  });
                const createdUser = createdUsers[0];
                if (!createdUser) {
                  return yield* Effect.die(
                    new Error('User insert returned no rows'),
                  );
                }
                userId = createdUser.id;
              }

              const existingTenantAssignment =
                yield* tx.query.usersToTenants.findFirst({
                  columns: {
                    id: true,
                  },
                  where: {
                    tenantId: tenant.id,
                    userId,
                  },
                });

              if (existingTenantAssignment) {
                return yield* Effect.fail(
                  new UserConflictError({
                    message: 'User account already exists',
                  }),
                );
              }

              const defaultUserRoles = yield* tx.query.roles.findMany({
                columns: {
                  id: true,
                },
                where: { defaultUserRole: true, tenantId: tenant.id },
              });

              const userTenantCreateResponse = yield* tx
                .insert(usersToTenants)
                .values({
                  tenantId: tenant.id,
                  userId,
                })
                .returning({
                  id: usersToTenants.id,
                });
              const createdUserTenant = userTenantCreateResponse[0];
              if (!createdUserTenant) {
                return yield* Effect.die(
                  new Error('User tenant association insert returned no rows'),
                );
              }

              if (defaultUserRoles.length > 0) {
                yield* tx.insert(rolesToTenantUsers).values(
                  defaultUserRoles.map((role) => ({
                    roleId: role.id,
                    userTenantId: createdUserTenant.id,
                  })),
                );
              }
            }),
          )
          .pipe(Effect.catch(mapCreateAccountUnexpectedError)),
      );
    }),
  'users.events': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensureAuthenticated(options.headers);
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const user = yield* requireUserHeader(options.headers);

      const registrations = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findMany({
          columns: {
            checkInTime: true,
            eventId: true,
            guestCount: true,
            id: true,
            status: true,
          },
          where: {
            status: {
              NOT: 'CANCELLED',
            },
            tenantId: tenant.id,
            userId: user.id,
          },
          with: {
            addonPurchases: {
              columns: {
                quantity: true,
                unitPrice: true,
              },
              with: {
                addOn: {
                  columns: {
                    title: true,
                  },
                },
              },
            },
            event: {
              columns: {
                description: true,
                end: true,
                id: true,
                start: true,
                title: true,
              },
            },
            registrationOption: {
              columns: {
                title: true,
              },
            },
            transactions: {
              columns: {
                method: true,
                status: true,
                stripeCheckoutUrl: true,
                type: true,
              },
            },
          },
        }),
      );

      if (registrations.length === 0) {
        return [];
      }

      return registrations
        .flatMap((registration) =>
          registration.event &&
          registration.registrationOption &&
          registration.status !== 'CANCELLED'
            ? [
                {
                  addonPurchases: registration.addonPurchases.flatMap(
                    (purchase) =>
                      purchase.addOn
                        ? [
                            {
                              quantity: purchase.quantity,
                              title: purchase.addOn.title,
                              unitPrice: purchase.unitPrice,
                            },
                          ]
                        : [],
                  ),
                  checkInTime: registration.checkInTime,
                  checkoutUrl: resolvePendingRegistrationCheckoutUrl(
                    registration.transactions,
                  ),
                  event: registration.event,
                  guestCount: registration.guestCount,
                  paymentState: resolveRegistrationPaymentState(
                    registration.transactions,
                  ),
                  registrationId: registration.id,
                  registrationOptionTitle:
                    registration.registrationOption.title,
                  status: registration.status,
                },
              ]
            : [],
        )
        .toSorted(
          (registrationA, registrationB) =>
            registrationA.event.start.getTime() -
            registrationB.event.start.getTime(),
        )
        .map((registration) => ({
          addonPurchases: registration.addonPurchases,
          checkInTime: registration.checkInTime?.toISOString() ?? null,
          checkoutUrl: registration.checkoutUrl,
          description: registration.event.description ?? null,
          end: registration.event.end.toISOString(),
          eventId: registration.event.id,
          guestCount: registration.guestCount,
          paymentState: registration.paymentState,
          registrationId: registration.registrationId,
          registrationOptionTitle: registration.registrationOptionTitle,
          start: registration.event.start.toISOString(),
          status: registration.status,
          title: registration.event.title,
        }));
    }),
  'users.findMany': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'users:viewAll');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const search = normalizeUsersFindManySearch(input.search);
      const usersFilter = search
        ? and(
            eq(usersToTenants.tenantId, tenant.id),
            ilike(users.searchableInfo, search),
          )
        : eq(usersToTenants.tenantId, tenant.id);

      const usersCountResult = yield* databaseEffect((database) =>
        database
          .select({ count: count() })
          .from(usersToTenants)
          .innerJoin(users, eq(usersToTenants.userId, users.id))
          .where(usersFilter),
      );
      const usersCount = usersCountResult[0]?.count ?? 0;

      const tenantUserPage = yield* databaseEffect((database) =>
        database
          .select({
            email: users.email,
            firstName: users.firstName,
            id: users.id,
            lastName: users.lastName,
            userTenantId: usersToTenants.id,
          })
          .from(usersToTenants)
          .innerJoin(users, eq(usersToTenants.userId, users.id))
          .where(usersFilter)
          .orderBy(users.lastName, users.firstName)
          .offset(input.offset ?? 0)
          .limit(input.limit ?? 100),
      );

      if (tenantUserPage.length === 0) {
        return { users: [], usersCount };
      }

      const tenantUserIds = tenantUserPage.map((user) => user.userTenantId);
      const selectedRoles = yield* databaseEffect((database) =>
        database
          .select({
            role: roles.name,
            userTenantId: usersToTenants.id,
          })
          .from(usersToTenants)
          .leftJoin(
            rolesToTenantUsers,
            eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
          )
          .leftJoin(roles, eq(rolesToTenantUsers.roleId, roles.id))
          .where(inArray(usersToTenants.id, tenantUserIds)),
      );

      const userMap: Record<
        string,
        {
          email: string;
          firstName: string;
          id: string;
          lastName: string;
          roles: string[];
        }
      > = {};
      for (const user of tenantUserPage) {
        userMap[user.id] = {
          email: user.email,
          firstName: user.firstName,
          id: user.id,
          lastName: user.lastName,
          roles: [],
        };
      }
      const userIdByTenantUserId = new Map(
        tenantUserPage.map((user) => [user.userTenantId, user.id]),
      );
      for (const selectedRole of selectedRoles) {
        const userId = userIdByTenantUserId.get(selectedRole.userTenantId);
        if (userId && selectedRole.role) {
          userMap[userId].roles.push(selectedRole.role);
        }
      }

      return { users: Object.values(userMap), usersCount };
    }),
  'users.maybeSelf': (_payload, options) => decodeUserHeader(options.headers),
  'users.self': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensureAuthenticated(options.headers);
      return yield* requireUserHeader(options.headers);
    }),
  'users.updateProfile': (input, options) =>
    Effect.gen(function* () {
      yield* ensureAuthenticated(options.headers);
      const user = yield* requireUserHeader(options.headers);

      yield* databaseEffect((database) =>
        database
          .update(users)
          .set({
            communicationEmail: input.communicationEmail,
            firstName: input.firstName,
            iban: input.iban ?? null,
            lastName: input.lastName,
            paypalEmail: input.paypalEmail ?? null,
          })
          .where(eq(users.id, user.id)),
      );
    }),
  'users.userAssigned': (_payload, options) =>
    Effect.succeed(
      options.headers[RPC_CONTEXT_HEADERS.USER_ASSIGNED] === 'true',
    ),
} satisfies Partial<AppRpcHandlers>;
