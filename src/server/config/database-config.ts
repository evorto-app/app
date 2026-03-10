import { Config, Option } from 'effect';

import { loadConfigSync } from './config-error';
import {
  nonEmptyTrimmedStringConfig,
  toOptionalString,
  trimmedStringConfig,
} from './config-string';

const optionalDatabaseStringConfig = (name: string) =>
  Config.option(trimmedStringConfig(name)).pipe(
    Config.map((value) => toOptionalString(Option.getOrUndefined(value))),
  );

const optionalDatabaseStringWithDefaultConfig = (
  name: string,
  defaultValue: string,
) =>
  Config.option(trimmedStringConfig(name)).pipe(
    Config.map((value) => toOptionalString(Option.getOrUndefined(value))),
    Config.map((value) => value ?? defaultValue),
  );

export const databaseConfig = Config.all({
  BRANCH_ID: optionalDatabaseStringConfig('BRANCH_ID'),
  DATABASE_URL: nonEmptyTrimmedStringConfig('DATABASE_URL'),
  DELETE_BRANCH: Config.boolean('DELETE_BRANCH').pipe(Config.withDefault(true)),
  NEON_API_KEY: optionalDatabaseStringConfig('NEON_API_KEY'),
  NEON_DATABASE_NAME: optionalDatabaseStringWithDefaultConfig(
    'NEON_DATABASE_NAME',
    'appdb',
  ),
  NEON_LOCAL_HOST_PORT: Config.port('NEON_LOCAL_HOST_PORT').pipe(
    Config.withDefault(55_432),
  ),
  NEON_LOCAL_PROXY: Config.boolean('NEON_LOCAL_PROXY').pipe(
    Config.withDefault(false),
  ),
  NEON_PROJECT_ID: optionalDatabaseStringConfig('NEON_PROJECT_ID'),
  PARENT_BRANCH_ID: optionalDatabaseStringConfig('PARENT_BRANCH_ID'),
});

export type DatabaseConfig = Config.Config.Success<typeof databaseConfig>;

export const loadDatabaseConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): DatabaseConfig => loadConfigSync('database', databaseConfig, provider);
