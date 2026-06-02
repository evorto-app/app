import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import {
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransferIntents,
  rolesToTenantUsers,
  transactions,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { StripeClient } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  buildRegistrationTransferredEmailNotification,
  eventRegistrationHandlers,
} from './events-registration.handlers';

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

const createUser = ({
  id = 'scanner-1',
  permissions = [],
}: {
  id?: string;
  permissions?: readonly Permission[];
} = {}) => ({
  attributes: [],
  auth0Id: `auth0|${id}`,
  email: `${id}@example.com`,
  firstName: 'Scan',
  iban: null,
  id,
  lastName: 'User',
  paypalEmail: null,
  permissions,
  roleIds: [],
});

const createContextLayer = ({
  database,
  stripe = {
    checkout: {
      sessions: {
        expire: vi.fn(),
      },
    },
    refunds: {
      create: vi.fn(),
    },
  },
  tenant: currentTenant = tenant,
  user = createUser(),
}: {
  database: unknown;
  stripe?: unknown;
  tenant?: typeof tenant;
  user?: ReturnType<typeof createUser>;
}) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant: currentTenant,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, database as never),
    Layer.succeed(StripeClient, stripe as never),
  );
};

const scannedRegistration = {
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  checkedInGuestCount: 0,
  checkInTime: null,
  event: {
    start: new Date(Date.now() + 30 * 60 * 1000),
    title: 'City tour',
  },
  eventId: 'event-1',
  guestCount: 0,
  registrationOption: {
    price: 0,
    title: 'Participant',
  },
  status: 'CONFIRMED',
  transactions: [],
  user: {
    firstName: 'Alice',
    lastName: 'Doe',
  },
  userId: 'attendee-1',
};

const nonConfirmedRegistrationStatuses = [
  'CANCELLED',
  'PENDING',
  'WAITLIST',
] as const;

const cancellationEvent = {
  start: new Date(Date.now() + 24 * 60 * 60 * 1000),
  title: 'City tour',
};

const cancellationUser = {
  communicationEmail: 'notify-attendee@example.com',
  email: 'attendee@example.com',
  firstName: 'Alice',
  id: 'attendee-1',
};

const expectCounterDecrement = (
  updateSet: unknown,
  field: 'confirmedSpots' | 'reservedSpots' | 'waitlistSpots',
  amount: number,
) => {
  const sqlUpdate = (
    updateSet as Record<string, { queryChunks?: readonly unknown[] }>
  )[field];

  expect(sqlUpdate).toEqual(
    expect.objectContaining({
      queryChunks: expect.arrayContaining([amount]),
    }),
  );
};

const createWaitlistSelect =
  (waitlistRows: readonly Record<string, unknown>[] = []) =>
  () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Effect.succeed(waitlistRows),
          }),
        }),
      }),
    }),
  });

const createGuestCancellationDatabase = ({
  status,
}: {
  status: 'CONFIRMED' | 'PENDING';
}) => {
  const updateSets: unknown[] = [];
  const tx = {
    insert: () => ({
      values: () => Effect.succeed([]),
    }),
    query: {
      eventRegistrations: {
        findMany: () => Effect.succeed([]),
      },
    },
    select: createWaitlistSelect(),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        updateSets.push(values);
        return {
          where: () => ({
            returning: () => {
              if (
                table === eventRegistrations ||
                table === eventRegistrationOptions
              ) {
                return Effect.succeed([{ id: 'updated' }]);
              }
              return Effect.succeed([]);
            },
          }),
        };
      },
    }),
  };
  const database = {
    query: {
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            checkedInGuestCount: 0,
            checkInTime: null,
            event: cancellationEvent,
            eventId: 'event-1',
            guestCount: 2,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status,
            transactions: [],
            user: cancellationUser,
            userId: 'attendee-1',
          }),
      },
    },
    transaction: vi.fn((callback: (tx: typeof tx) => unknown) => callback(tx)),
  };

  return { database, updateSets };
};

