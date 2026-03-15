import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer } from 'effect';

import { databaseConfig } from '@db/database-config';
import { createPgClientConfig } from './pg-connection-config';
import { relations } from './relations';
import * as schema from './schema';

const makeDatabase = (client: PgClient.PgClient) =>
  PgDrizzle.drizzle(client, {
    relations,
    schema,
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

export type DatabaseClient = ReturnType<typeof makeDatabase>;

export class Database extends Context.Tag('@db/Database')<
  Database,
  DatabaseClient
>() {}

export const databaseLayer = Layer.effect(
  Database,
  Effect.map(PgClient.PgClient, makeDatabase),
).pipe(Layer.provide(pgClientLayer));
