import { databaseConfig } from '@db/database-config';
import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer } from 'effect';

import { createPgClientConfig } from './pg-connection-config';
import { relations } from './relations';
import * as schema from './schema';

const databaseEffect = PgDrizzle
  .make({
    relations,
    schema,
  })
  .pipe(Effect.provide(PgDrizzle.DefaultServices));

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

export type DatabaseClient = Effect.Effect.Success<typeof databaseEffect>;

export class Database extends Context.Tag('@db/Database')<
  Database,
  DatabaseClient
>() {}

export const databaseLayer = Layer.effect(Database, databaseEffect).pipe(
  Layer.provide(pgClientLayer),
);
