import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer } from 'effect';

import { databaseConfig } from '@db/database-config';
import { createPgClientConfig } from './pg-connection-config';
import { relations } from './relations';

const makeDatabase = PgDrizzle.make({
  relations,
});

const pgClientLayer = Layer.unwrapEffect(
  databaseConfig.pipe(
    Effect.map(({ DATABASE_URL, NEON_LOCAL_PROXY }) =>
      PgClient.layer(
        createPgClientConfig({
          databaseUrl: DATABASE_URL,
          neonLocalProxy: NEON_LOCAL_PROXY,
        }),
      ),
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
