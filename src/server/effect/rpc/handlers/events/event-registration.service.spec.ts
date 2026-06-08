import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import Stripe from 'stripe';

import { Database } from '../../../../../db';
import { eventAddons, eventRegistrations } from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import {
  EventRegistrationService,
  isUserEligibleForRegistrationOption,
  validateRegistrationAddons,
  validateRegistrationQuestionAnswers,
} from './event-registration.service';
import { EventRegistrationConflictError } from './events.errors';

const stripeClient = new Stripe('sk_test_123');
const configProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: Object.fromEntries([
      ['BASE_URL', 'https://app.example'],
      ['CLIENT_ID', 'client-id'],
      ['CLIENT_SECRET', 'client-secret'],
      ['DATABASE_URL', 'postgresql://db.example/app'],
      ['E2E_NOW_ISO', '2026-09-15T12:00:00.000Z'],
      ['ISSUER_BASE_URL', 'https://issuer.example'],
      ['SECRET', 'secret'],
    ]),
  }),
);

const approvedRegistrationOption = {
  closeRegistrationTime: new Date('2026-09-20T10:00:00.000Z'),
  confirmedSpots: 0,
  event: {
    start: new Date('2026-09-18T10:00:00.000Z'),
    status: 'APPROVED',
    tenantId: 'tenant-1',
    title: 'Approved event',
  },
  eventId: 'event-1',
  id: 'option-1',
  isPaid: false,
  openRegistrationTime: new Date('2026-09-10T10:00:00.000Z'),
  organizingRegistration: false,
  price: 0,
  registrationMode: 'fcfs',
  reservedSpots: 0,
  roleIds: ['role-1'],
  spots: 10,
  stripeTaxRateId: null,
} as const;

