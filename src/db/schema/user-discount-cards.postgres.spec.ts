import { describe, expect, it } from '@effect/vitest';
import { eq, inArray } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Result,
  Schema,
} from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { isSqlError } from 'effect/unstable/sql/SqlError';

import { Database, type DatabaseClient, databaseLayer } from '../../db';
import {
  Adapters,
  type ProviderAdapter,
  type ValidationResult,
} from '../../server/discounts/providers';
import { discountHandlers } from '../../server/effect/rpc/handlers/discounts.handlers';
import { RpcAccess } from '../../server/effect/rpc/handlers/shared/rpc-access.service';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
} from '../../shared/rpc-contracts/app-rpcs';
import { DiscountsUpsertMyCard } from '../../shared/rpc-contracts/app-rpcs/discounts.rpcs';
import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { createId } from '../create-id';
import {
  tenants,
  userDiscountCards,
  userDiscountCardValidityWindowCheckName,
  users,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const testDatabaseLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          DATABASE_TLS_REQUIRED: 'false',
          DATABASE_URL: databaseUrl,
        },
      }),
    ),
  ),
);

type Card = typeof userDiscountCards.$inferInsert;
const withCardFixture = <E, R>(
  run: (fixture: {
    card: Pick<Card, 'identifier' | 'tenantId' | 'type' | 'userId'>;
    database: DatabaseClient;
    otherUserId: string;
  }) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    yield* Effect.acquireUseRelease(
      Effect.sync(() => ({
        otherUserId: createId(),
        tenantId: createId(),
        userId: createId(),
      })),
      ({ otherUserId, tenantId, userId }) =>
        Effect.gen(function* () {
          yield* database.insert(tenants).values({
            domain: `${tenantId}.card-window.example`,
            id: tenantId,
            name: 'Card validity window',
          });
          yield* database.insert(users).values(
            [userId, otherUserId].map((id) => ({
              auth0Id: `card-window|${id}`,
              communicationEmail: `${id}@example.com`,
              email: `${id}@example.com`,
              firstName: 'Card',
              id,
              lastName: 'Window',
            })),
          );
          yield* run({
            card: {
              identifier: `card-${userId}`,
              tenantId,
              type: 'esnCard',
              userId,
            },
            database,
            otherUserId,
          });
        }),
      ({ otherUserId, tenantId, userId }) =>
        database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.tenantId, tenantId))
          .pipe(
            Effect.ensuring(
              database
                .delete(users)
                .where(inArray(users.id, [userId, otherUserId]))
                .pipe(Effect.orDie),
            ),
            Effect.ensuring(
              database
                .delete(tenants)
                .where(eq(tenants.id, tenantId))
                .pipe(Effect.orDie),
            ),
            Effect.orDie,
          ),
    );
  });

const validFrom = new Date('2026-01-01T00:00:00.000Z');
const validTo = new Date('2026-12-31T00:00:00.000Z');
const invalidWindows = [
  { name: 'missing start', validFrom: null, validTo },
  { name: 'missing end', validFrom, validTo: null },
  { name: 'reversed dates', validFrom: validTo, validTo: validFrom },
] satisfies readonly (Pick<Card, 'validFrom' | 'validTo'> & { name: string })[];

