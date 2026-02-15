import path from 'node:path';
import { Either, ParseResult, Schema } from 'effect';
import consola from 'consola';

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
  CLOUDFLARE_TOKEN: optionalNonEmptyString,
  DOCS_IMG_OUT_DIR: optionalNonEmptyString,
  DOCS_OUT_DIR: optionalNonEmptyString,
  PLAYWRIGHT_TEST_BASE_URL: optionalNonEmptyString,
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

const CIIntegrationEnvironmentSchema = Schema.Struct({
  CI: TrueFromString,
  CLOUDFLARE_ACCOUNT_ID: Schema.NonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: Schema.NonEmptyString,
  CLOUDFLARE_R2_S3_ENDPOINT: Schema.NonEmptyString,
  CLOUDFLARE_R2_S3_KEY: Schema.NonEmptyString,
  CLOUDFLARE_R2_S3_KEY_ID: Schema.NonEmptyString,
}).pipe(Schema.extend(CloudflareImagesTokenEnvironmentSchema));

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
  const environment = decodeOrThrow(
    PlaywrightEnvironmentSchema,
    input,
    'e2e Playwright environment',
  );

  if (environment.CI) {
    decodeOrThrow(
      CIIntegrationEnvironmentSchema,
      input,
      'e2e CI integration environment',
    );
  }

  consola.debug('Playwright environment:', environment);

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
