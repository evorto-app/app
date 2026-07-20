import { databaseConfig } from '@db/database-config';
import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer, Option, Redacted } from 'effect';

import { createPgClientConfig } from './pg-connection-config';
import { relations } from './relations';

const databaseEffect = PgDrizzle.makeWithDefaults({ relations });

const pgClientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* databaseConfig;
    const caCertificate = config.DATABASE_TLS_CA_CERTIFICATE.pipe(
      Option.map((certificate) => Redacted.value(certificate)),
      Option.getOrUndefined,
    );
    const tlsServerName = Option.getOrUndefined(
      config.DATABASE_TLS_SERVER_NAME,
    );

    return PgClient.layer(
      createPgClientConfig({
        caCertificate,
        databaseUrl: config.DATABASE_URL,
        pool: {
          connectTimeoutMs: config.DATABASE_POOL_CONNECT_TIMEOUT_MS,
          idleTimeoutMs: config.DATABASE_POOL_IDLE_TIMEOUT_MS,
          max: config.DATABASE_POOL_MAX,
          min: config.DATABASE_POOL_MIN,
        },
        tlsServerName,
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
