import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Redacted } from 'effect';

import { databaseConfig } from '../server/config/database-config';
import { relations } from './relations';

const makeDatabase = PgDrizzle.make({
  relations,
});

const pgClientLayer = Layer.unwrapEffect(
  databaseConfig.pipe(
    Effect.map(({ DATABASE_URL }) =>
      PgClient.layer({
        url: Redacted.make(DATABASE_URL),
      }),
    ),
  ),
);

export type DatabaseClient = Effect.Effect.Success<typeof makeDatabase>;

export class Database extends Effect.Service<Database>()('@db/Database', {
  dependencies: [
    PgDrizzle.DefaultServices,
    PgDrizzle.EffectLogger.layer,
    pgClientLayer,
  ],
  scoped: makeDatabase,
}) {}

export const databaseLayer = Database.Default;
