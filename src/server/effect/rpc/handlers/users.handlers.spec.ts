import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import {
  rolesToTenantUsers,
  users,
  usersToTenants,
} from '../../../../db/schema';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { normalizeUsersFindManySearch, userHandlers } from './users.handlers';

const createTenant = () => ({
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
});

const createUser = () => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  communicationEmail: 'notify@example.com',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: [] as string[],
  roleIds: [],
});

const createCreateAccountHeaders = (
  tenant = createTenant(),
  authData?: { email?: string; sub?: string },
) => ({
  [RPC_CONTEXT_HEADERS.AUTH_DATA]: encodeRpcContextHeaderJson(
    authData ?? {
      email: 'alice@example.com',
      sub: 'auth0|alice',
    },
  ),
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
});

const returningInsert = <A>(result: A) => ({
  onConflictDoNothing: () => ({
    returning: () => Effect.succeed(result),
  }),
  returning: () => Effect.succeed(result),
});

describe('userHandlers', () => {
  it('normalizes user-list search input for the server query', () => {
    expect(normalizeUsersFindManySearch()).toBeUndefined();
    expect(normalizeUsersFindManySearch(' '.repeat(3))).toBeUndefined();
    expect(normalizeUsersFindManySearch(' alice@example.com ')).toBe(
      '%alice@example.com%',
    );
  });

  it.effect(
    'createAccount creates the user, tenant assignment, and default roles transactionally',
    () =>
      Effect.gen(function* () {
        const inserts: unknown[] = [];
        const tx = {
          insert: (table: unknown) => ({
            values: (value: unknown) => {
              inserts.push({ table, value });
              if (table === rolesToTenantUsers) {
                return Effect.void;
              }
              if (table === users) {
                return returningInsert([{ id: 'created-user-1' }]);
              }
              if (table === usersToTenants) {
                return returningInsert([{ id: 'membership-1' }]);
              }
              return returningInsert([]);
            },
          }),
          query: {
            roles: {
              findMany: () =>
                Effect.succeed([{ id: 'role-1' }, { id: 'role-2' }]),
            },
            users: {
              findFirst: () => Effect.succeed(null),
            },
            usersToTenants: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };
        const database = {
          transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
        };

        yield* userHandlers['users.createAccount'](
          {
            communicationEmail: 'notify@example.com',
            firstName: 'Alice',
            lastName: 'Doe',
          },
          { headers: createCreateAccountHeaders() } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(inserts).toEqual([
          {
            table: users,
            value: {
              auth0Id: 'auth0|alice',
              communicationEmail: 'notify@example.com',
              email: 'alice@example.com',
              firstName: 'Alice',
              lastName: 'Doe',
            },
          },
          {
            table: usersToTenants,
            value: {
              tenantId: 'tenant-1',
              userId: 'created-user-1',
            },
          },
          {
            table: rolesToTenantUsers,
            value: [
              {
                roleId: 'role-1',
                userTenantId: 'membership-1',
              },
              {
                roleId: 'role-2',
                userTenantId: 'membership-1',
              },
            ],
          },
        ]);
      }),
  );

  it.effect(
    'createAccount attaches an existing global user to this tenant',
    () =>
      Effect.gen(function* () {
        const inserts: unknown[] = [];
        const tx = {
          insert: (table: unknown) => ({
            values: (value: unknown) => {
              inserts.push({ table, value });
              if (table === usersToTenants) {
                return returningInsert([{ id: 'membership-1' }]);
              }
              return returningInsert([]);
            },
          }),
          query: {
            roles: {
              findMany: () => Effect.succeed([]),
            },
            users: {
              findFirst: () => Effect.succeed({ id: 'existing-user-1' }),
            },
            usersToTenants: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };
        const database = {
          transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
        };

        yield* userHandlers['users.createAccount'](
          {
            communicationEmail: 'notify@example.com',
            firstName: 'Alice',
            lastName: 'Doe',
          },
          { headers: createCreateAccountHeaders() } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(inserts).toEqual([
          {
            table: usersToTenants,
            value: {
              tenantId: 'tenant-1',
              userId: 'existing-user-1',
            },
          },
        ]);
      }),
  );

  it.effect(
    'createAccount attaches a user created by a concurrent request',
    () =>
      Effect.gen(function* () {
        const inserts: unknown[] = [];
        const findUser = vi
          .fn()
          .mockReturnValueOnce(Effect.succeed(null))
          .mockReturnValueOnce(Effect.succeed({ id: 'concurrent-user-1' }));
        const tx = {
          insert: (table: unknown) => ({
            values: (value: unknown) => {
              inserts.push({ table, value });
              if (table === users) {
                return returningInsert([]);
              }
              if (table === usersToTenants) {
                return returningInsert([{ id: 'membership-1' }]);
              }
              return returningInsert([]);
            },
          }),
          query: {
            roles: {
              findMany: () => Effect.succeed([]),
            },
            users: {
              findFirst: findUser,
            },
            usersToTenants: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };
        const database = {
          transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
        };

        yield* userHandlers['users.createAccount'](
          {
            communicationEmail: 'notify@example.com',
            firstName: 'Alice',
            lastName: 'Doe',
          },
          { headers: createCreateAccountHeaders() } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(findUser).toHaveBeenCalledTimes(2);
        expect(inserts).toEqual([
          {
            table: users,
            value: {
              auth0Id: 'auth0|alice',
              communicationEmail: 'notify@example.com',
              email: 'alice@example.com',
              firstName: 'Alice',
              lastName: 'Doe',
            },
          },
          {
            table: usersToTenants,
            value: {
              tenantId: 'tenant-1',
              userId: 'concurrent-user-1',
            },
          },
        ]);
      }),
  );

  it.effect(
    'createAccount returns a conflict when a concurrent request claims this tenant',
    () =>
      Effect.gen(function* () {
        const findTenantAssignment = vi
          .fn()
          .mockReturnValueOnce(Effect.succeed(null))
          .mockReturnValueOnce(Effect.succeed({ id: 'membership-1' }));
        const tx = {
          insert: (table: unknown) => ({
            values: () => {
              if (table === usersToTenants) {
                return returningInsert([]);
              }
              return returningInsert([]);
            },
          }),
          query: {
            roles: {
              findMany: () => Effect.succeed([]),
            },
            users: {
              findFirst: () => Effect.succeed({ id: 'existing-user-1' }),
            },
            usersToTenants: {
              findFirst: findTenantAssignment,
            },
          },
        };
        const database = {
          transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
        };

        const error = yield* userHandlers['users.createAccount'](
          {
            communicationEmail: 'notify@example.com',
            firstName: 'Alice',
            lastName: 'Doe',
          },
          { headers: createCreateAccountHeaders() } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(Layer.succeed(Database, database as never)),
        );

        expect(findTenantAssignment).toHaveBeenCalledTimes(2);
        expect(error['_tag']).toBe('UserConflictError');
        expect(error.message).toBe('User account already exists');
      }),
  );

  it.effect(
    'createAccount rejects an existing user already in this tenant',
    () =>
      Effect.gen(function* () {
        const tx = {
          query: {
            users: {
              findFirst: () => Effect.succeed({ id: 'existing-user-1' }),
            },
            usersToTenants: {
              findFirst: () => Effect.succeed({ id: 'membership-1' }),
            },
          },
        };
        const database = {
          transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
        };

        const error = yield* userHandlers['users.createAccount'](
          {
            communicationEmail: 'notify@example.com',
            firstName: 'Alice',
            lastName: 'Doe',
          },
          { headers: createCreateAccountHeaders() } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(Layer.succeed(Database, database as never)),
        );

        expect(error['_tag']).toBe('UserConflictError');
        expect(error.message).toBe('User account already exists');
      }),
  );

  it.effect('users.events returns only events from user registrations', () =>
    Effect.gen(function* () {
      const tenant = createTenant();
      const user = createUser();
      const headers = {
        [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
        [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
        [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
      };
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
        },
      };

      const result = yield* userHandlers['users.events'](
        undefined as never,
        {
          headers,
        } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, mockDatabase as never)));

      expect(findRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              NOT: 'CANCELLED',
            },
            tenantId: tenant.id,
            userId: user.id,
          },
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
          paymentState: 'notRequired',
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
          paymentState: 'cancelled',
          registrationId: 'registration-cancelled-payment',
          registrationOptionTitle: 'Participant',
          start: '2026-01-15T10:00:00.000Z',
          status: 'PENDING',
          title: 'Cancelled Payment Event',
        },
        {
          addonPurchases: [],
          checkInTime: '2026-02-01T10:30:00.000Z',
          checkoutUrl: null,
          description: 'earlier',
          end: '2026-02-01T11:00:00.000Z',
          eventId: 'event-1',
          guestCount: 0,
          paymentState: 'recorded',
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
          paymentState: 'pending',
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
        const headers = {
          [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
          [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
          [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
        };
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
          },
        };

        const exit = yield* userHandlers['users.events'](
          undefined as never,
          {
            headers,
          } as never,
        ).pipe(
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
        const headers = {
          [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
          [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
            'users:viewAll',
          ]),
          [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
        };
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
                        userTenantId: 'user-tenant-1',
                      },
                      {
                        role: 'Editor',
                        userTenantId: 'user-tenant-1',
                      },
                      {
                        role: null,
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
          { headers } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, mockDatabase as never)));

        expect(result.usersCount).toBe(2);
        expect(result.users).toEqual([
          {
            email: 'a@example.com',
            firstName: 'Alice',
            id: 'user-1',
            lastName: 'One',
            roles: ['Admin', 'Editor'],
          },
          {
            email: 'b@example.com',
            firstName: 'Bob',
            id: 'user-2',
            lastName: 'Two',
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
      const headers = {
        [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
        [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
      };
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
        { headers } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, mockDatabase as never)));

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

  it.effect('userAssigned reflects the current tenant assignment header', () =>
    Effect.gen(function* () {
      const assigned = yield* userHandlers['users.userAssigned'](undefined, {
        headers: {
          [RPC_CONTEXT_HEADERS.USER_ASSIGNED]: 'true',
        },
      } as never);
      expect(assigned).toBe(true);

      const unassigned = yield* userHandlers['users.userAssigned'](undefined, {
        headers: {
          [RPC_CONTEXT_HEADERS.USER_ASSIGNED]: 'false',
        },
      } as never);
      expect(unassigned).toBe(false);
    }),
  );

  it.effect(
    'userAssigned fails closed when the assignment header is absent',
    () =>
      Effect.gen(function* () {
        const assigned = yield* userHandlers['users.userAssigned'](undefined, {
          headers: {},
        } as never);
        expect(assigned).toBe(false);
      }),
  );
});
