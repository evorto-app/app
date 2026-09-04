import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
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
        const result = yield* roleHandlers['roles.findMany']().pipe(
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
        const result = yield* roleHandlers['roles.findMany']().pipe(
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
        const error = yield* roleHandlers['roles.findMany']().pipe(
          Effect.flip,
          Effect.provide(createContextLayer(['templates:view'], databaseLayer)),
        );
        expect(error).toMatchObject({ _tag: 'RpcForbiddenError' });
      }),
  );
});
