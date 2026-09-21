import { describe, expect, it } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { date, interval, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { Database, databaseLayer } from './database.layer';
import { createNodePgPoolConfig } from './pg-connection-config';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const testDatabaseLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
      }),
    ),
  ),
);
const values = pgTable('evorto_native_temporal_fixture', {
  day: date('day', { mode: 'string' }),
  days: date('days', { mode: 'string' }).array(),
  duration: interval('duration'),
  durations: interval('durations').array(),
  instant: timestamp('instant', { mode: 'string', withTimezone: true }),
  missing: timestamp('missing', { mode: 'string' }),
  wallClock: timestamp('wall_clock', { mode: 'string' }),
  wallClocks: timestamp('wall_clocks', { mode: 'string' }).array(),
});
// Literal provider-boundary values: six fractional digits must survive the
// application string codec, including array elements and null entries.
const temporalSelect = `SELECT
  DATE '2026-03-29' AS day,
  ARRAY[DATE '2026-03-29', NULL] AS days,
  INTERVAL '1 month 2 days 03:04:05.123456' AS duration,
  ARRAY[INTERVAL '1 month 2 days 03:04:05.123456', NULL] AS durations,
  TIMESTAMPTZ '2026-03-29 03:59:59.123456+02' AS instant,
  NULL::timestamp AS missing,
  TIMESTAMP '2026-03-29 01:59:59.123456' AS wall_clock,
  ARRAY[TIMESTAMP '2026-03-29 01:59:59.123456', NULL] AS wall_clocks`;

describe('PostgreSQL temporal value boundaries', () => {
  it.effect(
    'preserves temporal strings, microseconds and arrays through native Drizzle',
    () =>
      Effect.gen(function* () {
        const database = yield* Database;
        const rows = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
            yield* transaction.execute(
              sql`SET LOCAL IntervalStyle = 'postgres'`,
            );
            yield* transaction.execute(
              sql`CREATE TEMP TABLE evorto_native_temporal_fixture ON COMMIT DROP AS ${sql.raw(temporalSelect)}`,
            );
            return yield* transaction.select().from(values);
          }),
        );
        expect(rows).toEqual([
          {
            day: '2026-03-29',
            days: ['2026-03-29', null],
            duration: '1 mon 2 days 03:04:05.123456',
            durations: ['1 mon 2 days 03:04:05.123456', null],
            instant: '2026-03-29 01:59:59.123456+00',
            missing: null,
            wallClock: '2026-03-29 01:59:59.123456',
            wallClocks: ['2026-03-29 01:59:59.123456', null],
          },
        ]);
      }).pipe(Effect.provide(testDatabaseLayer)),
  );

  it('preserves raw temporal values for the Node PostgreSQL tooling client', async () => {
    const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query("SET LOCAL IntervalStyle = 'postgres'");
        const result =
          await client.query<Record<string, unknown>>(temporalSelect);
        expect(result.rows).toEqual([
          {
            day: '2026-03-29',
            days: '{2026-03-29,NULL}',
            duration: '1 mon 2 days 03:04:05.123456',
            durations: '{"1 mon 2 days 03:04:05.123456",NULL}',
            instant: '2026-03-29 01:59:59.123456+00',
            missing: null,
            wall_clock: '2026-03-29 01:59:59.123456',
            wall_clocks: '{"2026-03-29 01:59:59.123456",NULL}',
          },
        ]);
      } finally {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });
});
