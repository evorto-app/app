import {
  Config,
  ConfigError,
  Effect,
  Option,
} from 'effect';

import { missingFieldError } from './config-error';
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

const combineConfigErrors = (
  errors: readonly ConfigError.ConfigError[],
) => {
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

const getRequiredConfigValue = <A>(
  option: Option.Option<A>,
  message: string,
) =>
  Option.match(option, {
    onNone: () => Effect.die(new Error(message)),
    onSome: (value) => Effect.succeed(value),
  });

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
        : missingFieldError('CLOUDFLARE_ACCOUNT_ID'),
      Option.isSome(state.CLOUDFLARE_IMAGES_API_TOKEN)
        ? undefined
        : missingFieldError('CLOUDFLARE_IMAGES_API_TOKEN'),
      Option.isSome(state.CLOUDFLARE_IMAGES_DELIVERY_HASH)
        ? undefined
        : missingFieldError('CLOUDFLARE_IMAGES_DELIVERY_HASH'),
    ].filter((value): value is ConfigError.ConfigError => value !== undefined);

    return yield* Effect.fail(combineConfigErrors(errors));
  }

  const accountId = yield* getRequiredConfigValue(
    state.CLOUDFLARE_ACCOUNT_ID,
    'Expected validated Cloudflare account id',
  );
  const apiToken = yield* getRequiredConfigValue(
    state.CLOUDFLARE_IMAGES_API_TOKEN,
    'Expected validated Cloudflare images API token',
  );
  const deliveryHash = yield* getRequiredConfigValue(
    state.CLOUDFLARE_IMAGES_DELIVERY_HASH,
    'Expected validated Cloudflare delivery hash',
  );

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