const paidTransferRegistration = {
  checkInTime: null,
  event: {
    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
  id: 'registration-1',
  status: 'CONFIRMED' as const,
  transactions: [
    {
      amount: 2500,
      status: 'successful',
      type: 'registration',
    },
  ],
  userId: 'attendee-1',
};

const createTransferIntentDatabase = ({
  activeIntent = null,
  registration = paidTransferRegistration,
}: {
  activeIntent?: null | {
    code: string;
    expiresAt: Date;
    id: string;
  };
  registration?: typeof paidTransferRegistration;
} = {}) => {
  let insertedIntent: Record<string, unknown> | undefined;
  const database = {
    insert: vi.fn((table) => {
      expect(table).toBe(registrationTransferIntents);
      return {
        values: vi.fn((values: Record<string, unknown>) => {
          insertedIntent = values;
          return {
            returning: vi.fn(() =>
              Effect.succeed([
                {
                  code: values['code'],
                  expiresAt: values['expiresAt'],
                },
              ]),
            ),
          };
        }),
      };
    }),
    query: {
      eventRegistrations: {
        findFirst: vi.fn(() => Effect.succeed(registration)),
      },
      registrationTransferIntents: {
        findFirst: vi.fn(() => Effect.succeed(activeIntent)),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Effect.succeed()),
      })),
    })),
  };

  return {
    database,
    getInsertedIntent: () => insertedIntent,
  };
};

const createTransferDatabase = ({
  existingTargetRegistration = null,
  organizerRegistrations = [
    {
      id: 'organizer-registration-1',
      registrationOption: {
        organizingRegistration: true,
      },
    },
  ],
  registration = {
    checkInTime: null,
    event: {
      start: new Date(Date.now() + 24 * 60 * 60 * 1000),
      title: 'City tour',
    },
    eventId: 'event-1',
    id: 'registration-1',
    registrationOptionId: 'option-1',
    status: 'CONFIRMED',
    transactions: [],
    userId: 'attendee-1',
  },
  registrationOptionRoleIds = ['participant-role-1'],
  targetTenantUser = {
    id: 'target-tenant-user-1',
    roles: [{ id: 'participant-role-1' }],
  },
  targetUser = {
    communicationEmail: 'notify-target@example.com',
    email: 'target@example.com',
    firstName: 'Target',
    id: 'target-user-1',
  },
}: {
  existingTargetRegistration?: null | { id: string };
  organizerRegistrations?: readonly {
    id: string;
    registrationOption: {
      organizingRegistration: boolean;
    };
  }[];
  registration?: null | {
    checkInTime: Date | null;
    event: null | { start: Date; title: string };
    eventId: string;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    transactions: readonly {
      amount: number;
      status: 'cancelled' | 'pending' | 'successful';
      type: 'other' | 'refund' | 'registration';
    }[];
    userId: string;
  };
  registrationOptionRoleIds?: string[];
  targetTenantUser?: null | { id: string; roles: readonly { id: string }[] };
  targetUser?: null | {
    communicationEmail: string;
    email: string;
    firstName: string;
    id: string;
  };
} = {}) => {
  let insertedNotification: unknown;
  const updateSets: unknown[] = [];
  const insertQuery = {
    values: (values: unknown) => {
      insertedNotification = values;
      return Effect.succeed();
    },
  };
  const updateQuery = (table: unknown) => ({
    set: (values: unknown) => {
      updateSets.push(values);
      return {
        where: () => ({
          returning: () => {
            if (table === eventRegistrations) {
              return Effect.succeed([
                {
                  eventId: 'event-1',
                  id: 'registration-1',
                },
              ]);
            }
            return Effect.succeed([]);
          },
        }),
      };
    },
  });
  const tx = {
    insert: () => insertQuery,
    update: updateQuery,
  };
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed(registration))
          .mockReturnValueOnce(Effect.succeed(existingTargetRegistration)),
        findMany: () => Effect.succeed(organizerRegistrations),
      },
      users: {
        findFirst: () => Effect.succeed(targetUser),
      },
      usersToTenants: {
        findFirst: () => Effect.succeed(targetTenantUser),
      },
    },
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === users) {
              return Effect.succeed(targetUser ? [targetUser] : []);
            }
            return Effect.succeed([]);
          },
        }),
      }),
    }),
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        updateSets.push(values);
        return {
          where: () => ({
            returning: () => {
              if (table === eventRegistrations) {
                return Effect.succeed([{ id: 'registration-1' }]);
              }
              return Effect.succeed([]);
            },
          }),
        };
      },
    }),
    transaction: (run: (transaction: typeof tx) => Effect.Effect<unknown>) =>
      run(tx),
  };

  return {
    database,
    insertedNotification: () => insertedNotification,
    updateSets,
  };
};

