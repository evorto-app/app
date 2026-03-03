import path from 'node:path';
import { Either, ParseResult, Schema } from 'effect';
import consola from 'consola';

import { loadDotenvFiles } from '../../../helpers/config/load-dotenv-files';
import { applyTestConsolaLevel } from '../../../helpers/testing/test-logging';

loadDotenvFiles();

const optionalNonEmptyString = Schema.optional(Schema.NonEmptyString);

const FalseFromString = Schema.BooleanFromString.pipe(
  Schema.filter((value) => value === false),
);

const TrueFromString = Schema.BooleanFromString.pipe(
  Schema.filter((value) => value === true),
);

const PlaywrightCommonFields = {
  CI: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
  CLOUDFLARE_ACCOUNT_ID: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_API_TOKEN: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_ENDPOINT: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY_ID: optionalNonEmptyString,
  AWS_ACCESS_KEY_ID: optionalNonEmptyString,
  AWS_BUCKET: optionalNonEmptyString,
  AWS_ENDPOINT: optionalNonEmptyString,
  AWS_REGION: optionalNonEmptyString,
  AWS_SECRET_ACCESS_KEY: optionalNonEmptyString,
  CLOUDFLARE_TOKEN: optionalNonEmptyString,
  DOCS_IMG_OUT_DIR: optionalNonEmptyString,
  DOCS_OUT_DIR: optionalNonEmptyString,
  E2E_NOW_ISO: optionalNonEmptyString,
  E2E_SEED_KEY: optionalNonEmptyString,
  PLAYWRIGHT_TEST_BASE_URL: optionalNonEmptyString,
  S3_ACCESS_KEY_ID: optionalNonEmptyString,
  S3_BUCKET: optionalNonEmptyString,
  S3_ENDPOINT: optionalNonEmptyString,
  S3_REGION: optionalNonEmptyString,
  S3_SECRET_ACCESS_KEY: optionalNonEmptyString,
  STRIPE_TEST_ACCOUNT_ID: optionalNonEmptyString,
  TENANT_DOMAIN: optionalNonEmptyString,
} as const;

const PlaywrightWithWebserverEnvironmentSchema = Schema.Struct({
  ...PlaywrightCommonFields,
  BASE_URL: Schema.NonEmptyString,
  CLIENT_ID: Schema.NonEmptyString,
  CLIENT_SECRET: Schema.NonEmptyString,
  DATABASE_URL: Schema.NonEmptyString,
  ISSUER_BASE_URL: Schema.NonEmptyString,
  NO_WEBSERVER: Schema.optionalWith(FalseFromString, {
    default: () => false,
  }),
  SECRET: Schema.NonEmptyString,
  STRIPE_API_KEY: Schema.NonEmptyString,
  STRIPE_TEST_ACCOUNT_ID: Schema.NonEmptyString,
  STRIPE_WEBHOOK_SECRET: Schema.NonEmptyString,
});

const PlaywrightWithoutWebserverEnvironmentSchema = Schema.Struct({
  ...PlaywrightCommonFields,
  DATABASE_URL: Schema.NonEmptyString,
  NO_WEBSERVER: TrueFromString,
});

const PlaywrightEnvironmentSchema = Schema.Union(
  PlaywrightWithWebserverEnvironmentSchema,
  PlaywrightWithoutWebserverEnvironmentSchema,
);

const Auth0ManagementEnvironmentSchema = Schema.Struct({
  AUTH0_MANAGEMENT_CLIENT_ID: Schema.NonEmptyString,
  AUTH0_MANAGEMENT_CLIENT_SECRET: Schema.NonEmptyString,
});

const CloudflareImagesTokenEnvironmentSchema = Schema.Union(
  Schema.Struct({
    CLOUDFLARE_IMAGES_API_TOKEN: Schema.NonEmptyString,
    CLOUDFLARE_TOKEN: optionalNonEmptyString,
  }),
  Schema.Struct({
    CLOUDFLARE_IMAGES_API_TOKEN: optionalNonEmptyString,
    CLOUDFLARE_TOKEN: Schema.NonEmptyString,
  }),
);

const CIS3ObjectStorageEnvironmentSchema = Schema.Struct({
  S3_ACCESS_KEY_ID: Schema.NonEmptyString,
  S3_BUCKET: Schema.NonEmptyString,
  S3_ENDPOINT: Schema.NonEmptyString,
  S3_REGION: Schema.NonEmptyString,
  S3_SECRET_ACCESS_KEY: Schema.NonEmptyString,
});

