import {
  nonEmptyTrimmedString,
  optionalTrimmedString,
} from '@server/config/config-string';
import { Config, ConfigProvider, Effect, Option } from 'effect';

const boundedInteger = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  Config.int(name).pipe(
    Config.withDefault(fallback),
    Config.mapOrFail((value) =>
      value >= minimum && value <= maximum
        ? Effect.succeed(value)
        : Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${name} must be between ${minimum} and ${maximum}`,
              }),
            ),
          ),
    ),
  );

const databaseConfigValues = Config.all({
  DATABASE_POOL_CONNECT_TIMEOUT_MS: boundedInteger(
    'DATABASE_POOL_CONNECT_TIMEOUT_MS',
    10_000,
    1000,
    60_000,
  ),
  DATABASE_POOL_IDLE_TIMEOUT_MS: boundedInteger(
    'DATABASE_POOL_IDLE_TIMEOUT_MS',
    30_000,
    1000,
    300_000,
  ),
  DATABASE_POOL_MAX: boundedInteger('DATABASE_POOL_MAX', 5, 1, 20),
  DATABASE_POOL_MIN: boundedInteger('DATABASE_POOL_MIN', 0, 0, 5),
  DATABASE_TLS_CA_CERTIFICATE: Config.option(
    Config.redacted('DATABASE_TLS_CA_CERTIFICATE'),
  ),
  DATABASE_TLS_REQUIRED: Config.boolean('DATABASE_TLS_REQUIRED').pipe(
    Config.withDefault(false),
  ),
  DATABASE_TLS_SERVER_NAME: optionalTrimmedString('DATABASE_TLS_SERVER_NAME'),
  DATABASE_URL: nonEmptyTrimmedString('DATABASE_URL'),
});

export const databaseConfig = databaseConfigValues.pipe(
  Config.mapOrFail((config) => {
    if (!config.DATABASE_TLS_REQUIRED) {
      return Effect.succeed(config);
    }

    const missingValues = [
      Option.isNone(config.DATABASE_TLS_CA_CERTIFICATE)
        ? 'DATABASE_TLS_CA_CERTIFICATE'
        : undefined,
      Option.isNone(config.DATABASE_TLS_SERVER_NAME)
        ? 'DATABASE_TLS_SERVER_NAME'
        : undefined,
    ].filter((value): value is string => value !== undefined);
    return missingValues.length === 0
      ? Effect.succeed(config)
      : Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: `${missingValues.join(' and ')} must be configured when DATABASE_TLS_REQUIRED=true`,
            }),
          ),
        );
  }),
);

export type DatabaseConfig = Config.Success<typeof databaseConfig>;
