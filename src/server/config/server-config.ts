import { Config, Option } from 'effect';

import { loadConfigSync } from './config-error';
import { toOptionalString, trimmedStringConfig } from './config-string';

const optionalServerStringConfig = (name: string) =>
  Config.option(trimmedStringConfig(name)).pipe(
    Config.map((value) => toOptionalString(Option.getOrUndefined(value))),
  );

export const serverConfig = Config.all({
  BASE_URL: optionalServerStringConfig('BASE_URL'),
  NODE_ENV: optionalServerStringConfig('NODE_ENV'),
  PORT: Config.port('PORT').pipe(Config.withDefault(4000)),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalServerStringConfig(
    'PUBLIC_GOOGLE_MAPS_API_KEY',
  ),
  PUBLIC_SENTRY_DSN: optionalServerStringConfig('PUBLIC_SENTRY_DSN'),
});

export type ServerConfig = Config.Config.Success<typeof serverConfig>;

export const loadServerConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): ServerConfig => loadConfigSync('server', serverConfig, provider);
