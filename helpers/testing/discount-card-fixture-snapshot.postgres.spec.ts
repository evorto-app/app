import { describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inspect } from 'node:util';
import { Pool } from 'pg';

import { createId } from '../../src/db/create-id';
import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import { relations } from '../../src/db/relations';
import {
  userDiscountCards,
  userDiscountCardIdentifierUniqueConstraintName,
  users,
} from '../../src/db/schema';
import { captureDiscountCardFixtureSnapshot } from '../../tests/support/utils/discount-card-fixture-snapshot';
import {
  requiredPostgresMajorVersion,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';

type TestDatabase = NodePgDatabase<typeof relations>;

const readCards = (database: TestDatabase, userIds: readonly string[]) =>
  database
    .select({ row: sql<string>`row_to_json(${userDiscountCards})::text` })
    .from(userDiscountCards)
    .where(inArray(userDiscountCards.userId, userIds))
    .orderBy(userDiscountCards.userId);

const withFixture = async (
  run: (
    database: TestDatabase,
    userId: string,
    otherUserId: string,
  ) => Promise<void>,
) => {
  const environment = await resolvePostgresIntegrationEnvironment({
    environment: {
      ...process.env,
      POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
    },
  });
  const pool = new Pool(
    createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
  );
  const failures: unknown[] = [];
  const completed = new Error('Roll back fixture snapshot proof');
  try {
    const version = await pool.query<{ server_version_num: string }>(
      'SHOW server_version_num',
    );
    expect(
      Math.floor(Number(version.rows[0]?.server_version_num) / 10_000),
    ).toBe(requiredPostgresMajorVersion);
    const database = drizzle({ client: pool, relations });
    const userId = createId();
    const otherUserId = createId();
    try {
      await database.transaction(async (transaction) => {
        try {
          await transaction.insert(users).values(
            [userId, otherUserId].map((id) => ({
              auth0Id: `fixture-snapshot|${id}`,
              communicationEmail: `${id}@example.com`,
              email: `${id}@example.com`,
              firstName: 'Fixture',
              id,
              lastName: 'Snapshot',
            })),
          );
          await transaction.insert(userDiscountCards).values({
            identifier: `foreign-${otherUserId}`,
            type: 'esnCard',
            userId: otherUserId,
          });
          await run(transaction, userId, otherUserId);
        } catch (error) {
          failures.push(error);
        }
        throw completed;
      });
    } catch (error) {
      if (error !== completed) failures.push(error);
    }
    expect(
      await database.query.users.findFirst({ where: { id: userId } }),
    ).toBeUndefined();
    expect(
      await database.query.users.findFirst({ where: { id: otherUserId } }),
    ).toBeUndefined();
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      'Discount fixture snapshot proof failed',
    );
  }
};

describe('exact global discount-card fixture restoration', () => {
  it.each(['verified', 'unverified'] as const)(
    'restores every original field after remove and re-add (%s)',
    async (status) => {
      await withFixture(async (database, userId, otherUserId) => {
        const originalId = createId();
        await database.insert(userDiscountCards).values({
          createdAt: sql`${'2020-01-02 03:04:05.123456'}::timestamp`,
          id: originalId,
          identifier: `original-${userId}`,
          lastCheckedAt:
            status === 'verified'
              ? sql`${'2030-01-02 03:04:05.234567'}::timestamp`
              : null,
          metadata:
            status === 'verified'
              ? sql`${'{"large":9007199254740993,"fraction":1.123456789123456789}'}::jsonb`
              : null,
          status,
          type: 'esnCard',
          updatedAt: sql`${'2021-01-02 03:04:05.345678'}::timestamp`,
          userId,
          validFrom:
            status === 'verified'
              ? sql`${'2031-01-02 03:04:05.456789'}::timestamp`
              : null,
          validTo:
            status === 'verified'
              ? sql`${'2032-01-02 03:04:05.567891'}::timestamp`
              : null,
        });
        const before = await readCards(database, [userId, otherUserId]);
        const snapshot = await captureDiscountCardFixtureSnapshot(
          database,
          userId,
        );
        expect(snapshot.originalCardId).toBe(originalId);
        await database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.userId, userId));
        await database.insert(userDiscountCards).values({
          id: createId(),
          identifier: `replacement-${userId}`,
          type: 'esnCard',
          userId,
        });
        await snapshot.restore();
        expect(await readCards(database, [userId, otherUserId])).toEqual(
          before,
        );
      });
    },
  );

  it('restores absence after the test creates a card with a different row id', async () => {
    await withFixture(async (database, userId, otherUserId) => {
      const before = await readCards(database, [userId, otherUserId]);
      const snapshot = await captureDiscountCardFixtureSnapshot(
        database,
        userId,
      );
      expect(snapshot.originalCardId).toBeUndefined();
      for (let index = 0; index < 2; index += 1) {
        await database
          .delete(userDiscountCards)
          .where(eq(userDiscountCards.userId, userId));
        await database.insert(userDiscountCards).values({
          id: createId(),
          identifier: `new-${index}-${userId}`,
          type: 'esnCard',
          userId,
        });
      }
      await snapshot.restore();
      expect(await readCards(database, [userId, otherUserId])).toEqual(before);
    });
  });

  it('does not take another account identifier and rolls back a failed restoration', async () => {
    await withFixture(async (database, userId, otherUserId) => {
      const identifier = `original-${userId}`;
      const metadataMarker = `private-snapshot-metadata-${userId}`;
      await database.insert(userDiscountCards).values({
        identifier,
        metadata: { privateFixtureValue: metadataMarker },
        type: 'esnCard',
        userId,
      });
      const snapshot = await captureDiscountCardFixtureSnapshot(
        database,
        userId,
      );
      await database
        .update(userDiscountCards)
        .set({ identifier: `replacement-${userId}` })
        .where(eq(userDiscountCards.userId, userId));
      await database
        .update(userDiscountCards)
        .set({ identifier })
        .where(eq(userDiscountCards.userId, otherUserId));
      const before = await readCards(database, [userId, otherUserId]);
      const failure = await snapshot.restore().then(
        () => {
          throw new Error('Expected a discount-card restoration conflict');
        },
        (error: unknown) => error,
      );
      if (!(failure instanceof Error)) {
        throw new Error('Expected a restoration error');
      }
      expect(failure).toMatchObject({
        cause: {
          code: '23505',
          constraint: userDiscountCardIdentifierUniqueConstraintName,
        },
      });
      const diagnostic = inspect(failure, { depth: null });
      expect(diagnostic).not.toContain(identifier);
      expect(diagnostic).not.toContain(metadataMarker);
      expect(await readCards(database, [userId, otherUserId])).toEqual(before);
    });
  });
});
