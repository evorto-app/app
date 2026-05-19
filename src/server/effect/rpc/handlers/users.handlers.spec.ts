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
import { userHandlers } from './users.handlers';

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

describe('userHandlers', () => {
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
              return {
                returning: () => {
                  if (table === users) {
                    return Effect.succeed([{ id: 'created-user-1' }]);
                  }
                  if (table === usersToTenants) {
                    return Effect.succeed([{ id: 'membership-1' }]);
                  }
                  return Effect.succeed([]);
                },
              };
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
              return {
                returning: () => {
                  if (table === usersToTenants) {
                    return Effect.succeed([{ id: 'membership-1' }]);
                  }
                  return Effect.succeed([]);
                },
              };
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
          {
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
    'users.findMany uses distinct tenant users count with role-join rows',
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
              where: () => Effect.succeed([{ count: 2 }]),
            }),
          }))
          .mockImplementationOnce(() => ({
            from: () => ({
              orderBy: () => ({
                offset: () => ({
                  limit: () => ({
                    innerJoin: () => ({
                      leftJoin: () => ({
                        leftJoin: () =>
                          Effect.succeed([
                            {
                              email: 'a@example.com',
                              firstName: 'Alice',
                              id: 'user-1',
                              lastName: 'One',
                              role: 'Admin',
                            },
                            {
                              email: 'a@example.com',
                              firstName: 'Alice',
                              id: 'user-1',
                              lastName: 'One',
                              role: 'Editor',
                            },
                            {
                              email: 'b@example.com',
                              firstName: 'Bob',
                              id: 'user-2',
                              lastName: 'Two',
                              role: null,
                            },
                          ]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }));
        const mockDatabase = { select };

        const result = yield* userHandlers['users.findMany'](
          {
            limit: 25,
            offset: 0,
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

  it('userAssigned reflects the current tenant assignment header', () => {
    expect(
      Effect.runSync(
        userHandlers['users.userAssigned'](undefined, {
          headers: {
            [RPC_CONTEXT_HEADERS.USER_ASSIGNED]: 'true',
          },
        } as never),
      ),
    ).toBe(true);
    expect(
      Effect.runSync(
        userHandlers['users.userAssigned'](undefined, {
          headers: {
            [RPC_CONTEXT_HEADERS.USER_ASSIGNED]: 'false',
          },
        } as never),
      ),
    ).toBe(false);
  });

  it('userAssigned fails closed when the assignment header is absent', () => {
    expect(
      Effect.runSync(
        userHandlers['users.userAssigned'](undefined, {
          headers: {},
        } as never),
      ),
    ).toBe(false);
  });
});
