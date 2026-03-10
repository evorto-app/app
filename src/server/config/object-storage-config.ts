import { Config, ConfigError, type ConfigProvider, Effect } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalStringConfig } from './config-helpers';

export const objectStorageStateConfig = Config.all({
  S3_ACCESS_KEY_ID: optionalStringConfig('S3_ACCESS_KEY_ID'),
  S3_BUCKET: optionalStringConfig('S3_BUCKET').pipe(
    Config.withDefault('testing'),
  ),
  S3_ENDPOINT: optionalStringConfig('S3_ENDPOINT'),
  S3_REGION: optionalStringConfig('S3_REGION').pipe(Config.withDefault('auto')),
  S3_SECRET_ACCESS_KEY: optionalStringConfig('S3_SECRET_ACCESS_KEY'),
});

export interface ObjectStorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
}

export type ObjectStorageConfigState = Config.Config.Success<
  typeof objectStorageStateConfig
>;

const toMissingFieldError = (name: string) =>
  ConfigError.MissingData([name], `Expected ${name} to be configured`);

const combineConfigErrors = (
  errors: readonly ConfigError.ConfigError[],
): ConfigError.ConfigError => {
  const [firstError, ...remainingErrors] = errors;
  if (!firstError) {
    throw new Error('Expected at least one object storage config error');
  }

  let combinedError = firstError;
  for (const error of remainingErrors) {
    combinedError = ConfigError.And(combinedError, error);
  }

  return combinedError;
};

const objectStorageConfig = Effect.gen(function* () {
  const state = yield* objectStorageStateConfig;
  if (
    !state.S3_ENDPOINT ||
    !state.S3_ACCESS_KEY_ID ||
    !state.S3_SECRET_ACCESS_KEY
  ) {
    const errors = [
      state.S3_ENDPOINT ? undefined : toMissingFieldError('S3_ENDPOINT'),
      state.S3_ACCESS_KEY_ID
        ? undefined
        : toMissingFieldError('S3_ACCESS_KEY_ID'),
      state.S3_SECRET_ACCESS_KEY
        ? undefined
        : toMissingFieldError('S3_SECRET_ACCESS_KEY'),
    ].filter((value): value is ConfigError.ConfigError => value !== undefined);

    if (errors.length === 0) {
      throw new Error('Expected missing object storage config errors');
    }

    return yield* Effect.fail(combineConfigErrors(errors));
  }

  return {
    accessKeyId: state.S3_ACCESS_KEY_ID,
    bucket: state.S3_BUCKET ?? 'testing',
    endpoint: state.S3_ENDPOINT,
    region: state.S3_REGION ?? 'auto',
    secretAccessKey: state.S3_SECRET_ACCESS_KEY,
  } satisfies ObjectStorageConfig;
});

export const loadObjectStorageConfigSync = (
  provider?: ConfigProvider.ConfigProvider,
): ObjectStorageConfig =>
  loadConfigSync('object storage', objectStorageConfig, provider);

export const loadObjectStorageStateSync = (
  provider?: ConfigProvider.ConfigProvider,
): ObjectStorageConfigState =>
  loadConfigSync('object storage state', objectStorageStateConfig, provider);
