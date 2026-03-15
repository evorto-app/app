import * as Headers from '@effect/platform/Headers';
import { ConfigProvider, Effect, Layer } from 'effect';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import { Database } from '../../../../../db';
import { RuntimeConfig } from '../../../../config/runtime-config';
import { StripeClient } from '../../../../stripe-client';
import { EventRegistrationService } from './event-registration.service';

const stripeClient = new Stripe('sk_test_123');
const runtimeConfigLayer = RuntimeConfig.Default.pipe(
  Layer.provide(
    Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([
          ['BASE_URL', 'https://app.example'],
          ['CLIENT_ID', 'client-id'],
          ['CLIENT_SECRET', 'client-secret'],
          ['DATABASE_URL', 'postgresql://db.example/app'],
          ['ISSUER_BASE_URL', 'https://issuer.example'],
          ['SECRET', 'secret'],
        ]),
      ),
    ),
  ),
);

describe('EventRegistrationService', () => {
  it('fails with conflict when user already has a registration', async () => {
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
      },
    }).pipe(
      Effect.flip,
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(Layer.succeed(Database, mockDatabase as never)),
      Effect.provideService(StripeClient, stripeClient),
      Effect.provide(runtimeConfigLayer),
    );

    const error = await Effect.runPromise(program);
    expect(error['_tag']).toBe('EventRegistrationConflictError');
  });

  it('queries registration options with explicit projection columns', async () => {
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
      },
    }).pipe(
      Effect.flip,
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(Layer.succeed(Database, mockDatabase as never)),
      Effect.provideService(StripeClient, stripeClient),
      Effect.provide(runtimeConfigLayer),
    );

    const error = await Effect.runPromise(program);
    expect(error['_tag']).toBe('EventRegistrationNotFoundError');
    expect(findRegistrationOption).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.objectContaining({
          confirmedSpots: true,
          eventId: true,
          id: true,
          isPaid: true,
          price: true,
          reservedSpots: true,
          spots: true,
          stripeTaxRateId: true,
        }),
      }),
    );
  });
});
