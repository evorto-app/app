import { Config, ConfigError, Either, LogLevel, Option } from 'effect';

import { optionalTrimmedString } from './config-string';

const serverLogLevelNames = [
  'all',
  'debug',
  'error',
  'fatal',
  'info',
  'none',
  'off',
  'trace',
  'warn',
  'warning',
] as const;

const actionsStepDebugConfig = Config.boolean('ACTIONS_STEP_DEBUG').pipe(
  Config.withDefault(false),
);
const baseUrlConfig = optionalTrimmedString('BASE_URL');
const ciConfig = Config.boolean('CI').pipe(Config.withDefault(false));
const pinnedNowIsoConfig = optionalTrimmedString('E2E_NOW_ISO');
const nodeEnvironmentConfig = optionalTrimmedString('NODE_ENV');
const packageVersionConfig = optionalTrimmedString('npm_package_version');
const portConfig = Config.port('PORT').pipe(Config.withDefault(4000));
const publicGoogleMapsApiKeyConfig = optionalTrimmedString(
  'PUBLIC_GOOGLE_MAPS_API_KEY',
);
const publicSentryDsnConfig = optionalTrimmedString('PUBLIC_SENTRY_DSN');

const parseServerLogLevel = (
  configuredLevel: string,
): Either.Either<LogLevel.LogLevel, ConfigError.ConfigError> => {
  switch (configuredLevel.toLowerCase()) {
    case 'all': {
      return Either.right(LogLevel.All);
    }
    case 'debug': {
      return Either.right(LogLevel.Debug);
    }
    case 'error': {
      return Either.right(LogLevel.Error);
    }
    case 'fatal': {
      return Either.right(LogLevel.Fatal);
    }
    case 'info': {
      return Either.right(LogLevel.Info);
    }
    case 'none':
    case 'off': {
      return Either.right(LogLevel.None);
    }
    case 'trace': {
      return Either.right(LogLevel.Trace);
    }
    case 'warn':
    case 'warning': {
      return Either.right(LogLevel.Warning);
    }
    default: {
      return Either.left(
        ConfigError.InvalidData(
          ['SERVER_LOG_LEVEL'],
          `Expected SERVER_LOG_LEVEL to be one of (${serverLogLevelNames.join(', ')}) but received ${JSON.stringify(configuredLevel)}`,
        ),
      );
    }
  }
};

const serverLogLevelConfig = optionalTrimmedString('SERVER_LOG_LEVEL').pipe(
  Config.mapOrFail((configuredLevel) =>
    Option.match(configuredLevel, {
      onNone: () => Either.right(Option.none()),
      onSome: (value) =>
        parseServerLogLevel(value).pipe(
          Either.map((parsedLevel) => Option.some(parsedLevel)),
        ),
    }),
  ),
);

export const serverLoggingConfig = Config.all({
  ACTIONS_STEP_DEBUG: actionsStepDebugConfig,
  CI: ciConfig,
  SERVER_LOG_LEVEL: serverLogLevelConfig,
});

export const serverNetworkConfig = Config.all({
  BASE_URL: baseUrlConfig,
  PORT: portConfig,
});

export const serverTelemetryConfig = Config.all({
  PACKAGE_VERSION: packageVersionConfig,
});

export const serverConfig = Config.all({
  ACTIONS_STEP_DEBUG: actionsStepDebugConfig,
  BASE_URL: baseUrlConfig,
  CI: ciConfig,
  E2E_NOW_ISO: pinnedNowIsoConfig,
  NODE_ENV: nodeEnvironmentConfig,
  PACKAGE_VERSION: packageVersionConfig,
  PORT: portConfig,
  PUBLIC_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKeyConfig,
  PUBLIC_SENTRY_DSN: publicSentryDsnConfig,
  SERVER_LOG_LEVEL: serverLogLevelConfig,
});

export type ServerConfig = Config.Config.Success<typeof serverConfig>;
export type ServerLoggingConfig = Config.Config.Success<typeof serverLoggingConfig>;
