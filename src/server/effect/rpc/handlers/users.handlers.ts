import type { Headers } from 'effect/unstable/http';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  UserRoleAssignmentNotFoundError,
  UserSelfRoleRemovalError,
} from '@shared/rpc-contracts/app-rpcs/users.errors';
import { and, count, eq, gte, ilike, inArray, lte } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { DateTime } from 'luxon';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
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
import { lockTenantRoleGraph } from '../../../roles/tenant-role-graph';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

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

const uniqueRoleIds = (roleIds: readonly string[]): string[] => [
  ...new Set(roleIds),
];

const missingRegistrationRelationDefect = (registration: {
  eventId: string;
  id: string;
}) =>
  new Error(
    `Registration ${registration.id} references missing event or registration option for event ${registration.eventId}`,
  );

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

export const tenantDayBounds = (timezone: string, now = DateTime.now()) => {
  const tenantNow = now.setZone(timezone);
  return {
    end: tenantNow.endOf('day').toJSDate(),
    start: tenantNow.startOf('day').toJSDate(),
  };
};

export const userHandlers = {
  'users.assignRoles': ({ roleIds, userId }, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'users:assignRoles');
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const currentUser = yield* requireUserHeader(options.headers);
      const nextRoleIds = uniqueRoleIds(roleIds);

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(tx, tenant.id);
              const memberships = yield* tx
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, tenant.id),
                    eq(usersToTenants.userId, userId),
                  ),
                )
                .for('update');
              const membership = memberships[0];
              if (!membership) {
                return yield* Effect.fail(
                  new UserRoleAssignmentNotFoundError({
                    message: 'Tenant user not found',
                  }),
                );
              }

              if (userId === currentUser.id && nextRoleIds.length === 0) {
                return yield* Effect.fail(
                  new UserSelfRoleRemovalError({
                    message: 'You cannot remove all of your own roles',
                  }),
                );
              }

              if (nextRoleIds.length > 0) {
                const tenantRoles = yield* tx.query.roles.findMany({
                  columns: {
                    id: true,
                  },
                  where: {
                    id: { in: nextRoleIds },
                    tenantId: tenant.id,
                  },
                });
                if (tenantRoles.length !== nextRoleIds.length) {
                  return yield* Effect.fail(
                    new UserRoleAssignmentNotFoundError({
                      message: 'One or more roles were not found',
                    }),
                  );
                }
              }

              yield* tx
                .delete(rolesToTenantUsers)
                .where(
                  and(
                    eq(rolesToTenantUsers.tenantId, tenant.id),
                    eq(rolesToTenantUsers.userTenantId, membership.id),
                  ),
                );

              if (nextRoleIds.length > 0) {
                yield* tx.insert(rolesToTenantUsers).values(
                  nextRoleIds.map((roleId) => ({
                    roleId,
                    tenantId: tenant.id,
                    userTenantId: membership.id,
                  })),
                );
              }
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof UserRoleAssignmentNotFoundError ||
              error instanceof UserSelfRoleRemovalError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'users.authData': (_payload, options) =>
    Effect.sync(() => decodeAuthDataHeader(options.headers)),
  'users.canUseScanner': (_payload, options) =>
    Effect.gen(function* () {
      if (options.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] !== 'true') {
        return false;
      }

      const user = yield* decodeUserHeader(options.headers);
      if (!user) {
        return false;
      }
      if (includesPermission('events:organizeAll', user.permissions)) {
        return true;
      }

      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const { end, start } = tenantDayBounds(tenant.timezone);
      const organizingRegistrations = yield* databaseEffect((database) =>
        database
          .select({
            id: eventRegistrations.id,
          })
          .from(eventRegistrations)
          .innerJoin(
            eventRegistrationOptions,
            eq(
              eventRegistrationOptions.id,
              eventRegistrations.registrationOptionId,
            ),
          )
          .innerJoin(
            eventInstances,
            eq(eventInstances.id, eventRegistrations.eventId),
          )
          .where(
            and(
              eq(eventRegistrations.status, 'CONFIRMED'),
              eq(eventRegistrations.tenantId, tenant.id),
              eq(eventRegistrations.userId, user.id),
              eq(eventRegistrationOptions.organizingRegistration, true),
              lte(eventInstances.start, end),
              gte(eventInstances.end, start),
            ),
          )
          .limit(1),
      );

      return organizingRegistrations.length > 0;
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
                organizingRegistration: true,
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

      const mappedRegistrations = [];
      for (const registration of registrations) {
        if (!registration.event || !registration.registrationOption) {
          return yield* Effect.die(
            missingRegistrationRelationDefect(registration),
          );
        }
        if (registration.status === 'CANCELLED') {
          return yield* Effect.die(
            new Error(
              `Cancelled registration ${registration.id} was returned by users.events`,
            ),
          );
        }

        mappedRegistrations.push({
          addonPurchases: registration.addonPurchases.flatMap((purchase) =>
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
          organizingRegistration:
            registration.registrationOption.organizingRegistration,
          paymentState: resolveRegistrationPaymentState(
            registration.transactions,
          ),
          registrationId: registration.id,
          registrationOptionTitle: registration.registrationOption.title,
          status: registration.status,
        });
      }

      return mappedRegistrations
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
          organizingRegistration: registration.organizingRegistration,
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
            roleId: roles.id,
            userTenantId: usersToTenants.id,
          })
          .from(usersToTenants)
          .leftJoin(
            rolesToTenantUsers,
            eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
          )
          .leftJoin(
            roles,
            and(
              eq(rolesToTenantUsers.roleId, roles.id),
              eq(roles.tenantId, tenant.id),
            ),
          )
          .where(inArray(usersToTenants.id, tenantUserIds)),
      );

      const userMap: Record<
        string,
        {
          email: string;
          firstName: string;
          id: string;
          lastName: string;
          roleIds: string[];
          roles: string[];
        }
      > = {};
      for (const user of tenantUserPage) {
        userMap[user.id] = {
          email: user.email,
          firstName: user.firstName,
          id: user.id,
          lastName: user.lastName,
          roleIds: [],
          roles: [],
        };
      }
      const userIdByTenantUserId = new Map(
        tenantUserPage.map((user) => [user.userTenantId, user.id]),
      );
      for (const selectedRole of selectedRoles) {
        const userId = userIdByTenantUserId.get(selectedRole.userTenantId);
        if (userId && selectedRole.role && selectedRole.roleId) {
          userMap[userId].roleIds.push(selectedRole.roleId);
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
  'users.setHomeTenant': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensureAuthenticated(options.headers);
      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
      const user = yield* requireUserHeader(options.headers);

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const memberships = yield* tx
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, tenant.id),
                    eq(usersToTenants.userId, user.id),
                  ),
                )
                .limit(1)
                .for('update');
              if (memberships.length === 0) {
                return yield* Effect.fail(
                  new RpcUnauthorizedError({
                    message: 'Current tenant membership required',
                  }),
                );
              }
              yield* tx
                .update(users)
                .set({ homeTenantId: tenant.id })
                .where(eq(users.id, user.id));
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcUnauthorizedError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );

      return { homeTenantId: tenant.id, homeTenantName: tenant.name };
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
