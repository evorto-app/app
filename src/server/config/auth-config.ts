import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalStringConfig, requiredStringConfig } from './config-helpers';

export const authConfig = Config.all({
  AUDIENCE: optionalStringConfig('AUDIENCE'),
  BASE_URL: requiredStringConfig('BASE_URL'),
  CLIENT_ID: requiredStringConfig('CLIENT_ID'),
  CLIENT_SECRET: requiredStringConfig('CLIENT_SECRET'),
  ISSUER_BASE_URL: requiredStringConfig('ISSUER_BASE_URL'),
  SECRET: requiredStringConfig('SECRET'),
});

export type AuthConfig = Config.Config.Success<typeof authConfig>;

export const loadAuthConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): AuthConfig => loadConfigSync('auth', authConfig, provider);
