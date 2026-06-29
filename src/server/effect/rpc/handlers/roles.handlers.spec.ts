import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { roleHandlers } from './roles.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const tenant = {
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en',
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
};

const createUser = (permissions: readonly Permission[]) => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions,
  roleIds: [],
});

const createContextLayer = (
  permissions: readonly Permission[],
  database: unknown,
) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant,
    user: createUser(permissions),
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, database as never),
  );
};

describe('roleHandlers lookup permissions', () => {
  it.effect(
    'findMany allows template creators and returns lookup-only roles',
    () =>
      Effect.gen(function* () {
        let columns: unknown;
        const database = {
          query: {
            roles: {
              findMany: (query: { columns: unknown }) => {
                columns = query.columns;
                return Effect.succeed([
                  {
                    defaultOrganizerRole: true,
                    defaultUserRole: false,
                    id: 'role-1',
                    name: 'Organizer',
                    permissions: ['admin:manageRoles'],
                  },
                ]);
              },
            },
          },
        };

        const result = yield* roleHandlers['roles.findMany'](
          { search: 'organizer' },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(createContextLayer(['templates:create'], database)),
        );

        expect(columns).toEqual({
          defaultOrganizerRole: true,
          defaultUserRole: true,
          id: true,
          name: true,
        });
        expect(result).toEqual([
          {
            defaultOrganizerRole: true,
            defaultUserRole: false,
            id: 'role-1',
            name: 'Organizer',
          },
        ]);
      }),
  );

  it.effect('findMany scopes lookup filters to the current tenant', () =>
    Effect.gen(function* () {
      let queryInput: unknown;
      const database = {
        query: {
          roles: {
            findMany: (query: unknown) => {
              queryInput = query;
              return Effect.succeed([]);
            },
          },
        },
      };

      yield* roleHandlers['roles.findMany'](
        {
          defaultOrganizerRole: true,
          defaultUserRole: false,
          search: 'mentor',
        },
        { headers: {} } as never,
      ).pipe(Effect.provide(createContextLayer(['events:create'], database)));

      expect(queryInput).toEqual({
        columns: {
          defaultOrganizerRole: true,
          defaultUserRole: true,
          id: true,
          name: true,
        },
        limit: 15,
        orderBy: { name: 'asc' },
        where: {
          defaultOrganizerRole: true,
          defaultUserRole: false,
          name: { ilike: '%mentor%' },
          tenantId: tenant.id,
        },
      });
    }),
  );

  it.effect('findOne allows event creators', () =>
    Effect.gen(function* () {
      let queryInput: unknown;
      const database = {
        query: {
          roles: {
            findFirst: (query: unknown) => {
              queryInput = query;
              return Effect.succeed({
                defaultOrganizerRole: false,
                defaultUserRole: true,
                id: 'role-1',
                name: 'Participant',
              });
            },
          },
        },
      };

      const result = yield* roleHandlers['roles.findOne']({ id: 'role-1' }, {
        headers: {},
      } as never).pipe(
        Effect.provide(createContextLayer(['events:create'], database)),
      );

      expect(queryInput).toEqual({
        columns: {
          defaultOrganizerRole: true,
          defaultUserRole: true,
          id: true,
          name: true,
        },
        where: {
          id: 'role-1',
          tenantId: tenant.id,
        },
      });
      expect(result).toEqual({
        defaultOrganizerRole: false,
        defaultUserRole: true,
        id: 'role-1',
        name: 'Participant',
      });
    }),
  );

  it.effect('findOne strips permission-bearing role data from the result', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          roles: {
            findFirst: () =>
              Effect.succeed({
                defaultOrganizerRole: false,
                defaultUserRole: true,
                id: 'role-1',
                name: 'Participant',
                permissions: ['admin:manageRoles'],
              }),
          },
        },
      };

      const result = yield* roleHandlers['roles.findOne']({ id: 'role-1' }, {
        headers: {},
      } as never).pipe(
        Effect.provide(createContextLayer(['events:create'], database)),
      );

      expect(result).toEqual({
        defaultOrganizerRole: false,
        defaultUserRole: true,
        id: 'role-1',
        name: 'Participant',
      });
    }),
  );

  it.effect(
    'findMany rejects users without event or template authoring access',
    () =>
      Effect.gen(function* () {
        const error = yield* roleHandlers['roles.findMany']({}, {
          headers: {},
        } as never).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['templates:view'], {})),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
      }),
  );

  it.effect('findOne fails with a typed not-found error', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          roles: {
            findFirst: () => Effect.succeed(),
          },
        },
      };

      const error = yield* roleHandlers['roles.findOne'](
        { id: 'missing-role' },
        { headers: {} } as never,
      ).pipe(
        Effect.flip,
        Effect.provide(createContextLayer(['events:create'], database)),
      );

      expect(error['_tag']).toBe('RoleLookupNotFoundError');
      expect(error.id).toBe('missing-role');
    }),
  );
});
