import { Either, ParseResult, Schema } from 'effect';

import { loadDotenvFiles } from './load-dotenv-files';

loadDotenvFiles();

const optionalNonEmptyString = Schema.optional(Schema.NonEmptyString);

const ServerEnvironmentSchema = Schema.Struct({
  AUDIENCE: optionalNonEmptyString,
  AWS_ACCESS_KEY_ID: optionalNonEmptyString,
  AWS_BUCKET: optionalNonEmptyString,
  AWS_ENDPOINT: optionalNonEmptyString,
  AWS_REGION: optionalNonEmptyString,
  AWS_SECRET_ACCESS_KEY: optionalNonEmptyString,
  BASE_URL: optionalNonEmptyString,
  CLIENT_ID: optionalNonEmptyString,
  CLIENT_SECRET: optionalNonEmptyString,
  CLOUDFLARE_ACCOUNT_ID: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_API_TOKEN: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_ENVIRONMENT: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_VARIANT: optionalNonEmptyString,
  CLOUDFLARE_R2_BUCKET: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_ENDPOINT: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY: optionalNonEmptyString,
  CLOUDFLARE_R2_S3_KEY_ID: optionalNonEmptyString,
  CLOUDFLARE_TOKEN: optionalNonEmptyString,
  DATABASE_URL: optionalNonEmptyString,
  GOOGLE_API_KEY: optionalNonEmptyString,
  GOOGLE_MAPS_API_KEY: optionalNonEmptyString,
  ISSUER_BASE_URL: optionalNonEmptyString,
  NODE_ENV: optionalNonEmptyString,
  PORT: Schema.optionalWith(
    Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
    {
      default: () => 4000,
    },
  ),
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalNonEmptyString,
  PUBLIC_SENTRY_DSN: optionalNonEmptyString,
  S3_ACCESS_KEY_ID: optionalNonEmptyString,
  S3_BUCKET: optionalNonEmptyString,
  S3_ENDPOINT: optionalNonEmptyString,
  S3_REGION: optionalNonEmptyString,
  S3_SECRET_ACCESS_KEY: optionalNonEmptyString,
  SECRET: optionalNonEmptyString,
  STRIPE_API_KEY: optionalNonEmptyString,
  STRIPE_WEBHOOK_SECRET: optionalNonEmptyString,
});

const DatabaseEnvironmentSchema = Schema.Struct({
  DATABASE_URL: Schema.NonEmptyString,
});

const OidcEnvironmentSchema = Schema.Struct({
  AUDIENCE: optionalNonEmptyString,
  BASE_URL: Schema.NonEmptyString,
  CLIENT_ID: Schema.NonEmptyString,
  CLIENT_SECRET: Schema.NonEmptyString,
  ISSUER_BASE_URL: Schema.NonEmptyString,
  SECRET: Schema.NonEmptyString,
});

const StripeApiEnvironmentSchema = Schema.Struct({
  STRIPE_API_KEY: Schema.NonEmptyString,
});

const StripeWebhookEnvironmentSchema = Schema.Struct({
  STRIPE_WEBHOOK_SECRET: Schema.NonEmptyString,
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

const CloudflareImagesEnvironmentSchema = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.NonEmptyString,
  CLOUDFLARE_IMAGES_DELIVERY_HASH: Schema.NonEmptyString,
  CLOUDFLARE_IMAGES_ENVIRONMENT: optionalNonEmptyString,
  CLOUDFLARE_IMAGES_VARIANT: optionalNonEmptyString,
  NODE_ENV: optionalNonEmptyString,
}).pipe(Schema.extend(CloudflareImagesTokenEnvironmentSchema));

export type ServerEnvironment = Schema.Schema.Type<
  typeof ServerEnvironmentSchema
>;

const formatSchemaError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error);

const normalizeEnvironmentInput = (
  input: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const normalized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] =
      typeof value === 'string' && value.trim().length === 0
        ? undefined
        : value;
  }
  return normalized;
};

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

const resolveFirstNonEmpty = (...values: (string | undefined)[]) =>
  values.find((value) => value && value.trim().length > 0);

export const getServerEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): ServerEnvironment =>
  decodeOrThrow(
    ServerEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'server environment',
  );

export const serverEnvironment = getServerEnvironment();

export const getServerPort = (
  environment: ServerEnvironment = serverEnvironment,
): number => environment.PORT;

export const getDatabaseEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): { DATABASE_URL: string } =>
  decodeOrThrow(
    DatabaseEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'database connection',
  );

export const getOidcEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  AUDIENCE: string | undefined;
  BASE_URL: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  ISSUER_BASE_URL: string;
  SECRET: string;
} => {
  const environment = decodeOrThrow(
    OidcEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'OIDC configuration',
  );

  return {
    AUDIENCE: environment.AUDIENCE,
    BASE_URL: environment.BASE_URL,
    CLIENT_ID: environment.CLIENT_ID,
    CLIENT_SECRET: environment.CLIENT_SECRET,
    ISSUER_BASE_URL: environment.ISSUER_BASE_URL,
    SECRET: environment.SECRET,
  };
};

