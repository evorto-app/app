import { Config, Option } from 'effect';

import { loadConfigSync } from './config-error';
import {
  nonEmptyTrimmedStringConfig,
  toOptionalString,
  trimmedStringConfig,
} from './config-string';

const optionalAuthStringConfig = (name: string) =>
  Config.option(trimmedStringConfig(name)).pipe(
    Config.map((value) => toOptionalString(Option.getOrUndefined(value))),
  );

export const authConfig = Config.all({
  AUDIENCE: optionalAuthStringConfig('AUDIENCE'),
  BASE_URL: nonEmptyTrimmedStringConfig('BASE_URL'),
  CLIENT_ID: nonEmptyTrimmedStringConfig('CLIENT_ID'),
  CLIENT_SECRET: nonEmptyTrimmedStringConfig('CLIENT_SECRET'),
  ISSUER_BASE_URL: nonEmptyTrimmedStringConfig('ISSUER_BASE_URL'),
  SECRET: nonEmptyTrimmedStringConfig('SECRET'),
});

export type AuthConfig = Config.Config.Success<typeof authConfig>;

export const loadAuthConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): AuthConfig => loadConfigSync('auth', authConfig, provider);
