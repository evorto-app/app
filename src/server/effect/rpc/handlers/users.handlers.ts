 

import type { Headers } from '@effect/platform';

import {
  and,
  count,
  eq,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  roles,
  rolesToTenantUsers,
  users,
  usersToTenants,
} from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
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
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail('FORBIDDEN' as const);
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
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
    }
    return user;
  });

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
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        const existingUser = yield* databaseEffect((database) =>
          database
            .select({ id: users.id })
            .from(users)
            .where(eq(users.auth0Id, auth0Id))
            .limit(1),
        );
        if (existingUser.length > 0) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const defaultUserRoles = yield* databaseEffect((database) =>
          database.query.roles.findMany({
            columns: {
              id: true,
            },
            where: { defaultUserRole: true, tenantId: tenant.id },
          }),
        );
        const userCreateResponse = yield* databaseEffect((database) =>
          database
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
            }),
        );
        const createdUser = userCreateResponse[0];
        if (!createdUser) {
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        const userTenantCreateResponse = yield* databaseEffect((database) =>
          database
            .insert(usersToTenants)
            .values({
              tenantId: tenant.id,
              userId: createdUser.id,
            })
            .returning({
              id: usersToTenants.id,
            }),
        );
        const createdUserTenant = userTenantCreateResponse[0];
        if (!createdUserTenant) {
          return yield* Effect.fail('UNAUTHORIZED' as const);
        }

        if (defaultUserRoles.length > 0) {
          yield* databaseEffect((database) =>
          database.insert(rolesToTenantUsers).values(
              defaultUserRoles.map((role) => ({
                roleId: role.id,
                userTenantId: createdUserTenant.id,
              })),
            ),
          );
        }
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
              eventId: true,
            },
            where: {
              status: {
                NOT: 'CANCELLED',
              },
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              event: {
                columns: {
                  description: true,
                  end: true,
                  id: true,
                  start: true,
                  title: true,
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
            registration.event ? [registration.event] : [],
          )
          .toSorted((eventA, eventB) =>
            eventA.start.getTime() - eventB.start.getTime(),
          )
          .map((event) => ({
            description: event.description ?? null,
            end: event.end.toISOString(),
            id: event.id,
            start: event.start.toISOString(),
            title: event.title,
          }));
      }),
    'users.findMany': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'users:viewAll');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        const usersCountResult = yield* databaseEffect((database) =>
          database
            .select({ count: count() })
            .from(usersToTenants)
            .where(eq(usersToTenants.tenantId, tenant.id)),
        );
        const usersCount = usersCountResult[0]?.count ?? 0;

        const selectedUsers = yield* databaseEffect((database) =>
          database
            .select({
              email: users.email,
              firstName: users.firstName,
              id: users.id,
              lastName: users.lastName,
              role: roles.name,
            })
            .from(users)
            .orderBy(users.lastName, users.firstName)
            .offset(input.offset ?? 0)
            .limit(input.limit ?? 100)
            .innerJoin(
              usersToTenants,
              and(
                eq(usersToTenants.userId, users.id),
                eq(usersToTenants.tenantId, tenant.id),
              ),
            )
            .leftJoin(
              rolesToTenantUsers,
              eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
            )
            .leftJoin(roles, eq(rolesToTenantUsers.roleId, roles.id)),
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
        for (const user of selectedUsers) {
          if (userMap[user.id]) {
            if (user.role) {
              userMap[user.id].roles.push(user.role);
            }
            continue;
          }
          userMap[user.id] = {
            ...user,
            roles: user.role ? [user.role] : [],
          };
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