export const getStripeApiEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): { STRIPE_API_KEY: string } =>
  decodeOrThrow(
    StripeApiEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'Stripe API configuration',
  );

export const getStripeWebhookEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): { STRIPE_WEBHOOK_SECRET: string } =>
  decodeOrThrow(
    StripeWebhookEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'Stripe webhook configuration',
  );

export const isCloudflareImagesEnvironmentConfigured = (
  input: NodeJS.ProcessEnv = process.env,
): boolean =>
  Either.isRight(
    Schema.decodeUnknownEither(CloudflareImagesEnvironmentSchema)(
      normalizeEnvironmentInput(input),
    ),
  );

export const getCloudflareImagesEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_IMAGES_DELIVERY_HASH: string;
  CLOUDFLARE_IMAGES_ENVIRONMENT: string | undefined;
  CLOUDFLARE_IMAGES_VARIANT: string | undefined;
  CLOUDFLARE_TOKEN: string;
  NODE_ENV: string | undefined;
} => {
  const environment = decodeOrThrow(
    CloudflareImagesEnvironmentSchema,
    normalizeEnvironmentInput(input),
    'Cloudflare Images configuration',
  );

  const cloudflareToken =
    environment.CLOUDFLARE_IMAGES_API_TOKEN ?? environment.CLOUDFLARE_TOKEN;
  if (!cloudflareToken) {
    throw new Error(
      'Invalid Cloudflare Images configuration: missing API token value',
    );
  }

  return {
    CLOUDFLARE_ACCOUNT_ID: environment.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_IMAGES_DELIVERY_HASH:
      environment.CLOUDFLARE_IMAGES_DELIVERY_HASH,
    CLOUDFLARE_IMAGES_ENVIRONMENT: environment.CLOUDFLARE_IMAGES_ENVIRONMENT,
    CLOUDFLARE_IMAGES_VARIANT: environment.CLOUDFLARE_IMAGES_VARIANT,
    CLOUDFLARE_TOKEN: cloudflareToken,
    NODE_ENV: environment.NODE_ENV,
  };
};

export const getObjectStorageEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
} => {
  const environment = normalizeEnvironmentInput(input);
  const endpoint = resolveFirstNonEmpty(
    environment['S3_ENDPOINT'],
    environment['AWS_ENDPOINT'],
    environment['CLOUDFLARE_R2_S3_ENDPOINT'],
  );
  const bucket =
    resolveFirstNonEmpty(
      environment['S3_BUCKET'],
      environment['AWS_BUCKET'],
      environment['CLOUDFLARE_R2_BUCKET'],
    ) ?? 'testing';
  const accessKeyId = resolveFirstNonEmpty(
    environment['S3_ACCESS_KEY_ID'],
    environment['AWS_ACCESS_KEY_ID'],
    environment['CLOUDFLARE_R2_S3_KEY_ID'],
  );
  const secretAccessKey = resolveFirstNonEmpty(
    environment['S3_SECRET_ACCESS_KEY'],
    environment['AWS_SECRET_ACCESS_KEY'],
    environment['CLOUDFLARE_R2_S3_KEY'],
  );
  const region =
    resolveFirstNonEmpty(environment['S3_REGION'], environment['AWS_REGION']) ??
    'auto';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    const missingFields = [
      endpoint ? null : 'S3_ENDPOINT/AWS_ENDPOINT',
      accessKeyId ? null : 'S3_ACCESS_KEY_ID/AWS_ACCESS_KEY_ID',
      secretAccessKey ? null : 'S3_SECRET_ACCESS_KEY/AWS_SECRET_ACCESS_KEY',
    ].filter((value): value is string => value !== null);

    throw new Error(
      `Invalid object storage configuration: missing ${missingFields.join(', ')}`,
    );
  }

  return {
    accessKeyId,
    bucket,
    endpoint,
    region,
    secretAccessKey,
  };
};

export const getCloudflareR2Environment = (
  input: NodeJS.ProcessEnv = process.env,
): {
  CLOUDFLARE_R2_BUCKET: string;
  CLOUDFLARE_R2_S3_ENDPOINT: string;
  CLOUDFLARE_R2_S3_KEY: string;
  CLOUDFLARE_R2_S3_KEY_ID: string;
} => {
  const objectStorageEnvironment = getObjectStorageEnvironment(input);
  return {
    CLOUDFLARE_R2_BUCKET: objectStorageEnvironment.bucket,
    CLOUDFLARE_R2_S3_ENDPOINT: objectStorageEnvironment.endpoint,
    CLOUDFLARE_R2_S3_KEY: objectStorageEnvironment.secretAccessKey,
    CLOUDFLARE_R2_S3_KEY_ID: objectStorageEnvironment.accessKeyId,
  };
};

export const getPublicGoogleMapsApiKey = (
  environment: ServerEnvironment = serverEnvironment,
): string | undefined =>
  environment.PUBLIC_GOOGLE_MAPS_API_KEY ??
  environment.GOOGLE_MAPS_API_KEY ??
  environment.GOOGLE_API_KEY;
