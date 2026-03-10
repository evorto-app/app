import {
  Config,
  ConfigError,
  Effect,
  Option,
} from 'effect';

import { optionalTrimmedString } from './config-string';

export const cloudflareImagesStateConfig = Config.all({
  CLOUDFLARE_ACCOUNT_ID: optionalTrimmedString('CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_IMAGES_API_TOKEN: optionalTrimmedString(
    'CLOUDFLARE_IMAGES_API_TOKEN',
  ),
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalTrimmedString(
    'CLOUDFLARE_IMAGES_DELIVERY_HASH',
  ),
  CLOUDFLARE_IMAGES_ENVIRONMENT: optionalTrimmedString(
    'CLOUDFLARE_IMAGES_ENVIRONMENT',
  ),
  CLOUDFLARE_IMAGES_VARIANT: optionalTrimmedString('CLOUDFLARE_IMAGES_VARIANT'),
  NODE_ENV: optionalTrimmedString('NODE_ENV'),
});

export interface CloudflareImagesConfig {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_IMAGES_API_TOKEN: string;
  CLOUDFLARE_IMAGES_DELIVERY_HASH: string;
  CLOUDFLARE_IMAGES_ENVIRONMENT: Option.Option<string>;
  CLOUDFLARE_IMAGES_VARIANT: Option.Option<string>;
  NODE_ENV: Option.Option<string>;
}

export type CloudflareImagesConfigState = Config.Config.Success<
  typeof cloudflareImagesStateConfig
>;

const toMissingFieldError = (name: string) =>
  ConfigError.MissingData([name], `Expected ${name} to be configured`);

const combineConfigErrors = (
  errors: readonly ConfigError.ConfigError[],
): ConfigError.ConfigError => {
  const [firstError, ...remainingErrors] = errors;
  if (!firstError) {
    throw new Error('Expected at least one Cloudflare Images config error');
  }

  let combinedError = firstError;
  for (const error of remainingErrors) {
    combinedError = ConfigError.And(combinedError, error);
  }

  return combinedError;
};

export const cloudflareImagesConfig = Effect.gen(function* () {
  const state = yield* cloudflareImagesStateConfig;
  if (
    Option.isNone(state.CLOUDFLARE_ACCOUNT_ID) ||
    Option.isNone(state.CLOUDFLARE_IMAGES_API_TOKEN) ||
    Option.isNone(state.CLOUDFLARE_IMAGES_DELIVERY_HASH)
  ) {
    const errors = [
      Option.isSome(state.CLOUDFLARE_ACCOUNT_ID)
        ? undefined
        : toMissingFieldError('CLOUDFLARE_ACCOUNT_ID'),
      Option.isSome(state.CLOUDFLARE_IMAGES_API_TOKEN)
        ? undefined
        : toMissingFieldError('CLOUDFLARE_IMAGES_API_TOKEN'),
      Option.isSome(state.CLOUDFLARE_IMAGES_DELIVERY_HASH)
        ? undefined
        : toMissingFieldError('CLOUDFLARE_IMAGES_DELIVERY_HASH'),
    ].filter((value): value is ConfigError.ConfigError => value !== undefined);

    if (errors.length === 0) {
      throw new Error('Expected missing Cloudflare Images config errors');
    }

    return yield* Effect.fail(combineConfigErrors(errors));
  }

  const accountId = Option.getOrUndefined(state.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = Option.getOrUndefined(state.CLOUDFLARE_IMAGES_API_TOKEN);
  const deliveryHash = Option.getOrUndefined(
    state.CLOUDFLARE_IMAGES_DELIVERY_HASH,
  );

  if (!accountId || !apiToken || !deliveryHash) {
    throw new Error(
      'Expected validated Cloudflare Images configuration values',
    );
  }

  return {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_IMAGES_API_TOKEN: apiToken,
    CLOUDFLARE_IMAGES_DELIVERY_HASH: deliveryHash,
    CLOUDFLARE_IMAGES_ENVIRONMENT: state.CLOUDFLARE_IMAGES_ENVIRONMENT,
    CLOUDFLARE_IMAGES_VARIANT: state.CLOUDFLARE_IMAGES_VARIANT,
    NODE_ENV: state.NODE_ENV,
  } satisfies CloudflareImagesConfig;
});

export const isCloudflareImagesConfigured = cloudflareImagesStateConfig.pipe(
  Effect.map(
    (state) =>
      Option.isSome(state.CLOUDFLARE_ACCOUNT_ID) &&
      Option.isSome(state.CLOUDFLARE_IMAGES_API_TOKEN) &&
      Option.isSome(state.CLOUDFLARE_IMAGES_DELIVERY_HASH),
  ),
);
