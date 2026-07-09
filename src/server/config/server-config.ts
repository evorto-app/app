import {
  Config,
  ConfigProvider,
  Effect,
  LogLevel,
  Option,
  Schema,
} from 'effect';

import { nonEmptyTrimmedString, optionalTrimmedString } from './config-string';

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
const resendApiKeyConfig = nonEmptyTrimmedString('RESEND_API_KEY');
const resendDefaultFromConfig = nonEmptyTrimmedString('RESEND_DEFAULT_FROM');

const serverLogLevelName = Schema.Literals(serverLogLevelNames);
const serverLogLevelByName = {
  all: 'All',
  debug: 'Debug',
  error: 'Error',
  fatal: 'Fatal',
  info: 'Info',
  none: 'None',
  off: 'None',
  trace: 'Trace',
  warn: 'Warn',
  warning: 'Warn',
} satisfies Record<(typeof serverLogLevelNames)[number], LogLevel.LogLevel>;
const serverLogLevelNamesList = serverLogLevelNames.join(', ');

const parseServerLogLevel = (configuredLevel: string) =>
  Schema.decodeUnknownEffect(serverLogLevelName)(
    configuredLevel.toLowerCase(),
  ).pipe(
    Effect.map((levelName) => serverLogLevelByName[levelName]),
    Effect.mapError(
      () =>
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message: `Expected SERVER_LOG_LEVEL to be one of ${serverLogLevelNamesList}, got "${configuredLevel}"`,
          }),
        ),
    ),
  );

const serverLogLevelConfig = optionalTrimmedString('SERVER_LOG_LEVEL').pipe(
  Config.mapOrFail(
    (
      configuredLevel,
    ): Effect.Effect<Option.Option<LogLevel.LogLevel>, Config.ConfigError> =>
      Option.match(configuredLevel, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (value) =>
          parseServerLogLevel(value).pipe(
            Effect.map((parsedLevel) => Option.fromIterable([parsedLevel])),
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

export const serverEmailConfig = Config.all({
  RESEND_API_KEY: resendApiKeyConfig,
  RESEND_DEFAULT_FROM: resendDefaultFromConfig,
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
  RESEND_API_KEY: resendApiKeyConfig,
  RESEND_DEFAULT_FROM: resendDefaultFromConfig,
  SERVER_LOG_LEVEL: serverLogLevelConfig,
});

export type ServerConfig = Config.Success<typeof serverConfig>;
export type ServerEmailConfig = Config.Success<typeof serverEmailConfig>;
export type ServerLoggingConfig = Config.Success<typeof serverLoggingConfig>;
