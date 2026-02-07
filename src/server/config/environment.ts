import { Either, ParseResult, Schema } from 'effect';

const optionalNonEmptyString = Schema.optional(Schema.NonEmptyString);

const ServerEnvironmentSchema = Schema.Struct({
  AUDIENCE: optionalNonEmptyString,
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
  PORT: optionalNonEmptyString,
  PUBLIC_GOOGLE_MAPS_API_KEY: optionalNonEmptyString,
  PUBLIC_SENTRY_DSN: optionalNonEmptyString,
  SECRET: optionalNonEmptyString,
  STRIPE_API_KEY: optionalNonEmptyString,
  STRIPE_WEBHOOK_SECRET: optionalNonEmptyString,
});

export type ServerEnvironment = Schema.Schema.Type<typeof ServerEnvironmentSchema>;

const decodeServerEnvironment = Schema.decodeUnknownEither(
  ServerEnvironmentSchema,
);

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

const requireValue = (
  value: string | undefined,
  key: string,
  scope: string,
): string => {
  if (value) {
    return value;
  }
  throw new Error(`Missing server environment variable ${key} (${scope})`);
};

export const getServerEnvironment = (
  input: NodeJS.ProcessEnv = process.env,
): ServerEnvironment => {
  const parsed = decodeServerEnvironment(normalizeEnvironmentInput(input));
  if (Either.isLeft(parsed)) {
    throw new Error(
      `Invalid server environment schema:\n${formatSchemaError(parsed.left)}`,
    );
  }
  return parsed.right;
};

export const serverEnvironment = getServerEnvironment();

export const getServerPort = (
  environment: ServerEnvironment = serverEnvironment,
): number => {
  if (!environment.PORT) {
    return 4000;
  }
  const port = Number.parseInt(environment.PORT, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }
  return port;
};

export const getDatabaseEnvironment = (
  environment: ServerEnvironment = serverEnvironment,
): { DATABASE_URL: string } => ({
  DATABASE_URL: requireValue(
    environment.DATABASE_URL,
    'DATABASE_URL',
    'database connection',
  ),
});

export const getOidcEnvironment = (
  environment: ServerEnvironment = serverEnvironment,
): {
  AUDIENCE: string | undefined;
  BASE_URL: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  ISSUER_BASE_URL: string;
  SECRET: string;
} => ({
  AUDIENCE: environment.AUDIENCE,
  BASE_URL: requireValue(environment.BASE_URL, 'BASE_URL', 'OIDC'),
  CLIENT_ID: requireValue(environment.CLIENT_ID, 'CLIENT_ID', 'OIDC'),
  CLIENT_SECRET: requireValue(
    environment.CLIENT_SECRET,
    'CLIENT_SECRET',
    'OIDC',
  ),
  ISSUER_BASE_URL: requireValue(
    environment.ISSUER_BASE_URL,
    'ISSUER_BASE_URL',
    'OIDC',
  ),
  SECRET: requireValue(environment.SECRET, 'SECRET', 'OIDC'),
});

export const getStripeApiEnvironment = (
  environment: ServerEnvironment = serverEnvironment,
): { STRIPE_API_KEY: string } => ({
  STRIPE_API_KEY: requireValue(environment.STRIPE_API_KEY, 'STRIPE_API_KEY', 'Stripe'),
});

export const getStripeWebhookEnvironment = (
  environment: ServerEnvironment = serverEnvironment,
): { STRIPE_WEBHOOK_SECRET: string } => ({
  STRIPE_WEBHOOK_SECRET: requireValue(
    environment.STRIPE_WEBHOOK_SECRET,
    'STRIPE_WEBHOOK_SECRET',
    'Stripe webhooks',
  ),
});

export const isCloudflareImagesEnvironmentConfigured = (
  environment: ServerEnvironment = serverEnvironment,
): boolean =>
  Boolean(
    (environment.CLOUDFLARE_IMAGES_API_TOKEN ?? environment.CLOUDFLARE_TOKEN) &&
      environment.CLOUDFLARE_ACCOUNT_ID &&
      environment.CLOUDFLARE_IMAGES_DELIVERY_HASH,
  );

export const getCloudflareImagesEnvironment = (
  environment: ServerEnvironment = serverEnvironment,
): {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_IMAGES_DELIVERY_HASH: string;
  CLOUDFLARE_IMAGES_ENVIRONMENT: string | undefined;
  CLOUDFLARE_IMAGES_VARIANT: string | undefined;
  CLOUDFLARE_TOKEN: string;
  NODE_ENV: string | undefined;
} => {
  const token =
    environment.CLOUDFLARE_IMAGES_API_TOKEN ?? environment.CLOUDFLARE_TOKEN;
  return {
    CLOUDFLARE_ACCOUNT_ID: requireValue(
      environment.CLOUDFLARE_ACCOUNT_ID,
      'CLOUDFLARE_ACCOUNT_ID',
      'Cloudflare Images',
    ),
    CLOUDFLARE_IMAGES_DELIVERY_HASH: requireValue(
      environment.CLOUDFLARE_IMAGES_DELIVERY_HASH,
      'CLOUDFLARE_IMAGES_DELIVERY_HASH',
      'Cloudflare Images',
    ),
    CLOUDFLARE_IMAGES_ENVIRONMENT: environment.CLOUDFLARE_IMAGES_ENVIRONMENT,
    CLOUDFLARE_IMAGES_VARIANT: environment.CLOUDFLARE_IMAGES_VARIANT,
    CLOUDFLARE_TOKEN: requireValue(
      token,
      'CLOUDFLARE_IMAGES_API_TOKEN or CLOUDFLARE_TOKEN',
      'Cloudflare Images',
    ),
    NODE_ENV: environment.NODE_ENV,
  };
};

export const getCloudflareR2Environment = (
  environment: ServerEnvironment = serverEnvironment,
): {
  CLOUDFLARE_R2_BUCKET: string;
  CLOUDFLARE_R2_S3_ENDPOINT: string;
  CLOUDFLARE_R2_S3_KEY: string;
  CLOUDFLARE_R2_S3_KEY_ID: string;
} => ({
  CLOUDFLARE_R2_BUCKET: environment.CLOUDFLARE_R2_BUCKET ?? 'testing',
  CLOUDFLARE_R2_S3_ENDPOINT: requireValue(
    environment.CLOUDFLARE_R2_S3_ENDPOINT,
    'CLOUDFLARE_R2_S3_ENDPOINT',
    'Cloudflare R2',
  ),
  CLOUDFLARE_R2_S3_KEY: requireValue(
    environment.CLOUDFLARE_R2_S3_KEY,
    'CLOUDFLARE_R2_S3_KEY',
    'Cloudflare R2',
  ),
  CLOUDFLARE_R2_S3_KEY_ID: requireValue(
    environment.CLOUDFLARE_R2_S3_KEY_ID,
    'CLOUDFLARE_R2_S3_KEY_ID',
    'Cloudflare R2',
  ),
});

export const getPublicGoogleMapsApiKey = (
  environment: ServerEnvironment = serverEnvironment,
): string | undefined =>
  environment.PUBLIC_GOOGLE_MAPS_API_KEY ??
  environment.GOOGLE_MAPS_API_KEY ??
  environment.GOOGLE_API_KEY;
