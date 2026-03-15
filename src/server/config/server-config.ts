import { Config } from 'effect';

import { optionalTrimmedString } from './config-string';

export const serverConfig = Config.all({
  ACTIONS_STEP_DEBUG: Config.boolean('ACTIONS_STEP_DEBUG').pipe(
    Config.withDefault(false),
  ),
  BASE_URL: optionalTrimmedString('BASE_URL'),
  CI: Config.boolean('CI').pipe(Config.withDefault(false)),
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO'),
  NODE_ENV: optionalTrimmedString('NODE_ENV'),
  PACKAGE_VERSION: optionalTrimmedString('npm_package_version'),
  PORT: Config.port('PORT').pipe(Config.withDefault(4000)),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalTrimmedString(
    'PUBLIC_GOOGLE_MAPS_API_KEY',
  ),
  PUBLIC_SENTRY_DSN: optionalTrimmedString('PUBLIC_SENTRY_DSN'),
  SERVER_LOG_LEVEL: optionalTrimmedString('SERVER_LOG_LEVEL'),
});

export type ServerConfig = Config.Config.Success<typeof serverConfig>;
