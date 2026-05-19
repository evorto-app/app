import { describe, expect, it, vi } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import { userDiscountCards } from '../../../../db/schema';
import {
  Adapters,
  ProviderValidationUnavailableError,
} from '../../../discounts/providers';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { discountHandlers } from './discounts.handlers';

const createTenant = (id = 'tenant-1') => ({
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'enabled' as const,
    },
  },
  domain: `${id}.example.com`,
  id,
  locale: 'en',
  name: id,
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
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: [] as string[],
  roleIds: [],
});

const createHeaders = (tenant = createTenant(), user = createUser()) => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
  [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
});

describe('discountHandlers', () => {
  it.effect('getMyCards reads discount cards globally for the user', () =>
    Effect.gen(function* () {
      const findMany = vi.fn(() =>
        Effect.succeed([
          {
            id: 'card-1',
            identifier: 'ESN-123',
            status: 'verified' as const,
            type: 'esnCard' as const,
            validTo: new Date('2026-12-31T00:00:00.000Z'),
          },
        ]),
      );
      const database = {
        query: {
          userDiscountCards: {
            findMany,
          },
        },
      };

      const cards = yield* discountHandlers['discounts.getMyCards'](undefined, {
        headers: createHeaders(createTenant('tenant-2')),
      } as never).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
      );

      expect(cards).toEqual([
        {
          id: 'card-1',
          identifier: 'ESN-123',
          status: 'verified',
          type: 'esnCard',
          validTo: '2026-12-31T00:00:00.000Z',
        },
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
          },
        }),
      );
    }),
  );

  it.effect('upsertMyCard updates an existing global user card', () => {
    const originalAdapter = Adapters.esnCard;
    const validate = vi.fn(async () => ({
      status: 'verified' as const,
      validTo: new Date('2026-12-31T00:00:00.000Z'),
    }));
    Adapters.esnCard = { validate };

    return Effect.gen(function* () {
      const findFirst = vi
        .fn()
        .mockReturnValueOnce(Effect.succeed({ userId: 'user-1' }))
        .mockReturnValueOnce(
          Effect.succeed({
            id: 'card-1',
            identifier: 'OLD-ESN',
            status: 'verified' as const,
            type: 'esnCard' as const,
            validTo: null,
          }),
        );
      const insertedValues = vi.fn(() => {
        throw new Error('Expected existing global card to be updated');
      });
      const updateReturning = vi
        .fn()
        .mockReturnValueOnce(
          Effect.succeed([
            {
              id: 'card-1',
              identifier: 'ESN-123',
              status: 'verified' as const,
              type: 'esnCard' as const,
              validTo: null,
            },
          ]),
        )
        .mockReturnValueOnce(
          Effect.succeed([
            {
              id: 'card-1',
              identifier: 'ESN-123',
              status: 'verified' as const,
              type: 'esnCard' as const,
              validTo: new Date('2026-12-31T00:00:00.000Z'),
            },
          ]),
        );
      const database = {
        insert: vi.fn((table: unknown) => {
          expect(table).toBe(userDiscountCards);
          return {
            values: insertedValues,
          };
        }),
        query: {
          tenants: {
            findFirst: () =>
              Effect.succeed({
                discountProviders: {
                  esnCard: {
                    config: {},
                    status: 'enabled',
                  },
                },
              }),
          },
          userDiscountCards: {
            findFirst,
          },
        },
        update: vi.fn((table: unknown) => {
          expect(table).toBe(userDiscountCards);
          return {
            set: () => ({
              where: () => ({
                returning: updateReturning,
              }),
            }),
          };
        }),
      };

      const card = yield* discountHandlers['discounts.upsertMyCard'](
        {
          identifier: 'ESN-123',
          type: 'esnCard',
        },
        { headers: createHeaders(createTenant('tenant-2')) } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(card).toEqual({
        id: 'card-1',
        identifier: 'ESN-123',
        status: 'verified',
        type: 'esnCard',
        validTo: '2026-12-31T00:00:00.000Z',
      });
      expect(insertedValues).not.toHaveBeenCalled();
      expect(validate).toHaveBeenCalledWith({
        config: {},
        identifier: 'ESN-123',
      });
      expect(findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            type: 'esnCard',
            userId: 'user-1',
          },
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          Adapters.esnCard = originalAdapter;
        }),
      ),
    );
  });

  it.effect(
    'upsertMyCard reports provider outages as retryable validation errors',
    () => {
      const originalAdapter = Adapters.esnCard;
      const validate = vi.fn(async () => {
        throw new ProviderValidationUnavailableError(
          'ESNcard validation provider is unavailable',
          'unavailable',
        );
      });
      Adapters.esnCard = { validate };

      return Effect.gen(function* () {
        const findFirst = vi
          .fn()
          .mockReturnValueOnce(Effect.succeed({ userId: 'user-1' }))
          .mockReturnValueOnce(
            Effect.succeed({
              id: 'card-1',
              identifier: 'OLD-ESN',
              status: 'verified' as const,
              type: 'esnCard' as const,
              validTo: null,
            }),
          );
        const updateReturning = vi.fn().mockReturnValueOnce(
          Effect.succeed([
            {
              id: 'card-1',
              identifier: 'ESN-123',
              status: 'verified' as const,
              type: 'esnCard' as const,
              validTo: null,
            },
          ]),
        );
        const database = {
          query: {
            tenants: {
              findFirst: () =>
                Effect.succeed({
                  discountProviders: {
                    esnCard: {
                      config: {},
                      status: 'enabled',
                    },
                  },
                }),
            },
            userDiscountCards: {
              findFirst,
            },
          },
          update: vi.fn((table: unknown) => {
            expect(table).toBe(userDiscountCards);
            return {
              set: () => ({
                where: () => ({
                  returning: updateReturning,
                }),
              }),
            };
          }),
        };

        const error = yield* Effect.flip(
          discountHandlers['discounts.upsertMyCard'](
            {
              identifier: 'ESN-123',
              type: 'esnCard',
            },
            { headers: createHeaders(createTenant('tenant-2')) } as never,
          ).pipe(Effect.provide(Layer.succeed(Database, database as never))),
        );

        expect(error).toBeInstanceOf(RpcBadRequestError);
        expect(error).toMatchObject({
          message: 'Could not validate ESN card right now. Try again later.',
          reason: 'provider-unavailable',
        });
        expect(validate).toHaveBeenCalledWith({
          config: {},
          identifier: 'ESN-123',
        });
        expect(updateReturning).toHaveBeenCalledTimes(1);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Adapters.esnCard = originalAdapter;
          }),
        ),
      );
    },
  );
});
