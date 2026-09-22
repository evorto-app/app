import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { describe, expect, it, vi } from '@effect/vitest';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Schema, Stream } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcMessage from 'effect/unstable/rpc/RpcMessage';
import { DateTime } from 'luxon';

import { Database } from '../../../../db';
import { relations } from '../../../../db/relations';
import { users } from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import {
  UsersAssignRoles,
  UsersCanUseScanner,
  UsersEventsFindMany,
  UsersFindMany,
  UsersUpdateProfile,
  UsersUserAssigned,
} from '../../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import { RpcAccess } from './shared/rpc-access.service';
import {
  normalizeUsersFindManySearch,
  resolveProfileRefundState,
  tenantDayBounds,
  userHandlers,
} from './users.handlers';

const createTenant = () =>
  Schema.decodeUnknownSync(Tenant)({
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: {
      esnCard: {
        config: {},
        status: 'disabled',
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
    theme: 'evorto',
    timezone: 'Europe/Amsterdam',
    transferDeadlineHoursBeforeStart: 0,
  });

const createUser = () =>
  Schema.decodeUnknownSync(User)({
    attributes: [],
    auth0Id: 'auth0|user-1',
    communicationEmail: 'notify@example.com',
    email: 'alice@example.com',
    firstName: 'Alice',
    iban: null,
    id: 'user-1',
    lastName: 'Doe',
    paypalEmail: null,
    permissions: [],
    roleIds: [],
  });

const createUserHandlerContext = ({
  authenticated = true,
  permissions = [],
  tenant = createTenant(),
  user = createUser(),
  userAssigned = user !== null,
}: {
  authenticated?: boolean;
  permissions?: readonly Permission[];
  tenant?: Tenant;
  user?: null | User;
  userAssigned?: boolean;
} = {}): RpcRequestContextShape => ({
  authData: {},
  authenticated,
  permissions,
  platformAuthority: null,
  tenant,
  user:
    user === null
      ? null
      : Schema.decodeUnknownSync(User)({
          ...user,
          permissions,
        }),
  userAssigned,
});

const provideUserHandlerContext = (context = createUserHandlerContext()) =>
  Effect.provide(
    Layer.mergeAll(
      RpcAccess.Default,
      Layer.succeed(RpcRequestContext, context),
    ),
  );

const userHandlerOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

const createUserDatabaseFixture = ({
  allowRoleChanges = false,
  membershipId,
  roleIds,
  scannerRegistrationIds,
}: {
  allowRoleChanges?: boolean;
  membershipId?: null | string;
  roleIds?: readonly string[];
  scannerRegistrationIds?: readonly string[];
} = {}) => {
  const unexpectedDatabaseAccess = Effect.die(
    new Error('Unexpected database operation in user handler fixture'),
  );
  const transactionCommands: string[] = [];
  const deleteWhere = vi.fn<SqlConnection.Connection['executeRaw']>(() =>
    allowRoleChanges ? Effect.succeed([]) : unexpectedDatabaseAccess,
  );
  const insertValues = vi.fn<SqlConnection.Connection['executeRaw']>(() =>
    allowRoleChanges ? Effect.succeed([]) : unexpectedDatabaseAccess,
  );
  const executeValues = vi.fn<SqlConnection.Connection['executeValues']>(
    (statement, parameters) =>
      Effect.sync(() => {
        if (
          membershipId !== undefined &&
          statement.includes('from "users_to_tenants"')
        ) {
          expect(statement).toContain('for update');
          expect(parameters).toContain('tenant-1');
          return membershipId === null ? [] : [[membershipId]];
        }
        if (roleIds !== undefined && statement.includes('from "roles"')) {
          expect(parameters).toContain('tenant-1');
          return roleIds.map((id) => [id]);
        }
        if (
          scannerRegistrationIds !== undefined &&
          statement.includes('from "event_registrations"')
        ) {
          expect(statement).toContain(
            'inner join "event_registration_options"',
          );
          expect(statement).toContain('inner join "event_instances"');
          expect(parameters).toEqual(
            expect.arrayContaining(['tenant-1', 'user-1']),
          );
          return scannerRegistrationIds.map((id) => [id]);
        }
        throw new Error(
          `Unexpected values query in user handler fixture: ${statement}`,
        );
      }),
  );
  const connection = {
    execute: () => unexpectedDatabaseAccess,
    executeRaw: (statement, parameters) => {
      if (
        membershipId !== undefined &&
        statement.startsWith('select pg_advisory_xact_lock(')
      ) {
        return Effect.sync(() => {
          expect(parameters).toEqual(['evorto:tenant-role-graph:tenant-1']);
          return [];
        });
      }
      if (statement.startsWith('delete from "roles_to_tenant_users"')) {
        return deleteWhere(statement, parameters);
      }
      if (statement.startsWith('insert into "roles_to_tenant_users"')) {
        return insertValues(statement, parameters);
      }
      return unexpectedDatabaseAccess;
    },
    executeStream: () =>
      Stream.die(
        new Error('Unexpected database stream in user handler fixture'),
      ),
    executeUnprepared: (statement, parameters) =>
      Effect.sync(() => {
        expect(['BEGIN', 'COMMIT', 'ROLLBACK']).toContain(statement);
        expect(parameters).toEqual([]);
        transactionCommands.push(statement);
        return [];
      }),
    executeValues,
    executeValuesUnprepared: () => unexpectedDatabaseAccess,
  } satisfies SqlConnection.Connection;
  const databaseLayer = Layer.effect(
    Database,
    PgDrizzle.makeWithDefaults({ relations }),
  ).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.makeWith({
          acquirer: Effect.succeed(connection),
          config: {},
          listenAcquirer: unexpectedDatabaseAccess,
          transactionAcquirer:
            membershipId === undefined
              ? unexpectedDatabaseAccess
              : Effect.succeed(connection),
        }),
      ),
    ),
  );
  return {
    databaseLayer,
    deleteWhere,
    executeValues,
    insertValues,
    transactionCommands,
  };
};

