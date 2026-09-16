import type { DiscountsCardMutationError } from '@shared/rpc-contracts/app-rpcs/discounts.errors';
import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { expect, layer, vi } from '@effect/vitest';
import { createDatabaseTestLayer } from '@server/testing/database-test-layer';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Cause, Effect, Exit, Layer, Result, Schema, Stream } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import {
  ConstraintError,
  SqlError,
  UniqueViolation,
} from 'effect/unstable/sql/SqlError';

import { Database } from '../../../../db';
import { relations } from '../../../../db/relations';
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
  type ProviderAdapter,
  ProviderValidationUnavailableError,
  type ValidationResult,
} from '../../../discounts/providers';
import { discountHandlers } from './discounts.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const createTenant = (id = 'tenant-1') =>
  Schema.decodeUnknownSync(Tenant)({
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: {
      esnCard: {
        config: {},
        status: 'enabled',
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
    theme: 'evorto',
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
    permissions: [],
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

type StoredCard = Pick<
  typeof userDiscountCards.$inferSelect,
  | 'id'
  | 'identifier'
  | 'lastCheckedAt'
  | 'metadata'
  | 'status'
  | 'tenantId'
  | 'type'
  | 'userId'
  | 'validFrom'
  | 'validTo'
>;

const createCard = (overrides: Partial<StoredCard> = {}): StoredCard => ({
  id: 'card-1',
  identifier: 'ESN-123',
  lastCheckedAt: null,
  metadata: { provider: 'saved' },
  status: 'unverified',
  tenantId: 'tenant-2',
  type: 'esnCard',
  userId: 'user-1',
  validFrom: null,
  validTo: null,
  ...overrides,
});

const validFrom = new Date('2026-01-01T00:00:00.000Z');
const validTo = new Date('2026-12-31T00:00:00.000Z');
const verifiedResult = {
  metadata: { provider: 'esncard' },
  status: 'verified',
  validFrom,
  validTo,
} satisfies ValidationResult;

const tenantReadSql =
  'select "d0"."discount_providers" as "discountProviders" from "tenants" as "d0" where "d0"."id" = $1 limit $2';
const cardProjectionSql =
  'select "d0"."id" as "id", "d0"."identifier" as "identifier", "d0"."status" as "status", "d0"."type" as "type", "d0"."validTo"::text as "validTo" from "user_discount_cards" as "d0"';
const cardListSql = `${cardProjectionSql} where (("d0"."tenantId" = $1) and ("d0"."userId" = $2))`;
const currentCardSql = `${cardProjectionSql} where (("d0"."tenantId" = $1) and ("d0"."type" = $2) and ("d0"."userId" = $3)) limit $4`;
const identifierOwnerSql =
  'select "d0"."userId" as "userId" from "user_discount_cards" as "d0" where (("d0"."identifier" = $1) and ("d0"."tenantId" = $2) and ("d0"."type" = $3)) limit $4';
const cardReturningSql =
  'returning "id", "identifier", "status", "type", "validTo"::text';
const upsertUpdateSql = `update "user_discount_cards" set "updatedAt" = $1, "identifier" = $2, "lastCheckedAt" = $3, "metadata" = $4, "status" = $5, "validFrom" = $6, "validTo" = $7 where "user_discount_cards"."id" = $8 ${cardReturningSql}`;
const guardedUpsertUpdateSql = `update "user_discount_cards" set "updatedAt" = $1, "identifier" = $2, "lastCheckedAt" = $3, "metadata" = $4, "status" = $5, "validFrom" = $6, "validTo" = $7 where (("user_discount_cards"."id" = $8) and ("user_discount_cards"."tenantId" = $9) and ("user_discount_cards"."userId" = $10) and ("user_discount_cards"."type" = $11) and ("user_discount_cards"."identifier" = $12)) ${cardReturningSql}`;
const partialUpsertUpdateSql = `update "user_discount_cards" set "updatedAt" = $1, "identifier" = $2, "lastCheckedAt" = $3, "status" = $4 where "user_discount_cards"."id" = $5 ${cardReturningSql}`;
const partialRefreshUpdateSql = `update "user_discount_cards" set "updatedAt" = $1, "lastCheckedAt" = $2, "status" = $3 where (("user_discount_cards"."id" = $4) and ("user_discount_cards"."tenantId" = $5) and ("user_discount_cards"."userId" = $6) and ("user_discount_cards"."type" = $7) and ("user_discount_cards"."identifier" = $8)) ${cardReturningSql}`;
const refreshUpdateSql = `update "user_discount_cards" set "updatedAt" = $1, "lastCheckedAt" = $2, "metadata" = $3, "status" = $4, "validFrom" = $5, "validTo" = $6 where (("user_discount_cards"."id" = $7) and ("user_discount_cards"."tenantId" = $8) and ("user_discount_cards"."userId" = $9) and ("user_discount_cards"."type" = $10) and ("user_discount_cards"."identifier" = $11)) ${cardReturningSql}`;
const insertCardSql = `insert into "user_discount_cards" ("createdAt", "id", "updatedAt", "identifier", "lastCheckedAt", "metadata", "status", "tenantId", "type", "userId", "validFrom", "validTo") values (default, $1, default, $2, $3, $4, $5, $6, $7, $8, $9, $10) ${cardReturningSql}`;
const deleteCardSql =
  'delete from "user_discount_cards" where (("user_discount_cards"."tenantId" = $1) and ("user_discount_cards"."userId" = $2) and ("user_discount_cards"."type" = $3))';

const decodeString = Schema.decodeUnknownSync(Schema.NonEmptyString);
const decodeStatus = Schema.decodeUnknownSync(
  Schema.Literals(['expired', 'invalid', 'unverified', 'verified']),
);
const decodeMetadata = Schema.decodeUnknownSync(
  Schema.NullOr(
    Schema.fromJsonString(Schema.Struct({ provider: Schema.String })),
  ),
);
const decodeTimestamp = (value: unknown): Date => {
  const date = new Date(decodeString(value));
  expect(Number.isNaN(date.getTime())).toBe(false);
  return date;
};
const decodeNullableTimestamp = (value: unknown) =>
  value === null ? null : decodeTimestamp(value);
const cardRow = (card: StoredCard) => [
  card.id,
  card.identifier,
  card.status,
  card.type,
  card.validTo?.toISOString().replace('Z', '') ?? null,
];

const createDiscountDatabase = ({
  concurrentCard,
  initialCards = [],
  providerStatus = 'enabled',
  writeFailure,
}: {
  concurrentCard?: StoredCard;
  initialCards?: StoredCard[];
  providerStatus?: 'disabled' | 'enabled';
  writeFailure?: SqlError;
} = {}) => {
  let cards = initialCards.map((card) => ({ ...card }));
  const operations: string[] = [];

  const readTenantProviders = (parameters: readonly unknown[]) => {
    operations.push('readTenantProviders');
    expect(parameters).toEqual(['tenant-2', 1]);
    return [[{ esnCard: { config: {}, status: providerStatus } }]];
  };
  const readCardList = (parameters: readonly unknown[]) => {
    operations.push('readCardList');
    expect(parameters).toEqual(['tenant-2', 'user-1']);
    return cards
      .filter(
        (card) =>
          card.tenantId === parameters[0] && card.userId === parameters[1],
      )
      .map((card) => cardRow(card));
  };
  const readCurrentCard = (parameters: readonly unknown[]) => {
    operations.push('readCurrentCard');
    expect(parameters).toEqual(['tenant-2', 'esnCard', 'user-1', 1]);
    const card = cards.find(
      (candidate) =>
        candidate.tenantId === parameters[0] &&
        candidate.type === parameters[1] &&
        candidate.userId === parameters[2],
    );
    return card ? [cardRow(card)] : [];
  };
  const readIdentifierOwner = (parameters: readonly unknown[]) => {
    operations.push('readIdentifierOwner');
    expect(parameters).toEqual(['ESN-123', 'tenant-2', 'esnCard', 1]);
    const card = cards.find(
      (candidate) =>
        candidate.identifier === parameters[0] &&
        candidate.tenantId === parameters[1] &&
        candidate.type === parameters[2],
    );
    return card ? [[card.userId]] : [];
  };
  const updateExistingCard = (parameters: readonly unknown[]) => {
    operations.push('updateExistingCard');
    expect([8, 12]).toContain(parameters.length);
    decodeTimestamp(parameters[0]);
    expect(parameters[1]).toBe('ESN-123');
    expect(parameters[7]).toBe('card-1');
    if (parameters.length === 12) {
      expect(parameters.slice(8)).toEqual([
        'tenant-2',
        'user-1',
        'esnCard',
        initialCards.find((card) => card.id === 'card-1')?.identifier,
      ]);
    }
    const card = cards.find(
      (candidate) =>
        candidate.id === parameters[7] &&
        (parameters.length === 8 ||
          (candidate.tenantId === parameters[8] &&
            candidate.userId === parameters[9] &&
            candidate.type === parameters[10] &&
            candidate.identifier === parameters[11])),
    );
    if (!card) return [];
    const updated = {
      ...card,
      identifier: decodeString(parameters[1]),
      lastCheckedAt: decodeTimestamp(parameters[2]),
      metadata: decodeMetadata(parameters[3]),
      status: decodeStatus(parameters[4]),
      validFrom: decodeNullableTimestamp(parameters[5]),
      validTo: decodeNullableTimestamp(parameters[6]),
    };
    cards = cards.map((candidate) =>
      candidate.id === card.id ? updated : candidate,
    );
    return [cardRow(updated)];
  };
  const refreshOriginalCard = (parameters: readonly unknown[]) => {
    operations.push('refreshOriginalCard');
    expect(parameters).toHaveLength(11);
    decodeTimestamp(parameters[0]);
    const fields = {
      lastCheckedAt: decodeTimestamp(parameters[1]),
      metadata: decodeMetadata(parameters[2]),
      status: decodeStatus(parameters[3]),
      validFrom: decodeNullableTimestamp(parameters[4]),
      validTo: decodeNullableTimestamp(parameters[5]),
    };
    expect(parameters.slice(6)).toEqual([
      'card-1',
      'tenant-2',
      'user-1',
      'esnCard',
      'ESN-123',
    ]);
    const original = cards.find(
      (card) =>
        card.id === parameters[6] &&
        card.tenantId === parameters[7] &&
        card.userId === parameters[8] &&
        card.type === parameters[9] &&
        card.identifier === parameters[10],
    );
    if (!original) return [];
    const refreshed = { ...original, ...fields };
    cards = cards.map((card) => (card.id === original.id ? refreshed : card));
    return [cardRow(refreshed)];
  };
  const insertNewCard = (parameters: readonly unknown[]) => {
    operations.push('insertNewCard');
    expect(parameters).toHaveLength(10);
    expect(parameters.slice(5, 8)).toEqual(['tenant-2', 'esnCard', 'user-1']);
    const card = createCard({
      id: decodeString(parameters[0]),
      identifier: decodeString(parameters[1]),
      lastCheckedAt: decodeTimestamp(parameters[2]),
      metadata: decodeMetadata(parameters[3]),
      status: decodeStatus(parameters[4]),
      tenantId: decodeString(parameters[5]),
      userId: decodeString(parameters[7]),
      validFrom: decodeNullableTimestamp(parameters[8]),
      validTo: decodeNullableTimestamp(parameters[9]),
    });
    cards.push(card);
    return [cardRow(card)];
  };
  const deleteCurrentCard = (parameters: readonly unknown[]) => {
    operations.push('deleteCurrentCard');
    expect(parameters).toEqual(['tenant-2', 'user-1', 'esnCard']);
    cards = cards.filter(
      (card) =>
        card.tenantId !== parameters[0] ||
        card.userId !== parameters[1] ||
        card.type !== parameters[2],
    );
    return [];
  };

  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.suspend(() => {
      if (
        writeFailure &&
        (statement === guardedUpsertUpdateSql || statement === insertCardSql)
      ) {
        if (concurrentCard) cards.push(concurrentCard);
        return Effect.fail(writeFailure);
      }
      return Effect.sync(() => {
        switch (statement) {
          case cardListSql: {
            return readCardList(parameters);
          }
          case currentCardSql: {
            return readCurrentCard(parameters);
          }
          case guardedUpsertUpdateSql:
          case upsertUpdateSql: {
            return updateExistingCard(parameters);
          }
          case identifierOwnerSql: {
            return readIdentifierOwner(parameters);
          }
          case insertCardSql: {
            return insertNewCard(parameters);
          }
          // Model omitted SQL columns as retained fields so stale-data regressions
          // fail on persisted state instead of only on a changed SQL string.
          case partialRefreshUpdateSql:
          case partialUpsertUpdateSql: {
            const saving = statement === partialUpsertUpdateSql;
            operations.push(
              saving ? 'updateExistingCard' : 'refreshOriginalCard',
            );
            const card = cards.find(
              (candidate) =>
                candidate.id === parameters[saving ? 4 : 3] &&
                (saving ||
                  (candidate.tenantId === parameters[4] &&
                    candidate.userId === parameters[5] &&
                    candidate.type === parameters[6] &&
                    candidate.identifier === parameters[7])),
            );
            if (!card) return [];
            const updated = {
              ...card,
              ...(saving && { identifier: decodeString(parameters[1]) }),
              lastCheckedAt: decodeTimestamp(parameters[saving ? 2 : 1]),
              status: decodeStatus(parameters[saving ? 3 : 2]),
            };
            cards = cards.map((candidate) =>
              candidate.id === card.id ? updated : candidate,
            );
            return [cardRow(updated)];
          }
          case refreshUpdateSql: {
            return refreshOriginalCard(parameters);
          }
          case tenantReadSql: {
            return readTenantProviders(parameters);
          }
          default: {
            throw new Error(`Unexpected discount card SQL: ${statement}`);
          }
        }
      });
    });
  const unexpectedDatabaseAccess = Effect.die(
    new Error('Unexpected discount card database operation'),
  );
  const connection = {
    execute: () => unexpectedDatabaseAccess,
    executeRaw: (statement, parameters) =>
      Effect.sync(() => {
        expect(statement).toBe(deleteCardSql);
        return deleteCurrentCard(parameters);
      }),
    executeStream: () =>
      Stream.die(new Error('Unexpected discount card query stream')),
    executeUnprepared: () => unexpectedDatabaseAccess,
    executeValues,
    executeValuesUnprepared: () => unexpectedDatabaseAccess,
  } satisfies SqlConnection.Connection;
  const databaseLayer = Layer.effect(
    Database,
    PgDrizzle.makeWithDefaults({ relations }),
  ).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.makeWith({
          acquirer: Effect.succeed(connection),
          config: {},
          listenAcquirer: unexpectedDatabaseAccess,
          transactionAcquirer: unexpectedDatabaseAccess,
        }),
      ),
    ),
  );

  return {
    databaseLayer,
    getCards: () => cards.map((card) => ({ ...card })),
    operations,
    removeOriginalCard: () => {
      cards = cards.filter((card) => card.id !== 'card-1');
    },
    replaceOriginalCard: () => {
      cards = cards.map((card) =>
        card.id === 'card-1' ? { ...card, identifier: 'ESN-456' } : card,
      );
    },
  };
};

const withEsnCardAdapter = <A, E, R>(
  validate: ProviderAdapter['validate'],
  operation: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = Adapters.esnCard;
      Adapters.esnCard = { validate };
      return original;
    }),
    () => operation,
    (original) =>
      Effect.sync(() => {
        Adapters.esnCard = original;
      }),
  );

