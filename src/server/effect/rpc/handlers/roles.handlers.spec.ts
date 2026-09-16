import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Schema } from 'effect';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { RolesFindManyInput } from '../../../../shared/rpc-contracts/app-rpcs/roles.rpcs';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
import { roleHandlers } from './roles.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const tenant = {
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: undefined,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
};

const createUser = (permissions: readonly Permission[]) => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  communicationEmail: undefined,
  email: 'alice@example.com',
  firstName: 'Alice',
  homeTenantId: undefined,
  homeTenantName: undefined,
  iban: undefined,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

const createContextLayer = (
  permissions: readonly Permission[],
  databaseLayer: ReturnType<typeof createRegistrationDatabaseTestLayer>,
  authenticated = true,
) => {
  const requestContext = {
    authData: {},
    authenticated,
    permissions,
    tenant,
    user: authenticated ? createUser(permissions) : null,
    userAssigned: authenticated,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    databaseLayer,
  );
};

describe('roleHandlers lookup permissions', () => {
  it.effect(
    'returns a tenant-scoped catalog with mixed default flags and no role authority',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(parameters).toEqual([tenant.id]);
              expect(statement).toContain('from "roles"');
              expect(statement).toContain(
                '"defaultOrganizerRole" as "defaultOrganizerRole"',
              );
              expect(statement).toContain(
                '"defaultUserRole" as "defaultUserRole"',
              );
              expect(statement).toContain('order by "d0"."name" asc');
              expect(statement).not.toContain('"permissions"');
              expect(statement).not.toContain(' limit ');
              return [
                [true, false, 'role-1', 'Organizer'],
                [false, true, 'role-2', 'Participant'],
              ];
            }),
        });
        const result = yield* roleHandlers['roles.findMany']({}).pipe(
          Effect.provide(
            createContextLayer(['templates:create'], databaseLayer),
          ),
        );
        expect(result).toEqual([
          {
            defaultOrganizerRole: true,
            defaultUserRole: false,
            id: 'role-1',
            name: 'Organizer',
          },
          {
            defaultOrganizerRole: false,
            defaultUserRole: true,
            id: 'role-2',
            name: 'Participant',
          },
        ]);
      }),
  );

  it.effect(
    'allows event authors and returns an empty catalog for an empty organization',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toContain('from "roles"');
              expect(parameters).toEqual([tenant.id]);
              return [];
            }),
        });
        const result = yield* roleHandlers['roles.findMany']({}).pipe(
          Effect.provide(createContextLayer(['events:create'], databaseLayer)),
        );
        expect(result).toEqual([]);
      }),
  );

  it.effect(
    'rejects users without authoring access before reading the catalog',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: () =>
            Effect.die(new Error('Unexpected role catalog access')),
        });
        const error = yield* roleHandlers['roles.findMany']({}).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['templates:view'], databaseLayer)),
        );
        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          message: 'You do not have permission to view roles.',
        });
      }),
  );

  it.effect.each(['', 'mentor', "O'Reilly"])(
    'bounds tenant role search for %j with parameterized filters',
    (search) =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toContain('from "roles"');
              expect(statement).toContain('"d0"."tenantId" = $1');
              expect(statement).toContain('"d0"."name" ilike $2');
              expect(statement).toContain('order by "d0"."name" asc');
              expect(statement).toContain(' limit $3');
              expect(statement).not.toContain('"permissions"');
              expect(parameters).toEqual([tenant.id, `%${search}%`, 15]);
              return [[true, false, 'role-1', 'Organizer']];
            }),
        });
        const input = Schema.decodeUnknownSync(RolesFindManyInput)({ search });
        const result = yield* roleHandlers['roles.findMany'](input).pipe(
          Effect.provide(
            createContextLayer(['templates:create'], databaseLayer),
          ),
        );
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

  it.effect(
    'resolves one selected role by ID within the current tenant without role authority',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toContain('from "roles"');
              expect(statement).toContain('"d0"."id" = $1');
              expect(statement).toContain('"d0"."tenantId" = $2');
              expect(statement).toContain(' limit $3');
              expect(statement).not.toContain('"permissions"');
              expect(parameters).toEqual(['selected-role', tenant.id, 1]);
              return [[false, true, 'selected-role', 'Participant']];
            }),
        });
        const result = yield* roleHandlers['roles.findOne']({
          id: 'selected-role',
        }).pipe(
          Effect.provide(createContextLayer(['events:create'], databaseLayer)),
        );
        expect(result).toEqual({
          defaultOrganizerRole: false,
          defaultUserRole: true,
          id: 'selected-role',
          name: 'Participant',
        });
      }),
  );

  it.effect(
    'reports a typed missing role when the ID is absent from the current tenant',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toContain('"d0"."id" = $1');
              expect(statement).toContain('"d0"."tenantId" = $2');
              expect(parameters).toEqual(['other-tenant-role', tenant.id, 1]);
              return [];
            }),
        });
        const error = yield* roleHandlers['roles.findOne']({
          id: 'other-tenant-role',
        }).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['events:create'], databaseLayer)),
        );
        expect(error).toMatchObject({
          _tag: 'RoleLookupNotFoundError',
          id: 'other-tenant-role',
          message: 'Role not found',
        });
      }),
  );

  it.effect(
    'rejects selected-role lookup without permission before database access',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: () =>
            Effect.die(new Error('Unexpected selected-role database access')),
        });
        const error = yield* roleHandlers['roles.findOne']({
          id: 'selected-role',
        }).pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['templates:view'], databaseLayer)),
        );
        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          message: 'You do not have permission to view roles.',
        });
      }),
  );

  it.effect('rejects anonymous role search before database access', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationDatabaseTestLayer({
        executeValues: () =>
          Effect.die(new Error('Unexpected anonymous role search')),
      });
      const error = yield* roleHandlers['roles.findMany']({ search: '' }).pipe(
        Effect.flip,
        Effect.provide(createContextLayer([], databaseLayer, false)),
      );
      expect(error).toMatchObject({
        _tag: 'RpcUnauthorizedError',
        message: 'Sign in to view roles.',
      });
    }),
  );

  it.effect(
    'rejects anonymous selected-role lookup before database access',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: () =>
            Effect.die(new Error('Unexpected anonymous selected-role lookup')),
        });
        const error = yield* roleHandlers['roles.findOne']({
          id: 'selected-role',
        }).pipe(
          Effect.flip,
          Effect.provide(createContextLayer([], databaseLayer, false)),
        );
        expect(error).toMatchObject({
          _tag: 'RpcUnauthorizedError',
          message: 'Sign in to view roles.',
        });
      }),
  );

  it.effect(
    'allows an announcement-only editor to read the tenant role catalog',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(parameters).toEqual([tenant.id]);
              expect(statement).toContain('from "roles"');
              expect(statement).toContain('"d0"."tenantId" = $1');
              expect(statement).not.toContain('"permissions"');
              return [[false, false, 'announcement-role', 'Attendees']];
            }),
        });
        const result = yield* roleHandlers['roles.findMany']({}).pipe(
          Effect.provide(
            createContextLayer(
              ['events:changeAnnouncementDiscovery'],
              databaseLayer,
            ),
          ),
        );
        expect(result).toEqual([
          {
            defaultOrganizerRole: false,
            defaultUserRole: false,
            id: 'announcement-role',
            name: 'Attendees',
          },
        ]);
      }),
  );
});
