import dotenv from 'dotenv';
import path from 'node:path';
import { Either, ParseResult, Schema } from 'effect';

const dotenvResult = dotenv.config({ quiet: true });
if (
  process.env['DATABASE_URL'] === '' &&
  dotenvResult.parsed?.['DATABASE_URL'] !== undefined
) {
  process.env['DATABASE_URL'] = dotenvResult.parsed['DATABASE_URL'];
}

const optionalNonEmptyString = Schema.optional(Schema.NonEmptyString);

const TestEnvironmentSchema = Schema.Struct({
  AUTH0_MANAGEMENT_CLIENT_ID: optionalNonEmptyString,
  AUTH0_MANAGEMENT_CLIENT_SECRET: optionalNonEmptyString,
  BASE_URL: optionalNonEmptyString,
  CI: optionalNonEmptyString,
  CLIENT_ID: optionalNonEmptyString,
  CLIENT_SECRET: optionalNonEmptyString,
  CLOUDFLARE_ACCOUNT_ID: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_API_TOKEN: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_ENDPOINT: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY_ID: optionalNonEmptyString,
  CLOUDFLARE_TOKEN: optionalNonEmptyString,
  DATABASE_URL: optionalNonEmptyString,
  DOCS_IMG_OUT_DIR: optionalNonEmptyString,
  DOCS_OUT_DIR: optionalNonEmptyString,
  ISSUER_BASE_URL: optionalNonEmptyString,
  NO_WEBSERVER: optionalNonEmptyString,
  PLAYWRIGHT_TEST_BASE_URL: optionalNonEmptyString,
  SECRET: optionalNonEmptyString,
  STRIPE_API_KEY: optionalNonEmptyString,
  STRIPE_WEBHOOK_SECRET: optionalNonEmptyString,
  TENANT_DOMAIN: optionalNonEmptyString,
});

type TestEnvironment = Schema.Schema.Type<typeof TestEnvironmentSchema>;

const decodeTestEnvironment = Schema.decodeUnknownEither(TestEnvironmentSchema);

const normalizeEnvironmentInput = (
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === '' ? undefined : value,
    ]),
  );

const formatSchemaError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error);

const hasValue = (value: string | undefined): boolean =>
  value !== undefined && value.length > 0;

const missingRequiredKeys = (
  environment: TestEnvironment,
  keys: readonly (keyof TestEnvironment)[],
): string[] => keys.filter((key) => !hasValue(environment[key])).map(String);

export const getTestEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): TestEnvironment => {
  const parsed = decodeTestEnvironment(normalizeEnvironmentInput(input));
  if (Either.isLeft(parsed)) {
    throw new Error(
      `Invalid e2e environment schema:\n${formatSchemaError(parsed.left)}`,
    );
  }
  return parsed.right;
};

export const hasAuth0ManagementEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): boolean => {
  const environment = getTestEnvironment(input);
  return (
    hasValue(environment.AUTH0_MANAGEMENT_CLIENT_ID) &&
    hasValue(environment.AUTH0_MANAGEMENT_CLIENT_SECRET)
  );
};

export const getAuth0ManagementEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  AUTH0_MANAGEMENT_CLIENT_ID: string;
  AUTH0_MANAGEMENT_CLIENT_SECRET: string;
} => {
  const environment = getTestEnvironment(input);
  const clientId = environment.AUTH0_MANAGEMENT_CLIENT_ID;
  const clientSecret = environment.AUTH0_MANAGEMENT_CLIENT_SECRET;
  if (!hasValue(clientId) || !hasValue(clientSecret)) {
    const missing = missingRequiredKeys(environment, [
      'AUTH0_MANAGEMENT_CLIENT_ID',
      'AUTH0_MANAGEMENT_CLIENT_SECRET',
    ]);
    throw new Error(
      `Missing e2e auth configuration:\n- ${missing.join('\n- ')}`,
    );
  }
  return {
    AUTH0_MANAGEMENT_CLIENT_ID: clientId,
    AUTH0_MANAGEMENT_CLIENT_SECRET: clientSecret,
  };
};

export const validatePlaywrightEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): TestEnvironment => {
  const environment = getTestEnvironment(input);

  const requiredKeys: (keyof TestEnvironment)[] = ['DATABASE_URL'];
  if (!environment.NO_WEBSERVER) {
    requiredKeys.push(
      'BASE_URL',
      'CLIENT_ID',
      'CLIENT_SECRET',
      'ISSUER_BASE_URL',
      'SECRET',
      'STRIPE_API_KEY',
      'STRIPE_WEBHOOK_SECRET',
    );
  }
  const missing = missingRequiredKeys(environment, requiredKeys);
  if (missing.length > 0) {
    throw new Error(`Missing e2e environment variables:\n- ${missing.join('\n- ')}`);
  }

  if (environment.CI) {
    const cloudflareImagesToken =
      environment.CLOUDFLARE_IMAGES_API_TOKEN ?? environment.CLOUDFLARE_TOKEN;
    const cloudflareImagesMissing: string[] = [];
    if (!hasValue(cloudflareImagesToken)) {
      cloudflareImagesMissing.push(
        'CLOUDFLARE_IMAGES_API_TOKEN or CLOUDFLARE_TOKEN',
      );
    }
    if (!hasValue(environment.CLOUDFLARE_ACCOUNT_ID)) {
      cloudflareImagesMissing.push('CLOUDFLARE_ACCOUNT_ID');
    }
    if (!hasValue(environment.CLOUDFLARE_IMAGES_DELIVERY_HASH)) {
      cloudflareImagesMissing.push('CLOUDFLARE_IMAGES_DELIVERY_HASH');
    }

    const cloudflareR2Missing = missingRequiredKeys(environment, [
      'CLOUDFLARE_R2_S3_ENDPOINT',
      'CLOUDFLARE_R2_S3_KEY',
      'CLOUDFLARE_R2_S3_KEY_ID',
    ]);

    const integrationMissing = [
      ...cloudflareImagesMissing.map((key) => `${key} (Cloudflare Images)`),
      ...cloudflareR2Missing.map((key) => `${key} (Cloudflare R2)`),
    ];
    if (integrationMissing.length > 0) {
      throw new Error(
        `Missing CI integration environment variables:\n- ${integrationMissing.join('\n- ')}`,
      );
    }
  }

  return environment;
};

export const resolveDocumentationOutputEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  docsImageOutputDirectory: string;
  docsOutputDirectory: string;
} => {
  const environment = getTestEnvironment(input);
  return {
    docsImageOutputDirectory:
      environment.DOCS_IMG_OUT_DIR ?? path.resolve('test-results/docs/images'),
    docsOutputDirectory:
      environment.DOCS_OUT_DIR ?? path.resolve('test-results/docs'),
  };
};