const createTransferTargetsDatabase = ({
  registrationOptionRoleIds = ['participant-role-1'],
}: {
  registrationOptionRoleIds?: string[];
} = {}) => {
  const tenantUserRows = [
    {
      email: 'current@example.com',
      firstName: 'Current',
      id: 'tenant-user-current',
      lastName: 'Owner',
      userId: 'attendee-1',
    },
    {
      email: 'alex@example.com',
      firstName: 'Alex',
      id: 'tenant-user-eligible',
      lastName: 'Able',
      userId: 'target-user-1',
    },
    {
      email: 'registered@example.com',
      firstName: 'Already',
      id: 'tenant-user-active',
      lastName: 'Registered',
      userId: 'already-registered-user',
    },
    {
      email: 'other@example.com',
      firstName: 'Other',
      id: 'tenant-user-ineligible',
      lastName: 'Role',
      userId: 'other-user-1',
    },
  ];
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          }),
        findMany: vi
          .fn()
          .mockReturnValueOnce(
            Effect.succeed([
              {
                id: 'organizer-registration-1',
                registrationOption: {
                  organizingRegistration: true,
                },
              },
            ]),
          )
          .mockReturnValueOnce(
            Effect.succeed([
              {
                userId: 'already-registered-user',
              },
            ]),
          ),
      },
      usersToTenants: {
        findMany: () =>
          Effect.succeed([
            {
              id: 'tenant-user-current',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'current@example.com',
                firstName: 'Current',
                id: 'attendee-1',
                lastName: 'Owner',
              },
              userId: 'attendee-1',
            },
            {
              id: 'tenant-user-eligible',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'alex@example.com',
                firstName: 'Alex',
                id: 'target-user-1',
                lastName: 'Able',
              },
              userId: 'target-user-1',
            },
            {
              id: 'tenant-user-active',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'registered@example.com',
                firstName: 'Already',
                id: 'already-registered-user',
                lastName: 'Registered',
              },
              userId: 'already-registered-user',
            },
            {
              id: 'tenant-user-ineligible',
              roles: [{ id: 'other-role-1' }],
              user: {
                email: 'other@example.com',
                firstName: 'Other',
                id: 'other-user-1',
                lastName: 'Role',
              },
              userId: 'other-user-1',
            },
          ]),
      },
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === usersToTenants) {
          return {
            innerJoin: () => ({
              where: () => ({
                limit: () => Effect.succeed(tenantUserRows),
              }),
            }),
          };
        }

        if (table === rolesToTenantUsers) {
          return {
            where: () =>
              Effect.succeed([
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-current',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-eligible',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-active',
                },
                {
                  roleId: 'other-role-1',
                  userTenantId: 'tenant-user-ineligible',
                },
              ]),
          };
        }

        throw new Error('Unexpected select table');
      },
    }),
  };

  return database;
};

