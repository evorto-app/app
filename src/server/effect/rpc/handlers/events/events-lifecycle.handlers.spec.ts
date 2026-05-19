import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { vi } from 'vitest';

import { Database } from '../../../../../db';
import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
} from '../../../../../db/schema';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import { eventLifecycleHandlers } from './events-lifecycle.handlers';

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

const user = {
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: ['events:create'],
  roleIds: [],
};

const requestContext = {
  authData: {},
  authenticated: true,
  permissions: ['events:create'],
  tenant,
  user,
  userAssigned: true,
} satisfies RpcRequestContextShape;

const requestContextLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, requestContext),
);

const createInput = {
  description: '<p>Useful event description</p>',
  end: '2026-09-20T12:00:00.000Z',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  registrationOptions: [
    {
      closeRegistrationTime: '2026-09-19T12:00:00.000Z',
      description: null,
      isPaid: false,
      openRegistrationTime: '2026-09-01T12:00:00.000Z',
      organizingRegistration: false,
      price: 0,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: ['role-1'],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Participant',
    },
  ],
  start: '2026-09-20T10:00:00.000Z',
  templateId: 'template-1',
  title: 'Event',
};

const updateInput = {
  ...createInput,
  eventId: 'event-1',
  location: null,
  registrationOptions: createInput.registrationOptions.map((option) => ({
    ...option,
    id: 'option-1',
  })),
};

describe('eventLifecycleHandlers', () => {
  it.effect('events.create rejects an event end before its start', () =>
    Effect.gen(function* () {
      const error = yield* eventLifecycleHandlers['events.create'](
        {
          ...createInput,
          end: '2026-09-20T09:00:00.000Z',
        },
        { headers: {} } as never,
      ).pipe(Effect.flip, Effect.provide(requestContextLayer));

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('invalidDates');
    }),
  );

  it.effect(
    'events.create rejects a registration window that closes before it opens',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                closeRegistrationTime: '2026-09-01T12:00:00.000Z',
                openRegistrationTime: '2026-09-19T12:00:00.000Z',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidRegistrationOptionTimes');
      }),
  );

  it.effect(
    'events.update rejects an event end before its start before loading the event',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
            end: '2026-09-20T09:00:00.000Z',
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidDates');
      }),
  );

  it.effect(
    'events.update rejects a registration window that closes before it opens before loading the event',
    () =>
      Effect.gen(function* () {
        const error = yield* eventLifecycleHandlers['events.update'](
          {
            ...updateInput,
            registrationOptions: [
              {
                ...updateInput.registrationOptions[0],
                closeRegistrationTime: '2026-09-01T12:00:00.000Z',
                openRegistrationTime: '2026-09-19T12:00:00.000Z',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.flip, Effect.provide(requestContextLayer));

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toBe('invalidRegistrationOptionTimes');
      }),
  );

  it.effect(
    'events.create copies template discounts by source option id when option titles match',
    () =>
      Effect.gen(function* () {
        const insertedDiscountValues = vi.fn(() => Effect.succeed());
        const database = {
          insert: vi.fn((table) => {
            if (table === eventInstances) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-1',
                      },
                    ]),
                  ),
                })),
              };
            }

            if (table === eventRegistrationOptions) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn(() =>
                    Effect.succeed([
                      {
                        id: 'event-option-1',
                      },
                      {
                        id: 'event-option-2',
                      },
                    ]),
                  ),
                })),
              };
            }

            if (table === eventRegistrationOptionDiscounts) {
              return {
                values: insertedDiscountValues,
              };
            }

            throw new Error('Unexpected insert table');
          }),
          query: {
            eventTemplates: {
              findFirst: vi.fn(() =>
                Effect.succeed({
                  unlisted: false,
                }),
              ),
            },
            templateRegistrationOptions: {
              findMany: vi.fn(() =>
                Effect.succeed([
                  {
                    id: 'template-option-1',
                  },
                  {
                    id: 'template-option-2',
                  },
                ]),
              ),
            },
          },
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() =>
                Effect.succeed([
                  {
                    discountedPrice: 500,
                    discountType: 'esnCard' as const,
                    registrationOptionId: 'template-option-2',
                  },
                ]),
              ),
            })),
          })),
        };
        const layer = Layer.mergeAll(
          requestContextLayer,
          Layer.succeed(Database, database as never),
        );

        const result = yield* eventLifecycleHandlers['events.create'](
          {
            ...createInput,
            registrationOptions: [
              {
                ...createInput.registrationOptions[0],
                sourceTemplateRegistrationOptionId: 'template-option-1',
                title: 'Duplicate',
              },
              {
                ...createInput.registrationOptions[0],
                sourceTemplateRegistrationOptionId: 'template-option-2',
                title: 'Duplicate',
              },
            ],
          },
          { headers: {} } as never,
        ).pipe(Effect.provide(layer));

        expect(result).toEqual({ id: 'event-1' });
        expect(insertedDiscountValues).toHaveBeenCalledWith([
          {
            discountedPrice: 500,
            discountType: 'esnCard',
            registrationOptionId: 'event-option-2',
          },
        ]);
      }),
  );
});
