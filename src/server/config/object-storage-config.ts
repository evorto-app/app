import {
  Config,
  ConfigError,
  Effect,
  Option,
} from 'effect';

import { optionalTrimmedString } from './config-string';

export const objectStorageStateConfig = Config.all({
  S3_ACCESS_KEY_ID: optionalTrimmedString('S3_ACCESS_KEY_ID'),
  S3_BUCKET: optionalTrimmedString('S3_BUCKET').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => 'testing',
        onSome: (bucket) => bucket,
      }),
    ),
  ),
  S3_ENDPOINT: optionalTrimmedString('S3_ENDPOINT'),
  S3_REGION: optionalTrimmedString('S3_REGION').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => 'auto',
        onSome: (region) => region,
      }),
    ),
  ),
  S3_SECRET_ACCESS_KEY: optionalTrimmedString('S3_SECRET_ACCESS_KEY'),
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

export const objectStorageConfig = Effect.gen(function* () {
  const state = yield* objectStorageStateConfig;
  if (
    Option.isNone(state.S3_ENDPOINT) ||
    Option.isNone(state.S3_ACCESS_KEY_ID) ||
    Option.isNone(state.S3_SECRET_ACCESS_KEY)
  ) {
    const errors = [
      Option.isSome(state.S3_ENDPOINT)
        ? undefined
        : toMissingFieldError('S3_ENDPOINT'),
      Option.isSome(state.S3_ACCESS_KEY_ID)
        ? undefined
        : toMissingFieldError('S3_ACCESS_KEY_ID'),
      Option.isSome(state.S3_SECRET_ACCESS_KEY)
        ? undefined
        : toMissingFieldError('S3_SECRET_ACCESS_KEY'),
    ].filter((value): value is ConfigError.ConfigError => value !== undefined);

    if (errors.length === 0) {
      throw new Error('Expected missing object storage config errors');
    }

    return yield* Effect.fail(combineConfigErrors(errors));
  }

  const accessKeyId = Option.getOrUndefined(state.S3_ACCESS_KEY_ID);
  const endpoint = Option.getOrUndefined(state.S3_ENDPOINT);
  const secretAccessKey = Option.getOrUndefined(state.S3_SECRET_ACCESS_KEY);

  if (!accessKeyId || !endpoint || !secretAccessKey) {
    throw new Error('Expected validated object storage configuration values');
  }

  return {
    accessKeyId,
    bucket: state.S3_BUCKET,
    endpoint,
    region: state.S3_REGION,
    secretAccessKey,
  } satisfies ObjectStorageConfig;
});