describe('registration transfer intent handlers', () => {
  it.effect(
    'creates a paid registration transfer code for an eligible participant registration',
    () =>
      Effect.gen(function* () {
        const user = createUser({ id: 'attendee-1' });
        const { database, getInsertedIntent } = createTransferIntentDatabase();

        const result = yield* eventRegistrationHandlers[
          'events.createRegistrationTransferIntent'
        ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
          Effect.provide(createContextLayer({ database, user })),
        );

        expect(result.code).toEqual(expect.any(String));
        expect(result.expiresAt).toEqual(expect.any(String));
        expect(getInsertedIntent()).toMatchObject({
          code: result.code,
          createdByUserId: 'attendee-1',
          sourceRegistrationId: 'registration-1',
          status: 'pending',
          tenantId: 'tenant-1',
        });
        expect(getInsertedIntent()?.['expiresAt']).toBeInstanceOf(Date);
      }),
  );

  it.effect('reuses an existing unexpired paid transfer code', () =>
    Effect.gen(function* () {
      const user = createUser({ id: 'attendee-1' });
      const { database, getInsertedIntent } = createTransferIntentDatabase({
        activeIntent: {
          code: 'existing-code',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          id: 'intent-1',
        },
      });

      const result = yield* eventRegistrationHandlers[
        'events.createRegistrationTransferIntent'
      ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
        Effect.provide(createContextLayer({ database, user })),
      );

      expect(result.code).toBe('existing-code');
      expect(getInsertedIntent()).toBeUndefined();
    }),
  );

  it.effect('rejects unpaid registrations for paid transfer codes', () =>
    Effect.gen(function* () {
      const user = createUser({ id: 'attendee-1' });
      const { database } = createTransferIntentDatabase({
        registration: {
          ...paidTransferRegistration,
          transactions: [],
        },
      });

      const error = yield* eventRegistrationHandlers[
        'events.createRegistrationTransferIntent'
      ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
        Effect.provide(createContextLayer({ database, user })),
        Effect.flip,
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Only paid registrations can create transfer codes',
      );
      expect(database.insert).not.toHaveBeenCalled();
    }),
  );
});