const noDatabaseAccessLayer = createUserDatabaseFixture().databaseLayer;

describe('userHandlers', () => {
  it('uses tenant-local DST boundaries for scanner business days', () => {
    const now = DateTime.fromISO('2026-03-29T12:00:00.000Z', { zone: 'utc' });
    if (!now.isValid) throw new Error('Expected a valid DST test instant');
    const { end, start } = tenantDayBounds('Europe/Berlin', now);

    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T21:59:59.999Z');
  });

  it('normalizes user-list search input for the server query', () => {
    expect(normalizeUsersFindManySearch(undefined)).toBeUndefined();
    expect(normalizeUsersFindManySearch(' '.repeat(3))).toBeUndefined();
    expect(normalizeUsersFindManySearch(' alice@example.com ')).toBe(
      '%alice@example.com%',
    );
  });

  it('derives participant-safe refund progress without exposing provider errors', () => {
    const pendingRefund = {
      method: 'stripe',
      status: 'pending',
      stripeRefundAttempts: 0,
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      stripeRefundGeneration: 0,
      stripeRefundMaxAttempts: 8,
      stripeRefundNextAttemptAt: new Date('2026-01-01T10:05:00.000Z'),
      stripeRefundRequeuedAt: null,
      stripeRefundStatus: null,
    };

    expect(resolveProfileRefundState(pendingRefund)).toBe('pending');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundAttempts: 1,
      }),
    ).toBe('retrying');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundGeneration: 1,
      }),
    ).toBe('retrying');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundRequeuedAt: new Date('2026-01-01T10:04:00.000Z'),
      }),
    ).toBe('retrying');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundNextAttemptAt: null,
      }),
    ).toBe('needsAttention');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundAttempts: 1,
        stripeRefundClaimLeaseExpiresAt: new Date('2026-01-01T10:06:00.000Z'),
        stripeRefundClaimLeaseId: 'lease-1',
        stripeRefundNextAttemptAt: null,
      }),
    ).toBe('retrying');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundAttempts: 8,
        stripeRefundNextAttemptAt: null,
      }),
    ).toBe('needsAttention');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundAttempts: 8,
      }),
    ).toBe('needsAttention');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundClaimLeaseId: 'partial-lease',
      }),
    ).toBe('needsAttention');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundStatus: 'requires_action',
      }),
    ).toBe('actionRequired');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        stripeRefundStatus: 'failed',
      }),
    ).toBe('needsAttention');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        status: 'successful',
        stripeRefundStatus: 'succeeded',
      }),
    ).toBe('succeeded');
    expect(
      resolveProfileRefundState({
        ...pendingRefund,
        method: 'cash',
      }),
    ).toBe('needsAttention');
  });

  it.effect('assignRoles requires users:assignRoles permission', () =>
    Effect.gen(function* () {
      const error = yield* userHandlers['users.assignRoles'](
        {
          roleIds: ['role-1'],
          userId: 'user-2',
        },
        userHandlerOptions(
          UsersAssignRoles.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(),
        Effect.provide(noDatabaseAccessLayer),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect('assignRoles rejects users outside the current tenant', () =>
    Effect.gen(function* () {
      const fixture = createUserDatabaseFixture({ membershipId: null });

      const error = yield* userHandlers['users.assignRoles'](
        {
          roleIds: ['role-1'],
          userId: 'user-2',
        },
        userHandlerOptions(
          UsersAssignRoles.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            permissions: ['users:assignRoles'],
          }),
        ),
        Effect.flip,
        Effect.provide(fixture.databaseLayer),
      );

      expect(error['_tag']).toBe('UserRoleAssignmentNotFoundError');
      expect(error.message).toBe('Member not found.');
    }),
  );

  it.effect('assignRoles rejects roles outside the current tenant', () =>
    Effect.gen(function* () {
      const fixture = createUserDatabaseFixture({
        membershipId: 'membership-2',
        roleIds: ['role-1'],
      });

      const error = yield* userHandlers['users.assignRoles'](
        {
          roleIds: ['role-1', 'role-missing'],
          userId: 'user-2',
        },
        userHandlerOptions(
          UsersAssignRoles.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            permissions: ['users:assignRoles'],
          }),
        ),
        Effect.flip,
        Effect.provide(fixture.databaseLayer),
      );

      expect(error['_tag']).toBe('UserRoleAssignmentNotFoundError');
      expect(error.message).toBe(
        'One or more selected roles are no longer available.',
      );
    }),
  );

  it.effect(
    'assignRoles prevents removing all of the current users own roles',
    () =>
      Effect.gen(function* () {
        const fixture = createUserDatabaseFixture({
          membershipId: 'membership-1',
        });

        const error = yield* userHandlers['users.assignRoles'](
          {
            roleIds: [],
            userId: 'user-1',
          },
          userHandlerOptions(
            UsersAssignRoles.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(
            createUserHandlerContext({
              permissions: ['users:assignRoles'],
            }),
          ),
          Effect.flip,
          Effect.provide(fixture.databaseLayer),
        );

        expect(error['_tag']).toBe('UserSelfRoleRemovalError');
        expect(error.message).toBe('You cannot remove all of your own roles.');
        expect(fixture.deleteWhere).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'assignRoles allows full tenant-admin self-assignment transactionally',
    () =>
      Effect.gen(function* () {
        const fixture = createUserDatabaseFixture({
          allowRoleChanges: true,
          membershipId: 'membership-2',
          roleIds: ['role-1', 'role-2'],
        });

        yield* userHandlers['users.assignRoles'](
          {
            roleIds: ['role-1', 'role-2', 'role-1'],
            userId: 'user-1',
          },
          userHandlerOptions(
            UsersAssignRoles.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(
            createUserHandlerContext({
              permissions: ['users:assignRoles'],
            }),
          ),
          Effect.provide(fixture.databaseLayer),
        );

        expect(fixture.deleteWhere).toHaveBeenCalledOnce();
        expect(fixture.deleteWhere).toHaveBeenCalledWith(
          expect.stringContaining('delete from "roles_to_tenant_users"'),
          ['tenant-1', 'membership-2'],
        );
        expect(fixture.insertValues).toHaveBeenCalledWith(
          expect.stringContaining('insert into "roles_to_tenant_users"'),
          [
            'role-1',
            'tenant-1',
            'membership-2',
            'role-2',
            'tenant-1',
            'membership-2',
          ],
        );
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect('canUseScanner returns false for anonymous users', () =>
    Effect.gen(function* () {
      const result = yield* userHandlers['users.canUseScanner'](
        undefined,
        userHandlerOptions(
          UsersCanUseScanner.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            authenticated: false,
            user: null,
            userAssigned: false,
          }),
        ),
        Effect.provide(noDatabaseAccessLayer),
      );

      expect(result).toBe(false);
    }),
  );

  it.effect(
    'canUseScanner allows tenant-wide event organizers without a query',
    () =>
      Effect.gen(function* () {
        const result = yield* userHandlers['users.canUseScanner'](
          undefined,
          userHandlerOptions(
            UsersCanUseScanner.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(
            createUserHandlerContext({
              permissions: ['events:organizeAll'],
            }),
          ),
          Effect.provide(noDatabaseAccessLayer),
        );

        expect(result).toBe(true);
      }),
  );

  it.effect(
    'canUseScanner allows users with an organizing registration today',
    () =>
      Effect.gen(function* () {
        const fixture = createUserDatabaseFixture({
          scannerRegistrationIds: ['registration-1'],
        });

        const result = yield* userHandlers['users.canUseScanner'](
          undefined,
          userHandlerOptions(
            UsersCanUseScanner.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(),
          Effect.provide(fixture.databaseLayer),
        );

        expect(result).toBe(true);
        expect(fixture.executeValues).toHaveBeenCalledOnce();
        expect(fixture.executeValues.mock.calls[0]?.[0]).toMatch(
          /limit \$\d+$/u,
        );
        expect(fixture.executeValues.mock.calls[0]?.[1].at(-1)).toBe(1);
      }),
  );

  it.effect(
    'canUseScanner rejects users without an organizing registration today',
    () =>
      Effect.gen(function* () {
        const fixture = createUserDatabaseFixture({
          scannerRegistrationIds: [],
        });

        const result = yield* userHandlers['users.canUseScanner'](
          undefined,
          userHandlerOptions(
            UsersCanUseScanner.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(),
          Effect.provide(fixture.databaseLayer),
        );

        expect(result).toBe(false);
        expect(fixture.executeValues).toHaveBeenCalledOnce();
        expect(fixture.executeValues.mock.calls[0]?.[0]).toMatch(
          /limit \$\d+$/u,
        );
        expect(fixture.executeValues.mock.calls[0]?.[1].at(-1)).toBe(1);
      }),
  );

  it.effect('users.events returns only events from user registrations', () =>
    Effect.gen(function* () {
      const tenant = createTenant();
      const user = createUser();
      const findRegistrations = vi.fn(() =>
        Effect.succeed([
          {
            addonPurchases: [],
            checkInTime: null,
            event: {
              description: 'waitlist',
              end: new Date('2026-01-01T11:00:00.000Z'),
              id: 'event-waitlist',
              start: new Date('2026-01-01T10:00:00.000Z'),
              title: 'Waitlist Event',
            },
            eventId: 'event-waitlist',
            guestCount: 0,
            id: 'registration-waitlist',
            registrationOption: {
              organizingRegistration: false,
              title: 'Waitlist option',
            },
            status: 'WAITLIST',
            transactions: [],
          },
          {
            addonPurchases: [],
            checkInTime: null,
            event: {
              description: 'cancelled payment',
              end: new Date('2026-01-15T11:00:00.000Z'),
              id: 'event-cancelled-payment',
              start: new Date('2026-01-15T10:00:00.000Z'),
              title: 'Cancelled Payment Event',
            },
            eventId: 'event-cancelled-payment',
            guestCount: 0,
            id: 'registration-cancelled-payment',
            registrationOption: {
              organizingRegistration: false,
              title: 'Participant',
            },
            status: 'PENDING',
            transactions: [
              {
                method: 'stripe',
                status: 'cancelled',
                stripeCheckoutUrl: null,
                type: 'registration',
              },
            ],
          },
          {
            addonPurchases: [],
            checkInTime: null,
            event: {
              description: 'cancelled with refund',
              end: new Date('2026-01-20T11:00:00.000Z'),
              id: 'event-cancelled-refund',
              start: new Date('2026-01-20T10:00:00.000Z'),
              title: 'Cancelled Refund Event',
            },
            eventId: 'event-cancelled-refund',
            guestCount: 0,
            id: 'registration-cancelled-refund',
            registrationOption: {
              organizingRegistration: false,
              title: 'Participant',
            },
            status: 'CANCELLED',
            transactions: [
              {
                amount: 2500,
                currency: 'EUR',
                method: 'stripe',
                sourceTransaction: null,
                status: 'successful',
                stripeCheckoutUrl: null,
                stripeRefundAttempts: 0,
                stripeRefundClaimLeaseExpiresAt: null,
                stripeRefundClaimLeaseId: null,
                stripeRefundGeneration: 0,
                stripeRefundMaxAttempts: 8,
                stripeRefundNextAttemptAt: null,
                stripeRefundRequeuedAt: null,
                stripeRefundStatus: null,
                type: 'registration',
                updatedAt: new Date('2026-01-20T09:00:00.000Z'),
              },
              {
                amount: -2500,
                currency: 'EUR',
                method: 'stripe',
                sourceTransaction: { type: 'registration' },
                status: 'pending',
                stripeCheckoutUrl: null,
                stripeRefundAttempts: 2,
                stripeRefundClaimLeaseExpiresAt: null,
                stripeRefundClaimLeaseId: null,
                stripeRefundGeneration: 0,
                stripeRefundMaxAttempts: 8,
                stripeRefundNextAttemptAt: new Date('2026-01-20T10:10:00.000Z'),
                stripeRefundRequeuedAt: null,
                stripeRefundStatus: null,
                type: 'refund',
                updatedAt: new Date('2026-01-20T10:05:00.000Z'),
              },
            ],
          },
          {
            addonPurchases: [
              {
                addOn: {
                  title: 'Workshop kit',
                },
                quantity: 2,
                unitPrice: 500,
              },
            ],
            checkInTime: null,
            event: {
              description: 'later',
              end: new Date('2026-03-01T11:00:00.000Z'),
              id: 'event-2',
              start: new Date('2026-03-01T10:00:00.000Z'),
              title: 'Later Event',
            },
            eventId: 'event-2',
            guestCount: 2,
            id: 'registration-2',
            registrationOption: {
              organizingRegistration: false,
              title: 'Standard',
            },
            status: 'PENDING',
            transactions: [
              {
                method: 'stripe',
                status: 'pending',
                stripeCheckoutUrl: 'https://checkout.stripe.test/pay',
                type: 'registration',
              },
            ],
          },
          {
            addonPurchases: [],
            checkInTime: new Date('2026-02-01T10:30:00.000Z'),
            event: {
              description: 'earlier',
              end: new Date('2026-02-01T11:00:00.000Z'),
              id: 'event-1',
              start: new Date('2026-02-01T10:00:00.000Z'),
              title: 'Earlier Event',
            },
            eventId: 'event-1',
            guestCount: 0,
            id: 'registration-1',
            registrationOption: {
              organizingRegistration: false,
              title: 'Participant',
            },
            status: 'CONFIRMED',
            transactions: [
              {
                method: 'stripe',
                status: 'successful',
                stripeCheckoutUrl: null,
                type: 'registration',
              },
            ],
          },
        ]),
      );
      const mockDatabase = {
        query: {
          eventRegistrations: {
            findMany: findRegistrations,
          },
          transactions: {
            findMany: vi.fn(() =>
              Effect.succeed([
                {
                  eventRegistrationId: 'registration-cancelled-refund',
                },
              ]),
            ),
          },
        },
      };

      const result = yield* userHandlers['users.events'](
        undefined,
        userHandlerOptions(
          UsersEventsFindMany.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            tenant,
            user,
          }),
        ),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
      );

      expect(findRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { status: { NOT: 'CANCELLED' } },
              {
                id: { in: ['registration-cancelled-refund'] },
                status: 'CANCELLED',
              },
            ],
            tenantId: tenant.id,
            userId: user.id,
          },
        }),
      );
      expect(findRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({
          with: expect.objectContaining({
            transactions: expect.objectContaining({
              where: { targetUserId: user.id },
            }),
          }),
        }),
      );
      expect(result).toEqual([
        {
          addonPurchases: [],
          checkInTime: null,
          checkoutUrl: null,
          description: 'waitlist',
          end: '2026-01-01T11:00:00.000Z',
          eventId: 'event-waitlist',
          guestCount: 0,
          organizingRegistration: false,
          paymentState: 'notRequired',
          refunds: [],
          registrationId: 'registration-waitlist',
          registrationOptionTitle: 'Waitlist option',
          start: '2026-01-01T10:00:00.000Z',
          status: 'WAITLIST',
          title: 'Waitlist Event',
        },
        {
          addonPurchases: [],
          checkInTime: null,
          checkoutUrl: null,
          description: 'cancelled payment',
          end: '2026-01-15T11:00:00.000Z',
          eventId: 'event-cancelled-payment',
          guestCount: 0,
          organizingRegistration: false,
          paymentState: 'cancelled',
          refunds: [],
          registrationId: 'registration-cancelled-payment',
          registrationOptionTitle: 'Participant',
          start: '2026-01-15T10:00:00.000Z',
          status: 'PENDING',
          title: 'Cancelled Payment Event',
        },
        {
          addonPurchases: [],
          checkInTime: null,
          checkoutUrl: null,
          description: 'cancelled with refund',
          end: '2026-01-20T11:00:00.000Z',
          eventId: 'event-cancelled-refund',
          guestCount: 0,
          organizingRegistration: false,
          paymentState: 'recorded',
          refunds: [
            {
              amount: 2500,
              currency: 'EUR',
              source: 'registration',
              state: 'retrying',
              updatedAt: '2026-01-20T10:05:00.000Z',
            },
          ],
          registrationId: 'registration-cancelled-refund',
          registrationOptionTitle: 'Participant',
          start: '2026-01-20T10:00:00.000Z',
          status: 'CANCELLED',
          title: 'Cancelled Refund Event',
        },
        {
          addonPurchases: [],
          checkInTime: '2026-02-01T10:30:00.000Z',
          checkoutUrl: null,
          description: 'earlier',
          end: '2026-02-01T11:00:00.000Z',
          eventId: 'event-1',
          guestCount: 0,
          organizingRegistration: false,
          paymentState: 'recorded',
          refunds: [],
          registrationId: 'registration-1',
          registrationOptionTitle: 'Participant',
          start: '2026-02-01T10:00:00.000Z',
          status: 'CONFIRMED',
          title: 'Earlier Event',
        },
        {
          addonPurchases: [
            {
              quantity: 2,
              title: 'Workshop kit',
              unitPrice: 500,
            },
          ],
          checkInTime: null,
          checkoutUrl: 'https://checkout.stripe.test/pay',
          description: 'later',
          end: '2026-03-01T11:00:00.000Z',
          eventId: 'event-2',
          guestCount: 2,
          organizingRegistration: false,
          paymentState: 'pending',
          refunds: [],
          registrationId: 'registration-2',
          registrationOptionTitle: 'Standard',
          start: '2026-03-01T10:00:00.000Z',
          status: 'PENDING',
          title: 'Later Event',
        },
      ]);
    }),
  );

  it.effect(
    'users.events defects when a registration relation is missing',
    () =>
      Effect.gen(function* () {
        const tenant = createTenant();
        const user = createUser();
        const mockDatabase = {
          query: {
            eventRegistrations: {
              findMany: () =>
                Effect.succeed([
                  {
                    addonPurchases: [],
                    checkInTime: null,
                    event: null,
                    eventId: 'event-missing',
                    guestCount: 0,
                    id: 'registration-missing',
                    registrationOption: {
                      title: 'Missing',
                    },
                    status: 'CONFIRMED',
                    transactions: [],
                  },
                ]),
            },
            transactions: {
              findMany: () => Effect.succeed([]),
            },
          },
        };

        const exit = yield* userHandlers['users.events'](
          undefined,
          userHandlerOptions(
            UsersEventsFindMany.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(
            createUserHandlerContext({
              tenant,
              user,
            }),
          ),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.exit,
        );

        expect(exit._tag).toBe('Failure');
        if (exit._tag === 'Failure') {
          const failure = exit.cause.reasons[0];
          expect(failure?._tag).toBe('Die');
          const defect = failure?._tag === 'Die' ? failure.defect : undefined;
          expect(defect).toBeInstanceOf(Error);
          expect(defect instanceof Error ? defect.message : undefined).toBe(
            'Registration registration-missing references missing event or registration option for event event-missing',
          );
        }
      }),
  );

  it.effect(
    'users.findMany paginates tenant users before loading role join rows',
    () =>
      Effect.gen(function* () {
        const tenant = createTenant();
        const select = vi
          .fn()
          .mockImplementationOnce(() => ({
            from: () => ({
              innerJoin: () => ({
                where: () => Effect.succeed([{ count: 2 }]),
              }),
            }),
          }))
          .mockImplementationOnce(() => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  orderBy: () => ({
                    offset: () => ({
                      limit: () =>
                        Effect.succeed([
                          {
                            email: 'a@example.com',
                            firstName: 'Alice',
                            id: 'user-1',
                            lastName: 'One',
                            userTenantId: 'user-tenant-1',
                          },
                          {
                            email: 'b@example.com',
                            firstName: 'Bob',
                            id: 'user-2',
                            lastName: 'Two',
                            userTenantId: 'user-tenant-2',
                          },
                        ]),
                    }),
                  }),
                }),
              }),
            }),
          }))
          .mockImplementationOnce(() => ({
            from: () => ({
              leftJoin: () => ({
                leftJoin: () => ({
                  where: () =>
                    Effect.succeed([
                      {
                        role: 'Admin',
                        roleId: 'role-admin',
                        userTenantId: 'user-tenant-1',
                      },
                      {
                        role: 'Editor',
                        roleId: 'role-editor',
                        userTenantId: 'user-tenant-1',
                      },
                      {
                        role: null,
                        roleId: null,
                        userTenantId: 'user-tenant-2',
                      },
                    ]),
                }),
              }),
            }),
          }));
        const mockDatabase = { select };

        const result = yield* userHandlers['users.findMany'](
          {
            limit: 25,
            offset: 0,
            search: 'Alice',
          },
          userHandlerOptions(
            UsersFindMany.middleware(RpcRequestContextMiddleware),
          ),
        ).pipe(
          provideUserHandlerContext(
            createUserHandlerContext({
              permissions: ['users:viewAll'],
              tenant,
            }),
          ),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        );

        expect(result.usersCount).toBe(2);
        expect(result.users).toEqual([
          {
            email: 'a@example.com',
            firstName: 'Alice',
            id: 'user-1',
            lastName: 'One',
            roleIds: ['role-admin', 'role-editor'],
            roles: ['Admin', 'Editor'],
          },
          {
            email: 'b@example.com',
            firstName: 'Bob',
            id: 'user-2',
            lastName: 'Two',
            roleIds: [],
            roles: [],
          },
        ]);
        expect(select).toHaveBeenCalledTimes(3);
        expect(result.users).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: expect.anything(),
            }),
          ]),
        );
      }),
  );

  it.effect('updateProfile updates notification and payout fields', () =>
    Effect.gen(function* () {
      const user = createUser();
      const updateSet = vi.fn((_value: unknown) => ({
        where: vi.fn(() => Effect.void),
      }));
      const mockDatabase = {
        update: vi.fn(() => ({
          set: updateSet,
        })),
      };

      yield* userHandlers['users.updateProfile'](
        {
          communicationEmail: 'events@example.com',
          firstName: 'Alice',
          iban: 'NL91ABNA0417164300',
          lastName: 'Updated',
          paypalEmail: 'paypal@example.com',
        },
        userHandlerOptions(
          UsersUpdateProfile.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            user,
          }),
        ),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
      );

      expect(mockDatabase.update).toHaveBeenCalledWith(users);
      expect(updateSet).toHaveBeenCalledWith({
        communicationEmail: 'events@example.com',
        firstName: 'Alice',
        iban: 'NL91ABNA0417164300',
        lastName: 'Updated',
        paypalEmail: 'paypal@example.com',
      });
    }),
  );

  it.effect('userAssigned reflects the current tenant assignment context', () =>
    Effect.gen(function* () {
      const assigned = yield* userHandlers['users.userAssigned'](
        undefined,
        userHandlerOptions(
          UsersUserAssigned.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            userAssigned: true,
          }),
        ),
      );
      expect(assigned).toBe(true);

      const unassigned = yield* userHandlers['users.userAssigned'](
        undefined,
        userHandlerOptions(
          UsersUserAssigned.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            userAssigned: false,
          }),
        ),
      );
      expect(unassigned).toBe(false);
    }),
  );

  it.effect('userAssigned returns false for a trusted unassigned context', () =>
    Effect.gen(function* () {
      const assigned = yield* userHandlers['users.userAssigned'](
        undefined,
        userHandlerOptions(
          UsersUserAssigned.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        provideUserHandlerContext(
          createUserHandlerContext({
            user: null,
            userAssigned: false,
          }),
        ),
      );
      expect(assigned).toBe(false);
    }),
  );
});

