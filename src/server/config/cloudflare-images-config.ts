import { Config, ConfigError, type ConfigProvider, Effect } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalStringConfig } from './config-helpers';

export const cloudflareImagesStateConfig = Config.all({
  CLOUDFLARE_ACCOUNT_ID: optionalStringConfig('CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_IMAGES_API_TOKEN: optionalStringConfig(
    'CLOUDFLARE_IMAGES_API_TOKEN',
  ),
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalStringConfig(
    'CLOUDFLARE_IMAGES_DELIVERY_HASH',
  ),
  CLOUDFLARE_IMAGES_ENVIRONMENT: optionalStringConfig(
    'CLOUDFLARE_IMAGES_ENVIRONMENT',
  ),
  CLOUDFLARE_IMAGES_VARIANT: optionalStringConfig('CLOUDFLARE_IMAGES_VARIANT'),
  NODE_ENV: optionalStringConfig('NODE_ENV'),
});

export interface CloudflareImagesConfig {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_IMAGES_API_TOKEN: string;
  CLOUDFLARE_IMAGES_DELIVERY_HASH: string;
  CLOUDFLARE_IMAGES_ENVIRONMENT: string | undefined;
  CLOUDFLARE_IMAGES_VARIANT: string | undefined;
  NODE_ENV: string | undefined;
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

const cloudflareImagesConfig = Effect.gen(function* () {
  const state = yield* cloudflareImagesStateConfig;
  if (
    !state.CLOUDFLARE_ACCOUNT_ID ||
    !state.CLOUDFLARE_IMAGES_API_TOKEN ||
    !state.CLOUDFLARE_IMAGES_DELIVERY_HASH
  ) {
    const errors = [
      state.CLOUDFLARE_ACCOUNT_ID
        ? undefined
        : toMissingFieldError('CLOUDFLARE_ACCOUNT_ID'),
      state.CLOUDFLARE_IMAGES_API_TOKEN
        ? undefined
        : toMissingFieldError('CLOUDFLARE_IMAGES_API_TOKEN'),
      state.CLOUDFLARE_IMAGES_DELIVERY_HASH
        ? undefined
        : toMissingFieldError('CLOUDFLARE_IMAGES_DELIVERY_HASH'),
    ].filter((value): value is ConfigError.ConfigError => value !== undefined);

    if (errors.length === 0) {
      throw new Error('Expected missing Cloudflare Images config errors');
    }

    return yield* Effect.fail(combineConfigErrors(errors));
  }

  return {
    CLOUDFLARE_ACCOUNT_ID: state.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_IMAGES_API_TOKEN: state.CLOUDFLARE_IMAGES_API_TOKEN,
    CLOUDFLARE_IMAGES_DELIVERY_HASH: state.CLOUDFLARE_IMAGES_DELIVERY_HASH,
    CLOUDFLARE_IMAGES_ENVIRONMENT: state.CLOUDFLARE_IMAGES_ENVIRONMENT,
    CLOUDFLARE_IMAGES_VARIANT: state.CLOUDFLARE_IMAGES_VARIANT,
    NODE_ENV: state.NODE_ENV,
  } satisfies CloudflareImagesConfig;
});

export const loadCloudflareImagesConfigSync = (
  provider?: ConfigProvider.ConfigProvider,
): CloudflareImagesConfig =>
  loadConfigSync('Cloudflare Images', cloudflareImagesConfig, provider);

export const loadCloudflareImagesStateSync = (
  provider?: ConfigProvider.ConfigProvider,
): CloudflareImagesConfigState =>
  loadConfigSync(
    'Cloudflare Images state',
    cloudflareImagesStateConfig,
    provider,
  );

export const isCloudflareImagesConfiguredSync = (
  provider?: ConfigProvider.ConfigProvider,
): boolean => {
  const state = loadCloudflareImagesStateSync(provider);
  return Boolean(
    state.CLOUDFLARE_ACCOUNT_ID &&
    state.CLOUDFLARE_IMAGES_API_TOKEN &&
    state.CLOUDFLARE_IMAGES_DELIVERY_HASH,
  );
};
