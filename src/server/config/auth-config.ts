import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import { nonEmptyTrimmedString, optionalTrimmedString } from './config-string';

export const authConfig = Config.all({
  AUDIENCE: optionalTrimmedString('AUDIENCE'),
  BASE_URL: nonEmptyTrimmedString('BASE_URL'),
  CLIENT_ID: nonEmptyTrimmedString('CLIENT_ID'),
  CLIENT_SECRET: nonEmptyTrimmedString('CLIENT_SECRET'),
  ISSUER_BASE_URL: nonEmptyTrimmedString('ISSUER_BASE_URL'),
  SECRET: nonEmptyTrimmedString('SECRET'),
});

export type AuthConfig = Config.Config.Success<typeof authConfig>;

export const loadAuthConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): AuthConfig => loadConfigSync('auth', authConfig, provider);