describe('profile payout writer guards', () => {
  it.effect(
    'rejects non-canonical payout details before accessing persistence',
    () =>
      Effect.gen(function* () {
        const fixture = createUserDatabaseFixture();
        const cases = [
          {
            iban: 'DE88370400440532013000',
            paypalEmail: 'paypal@example.com',
            reason: 'invalidIban',
          },
          {
            iban: 'nl91 abna 0417 1643 00',
            paypalEmail: 'paypal@example.com',
            reason: 'invalidIban',
          },
          {
            iban: 'NL91ABNA0417164300',
            paypalEmail: 'payout',
            reason: 'invalidPaypalEmail',
          },
          {
            iban: 'NL91ABNA0417164300',
            paypalEmail: 'PayPal@Example.COM',
            reason: 'invalidPaypalEmail',
          },
        ];
        for (const testCase of cases) {
          const error = yield* userHandlers['users.updateProfile'](
            {
              communicationEmail: 'Events@Example.COM',
              firstName: 'Alice',
              iban: testCase.iban,
              lastName: 'Updated',
              paypalEmail: testCase.paypalEmail,
            },
            userHandlerOptions(
              UsersUpdateProfile.middleware(RpcRequestContextMiddleware),
            ),
          ).pipe(
            Effect.flip,
            provideUserHandlerContext(),
            Effect.provide(fixture.databaseLayer),
          );
          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            reason: testCase.reason,
          });
        }
        expect(fixture.executeValues).not.toHaveBeenCalled();
        expect(fixture.deleteWhere).not.toHaveBeenCalled();
        expect(fixture.insertValues).not.toHaveBeenCalled();
        expect(fixture.transactionCommands).toEqual([]);
      }),
  );

  it.effect('keeps authentication ahead of payout validation', () =>
    Effect.gen(function* () {
      const fixture = createUserDatabaseFixture();
      const error = yield* userHandlers['users.updateProfile'](
        {
          communicationEmail: 'events@example.com',
          firstName: 'Alice',
          iban: 'invalid',
          lastName: 'Updated',
          paypalEmail: 'invalid',
        },
        userHandlerOptions(
          UsersUpdateProfile.middleware(RpcRequestContextMiddleware),
        ),
      ).pipe(
        Effect.flip,
        provideUserHandlerContext(
          createUserHandlerContext({ authenticated: false }),
        ),
        Effect.provide(fixture.databaseLayer),
      );
      expect(error._tag).toBe('RpcUnauthorizedError');
      expect(fixture.executeValues).not.toHaveBeenCalled();
      expect(fixture.transactionCommands).toEqual([]);
    }),
  );
});