const CIAwsObjectStorageEnvironmentSchema = Schema.Struct({
  AWS_ACCESS_KEY_ID: Schema.NonEmptyString,
  AWS_BUCKET: Schema.NonEmptyString,
  AWS_ENDPOINT: Schema.NonEmptyString,
  AWS_REGION: Schema.NonEmptyString,
  AWS_SECRET_ACCESS_KEY: Schema.NonEmptyString,
});

const CILegacyCloudflareR2EnvironmentSchema = Schema.Struct({
  CLOUDFLARE_R2_S3_ENDPOINT: Schema.NonEmptyString,
  CLOUDFLARE_R2_S3_KEY: Schema.NonEmptyString,
  CLOUDFLARE_R2_S3_KEY_ID: Schema.NonEmptyString,
});

const CIObjectStorageEnvironmentSchema = Schema.Union(
  CIS3ObjectStorageEnvironmentSchema,
  CIAwsObjectStorageEnvironmentSchema,
  CILegacyCloudflareR2EnvironmentSchema,
);

const CIIntegrationEnvironmentSchema = Schema.Struct({
  CI: TrueFromString,
  CLOUDFLARE_ACCOUNT_ID: Schema.NonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: Schema.NonEmptyString,
}).pipe(Schema.extend(CloudflareImagesTokenEnvironmentSchema));

const CIDeterministicEnvironmentSchema = Schema.Struct({
  E2E_NOW_ISO: Schema.NonEmptyString,
  E2E_SEED_KEY: Schema.NonEmptyString,
});

const CIStripeSeedEnvironmentSchema = Schema.Struct({
  STRIPE_TEST_ACCOUNT_ID: Schema.NonEmptyString,
});

const DocumentationOutputEnvironmentSchema = Schema.Struct({
  DOCS_IMG_OUT_DIR: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => path.resolve('test-results/docs/images'),
  }),
  DOCS_OUT_DIR: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => path.resolve('test-results/docs'),
  }),
});

export type PlaywrightEnvironment = Schema.Schema.Type<
  typeof PlaywrightEnvironmentSchema
>;

const formatSchemaError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error);

const decodeOrThrow = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  label: string,
): A => {
  const parsed = Schema.decodeUnknownEither(schema)(input);
  if (Either.isLeft(parsed)) {
    throw new Error(
      `Invalid ${label} schema:\n${formatSchemaError(parsed.left)}`,
    );
  }
  return parsed.right;
};

const normalizePlaywrightInput = (
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  if (input['NO_WEBSERVER'] !== undefined) {
    return input;
  }

  return {
    ...input,
    NO_WEBSERVER: 'false',
  };
};

export const hasAuth0ManagementEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): boolean =>
  Either.isRight(
    Schema.decodeUnknownEither(Auth0ManagementEnvironmentSchema)(input),
  );

export const getAuth0ManagementEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  AUTH0_MANAGEMENT_CLIENT_ID: string;
  AUTH0_MANAGEMENT_CLIENT_SECRET: string;
} =>
  decodeOrThrow(
    Auth0ManagementEnvironmentSchema,
    input,
    'e2e auth configuration',
  );

export const validatePlaywrightEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): PlaywrightEnvironment => {
  const normalizedInput = normalizePlaywrightInput(input);
  const logLevel = applyTestConsolaLevel(normalizedInput);
  const environment = decodeOrThrow(
    PlaywrightEnvironmentSchema,
    normalizedInput,
    'e2e Playwright environment',
  );

  if (environment.CI) {
    decodeOrThrow(
      CIIntegrationEnvironmentSchema,
      normalizedInput,
      'e2e CI integration environment',
    );
    decodeOrThrow(
      CIObjectStorageEnvironmentSchema,
      normalizedInput,
      'e2e object storage environment',
    );
    decodeOrThrow(
      CIDeterministicEnvironmentSchema,
      normalizedInput,
      'e2e deterministic seed/time environment',
    );
    decodeOrThrow(
      CIStripeSeedEnvironmentSchema,
      normalizedInput,
      'e2e stripe seed environment',
    );
  }

  if (logLevel >= 4) {
    consola.debug('Playwright environment:', environment);
  }

  return environment;
};

export const resolveDocumentationOutputEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  docsImageOutputDirectory: string;
  docsOutputDirectory: string;
} => {
  const environment = decodeOrThrow(
    DocumentationOutputEnvironmentSchema,
    input,
    'documentation output environment',
  );

  return {
    docsImageOutputDirectory: environment.DOCS_IMG_OUT_DIR,
    docsOutputDirectory: environment.DOCS_OUT_DIR,
  };
};
