import { databaseConfig } from '@db/database-config';
import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer } from 'effect';

import { createPgClientConfig } from './pg-connection-config';
import { relations } from './relations';

const databaseEffect = PgDrizzle.makeWithDefaults({ relations });

const pgClientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { DATABASE_URL, NEON_LOCAL_PROXY } = yield* databaseConfig;

    return PgClient.layer(
      createPgClientConfig({
        databaseUrl: DATABASE_URL,
        neonLocalProxy: NEON_LOCAL_PROXY,
      }),
    );
  }),
);

export type DatabaseClient = Effect.Success<typeof databaseEffect>;

export class Database extends Context.Service<Database, DatabaseClient>()(
  '@db/Database',
) {}

export const databaseLayer = Layer.effect(Database, databaseEffect).pipe(
  Layer.provide(pgClientLayer),
);
