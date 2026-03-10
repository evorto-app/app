import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import {
  booleanWithDefaultConfig,
  optionalStringConfig,
  portWithDefaultConfig,
  requiredStringConfig,
} from './config-helpers';

export const databaseConfig = Config.all({
  BRANCH_ID: optionalStringConfig('BRANCH_ID'),
  DATABASE_URL: requiredStringConfig('DATABASE_URL'),
  DELETE_BRANCH: booleanWithDefaultConfig('DELETE_BRANCH', true),
  NEON_API_KEY: optionalStringConfig('NEON_API_KEY'),
  NEON_DATABASE_NAME: optionalStringConfig('NEON_DATABASE_NAME').pipe(
    Config.withDefault('appdb'),
  ),
  NEON_LOCAL_HOST_PORT: portWithDefaultConfig('NEON_LOCAL_HOST_PORT', 55_432),
  NEON_LOCAL_PROXY: booleanWithDefaultConfig('NEON_LOCAL_PROXY', false),
  NEON_PROJECT_ID: optionalStringConfig('NEON_PROJECT_ID'),
  PARENT_BRANCH_ID: optionalStringConfig('PARENT_BRANCH_ID'),
});

export type DatabaseConfig = Config.Config.Success<typeof databaseConfig>;

export const loadDatabaseConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): DatabaseConfig => loadConfigSync('database', databaseConfig, provider);