describe('event registration cancellation handlers', () => {
  it.effect(
    'allows event organizers to cancel another confirmed registration',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        let insertedNotification: Record<string, unknown> | undefined;
        const tx = {
          insert: () => ({
            values: (values: Record<string, unknown>) => {
              insertedNotification = values;
              return Effect.succeed([]);
            },
          }),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: createWaitlistSelect(),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: cancellationEvent,
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  user: cancellationUser,
                  userId: 'attendee-1',
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelEventRegistration'](
          { eventId: 'event-1', registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(insertedNotification).toEqual(
          expect.objectContaining({
            kind: 'registrationCancelled',
            payload: {
              eventId: 'event-1',
              eventTitle: 'City tour',
              registrationId: 'registration-1',
            },
            recipientEmail: 'notify-attendee@example.com',
            recipientUserId: 'attendee-1',
            tenantId: 'tenant-1',
          }),
        );
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'rejects event registration cancellation without organizer access',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: cancellationEvent,
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  user: cancellationUser,
                  userId: 'attendee-1',
                }),
              findMany: () => Effect.succeed([]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelEventRegistration'
        ]({ eventId: 'event-1', registrationId: 'registration-1' }, {
          headers: {},
        } as never).pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ database })),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'cancels confirmed registrations and releases a confirmed spot',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        let insertedNotification: Record<string, unknown> | undefined;
        const tx = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table !== transactions) {
                insertedNotification = values;
              }
              return Effect.succeed([]);
            },
          }),
          query: {
            eventRegistrations: {
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'waitlist-registration-1',
                    user: {
                      communicationEmail: null,
                      email: 'waitlist@example.com',
                      firstName: 'Wait',
                      id: 'waitlist-user-1',
                    },
                    userId: 'waitlist-user-1',
                  },
                ]),
            },
          },
          select: createWaitlistSelect([
            {
              id: 'waitlist-registration-1',
              recipientCommunicationEmail: null,
              recipientEmail: 'waitlist@example.com',
              recipientFirstName: 'Wait',
              recipientUserId: 'waitlist-user-1',
            },
          ]),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: cancellationEvent,
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  user: cancellationUser,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(insertedNotification).toEqual(
          expect.objectContaining({
            kind: 'waitlistSpotAvailable',
            payload: {
              eventId: 'event-1',
              eventTitle: 'City tour',
              registrationId: 'waitlist-registration-1',
            },
            recipientEmail: 'waitlist@example.com',
            recipientUserId: 'waitlist-user-1',
            tenantId: 'tenant-1',
          }),
        );
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels confirmed guest registrations and releases buyer plus guest spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'CONFIRMED',
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 3);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'records a pending manual refund transaction for paid confirmed cancellation',
    () =>
      Effect.gen(function* () {
        let insertedTransaction: Record<string, unknown> | undefined;
        const updateSets: unknown[] = [];
        const tx = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                insertedTransaction = values;
              }
              return Effect.succeed([]);
            },
          }),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: createWaitlistSelect(),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: cancellationEvent,
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [
                    {
                      amount: 2500,
                      id: 'transaction-1',
                      method: 'stripe',
                      status: 'successful',
                      stripeCheckoutSessionId: 'checkout-1',
                      type: 'registration',
                    },
                  ],
                  user: cancellationUser,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 2);
        expect(insertedTransaction).toEqual(
          expect.objectContaining({
            amount: -2500,
            currency: 'EUR',
            eventId: 'event-1',
            eventRegistrationId: 'registration-1',
            manuallyCreated: true,
            method: 'stripe',
            status: 'pending',
            targetUserId: 'attendee-1',
            tenantId: 'tenant-1',
            type: 'refund',
          }),
        );
        expect(insertedTransaction?.['comment']).toContain(
          'Pending registration refund record',
        );
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'creates a Stripe refund for paid confirmed cancellation with a stored Stripe reference',
    () =>
      Effect.gen(function* () {
        let insertedTransaction: Record<string, unknown> | undefined;
        const updateSets: unknown[] = [];
        const tx = {
          insert: vi.fn(() => ({
            values: () => Effect.succeed([]),
          })),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: createWaitlistSelect(),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                insertedTransaction = values;
              }
              return Effect.succeed([]);
            },
          }),
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: cancellationEvent,
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [
                    {
                      amount: 2500,
                      id: 'transaction-1',
                      method: 'stripe',
                      status: 'successful',
                      stripeChargeId: 'ch_123',
                      stripeCheckoutSessionId: 'checkout-1',
                      stripePaymentIntentId: 'pi_123',
                      type: 'registration',
                    },
                  ],
                  user: cancellationUser,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = {
          checkout: {
            sessions: {
              expire: vi.fn(),
            },
          },
          refunds: {
            create: vi.fn(() =>
              Promise.resolve({ id: 're_123', status: 'succeeded' }),
            ),
          },
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 2);
        expect(tx.insert).toHaveBeenCalledOnce();
        expect(stripe.refunds.create).toHaveBeenCalledWith(
          {
            amount: 2500,
            charge: 'ch_123',
          },
          {
            stripeAccount: 'acct_123',
          },
        );
        expect(insertedTransaction).toEqual(
          expect.objectContaining({
            amount: -2500,
            currency: 'EUR',
            eventId: 'event-1',
            eventRegistrationId: 'registration-1',
            manuallyCreated: false,
            method: 'stripe',
            status: 'successful',
            targetUserId: 'attendee-1',
            tenantId: 'tenant-1',
            type: 'refund',
          }),
        );
        expect(insertedTransaction?.['comment']).toContain('re_123');
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect('cancels pending registrations and releases a reserved spot', () =>
    Effect.gen(function* () {
      const updateSets: unknown[] = [];
      const tx = {
        update: (table: unknown) => ({
          set: (values: unknown) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () => {
                  if (
                    table === eventRegistrations ||
                    table === eventRegistrationOptions
                  ) {
                    return Effect.succeed([{ id: 'updated' }]);
                  }
                  return Effect.succeed([]);
                },
              }),
            };
          },
        }),
      };
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'PENDING',
                transactions: [],
              }),
          },
        },
        transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      yield* eventRegistrationHandlers['events.cancelRegistration'](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        { headers: {} } as never,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(updateSets).toEqual([
        { status: 'CANCELLED' },
        expect.objectContaining({ reservedSpots: expect.anything() }),
      ]);
      expect(database.transaction).toHaveBeenCalledOnce();
    }),
  );

  it.effect(
    'cancels pending guest registrations and releases buyer plus guest reserved spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'PENDING',
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'reservedSpots', 3);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect('rejects checked-in registration cancellation', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: new Date(),
                event: {
                  start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                transactions: [],
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.cancelRegistration'
      ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Checked-in registrations cannot be cancelled',
      );
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'cancels waitlisted registrations and releases a waitlist spot',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'WAITLIST',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ waitlistSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );
});

