import {
  nonEmptyTrimmedString,
  optionalTrimmedString,
} from '@server/config/config-string';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

const boundedInteger = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  Config.Int(name).pipe(
    Config.withDefault(fallback),
    Config.mapEffect((value) =>
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
    Config.Redacted('DATABASE_TLS_CA_CERTIFICATE'),
  ).pipe(
    Config.mapEffect((certificate) =>
      Option.isSome(certificate) &&
      Redacted.value(certificate.value).trim().length === 0
        ? Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: 'DATABASE_TLS_CA_CERTIFICATE must not be blank',
              }),
            ),
          )
        : Effect.succeed(certificate),
    ),
  ),
  DATABASE_TLS_REQUIRED: Config.Boolean('DATABASE_TLS_REQUIRED'),
  DATABASE_TLS_SERVER_NAME: optionalTrimmedString('DATABASE_TLS_SERVER_NAME'),
  DATABASE_URL: nonEmptyTrimmedString('DATABASE_URL'),
});

export const databaseConfig = databaseConfigValues.pipe(
  Config.mapEffect((config) =>
    config.DATABASE_TLS_REQUIRED &&
    Option.isNone(config.DATABASE_TLS_CA_CERTIFICATE)
      ? Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message:
                'DATABASE_TLS_CA_CERTIFICATE must be configured when DATABASE_TLS_REQUIRED=true',
            }),
          ),
        )
      : Effect.succeed(config),
  ),
);

export type DatabaseConfig = Config.Success<typeof databaseConfig>;
