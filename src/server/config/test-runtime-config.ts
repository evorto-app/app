import {
  Config,
  ConfigError,
  Effect,
  Option,
} from 'effect';
import path from 'node:path';

import { nonEmptyTrimmedString, optionalTrimmedString } from './config-string';

const DEFAULT_TEST_CLOCK_ISO = '2026-02-01T12:00:00.000Z';
const DEFAULT_TEST_SEED_KEY = 'evorto-e2e-default-v1';

export const testRuntimeConfigState = Config.all({
  AUTH0_MANAGEMENT_CLIENT_ID: optionalTrimmedString(
    'AUTH0_MANAGEMENT_CLIENT_ID',
  ),
  AUTH0_MANAGEMENT_CLIENT_SECRET: optionalTrimmedString(
    'AUTH0_MANAGEMENT_CLIENT_SECRET',
  ),
  BASE_URL: optionalTrimmedString('BASE_URL'),
  CI: Config.boolean('CI').pipe(Config.withDefault(false)),
  CLIENT_ID: optionalTrimmedString('CLIENT_ID'),
  CLIENT_SECRET: optionalTrimmedString('CLIENT_SECRET'),
  CLOUDFLARE_ACCOUNT_ID: optionalTrimmedString('CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_IMAGES_API_TOKEN: optionalTrimmedString(
    'CLOUDFLARE_IMAGES_API_TOKEN',
  ),
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalTrimmedString(
    'CLOUDFLARE_IMAGES_DELIVERY_HASH',
  ),
  DATABASE_URL: nonEmptyTrimmedString('DATABASE_URL'),
  DOCS_IMG_OUT_DIR: optionalTrimmedString('DOCS_IMG_OUT_DIR').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => path.resolve('test-results/docs/images'),
        onSome: (outputDirectory) => outputDirectory,
      }),
    ),
  ),
  DOCS_OUT_DIR: optionalTrimmedString('DOCS_OUT_DIR').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => path.resolve('test-results/docs'),
        onSome: (outputDirectory) => outputDirectory,
      }),
    ),
  ),
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => DEFAULT_TEST_CLOCK_ISO,
        onSome: (nowIso) => nowIso,
      }),
    ),
  ),
  E2E_SEED_KEY: optionalTrimmedString('E2E_SEED_KEY').pipe(
    Config.map((value) =>
      Option.match(value, {
        onNone: () => DEFAULT_TEST_SEED_KEY,
        onSome: (seedKey) => seedKey,
      }),
    ),
  ),
  ISSUER_BASE_URL: optionalTrimmedString('ISSUER_BASE_URL'),
  NO_WEBSERVER: Config.boolean('NO_WEBSERVER').pipe(Config.withDefault(false)),
  S3_ACCESS_KEY_ID: optionalTrimmedString('S3_ACCESS_KEY_ID'),
  S3_BUCKET: optionalTrimmedString('S3_BUCKET'),
  S3_ENDPOINT: optionalTrimmedString('S3_ENDPOINT'),
  S3_REGION: optionalTrimmedString('S3_REGION'),
  S3_SECRET_ACCESS_KEY: optionalTrimmedString('S3_SECRET_ACCESS_KEY'),
  SECRET: optionalTrimmedString('SECRET'),
  STRIPE_API_KEY: optionalTrimmedString('STRIPE_API_KEY'),
  STRIPE_TEST_ACCOUNT_ID: optionalTrimmedString('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString('STRIPE_WEBHOOK_SECRET'),
  TENANT_DOMAIN: optionalTrimmedString('TENANT_DOMAIN'),
});

export interface Auth0ManagementEnvironment {
  AUTH0_MANAGEMENT_CLIENT_ID: string;
  AUTH0_MANAGEMENT_CLIENT_SECRET: string;
}

export interface DocumentationOutputEnvironment {
  docsImageOutputDirectory: string;
  docsOutputDirectory: string;
}

export type PlaywrightEnvironment =
  | (Omit<
      TestRuntimeConfigState,
      | 'BASE_URL'
      | 'CLIENT_ID'
      | 'CLIENT_SECRET'
      | 'ISSUER_BASE_URL'
      | 'SECRET'
      | 'STRIPE_API_KEY'
      | 'STRIPE_TEST_ACCOUNT_ID'
      | 'STRIPE_WEBHOOK_SECRET'
    > & {
      BASE_URL: string;
      CLIENT_ID: string;
      CLIENT_SECRET: string;
      ISSUER_BASE_URL: string;
      NO_WEBSERVER: false;
      SECRET: string;
      STRIPE_API_KEY: string;
      STRIPE_TEST_ACCOUNT_ID: string;
      STRIPE_WEBHOOK_SECRET: string;
    })
  | (TestRuntimeConfigState & {
      NO_WEBSERVER: true;
    });

export type TestRuntimeConfigState = Config.Config.Success<
  typeof testRuntimeConfigState
>;

const combineMissingDataErrors = (
  errors: readonly ConfigError.ConfigError[],
) => {
  const [firstError, ...restErrors] = errors;
  if (!firstError) {
    throw new Error('Expected at least one config error');
  }

  let combinedError = firstError;
  for (const error of restErrors) {
    combinedError = ConfigError.And(combinedError, error);
  }

  return combinedError;
};

const missingFieldError = (name: string) =>
  ConfigError.MissingData([name], `Expected ${name} to be configured`);

