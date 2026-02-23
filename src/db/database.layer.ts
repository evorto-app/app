import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Redacted } from 'effect';

import { getDatabaseEnvironment } from '../server/config/environment';
import { relations } from './relations';

const { DATABASE_URL } = getDatabaseEnvironment();

const makeDatabase = PgDrizzle.make({
  relations,
});

const databaseDependencies = [
  PgDrizzle.DefaultServices,
  PgDrizzle.EffectLogger.layer,
  PgClient.layer({
    url: Redacted.make(DATABASE_URL),
  }),
] as const;

export type DatabaseClient = Effect.Effect.Success<typeof makeDatabase>;

export class Database extends Effect.Service<Database>()('@db/Database', {
  dependencies: databaseDependencies,
  scoped: makeDatabase,
}) {}

export const databaseLayer = Database.Default;
