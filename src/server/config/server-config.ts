import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalTrimmedString } from './config-string';

export const serverConfig = Config.all({
  BASE_URL: optionalTrimmedString('BASE_URL'),
  NODE_ENV: optionalTrimmedString('NODE_ENV'),
  PORT: Config.port('PORT').pipe(Config.withDefault(4000)),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalTrimmedString(
    'PUBLIC_GOOGLE_MAPS_API_KEY',
  ),
  PUBLIC_SENTRY_DSN: optionalTrimmedString('PUBLIC_SENTRY_DSN'),
});

export type ServerConfig = Config.Config.Success<typeof serverConfig>;

export const loadServerConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): ServerConfig => loadConfigSync('server', serverConfig, provider);
