import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalStringConfig, portWithDefaultConfig } from './config-helpers';

export const serverConfig = Config.all({
  BASE_URL: optionalStringConfig('BASE_URL'),
  NODE_ENV: optionalStringConfig('NODE_ENV'),
  PORT: portWithDefaultConfig('PORT', 4000),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalStringConfig(
    'PUBLIC_GOOGLE_MAPS_API_KEY',
  ),
  PUBLIC_SENTRY_DSN: optionalStringConfig('PUBLIC_SENTRY_DSN'),
});

export type ServerConfig = Config.Config.Success<typeof serverConfig>;

export const loadServerConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): ServerConfig => loadConfigSync('server', serverConfig, provider);