const getMyCards = () =>
  discountHandlers['discounts.getMyCards'](
    undefined,
    createRpcOptions(
      DiscountRpcs.DiscountsGetMyCards.middleware(RpcRequestContextMiddleware),
    ),
  );
const upsertMyCard = () =>
  discountHandlers['discounts.upsertMyCard'](
    { identifier: 'ESN-123', type: 'esnCard' },
    createRpcOptions(
      DiscountRpcs.DiscountsUpsertMyCard.middleware(
        RpcRequestContextMiddleware,
      ),
    ),
  );
const refreshMyCard = () =>
  discountHandlers['discounts.refreshMyCard'](
    { type: 'esnCard' },
    createRpcOptions(
      DiscountRpcs.DiscountsRefreshMyCard.middleware(
        RpcRequestContextMiddleware,
      ),
    ),
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
          expect(error.message).toBe(
            'Organization context is no longer available',
          );
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
      const fixture = createDiscountDatabase({
        initialCards: [
          createCard({ status: 'verified', validFrom, validTo }),
          createCard({ id: 'other-tenant', tenantId: 'tenant-1' }),
          createCard({ id: 'other-user', userId: 'user-2' }),
        ],
      });
      const cards = yield* getMyCards().pipe(
        Effect.provide(fixture.databaseLayer),
      );
      expect(cards).toEqual([
        {
          id: 'card-1',
          identifier: 'ESN-123',
          status: 'verified',
          type: 'esnCard',
          validTo: validTo.toISOString(),
        },
      ]);
      expect(fixture.operations).toEqual(['readCardList']);
    }),
  );

  it.effect('upsertMyCard returns an expired provider state', () => {
    const expiredFrom = new Date('2024-01-01T00:00:00.000Z');
    const expiredTo = new Date('2024-12-31T00:00:00.000Z');
    const validate = vi.fn(async (): Promise<ValidationResult> => ({
      metadata: { provider: 'esncard' },
      status: 'expired',
      validFrom: expiredFrom,
      validTo: expiredTo,
    }));
    return withEsnCardAdapter(
      validate,
      Effect.gen(function* () {
        const fixture = createDiscountDatabase({
          initialCards: [createCard({ identifier: 'OLD-ESN' })],
        });
        const card = yield* upsertMyCard().pipe(
          Effect.provide(fixture.databaseLayer),
        );
        expect(card).toEqual({
          id: 'card-1',
          identifier: 'ESN-123',
          status: 'expired',
          type: 'esnCard',
          validTo: expiredTo.toISOString(),
        });
        expect(fixture.getCards()).toEqual([
          expect.objectContaining({
            identifier: 'ESN-123',
            lastCheckedAt: expect.any(Date),
            status: 'expired',
            validFrom: expiredFrom,
            validTo: expiredTo,
          }),
        ]);
        expect(fixture.operations).toEqual([
          'readTenantProviders',
          'readIdentifierOwner',
          'readCurrentCard',
          'updateExistingCard',
        ]);
        expect(validate).toHaveBeenCalledExactlyOnceWith({
          identifier: 'ESN-123',
        });
      }),
    );
  });

  for (const scenario of [
    {
      constraint: 'user_discount_cards_tenantId_type_identifier_unique',
      existing: true,
      tag: 'DiscountCardConflictError',
      winnerUser: 'user-2',
    },
    {
      constraint: 'user_discount_cards_tenantId_type_identifier_unique',
      existing: false,
      tag: 'DiscountCardConflictError',
      winnerUser: 'user-2',
    },
    {
      constraint: 'user_discount_cards_userId_tenantId_type_unique',
      existing: false,
      tag: 'DiscountCardChangedError',
      winnerUser: 'user-1',
    },
    {
      constraint: 'user_discount_cards_tenantId_type_identifier_unique',
      existing: false,
      tag: 'DiscountCardChangedError',
      winnerUser: 'user-1',
    },
  ]) {
    it.effect(
      `reports ${scenario.tag} for a write-time ${scenario.existing ? 'update' : 'insert'} ${scenario.constraint} race`,
      () =>
        withEsnCardAdapter(
          async () => verifiedResult,
          Effect.gen(function* () {
            const initialCards = scenario.existing
              ? [createCard({ identifier: 'ORIGINAL' })]
              : [];
            const concurrentCard = createCard({
              id: 'winner-card',
              userId: scenario.winnerUser,
            });
            const fixture = createDiscountDatabase({
              concurrentCard,
              initialCards,
              writeFailure: new SqlError({
                reason: new UniqueViolation({
                  cause: new Error('synthetic write race'),
                  constraint: scenario.constraint,
                }),
              }),
            });
            const error = yield* upsertMyCard().pipe(
              Effect.flip,
              Effect.provide(fixture.databaseLayer),
            );
            expect(error).toMatchObject({ _tag: scenario.tag });
            expect(fixture.getCards()).toEqual([
              ...initialCards,
              concurrentCard,
            ]);
          }),
        ),
    );
  }

  for (const reason of [
    new UniqueViolation({
      cause: new Error('synthetic unrelated constraint'),
      constraint: 'unrelated_unique',
    }),
    new ConstraintError({
      cause: {
        constraint: 'user_discount_cards_tenantId_type_identifier_unique',
      },
    }),
  ]) {
    it.effect(
      `preserves an unrelated ${reason._tag} write failure as a defect`,
      () =>
        withEsnCardAdapter(
          async () => verifiedResult,
          Effect.gen(function* () {
            const failure = new SqlError({ reason });
            const fixture = createDiscountDatabase({ writeFailure: failure });
            const exit = yield* upsertMyCard().pipe(
              Effect.exit,
              Effect.provide(fixture.databaseLayer),
            );
            expect(Exit.isFailure(exit)).toBe(true);
            if (!Exit.isFailure(exit)) return;
            expect(exit.cause.reasons).toHaveLength(1);
            const defect = exit.cause.reasons[0];
            expect(defect && Cause.isDieReason(defect)).toBe(true);
            if (!defect || !Cause.isDieReason(defect)) return;
            expect(defect.defect).toBeInstanceOf(EffectDrizzleQueryError);
            if (
              !(defect.defect instanceof EffectDrizzleQueryError) ||
              !Cause.isCause(defect.defect.cause)
            )
              return;
            const underlying = defect.defect.cause.reasons[0];
            expect(
              underlying && Cause.isFailReason(underlying) && underlying.error,
            ).toBe(failure);
            expect(fixture.getCards()).toEqual([]);
          }),
        ),
    );
  }

  it.effect('upsertMyCard validates before inserting a new card', () => {
    const validate = vi.fn(async () => verifiedResult);
    return withEsnCardAdapter(
      validate,
      Effect.gen(function* () {
        const fixture = createDiscountDatabase();
        const card = yield* upsertMyCard().pipe(
          Effect.provide(fixture.databaseLayer),
        );
        expect(card).toMatchObject({
          identifier: 'ESN-123',
          status: 'verified',
          validTo: validTo.toISOString(),
        });
        expect(fixture.getCards()).toEqual([
          expect.objectContaining({
            id: card.id,
            identifier: 'ESN-123',
            metadata: { provider: 'esncard' },
            status: 'verified',
            tenantId: 'tenant-2',
            userId: 'user-1',
            validFrom,
            validTo,
          }),
        ]);
        expect(fixture.operations).toEqual([
          'readTenantProviders',
          'readIdentifierOwner',
          'readCurrentCard',
          'insertNewCard',
        ]);
        expect(validate).toHaveBeenCalledExactlyOnceWith({
          identifier: 'ESN-123',
        });
      }),
    );
  });

  for (const existing of [false, true]) {
    it.effect(
      existing
        ? 'upsertMyCard reports provider outages without changing the stored card'
        : 'upsertMyCard reports provider outages without inserting a card',
      () => {
        const validate = vi.fn(async () => {
          throw new ProviderValidationUnavailableError(
            'provider details',
            'unavailable',
          );
        });
        return withEsnCardAdapter(
          validate,
          Effect.gen(function* () {
            const initialCards = existing
              ? [
                  createCard({
                    identifier: 'OLD-ESN',
                    status: 'verified',
                    validFrom,
                    validTo,
                  }),
                ]
              : [];
            const fixture = createDiscountDatabase({ initialCards });
            const error = yield* upsertMyCard().pipe(
              Effect.flip,
              Effect.provide(fixture.databaseLayer),
            );
            expect(error).toBeInstanceOf(RpcBadRequestError);
            expect(error).toMatchObject({
              message:
                'We could not check this ESNcard, so it was not saved or changed. Select Save ESNcard to try once more.',
              reason: 'provider-unavailable',
            });
            expect(error).not.toHaveProperty('cause');
            expect(fixture.getCards()).toEqual(initialCards);
            expect(fixture.operations).toEqual([
              'readTenantProviders',
              'readIdentifierOwner',
              'readCurrentCard',
            ]);
            expect(validate).toHaveBeenCalledExactlyOnceWith({
              identifier: 'ESN-123',
            });
          }),
        );
      },
    );
  }

  for (const action of ['save', 'refresh']) {
    it.effect(
      `rejects ${action} when the tenant ESNcard program is disabled`,
      () => {
        const validate = vi.fn(async () => verifiedResult);
        return withEsnCardAdapter(
          validate,
          Effect.gen(function* () {
            const original = createCard();
            const fixture = createDiscountDatabase({
              initialCards: [original],
              providerStatus: 'disabled',
            });
            const error =
              action === 'save'
                ? yield* upsertMyCard().pipe(
                    Effect.flip,
                    Effect.provide(fixture.databaseLayer),
                  )
                : yield* refreshMyCard().pipe(
                    Effect.flip,
                    Effect.provide(fixture.databaseLayer),
                  );
            expect(error).toBeInstanceOf(RpcForbiddenError);
            expect(error.message).toBe(
              'ESNcard discounts are not available for this organization.',
            );
            expect(validate).not.toHaveBeenCalled();
            expect(fixture.getCards()).toEqual([original]);
            expect(fixture.operations).toEqual(['readTenantProviders']);
          }),
        );
      },
    );
  }

  it.effect(
    'upsertMyCard rejects an identifier owned by another tenant member',
    () => {
      const validate = vi.fn(async () => verifiedResult);
      return withEsnCardAdapter(
        validate,
        Effect.gen(function* () {
          const initialCards = [createCard({ userId: 'user-2' })];
          const fixture = createDiscountDatabase({ initialCards });
          const error = yield* upsertMyCard().pipe(
            Effect.flip,
            Effect.provide(fixture.databaseLayer),
          );
          expect(error).toMatchObject({ _tag: 'DiscountCardConflictError' });
          expect(validate).not.toHaveBeenCalled();
          expect(fixture.getCards()).toEqual(initialCards);
          expect(fixture.operations).toEqual([
            'readTenantProviders',
            'readIdentifierOwner',
          ]);
        }),
      );
    },
  );

  it.effect(
    'refreshMyCard revalidates and updates the current user card',
    () => {
      const validate = vi.fn(async () => verifiedResult);
      return withEsnCardAdapter(
        validate,
        Effect.gen(function* () {
          const fixture = createDiscountDatabase({
            initialCards: [createCard()],
          });
          const refreshed = yield* refreshMyCard().pipe(
            Effect.provide(fixture.databaseLayer),
          );
          expect(refreshed).toEqual({
            id: 'card-1',
            identifier: 'ESN-123',
            status: 'verified',
            type: 'esnCard',
            validTo: validTo.toISOString(),
          });
          expect(fixture.getCards()).toEqual([
            expect.objectContaining({
              lastCheckedAt: expect.any(Date),
              metadata: { provider: 'esncard' },
              status: 'verified',
              validFrom,
              validTo,
            }),
          ]);
          expect(validate).toHaveBeenCalledExactlyOnceWith({
            identifier: 'ESN-123',
          });
          expect(fixture.operations).toEqual([
            'readTenantProviders',
            'readCurrentCard',
            'refreshOriginalCard',
          ]);
        }),
      );
    },
  );

  it.effect(
    'refreshMyCard reports unexpected provider failures without changing the card',
    () => {
      const validate = vi.fn(async () => {
        throw new Error('private-provider-detail');
      });
      return withEsnCardAdapter(
        validate,
        Effect.gen(function* () {
          const original = createCard({
            status: 'verified',
            validFrom,
            validTo,
          });
          const fixture = createDiscountDatabase({ initialCards: [original] });
          const error = yield* refreshMyCard().pipe(
            Effect.flip,
            Effect.provide(fixture.databaseLayer),
          );
          expect(error).toBeInstanceOf(RpcInternalServerError);
          expect(error).toMatchObject({
            message:
              'We could not check this ESNcard, so it was not changed. Select Check again to try once more.',
          });
          expect(error).not.toHaveProperty('cause');
          expect(JSON.stringify(error)).not.toContain(
            'private-provider-detail',
          );
          expect(fixture.getCards()).toEqual([original]);
          expect(fixture.operations).toEqual([
            'readTenantProviders',
            'readCurrentCard',
          ]);
          expect(validate).toHaveBeenCalledExactlyOnceWith({
            identifier: 'ESN-123',
          });
        }),
      );
    },
  );

  for (const action of ['save', 'refresh']) {
    for (const status of ['invalid', 'unverified'] as const) {
      it.effect(
        `${action} replaces stale verified fields after an authoritative ${status} result`,
        () => {
          const validate = vi.fn(async (): Promise<ValidationResult> => ({
            status,
          }));
          return withEsnCardAdapter(
            validate,
            Effect.gen(function* () {
              const fixture = createDiscountDatabase({
                initialCards: [
                  createCard({ status: 'verified', validFrom, validTo }),
                ],
              });
              const result =
                action === 'save'
                  ? yield* upsertMyCard().pipe(
                      Effect.provide(fixture.databaseLayer),
                    )
                  : yield* refreshMyCard().pipe(
                      Effect.provide(fixture.databaseLayer),
                    );
              expect(result).toMatchObject({ status, validTo: null });
              expect(fixture.getCards()).toEqual([
                expect.objectContaining({
                  lastCheckedAt: expect.any(Date),
                  metadata: null,
                  status,
                  validFrom: null,
                  validTo: null,
                }),
              ]);
              expect(validate).toHaveBeenCalledExactlyOnceWith({
                identifier: 'ESN-123',
              });
            }),
          );
        },
      );
    }
  }

  for (const scenario of ['unchanged', 'replaced', 'removed']) {
    it.effect(
      `upsertMyCard handles a card that is ${scenario} during validation`,
      () => {
        const original = createCard();
        const fixture = createDiscountDatabase({ initialCards: [original] });
        const validate = vi.fn(async () => {
          await Promise.resolve();
          if (scenario === 'replaced') fixture.replaceOriginalCard();
          else if (scenario === 'removed') fixture.removeOriginalCard();
          return verifiedResult;
        });
        return withEsnCardAdapter(
          validate,
          Effect.gen(function* () {
            const result = yield* upsertMyCard().pipe(
              Effect.result,
              Effect.provide(fixture.databaseLayer),
            );
            if (scenario === 'unchanged') {
              expect(Result.isSuccess(result)).toBe(true);
              if (Result.isFailure(result)) return;
              expect(result.success).toMatchObject({
                id: original.id,
                identifier: original.identifier,
                status: 'verified',
                validTo: validTo.toISOString(),
              });
            } else {
              expect(Result.isFailure(result)).toBe(true);
              if (Result.isSuccess(result)) return;
              expect(result.failure).toMatchObject({
                _tag: 'DiscountCardChangedError',
              });
              expect(fixture.getCards()).toEqual(
                scenario === 'removed'
                  ? []
                  : [{ ...original, identifier: 'ESN-456' }],
              );
            }
            expect(validate).toHaveBeenCalledExactlyOnceWith({
              identifier: 'ESN-123',
            });
            expect(fixture.operations).toEqual([
              'readTenantProviders',
              'readIdentifierOwner',
              'readCurrentCard',
              'updateExistingCard',
            ]);
          }),
        );
      },
    );
  }

  for (const scenario of ['unchanged', 'replaced', 'removed']) {
    it.effect(
      `refreshMyCard handles a card that is ${scenario} during validation`,
      () => {
        const original = createCard();
        const fixture = createDiscountDatabase({ initialCards: [original] });
        const validate = vi.fn(async () => {
          await Promise.resolve();
          if (scenario === 'replaced') fixture.replaceOriginalCard();
          else if (scenario === 'removed') fixture.removeOriginalCard();
          return verifiedResult;
        });
        return withEsnCardAdapter(
          validate,
          Effect.gen(function* () {
            const result = yield* refreshMyCard().pipe(
              Effect.result,
              Effect.provide(fixture.databaseLayer),
            );
            if (scenario === 'unchanged') {
              expect(Result.isSuccess(result)).toBe(true);
              if (Result.isFailure(result)) return;
              expect(result.success).toEqual({
                id: original.id,
                identifier: original.identifier,
                status: 'verified',
                type: 'esnCard',
                validTo: validTo.toISOString(),
              });
              expect(fixture.getCards()).toEqual([
                expect.objectContaining({
                  status: 'verified',
                  validFrom,
                  validTo,
                }),
              ]);
            } else {
              expect(Result.isFailure(result)).toBe(true);
              if (Result.isSuccess(result)) return;
              expect(result.failure).toMatchObject({
                _tag: 'DiscountCardChangedError',
              });
              expect(fixture.getCards()).toEqual(
                scenario === 'removed'
                  ? []
                  : [{ ...original, identifier: 'ESN-456' }],
              );
            }
            expect(validate).toHaveBeenCalledExactlyOnceWith({
              identifier: 'ESN-123',
            });
            expect(fixture.operations).toEqual([
              'readTenantProviders',
              'readCurrentCard',
              'refreshOriginalCard',
            ]);
          }),
        );
      },
    );
  }

  it.effect('explains when the saved ESNcard is no longer available', () => {
    const validate = vi.fn(async () => verifiedResult);
    return withEsnCardAdapter(
      validate,
      Effect.gen(function* () {
        const fixture = createDiscountDatabase();
        const error = yield* refreshMyCard().pipe(
          Effect.flip,
          Effect.provide(fixture.databaseLayer),
        );
        expect(error).toMatchObject({
          _tag: 'DiscountCardNotFoundError',
          message:
            'This ESNcard is no longer saved. No card was changed. Add it again if you still use it.',
        });
        expect(validate).not.toHaveBeenCalled();
        expect(fixture.operations).toEqual([
          'readTenantProviders',
          'readCurrentCard',
        ]);
      }),
    );
  });

  it.effect('deleteMyCard removes only the current user card type', () =>
    Effect.gen(function* () {
      const otherTenantCard = createCard({
        id: 'other-tenant',
        tenantId: 'tenant-1',
      });
      const otherUserCard = createCard({ id: 'other-user', userId: 'user-2' });
      const fixture = createDiscountDatabase({
        initialCards: [createCard(), otherTenantCard, otherUserCard],
      });
      yield* discountHandlers['discounts.deleteMyCard'](
        { type: 'esnCard' },
        createRpcOptions(
          DiscountRpcs.DiscountsDeleteMyCard.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(Effect.provide(fixture.databaseLayer));
      expect(fixture.getCards()).toEqual([otherTenantCard, otherUserCard]);
      expect(fixture.operations).toEqual(['deleteCurrentCard']);
    }),
  );
});