const validateCiEnvironment = (
  state: TestRuntimeConfigState,
) => {
  if (!state.CI) {
    return Effect.void;
  }

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
    Option.isSome(state.S3_ACCESS_KEY_ID)
      ? undefined
      : missingFieldError('S3_ACCESS_KEY_ID'),
    Option.isSome(state.S3_BUCKET) ? undefined : missingFieldError('S3_BUCKET'),
    Option.isSome(state.S3_ENDPOINT)
      ? undefined
      : missingFieldError('S3_ENDPOINT'),
    Option.isSome(state.S3_REGION) ? undefined : missingFieldError('S3_REGION'),
    Option.isSome(state.S3_SECRET_ACCESS_KEY)
      ? undefined
      : missingFieldError('S3_SECRET_ACCESS_KEY'),
    Option.isSome(state.STRIPE_TEST_ACCOUNT_ID)
      ? undefined
      : missingFieldError('STRIPE_TEST_ACCOUNT_ID'),
  ].filter((value): value is ConfigError.ConfigError => value !== undefined);

  return errors.length > 0
    ? Effect.fail(combineMissingDataErrors(errors))
    : Effect.void;
};

export const playwrightEnvironmentConfig = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;
  yield* validateCiEnvironment(state);

  if (state.NO_WEBSERVER) {
    return {
      ...state,
      NO_WEBSERVER: true as const,
    } satisfies PlaywrightEnvironment;
  }

  const errors = [
    Option.isSome(state.BASE_URL) ? undefined : missingFieldError('BASE_URL'),
    Option.isSome(state.CLIENT_ID) ? undefined : missingFieldError('CLIENT_ID'),
    Option.isSome(state.CLIENT_SECRET)
      ? undefined
      : missingFieldError('CLIENT_SECRET'),
    Option.isSome(state.ISSUER_BASE_URL)
      ? undefined
      : missingFieldError('ISSUER_BASE_URL'),
    Option.isSome(state.SECRET) ? undefined : missingFieldError('SECRET'),
    Option.isSome(state.STRIPE_API_KEY)
      ? undefined
      : missingFieldError('STRIPE_API_KEY'),
    Option.isSome(state.STRIPE_TEST_ACCOUNT_ID)
      ? undefined
      : missingFieldError('STRIPE_TEST_ACCOUNT_ID'),
    Option.isSome(state.STRIPE_WEBHOOK_SECRET)
      ? undefined
      : missingFieldError('STRIPE_WEBHOOK_SECRET'),
  ].filter((value): value is ConfigError.ConfigError => value !== undefined);

  if (errors.length > 0) {
    return yield* Effect.fail(combineMissingDataErrors(errors));
  }

  const baseUrl = Option.getOrUndefined(state.BASE_URL);
  const clientId = Option.getOrUndefined(state.CLIENT_ID);
  const clientSecret = Option.getOrUndefined(state.CLIENT_SECRET);
  const issuerBaseUrl = Option.getOrUndefined(state.ISSUER_BASE_URL);
  const secret = Option.getOrUndefined(state.SECRET);
  const stripeApiKey = Option.getOrUndefined(state.STRIPE_API_KEY);
  const stripeTestAccountId = Option.getOrUndefined(
    state.STRIPE_TEST_ACCOUNT_ID,
  );
  const stripeWebhookSecret = Option.getOrUndefined(
    state.STRIPE_WEBHOOK_SECRET,
  );

  if (
    !baseUrl ||
    !clientId ||
    !clientSecret ||
    !issuerBaseUrl ||
    !secret ||
    !stripeApiKey ||
    !stripeTestAccountId ||
    !stripeWebhookSecret
  ) {
    throw new Error('Expected validated Playwright configuration values');
  }

  return {
    ...state,
    BASE_URL: baseUrl,
    CLIENT_ID: clientId,
    CLIENT_SECRET: clientSecret,
    ISSUER_BASE_URL: issuerBaseUrl,
    NO_WEBSERVER: false as const,
    SECRET: secret,
    STRIPE_API_KEY: stripeApiKey,
    STRIPE_TEST_ACCOUNT_ID: stripeTestAccountId,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
  } satisfies PlaywrightEnvironment;
});

export const hasAuth0ManagementEnvironment = testRuntimeConfigState.pipe(
  Effect.map(
    (state) =>
      Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_ID) &&
      Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_SECRET),
  ),
);

export const auth0ManagementEnvironment = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;
  const errors = [
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_ID)
      ? undefined
      : missingFieldError('AUTH0_MANAGEMENT_CLIENT_ID'),
    Option.isSome(state.AUTH0_MANAGEMENT_CLIENT_SECRET)
      ? undefined
      : missingFieldError('AUTH0_MANAGEMENT_CLIENT_SECRET'),
  ].filter((value): value is ConfigError.ConfigError => value !== undefined);

  if (errors.length > 0) {
    throw new Error(
      `Invalid e2e auth configuration:\n${errors
        .map((error) =>
          error._op === 'MissingData'
            ? `- ${error.path.join('.')}: ${error.message}`
            : `- ${error.message}`,
        )
        .join('\n')}`,
    );
  }

  const managementClientId = Option.getOrUndefined(
    state.AUTH0_MANAGEMENT_CLIENT_ID,
  );
  const managementClientSecret = Option.getOrUndefined(
    state.AUTH0_MANAGEMENT_CLIENT_SECRET,
  );

  if (!managementClientId || !managementClientSecret) {
    throw new Error('Expected validated Auth0 management configuration values');
  }

  return {
    AUTH0_MANAGEMENT_CLIENT_ID: managementClientId,
    AUTH0_MANAGEMENT_CLIENT_SECRET: managementClientSecret,
  };
});

export const documentationOutputEnvironment = testRuntimeConfigState.pipe(
  Effect.map((state) => ({
    docsImageOutputDirectory: state.DOCS_IMG_OUT_DIR,
    docsOutputDirectory: state.DOCS_OUT_DIR,
  }) satisfies DocumentationOutputEnvironment),
);
