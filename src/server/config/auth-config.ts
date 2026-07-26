import { Config, ConfigProvider, Effect, Redacted } from 'effect';

import { nonEmptyTrimmedString, optionalTrimmedString } from './config-string';
import { applicationEnvironmentConfig } from './deployment-config';

const configFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

const nonEmptyTrimmedRedactedString = (name: string) =>
  Config.redacted(name).pipe(
    Config.map((value) => Redacted.make(Redacted.value(value).trim())),
    Config.mapOrFail((value) =>
      Redacted.value(value).length > 0
        ? Effect.succeed(value)
        : Effect.fail(configFailure(`Expected ${name} to be non-empty`)),
    ),
  );

const isLoopbackHostname = (hostname: string) =>
  hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';

const strictAuthOrigin = (
  name: 'BASE_URL' | 'ISSUER_BASE_URL',
  value: string,
  applicationEnvironment: Config.Success<typeof applicationEnvironmentConfig>,
) => {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return Effect.fail(
      configFailure(
        `Expected ${name} to be an absolute http(s) origin without credentials, path, query, or fragment`,
      ),
    );
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.hostname.endsWith('.')
  ) {
    return Effect.fail(
      configFailure(
        `Expected ${name} to be an absolute http(s) origin without credentials, path, query, or fragment`,
      ),
    );
  }

  if (
    parsed.protocol === 'http:' &&
    (applicationEnvironment !== 'local' || !isLoopbackHostname(parsed.hostname))
  ) {
    return Effect.fail(
      configFailure(
        `Expected ${name} to use https outside local loopback development`,
      ),
    );
  }

  return Effect.succeed(parsed.origin);
};

const minimumSessionSecret = (secret: Redacted.Redacted<string>) =>
  new TextEncoder().encode(Redacted.value(secret)).byteLength >= 32
    ? Effect.succeed(secret)
    : Effect.fail(
        configFailure('Expected SECRET to contain at least 32 UTF-8 bytes'),
      );

const unvalidatedAuthConfig = Config.all({
  APP_ENVIRONMENT: applicationEnvironmentConfig,
  AUDIENCE: optionalTrimmedString('AUDIENCE'),
  BASE_URL: nonEmptyTrimmedString('BASE_URL'),
  CLIENT_ID: nonEmptyTrimmedString('CLIENT_ID'),
  CLIENT_SECRET: nonEmptyTrimmedRedactedString('CLIENT_SECRET'),
  ISSUER_BASE_URL: nonEmptyTrimmedString('ISSUER_BASE_URL'),
  SECRET: nonEmptyTrimmedRedactedString('SECRET'),
});

export const authConfig = unvalidatedAuthConfig.pipe(
  Config.mapOrFail((configured) =>
    Effect.all({
      BASE_URL: strictAuthOrigin(
        'BASE_URL',
        configured.BASE_URL,
        configured.APP_ENVIRONMENT,
      ),
      ISSUER_BASE_URL: strictAuthOrigin(
        'ISSUER_BASE_URL',
        configured.ISSUER_BASE_URL,
        configured.APP_ENVIRONMENT,
      ),
      SECRET: minimumSessionSecret(configured.SECRET),
    }).pipe(
      Effect.map((validated) => ({
        AUDIENCE: configured.AUDIENCE,
        BASE_URL: validated.BASE_URL,
        CLIENT_ID: configured.CLIENT_ID,
        CLIENT_SECRET: configured.CLIENT_SECRET,
        ISSUER_BASE_URL: validated.ISSUER_BASE_URL,
        SECRET: validated.SECRET,
      })),
    ),
  ),
);

export type AuthConfig = Config.Success<typeof authConfig>;
