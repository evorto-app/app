import { describe, expect, it, vi } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

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
  canonicalRootUrl: `https://${id}.example.com`,
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

const createHeaders = (tenant = createTenant(), user = createUser()) =>
  Headers.fromInput({
    [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
    [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
    [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
  });

describe('discountHandlers', () => {
  it.effect('getMyCards reads discount cards for the current tenant', () =>
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
      }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

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
            tenantId: 'tenant-2',
            userId: 'user-1',
          },
        }),
      );
    }),
  );

  it.effect('upsertMyCard updates an existing tenant user card', () => {
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
      const updateSet = vi.fn(() => ({
        where: () => ({
          returning: () =>
            Effect.succeed([
              {
                id: 'card-1',
                identifier: 'ESN-123',
                status: 'verified' as const,
                type: 'esnCard' as const,
                validTo: new Date('2026-12-31T00:00:00.000Z'),
              },
            ]),
        }),
      }));
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
            set: updateSet,
          };
        }),
      };

      const card = yield* discountHandlers['discounts.upsertMyCard'](
        {
          identifier: 'ESN-123',
          type: 'esnCard',
        },
        { headers: createHeaders(createTenant('tenant-2')) },
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
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ESN-123',
          status: 'verified',
          validTo: new Date('2026-12-31T00:00:00.000Z'),
        }),
      );
      expect(findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            tenantId: 'tenant-2',
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
    'upsertMyCard reports provider outages without changing the stored card',
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
        const database = {
          insert: vi.fn(() => {
            throw new Error('Provider outages must not insert cards');
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
          update: vi.fn(() => {
            throw new Error('Provider outages must not update cards');
          }),
        };

        const error = yield* Effect.flip(
          discountHandlers['discounts.upsertMyCard'](
            {
              identifier: 'ESN-123',
              type: 'esnCard',
            },
            { headers: createHeaders(createTenant('tenant-2')) },
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
        expect(database.insert).not.toHaveBeenCalled();
        expect(database.update).not.toHaveBeenCalled();
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Adapters.esnCard = originalAdapter;
          }),
        ),
      );
    },
  );

  it.effect(
    'refreshMyCard revalidates and updates the current user card',
    () => {
      const originalAdapter = Adapters.esnCard;
      const validTo = new Date('2026-12-31T00:00:00.000Z');
      const validate = vi.fn(async () => ({
        metadata: { provider: 'esncard' },
        status: 'verified' as const,
        validTo,
      }));
      Adapters.esnCard = { validate };

      return Effect.gen(function* () {
        const card = {
          id: 'card-1',
          identifier: 'ESN-123',
          status: 'unverified' as const,
          type: 'esnCard' as const,
          validTo: null,
        };
        const updateSet = vi.fn(() => ({
          where: () => ({
            returning: () =>
              Effect.succeed([
                {
                  ...card,
                  status: 'verified' as const,
                  validTo,
                },
              ]),
          }),
        }));
        const findFirst = vi.fn(() => Effect.succeed(card));
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
              set: updateSet,
            };
          }),
        };

        const refreshed = yield* discountHandlers['discounts.refreshMyCard'](
          { type: 'esnCard' },
          { headers: createHeaders(createTenant('tenant-2')) },
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(refreshed).toEqual({
          id: 'card-1',
          identifier: 'ESN-123',
          status: 'verified',
          type: 'esnCard',
          validTo: '2026-12-31T00:00:00.000Z',
        });
        expect(findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              tenantId: 'tenant-2',
              type: 'esnCard',
              userId: 'user-1',
            },
          }),
        );
        expect(validate).toHaveBeenCalledWith({
          config: {},
          identifier: 'ESN-123',
        });
        expect(updateSet).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { provider: 'esncard' },
            status: 'verified',
            validTo,
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Adapters.esnCard = originalAdapter;
          }),
        ),
      );
    },
  );

  it.effect('deleteMyCard removes only the current user card type', () =>
    Effect.gen(function* () {
      const where = vi.fn(() => Effect.void);
      const database = {
        delete: vi.fn((table: unknown) => {
          expect(table).toBe(userDiscountCards);
          return { where };
        }),
      };

      yield* discountHandlers['discounts.deleteMyCard'](
        { type: 'esnCard' },
        {
          headers: createHeaders(createTenant('tenant-2')),
        },
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      const condition = where.mock.calls[0]?.[0];
      const collectValues = (value: unknown, seen = new WeakSet<object>()) => {
        if (value === null || value === undefined) return [];
        if (typeof value !== 'object') return [value];
        if (seen.has(value)) return [];
        seen.add(value);
        if (Array.isArray(value)) {
          return value.flatMap((item) => collectValues(item, seen));
        }
        return Object.values(value).flatMap((item) =>
          collectValues(item, seen),
        );
      };
      const conditionValues = collectValues(condition);

      expect(conditionValues).toContain('tenant-2');
      expect(conditionValues).toContain('user-1');
      expect(conditionValues).toContain('esnCard');
    }),
  );
});