describe('event registration transfer handlers', () => {
  it('builds transfer-completed email copy for the new registration owner', () => {
    expect(
      buildRegistrationTransferredEmailNotification({
        eventTitle: 'City tour',
        recipientFirstName: 'Target',
        registrationId: 'registration-1',
        tenantName: 'Tenant',
      }),
    ).toEqual({
      payload: {
        eventTitle: 'City tour',
        registrationId: 'registration-1',
      },
      subject: 'Registration transferred for City tour',
      textBody: [
        'Hi Target,',
        '',
        'Tenant has transferred a registration for City tour to you.',
        '',
        'Open Evorto to view the registration details.',
      ].join('\n'),
    });
  });

  it.effect(
    'returns eligible transfer targets for organizer-assisted transfer',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer({ database: createTransferTargetsDatabase() }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
        ]);
      }),
  );

  it.effect(
    'returns transfer targets for unrestricted registration options',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database: createTransferTargetsDatabase({
                registrationOptionRoleIds: [],
              }),
            }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
          {
            email: 'other@example.com',
            firstName: 'Other',
            id: 'other-user-1',
            lastName: 'Role',
          },
        ]);
      }),
  );

  it.effect(
    'allows event organizers to transfer a confirmed unpaid registration to another tenant user',
    () =>
      Effect.gen(function* () {
        const { database, insertedNotification, updateSets } =
          createTransferDatabase();

        yield* eventRegistrationHandlers['events.transferEventRegistration'](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          { headers: {} } as never,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
        expect(insertedNotification()).toEqual(
          expect.objectContaining({
            kind: 'registrationTransferred',
            payload: {
              eventId: 'event-1',
              eventTitle: 'City tour',
              registrationId: 'registration-1',
            },
            recipientEmail: 'notify-target@example.com',
            recipientUserId: 'target-user-1',
            subject: 'Registration transferred for City tour',
            tenantId: 'tenant-1',
          }),
        );
      }),
  );

  it.effect(
    'allows participants to transfer their own confirmed unpaid registration by target email',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          organizerRegistrations: [],
        });

        yield* eventRegistrationHandlers['events.transferMyRegistration'](
          {
            registrationId: 'registration-1',
            targetEmail: ' TARGET@EXAMPLE.COM ',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
      }),
  );

  it.effect('allows transfer to unrestricted registration options', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        registrationOptionRoleIds: [],
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [],
        },
      });

      yield* eventRegistrationHandlers['events.transferEventRegistration'](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        { headers: {} } as never,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
    }),
  );

  it.effect(
    'rejects participant transfer when the target email is not an existing user',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'missing@example.com',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'does not reveal existing users outside the tenant during participant transfer',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'target@example.com',
          },
          { headers: {} } as never,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer without organizer access', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        organizerRegistrations: [],
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        { headers: {} } as never,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'rejects paid registration transfer until the Stripe replacement flow exists',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          registration: {
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [
              {
                amount: 1200,
                status: 'successful',
                type: 'registration',
              },
            ],
            userId: 'attendee-1',
          },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Paid registration transfer is not available until the Stripe Checkout replacement and refund flow is implemented',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer when the target user is not role-eligible', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [{ id: 'other-role-1' }],
        },
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        { headers: {} } as never,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Target user is not eligible for this registration option',
      );
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'rejects transfer when the target user is outside the current tenant',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target already has an active registration',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          existingTargetRegistration: { id: 'target-registration-1' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Target user already has an active registration',
        );
        expect(updateSets).toEqual([]);
      }),
  );
});

