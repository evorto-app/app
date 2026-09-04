import { describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, ConfigProvider, Effect, Layer } from 'effect';
import { isSqlError } from 'effect/unstable/sql/SqlError';

import { Database, type DatabaseClient, databaseLayer } from '../../db';
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
  }) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    yield* Effect.acquireUseRelease(
      Effect.sync(() => ({ tenantId: createId(), userId: createId() })),
      ({ tenantId, userId }) =>
        Effect.gen(function* () {
          yield* database.insert(tenants).values({
            domain: `${tenantId}.card-window.example`,
            id: tenantId,
            name: 'Card validity window',
          });
          yield* database.insert(users).values({
            auth0Id: `card-window|${userId}`,
            communicationEmail: `${userId}@example.com`,
            email: `${userId}@example.com`,
            firstName: 'Card',
            id: userId,
            lastName: 'Window',
          });
          yield* run({
            card: {
              identifier: `card-${userId}`,
              tenantId,
              type: 'esnCard',
              userId,
            },
            database,
          });
        }),
      ({ tenantId, userId }) =>
        database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.tenantId, tenantId))
          .pipe(
            Effect.ensuring(
              database
                .delete(users)
                .where(eq(users.id, userId))
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
