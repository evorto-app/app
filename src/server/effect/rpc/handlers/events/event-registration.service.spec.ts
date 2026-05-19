import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import Stripe from 'stripe';

import { Database } from '../../../../../db';
import { StripeClient } from '../../../../stripe-client';
import { EventRegistrationService } from './event-registration.service';

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
  price: 0,
  reservedSpots: 0,
  roleIds: ['role-1'],
  spots: 10,
  stripeTaxRateId: null,
} as const;

describe('EventRegistrationService', () => {
  it.effect('fails with conflict when user already has a registration', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
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
              price: true,
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
});