describe('persisted discount card validity windows', () => {
  for (const status of ['verified', 'expired'] as const) {
    it.effect(`accepts a complete ordered ${status} card window`, () =>
      withCardFixture(({ card, database }) =>
        Effect.gen(function* () {
          const saved = yield* database
            .insert(userDiscountCards)
            .values({
              ...card,
              status,
              validFrom,
              validTo,
            })
            .returning({
              status: userDiscountCards.status,
              validFrom: userDiscountCards.validFrom,
              validTo: userDiscountCards.validTo,
            });
          expect(saved).toEqual([{ status, validFrom, validTo }]);
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
    for (const window of invalidWindows) {
      it.effect(`rejects ${window.name} for a ${status} card`, () =>
        withCardFixture(({ card, database }) =>
          Effect.gen(function* () {
            const error = yield* database
              .insert(userDiscountCards)
              .values({
                ...card,
                status,
                validFrom: window.validFrom,
                validTo: window.validTo,
              })
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(EffectDrizzleQueryError);
            if (!Cause.isCause(error.cause)) {
              throw new Error('Expected the Drizzle Effect cause');
            }
            const sqlErrors = error.cause.reasons.flatMap((reason) =>
              Cause.isFailReason(reason) && isSqlError(reason.error)
                ? [reason.error]
                : [],
            );
            expect(sqlErrors).toHaveLength(1);
            expect(sqlErrors[0]?.reason).toMatchObject({
              _tag: 'ConstraintError',
              cause: {
                code: '23514',
                constraint: userDiscountCardValidityWindowCheckName,
              },
            });
          }),
        ).pipe(Effect.provide(testDatabaseLayer)),
      );
    }
  }
  for (const status of ['invalid', 'unverified'] as const) {
    it.effect(`allows an unvalidated window for a ${status} card`, () =>
      withCardFixture(({ card, database }) =>
        Effect.gen(function* () {
          const saved = yield* database
            .insert(userDiscountCards)
            .values({ ...card, status })
            .returning({
              status: userDiscountCards.status,
              validFrom: userDiscountCards.validFrom,
              validTo: userDiscountCards.validTo,
            });
          expect(saved).toEqual([{ status, validFrom: null, validTo: null }]);
        }),
      ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
});

const withEsnCardAdapter = <A, E, R>(
  validate: ProviderAdapter['validate'],
  run: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = Adapters.esnCard;
      Adapters.esnCard = { validate };
      return original;
    }),
    () => run,
    (original) =>
      Effect.sync(() => {
        Adapters.esnCard = original;
      }),
  );

const saveCard = (tenant: Tenant, userId: string, identifier: string) =>
  discountHandlers['discounts.upsertMyCard'](
    { identifier, type: 'esnCard' },
    {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
      rpc: DiscountsUpsertMyCard.middleware(RpcRequestContextMiddleware),
    },
  ).pipe(
    Effect.provide(RpcAccess.Default),
    Effect.provideService(RpcRequestContext, {
      authData: {},
      authenticated: true,
      permissions: [],
      platformAuthority: null,
      tenant,
      user: Schema.decodeUnknownSync(User)({
        attributes: [],
        auth0Id: `card-window|${userId}`,
        email: `${userId}@example.com`,
        firstName: 'Card',
        id: userId,
        lastName: 'Window',
        permissions: [],
        roleIds: [],
      }),
      userAssigned: true,
    }),
  );

describe('concurrent discount card saves', () => {
  for (const scenario of [
    'existing identifier',
    'new identifier',
    'new user slot',
    'same identifier and user',
  ] as const) {
    it.live(
      `keeps the winning card and returns a typed conflict for a ${scenario} race`,
      () =>
        withCardFixture(({ card, database, otherUserId }) =>
          Effect.gen(function* () {
            yield* database
              .update(tenants)
              .set({
                discountProviders: {
                  esnCard: { config: {}, status: 'enabled' },
                },
              })
              .where(eq(tenants.id, card.tenantId));
            const tenant = Schema.decodeUnknownSync(Tenant)(
              yield* database.query.tenants.findFirst({
                where: { id: card.tenantId },
              }),
            );
            if (scenario === 'existing identifier') {
              yield* database.insert(userDiscountCards).values({
                ...card,
                identifier: 'ORIGINAL',
                status: 'unverified',
              });
            }
            const before = yield* database.query.userDiscountCards.findMany({
              where: { tenantId: card.tenantId },
            });
            const started = yield* Deferred.make<undefined>();
            const release = yield* Deferred.make<undefined>();
            let validationCalls = 0;
            const result: ValidationResult = {
              metadata: { provider: 'synthetic' },
              status: 'verified',
              validFrom,
              validTo,
            };
            const validate: ProviderAdapter['validate'] = () => {
              validationCalls += 1;
              if (validationCalls === 1) {
                return Effect.runPromise(
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.as(result),
                  ),
                );
              }
              return Promise.resolve(result);
            };
            yield* withEsnCardAdapter(
              validate,
              Effect.gen(function* () {
                const waitingSave = yield* saveCard(
                  tenant,
                  card.userId,
                  'TARGET',
                ).pipe(Effect.result, Effect.forkScoped);
                yield* Effect.gen(function* () {
                  // The first request has finished both reads and is paused in provider validation.
                  yield* Deferred.await(started);
                  const sameUser =
                    scenario === 'new user slot' ||
                    scenario === 'same identifier and user';
                  const winningUser = sameUser ? card.userId : otherUserId;
                  const winningIdentifier =
                    scenario === 'new user slot' ? 'WINNER' : 'TARGET';
                  const winner = yield* saveCard(
                    tenant,
                    winningUser,
                    winningIdentifier,
                  );
                  yield* Deferred.succeed(release, undefined);
                  const loser = yield* Fiber.join(waitingSave);
                  expect(Result.isFailure(loser)).toBe(true);
                  if (!Result.isFailure(loser)) return;
                  expect(loser.failure).toMatchObject({
                    _tag: sameUser
                      ? 'DiscountCardChangedError'
                      : 'DiscountCardConflictError',
                  });
                  const after =
                    yield* database.query.userDiscountCards.findMany({
                      where: { tenantId: card.tenantId },
                    });
                  expect(after).toHaveLength(before.length + 1);
                  expect(
                    after.find((row) => row.id === winner.id),
                  ).toMatchObject({
                    identifier: winningIdentifier,
                    metadata: { provider: 'synthetic' },
                    status: 'verified',
                    userId: winningUser,
                  });
                  if (scenario === 'existing identifier') {
                    expect(
                      after.find((row) => row.userId === card.userId),
                    ).toEqual(before[0]);
                  }
                  expect(validationCalls).toBe(2);
                }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
              }).pipe(Effect.scoped),
            );
          }),
        ).pipe(Effect.provide(testDatabaseLayer)),
    );
  }
});
