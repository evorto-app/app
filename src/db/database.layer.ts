import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Redacted } from 'effect';

import { databaseConfig } from '../server/config/database-config';
import { relations } from './relations';

const makeDatabase = PgDrizzle.make({
  relations,
});

const scopedDatabase = Effect.gen(function* () {
  const { DATABASE_URL } = yield* databaseConfig;

  return yield* makeDatabase.pipe(
    Effect.provide(PgDrizzle.DefaultServices),
    Effect.provide(PgDrizzle.EffectLogger.layer),
    Effect.provide(
      PgClient.layer({
        url: Redacted.make(DATABASE_URL),
      }),
    ),
  );
});

export type DatabaseClient = Effect.Effect.Success<typeof makeDatabase>;

export class Database extends Effect.Service<Database>()('@db/Database', {
  scoped: scopedDatabase,
}) {}

export const databaseLayer = Database.Default;
