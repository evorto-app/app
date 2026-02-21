import * as Headers from '@effect/platform/Headers';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { Database } from '../../../../../../db';
import { EventRegistrationService } from './event-registration.service';

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
    );

    const error = await Effect.runPromise(program);
    expect(error._tag).toBe('EventRegistrationConflictError');
  });
});
