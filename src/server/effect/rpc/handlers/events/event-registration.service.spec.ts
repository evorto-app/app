import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  emailOutbox,
  eventAddons,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  transactions,
} from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import {
  EventRegistrationService,
  isUserEligibleForRegistrationOption,
  validateRegistrationAddons,
  validateRegistrationQuestionAnswers,
} from './event-registration.service';
import { EventRegistrationConflictError } from './events.errors';

const stripeClient = new Stripe('sk_test_123');
const tenantPublicOrigin = {
  domain: 'tenant.example.com',
} as const;
const selectLockedTenantMembership = () => ({
  from: () => ({
    where: () => ({
      for: () => Effect.succeed([{ id: 'tenant-user-1' }]),
    }),
  }),
});
const configProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: Object.fromEntries([
      ['BASE_URL', 'https://app.example'],
      ['CLIENT_ID', 'client-id'],
      ['CLIENT_SECRET', 'client-secret'],
      ['DATABASE_URL', 'postgresql://db.example/app'],
      ['E2E_NOW_ISO', '2026-09-15T12:00:00.000Z'],
      ['ISSUER_BASE_URL', 'https://issuer.example'],
      ['RESEND_API_KEY', 're_test_123'],
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

const paidManualApprovalRegistration = {
  addonPurchases: [],
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  basePriceAtRegistration: null,
  discountAmount: null,
  event: {
    start: new Date('2026-09-18T10:00:00.000Z'),
    status: 'APPROVED',
    tenantId: 'tenant-1',
    title: 'Approved event',
  },
  eventId: 'event-1',
  guestCount: 0,
  id: 'registration-1',
  registrationOption: {
    eventId: 'event-1',
    id: 'option-1',
    isPaid: true,
    price: 1000,
    registrationMode: 'application',
    stripeTaxRateId: null,
  },
  registrationOptionId: 'option-1',
  status: 'PENDING',
  transactions: [],
  user: {
    communicationEmail: 'alice@example.com',
    email: 'alice@example.com',
  },
  userId: 'user-1',
} as const;

const createPaidManualApprovalDatabase = ({
  bindingSucceeds = true,
  operationOrder,
  registrationStatuses = ['PENDING'],
}: {
  bindingSucceeds?: boolean;
  operationOrder: string[];
  registrationStatuses?: readonly ('CANCELLED' | 'PENDING')[];
}) => {
  let registrationLockCount = 0;
  let transactionUpdateCount = 0;
  let optionUpdateCount = 0;
  const tx = {
    insert: (table: unknown) => ({
      values: () => {
        if (table === transactions) {
          operationOrder.push('claim');
          return Effect.succeed([]);
        }
        if (table === emailOutbox) {
          return {
            onConflictDoNothing: () => {
              operationOrder.push('email');
              return Effect.succeed([]);
            },
          };
        }
        return Effect.succeed([]);
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: () => {
            if (table === eventRegistrations) {
              const status =
                registrationStatuses[
                  Math.min(
                    registrationLockCount,
                    registrationStatuses.length - 1,
                  )
                ] ?? 'PENDING';
              registrationLockCount += 1;
              return Effect.succeed([{ status }]);
            }
            if (table === transactions) {
              return Effect.succeed([]);
            }
            return Effect.succeed([]);
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (table === eventRegistrationOptions) {
              optionUpdateCount += 1;
              if (optionUpdateCount > 1) {
                operationOrder.push('release-capacity');
              }
              return Effect.succeed([{ id: 'option-1' }]);
            }
            if (table === eventRegistrations) {
              return Effect.succeed([{ id: 'registration-1' }]);
            }
            if (table === transactions) {
              transactionUpdateCount += 1;
              if (transactionUpdateCount === 1) {
                operationOrder.push('bind');
                return Effect.succeed(
                  bindingSucceeds ? [{ id: 'transaction-1' }] : [],
                );
              }
              operationOrder.push('release-claim');
              return Effect.succeed([{ id: 'transaction-1' }]);
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
        findFirst: () => Effect.succeed(paidManualApprovalRegistration),
      },
      userDiscountCards: {
        findMany: () => Effect.succeed([]),
      },
    },
    transaction: (
      callback: (transaction: typeof tx) => Effect.Effect<unknown>,
    ) => callback(tx),
  };

  return database;
};

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
      quantity: 2,
      stripeTaxRateId: 'txr_1',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '19',
      title: 'Lunch',
      totalAvailableQuantity: 5,
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
          fulfilledQuantity: 4,
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
              totalAvailableQuantity: 3,
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
              answer: ' '.repeat(3),
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
    'rejects an invalid tenant domain before reading or writing registration data',
    () =>
      Effect.gen(function* () {
        const findRegistration = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrations: {
              findFirst: findRegistration,
            },
          },
        };

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com/path',
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Invalid tenant domain configuration');
        expect(findRegistration).not.toHaveBeenCalled();
      }),
  );

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
          registrationOptionId: 'organizer-option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
              select: typeof selectLockedTenantMembership;
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
              select: selectLockedTenantMembership,
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
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option mode is not supported');
      expect(updateOptionCounters).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'creates manual approval applications without reserving capacity',
    () =>
      Effect.gen(function* () {
        let insertedRegistration: unknown;
        const updateOptionCounters = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 10,
                  registrationMode: 'application',
                  reservedSpots: 0,
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  returning: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: ReturnType<typeof vi.fn>;
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table === eventRegistrations) {
                    insertedRegistration = value;
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
              select: selectLockedTenantMembership,
              update: updateOptionCounters,
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            status: 'PENDING',
          }),
        );
        expect(updateOptionCounters).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'fails paid manual approval before reserving capacity when Stripe is not configured',
    () =>
      Effect.gen(function* () {
        const transaction = vi.fn();
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () => Effect.succeed(paidManualApprovalRegistration),
            },
            userDiscountCards: {
              findMany: () => Effect.succeed([]),
            },
          },
          transaction,
        };

        const error = yield* EventRegistrationService.approveManualRegistration(
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: undefined,
            },
            user: { id: 'organizer-1' },
          },
        ).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Stripe account not found');
        expect(transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'persists a manual approval payment claim before creating and binding Stripe Checkout',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        let claimedTransaction: Record<string, unknown> | undefined;
        const tx = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                operationOrder.push('claim');
                claimedTransaction = values;
                return Effect.succeed([]);
              }
              if (table === emailOutbox) {
                return {
                  onConflictDoNothing: () => {
                    operationOrder.push('email');
                    return Effect.succeed([]);
                  },
                };
              }
              return Effect.succeed([]);
            },
          }),
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () =>
                  Effect.succeed(
                    table === eventRegistrations ? [{ status: 'PENDING' }] : [],
                  ),
              }),
            }),
          }),
          update: (table: unknown) => ({
            set: () => ({
              where: () => ({
                returning: () => {
                  if (table === transactions) {
                    operationOrder.push('bind');
                  }
                  return Effect.succeed([
                    {
                      id:
                        table === eventRegistrationOptions
                          ? 'option-1'
                          : table === eventRegistrations
                            ? 'registration-1'
                            : 'transaction-1',
                    },
                  ]);
                },
              }),
            }),
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () => Effect.succeed(paidManualApprovalRegistration),
            },
            userDiscountCards: {
              findMany: () => Effect.succeed([]),
            },
          },
          transaction: (
            callback: (transaction: typeof tx) => Effect.Effect<unknown>,
          ) => callback(tx),
        };
        const createSession = vi.fn(() => {
          operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_1',
            payment_intent: null,
            url: 'https://checkout.stripe.test/session',
          });
        });
        const checkoutStripeClient = new Stripe('sk_test_123');
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        yield* EventRegistrationService.approveManualRegistration({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(operationOrder).toEqual(['claim', 'stripe', 'bind', 'email']);
        expect(claimedTransaction).toEqual(
          expect.objectContaining({
            amount: 1000,
            eventRegistrationId: 'registration-1',
            method: 'stripe',
            status: 'pending',
            type: 'registration',
          }),
        );
        expect(claimedTransaction).not.toHaveProperty(
          'stripeCheckoutSessionId',
        );
        expect(createSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'expires checkout without binding or emailing when registration is cancelled before bind',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = createPaidManualApprovalDatabase({
          operationOrder,
          registrationStatuses: ['PENDING', 'CANCELLED'],
        });
        const checkoutStripeClient = new Stripe('sk_test_123');
        const createSession = vi.fn(() => {
          operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_1',
            payment_intent: null,
            url: 'https://checkout.stripe.test/session',
          });
        });
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve({ id: 'cs_test_1', status: 'expired' });
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(expireSession);

        const error = yield* EventRegistrationService.approveManualRegistration(
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          },
        ).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Registration is no longer awaiting payment',
        );
        expect(operationOrder).toEqual(['claim', 'stripe', 'expire']);
        expect(createSession).toHaveBeenCalledOnce();
        expect(expireSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'expires an unbound checkout before releasing its manual approval claim and capacity',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = createPaidManualApprovalDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = new Stripe('sk_test_123');
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.resolve({ id: 'cs_test_1', status: 'expired' });
          }),
        );

        const error = yield* EventRegistrationService.approveManualRegistration(
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          },
        ).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual([
          'claim',
          'stripe',
          'bind',
          'expire',
          'release-claim',
          'release-capacity',
        ]);
      }),
  );

  it.effect(
    'retains the approval claim when expiring an unbound checkout is ambiguous',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = createPaidManualApprovalDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = new Stripe('sk_test_123');
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
          }),
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.reject(new Error('Stripe expiry connection reset'));
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(expireSession);

        const error = yield* EventRegistrationService.approveManualRegistration(
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          },
        ).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual(['claim', 'stripe', 'bind', 'expire']);
        expect(expireSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'retains the payment claim when Stripe creation has an ambiguous failure',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = createPaidManualApprovalDatabase({ operationOrder });
        const checkoutStripeClient = new Stripe('sk_test_123');
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.reject(new Error('connection reset after request'));
          }),
        );
        const expire = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const error = yield* EventRegistrationService.approveManualRegistration(
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          },
        ).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to create stripe checkout session');
        expect(operationOrder).toEqual(['claim', 'stripe']);
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects new registrations when the tenant active registration limit is reached',
    () =>
      Effect.gen(function* () {
        const updateOptionCounters = vi.fn();
        let selectionCount = 0;
        const selectActiveFutureRegistrations = vi.fn(() => {
          selectionCount += 1;
          return selectionCount === 1
            ? selectLockedTenantMembership()
            : {
                from: () => ({
                  innerJoin: () => ({
                    where: () => ({
                      limit: () =>
                        Effect.succeed([
                          {
                            id: 'active-registration-1',
                          },
                        ]),
                    }),
                  }),
                }),
              };
        });
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
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectActiveFutureRegistrations;
              update: ReturnType<typeof vi.fn>;
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectActiveFutureRegistrations,
              update: updateOptionCounters,
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 1,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Active registration limit reached');
        expect(selectActiveFutureRegistrations).toHaveBeenCalled();
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
              select: typeof selectLockedTenantMembership;
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
              select: selectLockedTenantMembership,
              update: updateOptionCounters,
            }),
        };

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
              select: typeof selectLockedTenantMembership;
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
              select: selectLockedTenantMembership,
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
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
    'persists the configured add-on attachment quantity for a selected add-on',
    () =>
      Effect.gen(function* () {
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
                        price: 0,
                        quantity: 2,
                        stripeTaxRateId: null,
                        taxRateDisplayName: null,
                        taxRateInclusive: null,
                        taxRatePercentage: null,
                        title: 'Lunch',
                        totalAvailableQuantity: 2,
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
              select: typeof selectLockedTenantMembership;
              update: () => {
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
                  if (table === eventRegistrations) {
                    return {
                      returning: () =>
                        Effect.succeed([{ id: 'registration-1' }]),
                    };
                  }
                  if (table === eventRegistrationAddonPurchases) {
                    insertAddonPurchase(value);
                  }
                  return Effect.void;
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectLockedTenantMembership,
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([{ id: 'updated' }]),
                  }),
                }),
              }),
            }),
        };

        yield* EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(insertAddonPurchase).toHaveBeenCalledWith(
          expect.objectContaining({
            addonId: 'addon-1',
            quantity: 2,
            registrationId: 'registration-1',
          }),
        );
      }),
  );

  it.effect(
    'fails the reservation transaction when add-on stock is no longer available',
    () =>
      Effect.gen(function* () {
        let isTransactionFailed = false;
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
              select: typeof selectLockedTenantMembership;
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
              select: selectLockedTenantMembership,
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
                  isTransactionFailed =
                    error instanceof EventRegistrationConflictError;
                }),
              ),
            ),
        };

        const program = EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Add-on quantity is no longer available');
        expect(isTransactionFailed).toBe(true);
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
            select: typeof selectLockedTenantMembership;
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
            select: selectLockedTenantMembership,
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