describe('event registration scan handlers', () => {
  it.effect('rejects scan reads for users who cannot check in this event', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () => Effect.succeed(scannedRegistration),
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect('disables scan check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                ...scannedRegistration,
                event: {
                  ...scannedRegistration.event,
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
              }),
          },
        },
      };

      const result = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(result.allowCheckin).toBe(false);
      expect(result.registrationStatusIssue).toBe(false);
      expect(result.sameUserIssue).toBe(false);
    }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`disables scan check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  status,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(false);
        expect(result.registrationStatusIssue).toBe(true);
        expect(result.sameUserIssue).toBe(false);
      }),
    );
  }

  it.effect(
    'allows scanning remaining guests after the buyer is checked in',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  checkedInGuestCount: 1,
                  checkInTime: new Date(),
                  guestCount: 2,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, { headers: {} } as never).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(true);
        expect(result.alreadyCheckedInIssue).toBe(false);
        expect(result.attendeeCheckedIn).toBe(true);
        expect(result.checkedInGuestCount).toBe(1);
        expect(result.guestCount).toBe(2);
        expect(result.remainingGuestCount).toBe(1);
      }),
  );

  it.effect(
    'records check-in and increments the option counter for an organizer',
    () =>
      Effect.gen(function* () {
        const updateCalls: string[] = [];
        const tx = {
          update: (table: unknown) => ({
            set: (values: { checkInTime?: Date }) => ({
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    updateCalls.push('registration');
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 0,
                        checkInTime: values.checkInTime,
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    updateCalls.push('option');
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            }),
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 30 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  userId: 'attendee-1',
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const result = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ]({ guestCheckInCount: 0, registrationId: 'registration-1' }, {
          headers: {},
        } as never).pipe(Effect.provide(createContextLayer({ database })));

        expect(result.alreadyCheckedIn).toBe(false);
        expect(result.checkInTime).toContain('T');
        expect(updateCalls).toEqual(['registration', 'option']);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect('records selected guest check-ins with the attendee check-in', () =>
    Effect.gen(function* () {
      const updateSets: unknown[] = [];
      const tx = {
        update: (table: unknown) => ({
          set: (values: unknown) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 2,
                        checkInTime: new Date(),
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            };
          },
        }),
      };
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 30 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 2,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        {
          guestCheckInCount: 2,
          registrationId: 'registration-1',
        },
        { headers: {} } as never,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(result.alreadyCheckedIn).toBe(false);
      expect(updateSets).toEqual([
        expect.objectContaining({ checkInTime: expect.any(Date) }),
        expect.objectContaining({ checkedInSpots: expect.anything() }),
      ]);
    }),
  );

  it.effect(
    'rejects negative guest check-in counts before reading registration state',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: vi.fn(() =>
                Effect.die(new Error('registration lookup should not run')),
              ),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ]({ guestCheckInCount: -1, registrationId: 'registration-1' }, {
          headers: {},
        } as never).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count must be a non-negative integer',
        );
        expect(
          database.query.eventRegistrations.findFirst,
        ).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects guest check-in counts above remaining guests before writing',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 1,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 30 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 2,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  userId: 'attendee-1',
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ]({ guestCheckInCount: 2, registrationId: 'registration-1' }, {
          headers: {},
        } as never).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count exceeds remaining guests',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect('rejects check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ]({ guestCheckInCount: 0, registrationId: 'registration-1' }, {
        headers: {},
      } as never).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Check-in is not open for this event yet');
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('treats duplicate check-in as an idempotent success', () =>
    Effect.gen(function* () {
      const checkInTime = new Date('2026-09-18T09:45:00.000Z');
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime,
                event: {
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
                eventId: 'event-1',
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn(),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ]({ guestCheckInCount: 0, registrationId: 'registration-1' }, {
        headers: {},
      } as never).pipe(Effect.provide(createContextLayer({ database })));

      expect(result).toEqual({
        alreadyCheckedIn: true,
        checkInTime: '2026-09-18T09:45:00.000Z',
      });
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('rejects users checking in their own registration', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 30 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'scanner-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ]({ guestCheckInCount: 0, registrationId: 'registration-1' }, {
        headers: {},
      } as never).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Users cannot check in their own registration',
      );
    }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`rejects direct check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 30 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ]({ guestCheckInCount: 0, registrationId: 'registration-1' }, {
          headers: {},
        } as never).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Only confirmed registrations can be checked in',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
    );
  }
});
