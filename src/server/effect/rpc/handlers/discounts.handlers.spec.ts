import type { DiscountsCardMutationError } from '@shared/rpc-contracts/app-rpcs/discounts.errors';

import { expect, layer, vi } from '@effect/vitest';
import { createDatabaseTestLayer } from '@server/testing/database-test-layer';
import {
  RpcBadRequestError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import { Database } from '../../../../db';
import { userDiscountCards } from '../../../../db/schema';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import * as DiscountRpcs from '../../../../shared/rpc-contracts/app-rpcs/discounts.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import {
  Adapters,
  ProviderValidationUnavailableError,
} from '../../../discounts/providers';
import { discountHandlers } from './discounts.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const createTenant = (id = 'tenant-1') =>
  Schema.decodeUnknownSync(Tenant)({
    cancellationDeadlineHoursBeforeStart: 120,
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
    maxActiveRegistrationsPerUser: 0,
    name: id,
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['NL'],
    },
    refundFeesOnCancellation: true,
    stripeAccountId: null,
    theme: 'evorto' as const,
    timezone: 'Europe/Amsterdam',
    transferDeadlineHoursBeforeStart: 0,
  });

const createUser = () =>
  Schema.decodeUnknownSync(User)({
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

const createRpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

const discountRequestContext = {
  authData: {},
  authenticated: true,
  permissions: [],
  platformAuthority: null,
  tenant: createTenant('tenant-2'),
  user: createUser(),
  userAssigned: true,
} satisfies RpcRequestContextShape;

const discountHandlerLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, discountRequestContext),
);

layer(discountHandlerLayer)('discountHandlers', (it) => {
  const tenantProviderOperations: {
    name: string;
    run: () => Effect.Effect<
      void,
      DiscountsCardMutationError,
      Database | RpcAccess
    >;
  }[] = [
    {
      name: 'getTenantProviders',
      run: () =>
        discountHandlers['discounts.getTenantProviders'](
          undefined,
          createRpcOptions(
            DiscountRpcs.DiscountsGetTenantProviders.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(Effect.asVoid),
    },
    {
      name: 'refreshMyCard',
      run: () =>
        discountHandlers['discounts.refreshMyCard'](
          { type: 'esnCard' },
          createRpcOptions(
            DiscountRpcs.DiscountsRefreshMyCard.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(Effect.asVoid),
    },
    {
      name: 'upsertMyCard',
      run: () =>
        discountHandlers['discounts.upsertMyCard'](
          { identifier: 'ESN-123', type: 'esnCard' },
          createRpcOptions(
            DiscountRpcs.DiscountsUpsertMyCard.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(Effect.asVoid),
    },
  ];

  for (const operation of tenantProviderOperations) {
    it.effect(
      `${operation.name} rejects a missing tenant before reading cards or invoking a provider`,
      () =>
        Effect.gen(function* () {
          const executeValues = vi.fn(
            (statement: string, parameters: readonly unknown[]) =>
              Effect.sync(() => {
                expect(statement).toContain('from "tenants"');
                expect(parameters).toContain('tenant-2');
                return [];
              }),
          );
          const error = yield* operation
            .run()
            .pipe(
              Effect.provide(createDatabaseTestLayer(executeValues)),
              Effect.flip,
            );
          expect(error).toBeInstanceOf(RpcUnauthorizedError);
          expect(error.message).toBe('Tenant context is no longer available');
          expect(executeValues).toHaveBeenCalledTimes(1);
        }),
    );

    for (const discountProviders of [
      null,
      {},
      { esnCard: { config: {}, status: 'invalid' } },
    ]) {
      it.effect(
        `${operation.name} preserves invalid persisted provider settings as a schema defect: ${JSON.stringify(discountProviders)}`,
        () =>
          Effect.gen(function* () {
            const executeValues = vi.fn((statement: string) =>
              Effect.sync(() => {
                expect(statement).toContain('from "tenants"');
                return [[discountProviders]];
              }),
            );
            const exit = yield* operation
              .run()
              .pipe(
                Effect.provide(createDatabaseTestLayer(executeValues)),
                Effect.exit,
              );
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isSuccess(exit))
              throw new Error('Expected persisted settings to fail validation');
            expect(Cause.hasDies(exit.cause)).toBe(true);
            const defect = exit.cause.reasons.find((reason) =>
              Cause.isDieReason(reason),
            );
            expect(defect).toBeDefined();
            if (!defect) throw new Error('Expected a schema defect');
            expect(Schema.isSchemaError(defect.defect)).toBe(true);
            expect(executeValues).toHaveBeenCalledTimes(1);
          }),
      );
    }
  }

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

      const cards = yield* discountHandlers['discounts.getMyCards'](
        undefined,
        createRpcOptions(
          DiscountRpcs.DiscountsGetMyCards.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

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

  it.effect('upsertMyCard returns an expired provider state', () => {
    const originalAdapter = Adapters.esnCard;
    const validate = vi.fn(async () => ({
      status: 'expired' as const,
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
                status: 'expired' as const,
                type: 'esnCard' as const,
                validTo: null,
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
        createRpcOptions(
          DiscountRpcs.DiscountsUpsertMyCard.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(card).toEqual({
        id: 'card-1',
        identifier: 'ESN-123',
        status: 'expired',
        type: 'esnCard',
        validTo: null,
      });
      expect(insertedValues).not.toHaveBeenCalled();
      expect(validate).toHaveBeenCalledWith({
        config: {},
        identifier: 'ESN-123',
      });
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ESN-123',
          status: 'expired',
          validTo: undefined,
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
          if (originalAdapter) Adapters.esnCard = originalAdapter;
          else delete Adapters.esnCard;
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
            createRpcOptions(
              DiscountRpcs.DiscountsUpsertMyCard.middleware(
                RpcRequestContextMiddleware,
              ),
            ),
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
            if (originalAdapter) Adapters.esnCard = originalAdapter;
            else delete Adapters.esnCard;
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
          createRpcOptions(
            DiscountRpcs.DiscountsRefreshMyCard.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
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
            if (originalAdapter) Adapters.esnCard = originalAdapter;
            else delete Adapters.esnCard;
          }),
        ),
      );
    },
  );

  it.effect('deleteMyCard removes only the current user card type', () =>
    Effect.gen(function* () {
      const where = vi.fn((_condition: unknown) => Effect.void);
      const database = {
        delete: vi.fn((table: unknown) => {
          expect(table).toBe(userDiscountCards);
          return { where };
        }),
      };

      yield* discountHandlers['discounts.deleteMyCard'](
        { type: 'esnCard' },
        createRpcOptions(
          DiscountRpcs.DiscountsDeleteMyCard.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      const condition = where.mock.calls[0]?.[0];
      const collectValues = (
        value: unknown,
        seen = new WeakSet<object>(),
      ): unknown[] => {
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
