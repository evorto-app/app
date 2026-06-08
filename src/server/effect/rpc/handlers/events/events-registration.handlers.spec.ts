import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { StripeClient } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import { eventRegistrationHandlers } from './events-registration.handlers';

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
  user = createUser(),
}: {
  database: unknown;
  user?: ReturnType<typeof createUser>;
}) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, database as never),
    Layer.succeed(StripeClient, {
      checkout: {
        sessions: {
          expire: vi.fn(),
        },
      },
    } as never),
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

describe('event registration cancellation handlers', () => {
  it.effect(
    'allows event organizers to cancel another confirmed registration',
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
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
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
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
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
                  status: 'CONFIRMED',
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
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
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

  it.effect('cancels waitlist registrations and releases a waitlist spot', () =>
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
