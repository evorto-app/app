import { Config, ConfigError, type ConfigProvider, Effect } from 'effect';
import path from 'node:path';

import { loadConfigSync } from './config-error';
import {
  booleanWithDefaultConfig,
  optionalStringConfig,
  requiredStringConfig,
} from './config-helpers';

const DEFAULT_TEST_CLOCK_ISO = '2026-02-01T12:00:00.000Z';
const DEFAULT_TEST_SEED_KEY = 'evorto-e2e-default-v1';

export const testRuntimeConfigState = Config.all({
  AUTH0_MANAGEMENT_CLIENT_ID: optionalStringConfig(
    'AUTH0_MANAGEMENT_CLIENT_ID',
  ),
  AUTH0_MANAGEMENT_CLIENT_SECRET: optionalStringConfig(
    'AUTH0_MANAGEMENT_CLIENT_SECRET',
  ),
  BASE_URL: optionalStringConfig('BASE_URL'),
  CI: booleanWithDefaultConfig('CI', false),
  CLIENT_ID: optionalStringConfig('CLIENT_ID'),
  CLIENT_SECRET: optionalStringConfig('CLIENT_SECRET'),
  CLOUDFLARE_ACCOUNT_ID: optionalStringConfig('CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_IMAGES_API_TOKEN: optionalStringConfig(
    'CLOUDFLARE_IMAGES_API_TOKEN',
  ),
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalStringConfig(
    'CLOUDFLARE_IMAGES_DELIVERY_HASH',
  ),
  DATABASE_URL: requiredStringConfig('DATABASE_URL'),
  DOCS_IMG_OUT_DIR: optionalStringConfig('DOCS_IMG_OUT_DIR').pipe(
    Config.withDefault(path.resolve('test-results/docs/images')),
  ),
  DOCS_OUT_DIR: optionalStringConfig('DOCS_OUT_DIR').pipe(
    Config.withDefault(path.resolve('test-results/docs')),
  ),
  E2E_NOW_ISO: optionalStringConfig('E2E_NOW_ISO').pipe(
    Config.withDefault(DEFAULT_TEST_CLOCK_ISO),
  ),
  E2E_SEED_KEY: optionalStringConfig('E2E_SEED_KEY').pipe(
    Config.withDefault(DEFAULT_TEST_SEED_KEY),
  ),
  ISSUER_BASE_URL: optionalStringConfig('ISSUER_BASE_URL'),
  NO_WEBSERVER: booleanWithDefaultConfig('NO_WEBSERVER', false),
  S3_ACCESS_KEY_ID: optionalStringConfig('S3_ACCESS_KEY_ID'),
  S3_BUCKET: optionalStringConfig('S3_BUCKET'),
  S3_ENDPOINT: optionalStringConfig('S3_ENDPOINT'),
  S3_REGION: optionalStringConfig('S3_REGION'),
  S3_SECRET_ACCESS_KEY: optionalStringConfig('S3_SECRET_ACCESS_KEY'),
  SECRET: optionalStringConfig('SECRET'),
  STRIPE_API_KEY: optionalStringConfig('STRIPE_API_KEY'),
  STRIPE_TEST_ACCOUNT_ID: optionalStringConfig('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalStringConfig('STRIPE_WEBHOOK_SECRET'),
  TENANT_DOMAIN: optionalStringConfig('TENANT_DOMAIN'),
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
  | (Config.Config.Success<typeof testRuntimeConfigState> & {
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
  | (Config.Config.Success<typeof testRuntimeConfigState> & {
      NO_WEBSERVER: true;
    });

export type TestRuntimeConfigState = Config.Config.Success<
  typeof testRuntimeConfigState
>;

const combineMissingDataErrors = (
  errors: readonly ConfigError.ConfigError[],
): ConfigError.ConfigError => {
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
): Effect.Effect<void, ConfigError.ConfigError> => {
  if (!state.CI) {
    return Effect.void;
  }

  const errors = [
    state.CLOUDFLARE_ACCOUNT_ID
      ? undefined
      : missingFieldError('CLOUDFLARE_ACCOUNT_ID'),
    state.CLOUDFLARE_IMAGES_API_TOKEN
      ? undefined
      : missingFieldError('CLOUDFLARE_IMAGES_API_TOKEN'),
    state.CLOUDFLARE_IMAGES_DELIVERY_HASH
      ? undefined
      : missingFieldError('CLOUDFLARE_IMAGES_DELIVERY_HASH'),
    state.S3_ACCESS_KEY_ID ? undefined : missingFieldError('S3_ACCESS_KEY_ID'),
    state.S3_BUCKET ? undefined : missingFieldError('S3_BUCKET'),
    state.S3_ENDPOINT ? undefined : missingFieldError('S3_ENDPOINT'),
    state.S3_REGION ? undefined : missingFieldError('S3_REGION'),
    state.S3_SECRET_ACCESS_KEY
      ? undefined
      : missingFieldError('S3_SECRET_ACCESS_KEY'),
    state.STRIPE_TEST_ACCOUNT_ID
      ? undefined
      : missingFieldError('STRIPE_TEST_ACCOUNT_ID'),
  ].filter((value): value is ConfigError.ConfigError => value !== undefined);

  return errors.length > 0
    ? Effect.fail(combineMissingDataErrors(errors))
    : Effect.void;
};

const playwrightEnvironmentConfig = Effect.gen(function* () {
  const state = yield* testRuntimeConfigState;
  yield* validateCiEnvironment(state);

  if (state.NO_WEBSERVER) {
    return {
      ...state,
      NO_WEBSERVER: true as const,
    } satisfies PlaywrightEnvironment;
  }

  const errors = [
    state.BASE_URL ? undefined : missingFieldError('BASE_URL'),
    state.CLIENT_ID ? undefined : missingFieldError('CLIENT_ID'),
    state.CLIENT_SECRET ? undefined : missingFieldError('CLIENT_SECRET'),
    state.ISSUER_BASE_URL ? undefined : missingFieldError('ISSUER_BASE_URL'),
    state.SECRET ? undefined : missingFieldError('SECRET'),
    state.STRIPE_API_KEY ? undefined : missingFieldError('STRIPE_API_KEY'),
    state.STRIPE_TEST_ACCOUNT_ID
      ? undefined
      : missingFieldError('STRIPE_TEST_ACCOUNT_ID'),
    state.STRIPE_WEBHOOK_SECRET
      ? undefined
      : missingFieldError('STRIPE_WEBHOOK_SECRET'),
  ].filter((value): value is ConfigError.ConfigError => value !== undefined);

  if (errors.length > 0) {
    return yield* Effect.fail(combineMissingDataErrors(errors));
  }

  const baseUrl = state.BASE_URL;
  const clientId = state.CLIENT_ID;
  const clientSecret = state.CLIENT_SECRET;
  const issuerBaseUrl = state.ISSUER_BASE_URL;
  const secret = state.SECRET;
  const stripeApiKey = state.STRIPE_API_KEY;
  const stripeTestAccountId = state.STRIPE_TEST_ACCOUNT_ID;
  const stripeWebhookSecret = state.STRIPE_WEBHOOK_SECRET;

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

export const validatePlaywrightEnvironment = (
  provider?: ConfigProvider.ConfigProvider,
): PlaywrightEnvironment => {
  return loadConfigSync(
    'Playwright e2e',
    playwrightEnvironmentConfig,
    provider,
  );
};

export const hasAuth0ManagementEnvironment = (
  provider?: ConfigProvider.ConfigProvider,
): boolean => {
  const state = loadConfigSync(
    'e2e auth state',
    testRuntimeConfigState,
    provider,
  );
  return Boolean(
    state.AUTH0_MANAGEMENT_CLIENT_ID && state.AUTH0_MANAGEMENT_CLIENT_SECRET,
  );
};

export const getAuth0ManagementEnvironment = (
  provider?: ConfigProvider.ConfigProvider,
): Auth0ManagementEnvironment => {
  const state = loadConfigSync(
    'e2e auth state',
    testRuntimeConfigState,
    provider,
  );
  const errors = [
    state.AUTH0_MANAGEMENT_CLIENT_ID
      ? undefined
      : missingFieldError('AUTH0_MANAGEMENT_CLIENT_ID'),
    state.AUTH0_MANAGEMENT_CLIENT_SECRET
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

  const managementClientId = state.AUTH0_MANAGEMENT_CLIENT_ID;
  const managementClientSecret = state.AUTH0_MANAGEMENT_CLIENT_SECRET;

  if (!managementClientId || !managementClientSecret) {
    throw new Error('Expected validated Auth0 management configuration values');
  }

  return {
    AUTH0_MANAGEMENT_CLIENT_ID: managementClientId,
    AUTH0_MANAGEMENT_CLIENT_SECRET: managementClientSecret,
  };
};

export const resolveDocumentationOutputEnvironment = (
  provider?: ConfigProvider.ConfigProvider,
): DocumentationOutputEnvironment => {
  const state = loadConfigSync(
    'documentation output',
    testRuntimeConfigState,
    provider,
  );

  const documentationImageOutputDirectory =
    state.DOCS_IMG_OUT_DIR ?? path.resolve('test-results/docs/images');
  const documentationOutputDirectory =
    state.DOCS_OUT_DIR ?? path.resolve('test-results/docs');

  return {
    docsImageOutputDirectory: documentationImageOutputDirectory,
    docsOutputDirectory: documentationOutputDirectory,
  };
};