describe('EventRegistrationService', () => {
  describe('isUserEligibleForRegistrationOption', () => {
    it('treats an empty role list as open to all users', () => {
      expect(
        isUserEligibleForRegistrationOption({
          optionRoleIds: [],
          userRoleIds: ['role-2'],
        }),
      ).toBe(true);
    });

    it('requires at least one matching role when the option has role constraints', () => {
      expect(
        isUserEligibleForRegistrationOption({
          optionRoleIds: ['role-1'],
          userRoleIds: ['role-2'],
        }),
      ).toBe(false);
    });
  });

  describe('validateRegistrationAddons', () => {
    const availableAddOn = {
      addOnId: 'addon-1',
      allowMultiple: true,
      maxQuantityPerUser: 2,
      price: 500,
      quantity: 1,
      stripeTaxRateId: 'txr_1',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '19',
      title: 'Lunch',
      totalAvailableQuantity: 3,
    } as const;

    it('normalizes selected registration add-ons', () => {
      expect(
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 1,
            },
            {
              addOnId: 'addon-1',
              quantity: 1,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toEqual([
        {
          ...availableAddOn,
          selectedQuantity: 2,
        },
      ]);
    });

    it('rejects add-ons that are not available during registration', () => {
      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'other-addon',
              quantity: 1,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toThrow('Add-on is not available during registration');
    });

    it('rejects quantities above the per-user limit or remaining availability', () => {
      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 3,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toThrow('Add-on quantity exceeds the per-user limit');

      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 2,
            },
          ],
          availableAddOns: [
            {
              ...availableAddOn,
              maxQuantityPerUser: 5,
              totalAvailableQuantity: 1,
            },
          ],
        }),
      ).toThrow('Add-on quantity is no longer available');
    });
  });

  describe('validateRegistrationQuestionAnswers', () => {
    it('trims submitted answers and ignores blank optional answers', () => {
      expect(
        validateRegistrationQuestionAnswers({
          answers: [
            {
              answer: '  Alice  ',
              questionId: 'question-1',
            },
            {
              answer: '   ',
              questionId: 'question-2',
            },
          ],
          questions: [
            {
              id: 'question-1',
              required: true,
            },
            {
              id: 'question-2',
              required: false,
            },
          ],
        }),
      ).toEqual([
        {
          answer: 'Alice',
          questionId: 'question-1',
        },
      ]);
    });

    it('rejects missing required answers', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [],
          questions: [
            {
              id: 'question-1',
              required: true,
            },
          ],
        }),
      ).toThrow('Required registration question is missing');
    });

    it('rejects answers for questions outside the selected option', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [
            {
              answer: 'Alice',
              questionId: 'other-question',
            },
          ],
          questions: [
            {
              id: 'question-1',
              required: false,
            },
          ],
        }),
      ).toThrow('Registration question does not belong to this option');
    });
  });

  it.effect(
    'rejects a second registration for the same event before looking up another option',
    () =>
      Effect.gen(function* () {
        const findRegistrationOption = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: findRegistrationOption,
            },
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  id: 'existing-registration',
                }),
            },
          },
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'organizer-option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('User is already registered for this event');
        expect(findRegistrationOption).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'queries registration options with explicit projection columns',
    () =>
      Effect.gen(function* () {
        const findRegistrationOption = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: findRegistrationOption,
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(findRegistrationOption).toHaveBeenCalledWith(
          expect.objectContaining({
            columns: expect.objectContaining({
              closeRegistrationTime: true,
              confirmedSpots: true,
              eventId: true,
              id: true,
              isPaid: true,
              openRegistrationTime: true,
              organizingRegistration: true,
              price: true,
              registrationMode: true,
              reservedSpots: true,
              roleIds: true,
              spots: true,
              stripeTaxRateId: true,
            }),
          }),
        );
      }),
  );

  it.effect('rejects registration for an unpublished event', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                event: {
                  ...approvedRegistrationOption.event,
                  status: 'DRAFT',
                },
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Event is not open for registration');
    }),
  );

  it.effect(
    'rejects registration outside the server-side registration window',
    () =>
      Effect.gen(function* () {
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  openRegistrationTime: new Date('2026-09-20T10:00:00.000Z'),
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Registration is not open');
      }),
  );

  it.effect('rejects registration when user roles are not eligible', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () => Effect.succeed(approvedRegistrationOption),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-2'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'User is not eligible for this registration option',
      );
    }),
  );

  it.effect('rejects registration for another tenant event', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                event: {
                  ...approvedRegistrationOption.event,
                  tenantId: 'tenant-2',
                },
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationNotFoundError');
      expect(error.message).toBe('Registration option not found');
    }),
  );

  it.effect('rejects registration when the selected option is full', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 8,
                reservedSpots: 2,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option has no available spots');
    }),
  );

  it.effect(
    'stores guest count when registering multiple participant spots',
    () =>
      Effect.gen(function* () {
        let insertedRegistration: unknown;
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: (
            callback: (tx: {
              insert: () => {
                values: (value: unknown) => {
                  returning: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              update: () => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<{ id: string }[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: () => ({
                values: (value) => {
                  insertedRegistration = value;
                  return {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  };
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([{ id: 'option-1' }]),
                  }),
                }),
              }),
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 2,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            guestCount: 2,
            status: 'CONFIRMED',
          }),
        );
      }),
  );

  it.effect('rejects guest registration when not enough spots remain', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 8,
                reservedSpots: 0,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 2,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option has no available spots');
    }),
  );

  it.effect('rejects guest spots for organizer/helper registration', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                organizingRegistration: true,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 1,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Guest spots are only available for participant options',
      );
    }),
  );

  it.effect('rejects registration for unsupported registration modes', () =>
    Effect.gen(function* () {
      const updateOptionCounters = vi.fn();
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                registrationMode: 'random',
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
        update: updateOptionCounters,
      };

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        headers: Headers.empty,
        registrationOptionId: 'option-1',
        tenant: {
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Registration option mode is not available yet',
      );
      expect(updateOptionCounters).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'rejects when a concurrent registration appears inside the reservation transaction',
    () =>
      Effect.gen(function* () {
        const updateOptionCounters = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: (
            callback: (tx: {
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<{ id: string }[]>;
                };
              };
              update: ReturnType<typeof vi.fn>;
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              query: {
                eventRegistrations: {
                  findMany: () =>
                    Effect.succeed([{ id: 'concurrent-registration' }]),
                },
              },
              update: updateOptionCounters,
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('User is already registered for this event');
        expect(updateOptionCounters).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects when the transactional capacity counter update loses the race',
    () =>
      Effect.gen(function* () {
        const insertRegistration = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 9,
                  reservedSpots: 0,
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: (
            callback: (tx: {
              insert: ReturnType<typeof vi.fn>;
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              update: () => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: insertRegistration,
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([]),
                  }),
                }),
              }),
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Registration option has no available spots',
        );
        expect(insertRegistration).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'fails the reservation transaction when add-on stock is no longer available',
    () =>
      Effect.gen(function* () {
        let transactionFailed = false;
        const insertAddonPurchase = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: () =>
                    Effect.succeed([
                      {
                        addOnId: 'addon-1',
                        allowMultiple: false,
                        maxQuantityPerUser: 1,
                        price: 500,
                        quantity: 1,
                        stripeTaxRateId: null,
                        taxRateDisplayName: null,
                        taxRateInclusive: null,
                        taxRatePercentage: null,
                        title: 'Lunch',
                        totalAvailableQuantity: 1,
                      },
                    ]),
                }),
              }),
            }),
          }),
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  returning?: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              update: (table: unknown) => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<{ id: string }[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown, unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table !== eventRegistrations) {
                    insertAddonPurchase(value);
                    return {};
                  }

                  return {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  };
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              update: (table) => ({
                set: () => ({
                  where: () => ({
                    returning: () =>
                      Effect.succeed(
                        table === eventAddons ? [] : [{ id: 'option-1' }],
                      ),
                  }),
                }),
              }),
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  transactionFailed =
                    error instanceof EventRegistrationConflictError;
                }),
              ),
            ),
        };

        const program = EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          eventId: 'event-1',
          guestCount: 0,
          headers: Headers.empty,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase as never)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Add-on quantity is no longer available');
        expect(transactionFailed).toBe(true);
        expect(insertAddonPurchase).not.toHaveBeenCalled();
      }),
  );

  it.effect('joins the waitlist for a full public participant option', () =>
    Effect.gen(function* () {
      const insertWaitlistRegistration = vi.fn(() => ({
        values: vi.fn((values) => ({
          returning: vi.fn(() =>
            Effect.succeed([
              {
                id: values.status === 'WAITLIST' ? 'waitlist-1' : undefined,
              },
            ]),
          ),
        })),
      }));
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 10,
                organizingRegistration: false,
                roleIds: [],
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
        transaction: (
          callback: (tx: {
            insert: ReturnType<typeof vi.fn>;
            query: {
              eventRegistrations: {
                findMany: () => Effect.Effect<[]>;
              };
            };
            update: () => {
              set: (values: unknown) => {
                where: () => {
                  returning: () => Effect.Effect<{ id: string }[]>;
                };
              };
            };
          }) => Effect.Effect<unknown>,
        ) =>
          callback({
            insert: insertWaitlistRegistration,
            query: {
              eventRegistrations: {
                findMany: () => Effect.succeed([]),
              },
            },
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'option-1' }]),
                }),
              }),
            }),
          }),
      };

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: [],
        },
      }).pipe(
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provide(configProviderLayer),
      );

      yield* program;
      expect(insertWaitlistRegistration).toHaveBeenCalled();
    }),
  );

  it.effect('rejects waitlist joining while capacity remains', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                organizingRegistration: false,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Registration option still has available spots',
      );
    }),
  );

  it.effect('rejects waitlist joining for organizer/helper options', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 10,
                organizingRegistration: true,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Waitlist is only available for participant options',
      );
    }),
  );
});
