import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Redacted } from 'effect';

import { getDatabaseEnvironment } from '../server/config/environment';
import { relations } from './relations';

const { DATABASE_URL } = getDatabaseEnvironment();

const makeDatabase = PgDrizzle.make({
  relations,
}).pipe(
  Effect.provide(PgDrizzle.DefaultServices),
  Effect.provide(PgDrizzle.EffectLogger.layer),
  Effect.provide(
    PgClient.layer({
      url: Redacted.make(DATABASE_URL),
    }),
  ),
);

export type DatabaseClient = Effect.Effect.Success<typeof makeDatabase>;

export class Database extends Effect.Service<Database>()('@db/Database', {
  effect: makeDatabase,
}) {}

export const databaseLayer = Database.Default;
