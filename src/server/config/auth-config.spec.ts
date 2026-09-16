import { describe, expect, it } from '@effect/vitest';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { authConfig } from './auth-config';
import { formatConfigError } from './config-error';

const sessionSecret = 's'.repeat(32);
const validAuthEnvironment = {
  APP_ENVIRONMENT: 'production',
  BASE_URL: 'https://app.example',
  CLIENT_ID: 'client-id',
  CLIENT_SECRET: 'client-secret',
  ISSUER_BASE_URL: 'https://issuer.example',
  SECRET: sessionSecret,
};

const readAuthConfig = (provider: ConfigProvider.ConfigProvider) =>
  authConfig
    .parse(provider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(`Invalid auth configuration:\n${formatConfigError(error)}`),
      ),
    );

const providerFromEnvironment = (
  overrides: Readonly<Record<string, string>> = {},
) =>
  ConfigProvider.fromEnv({
    env: {
      ...validAuthEnvironment,
      ...overrides,
    },
  });

describe('auth-config', () => {
  it.effect(
    'keeps optional audience as Option.none when missing or blank',
    () =>
      Effect.gen(function* () {
        const missingAudience = yield* readAuthConfig(
          providerFromEnvironment(),
        );
        const blankAudience = yield* readAuthConfig(
          providerFromEnvironment({
            AUDIENCE: ' '.repeat(3),
          }),
        );

        expect(missingAudience.AUDIENCE).toEqual(Option.none());
        expect(blankAudience.AUDIENCE).toEqual(Option.none());
      }),
  );

  it.effect('trims values, normalizes origins, and redacts secrets', () =>
    Effect.gen(function* () {
      const configured = yield* readAuthConfig(
        providerFromEnvironment({
          AUDIENCE: '  https://api.example  ',
          BASE_URL: '  https://app.example/  ',
          CLIENT_SECRET: '  client-secret  ',
          ISSUER_BASE_URL: '  https://issuer.example/  ',
          SECRET: `  ${sessionSecret}  `,
        }),
      );

      expect(configured.AUDIENCE).toEqual(Option.some('https://api.example'));
      expect(configured.BASE_URL).toBe('https://app.example');
      expect(configured.ISSUER_BASE_URL).toBe('https://issuer.example');
      expect(Redacted.value(configured.CLIENT_SECRET)).toBe('client-secret');
      expect(Redacted.value(configured.SECRET)).toBe(sessionSecret);
      expect(String(configured.CLIENT_SECRET)).not.toContain('client-secret');
      expect(String(configured.SECRET)).not.toContain(sessionSecret);
    }),
  );

  it.effect('rejects whitespace-only required values after trimming', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        readAuthConfig(
          providerFromEnvironment({
            BASE_URL: ' '.repeat(3),
          }),
        ),
      );

      expect(error.message).toMatch(/BASE_URL/);
    }),
  );

  it.effect(
    'requires at least 32 UTF-8 bytes without exposing the configured secret',
    () =>
      Effect.gen(function* () {
        const weakSecret = 'sensitive-short-secret';
        const error = yield* Effect.flip(
          readAuthConfig(
            providerFromEnvironment({
              SECRET: weakSecret,
            }),
          ),
        );

        expect(error.message).toContain(
          'SECRET to contain at least 32 UTF-8 bytes',
        );
        expect(error.message).not.toContain(weakSecret);

        const multibyteSecret = 'é'.repeat(16);
        const configured = yield* readAuthConfig(
          providerFromEnvironment({
            SECRET: multibyteSecret,
          }),
        );
        expect(Redacted.value(configured.SECRET)).toBe(multibyteSecret);
      }),
  );

  it.effect(
    'rejects credentials, paths, queries, fragments, unsupported schemes, and trailing-dot hosts',
    () =>
      Effect.gen(function* () {
        const invalidOrigins = [
          'https://user:password@app.example',
          'https://app.example/auth',
          'https://app.example?mode=auth',
          'https://app.example#auth',
          'ftp://app.example',
          'https://app.example.',
          'not-an-origin',
        ];

        for (const field of ['BASE_URL', 'ISSUER_BASE_URL'] as const) {
          for (const invalidOrigin of invalidOrigins) {
            const error = yield* Effect.flip(
              readAuthConfig(
                providerFromEnvironment({
                  [field]: invalidOrigin,
                }),
              ),
            );

            expect(error.message).toContain(field);
          }
        }
      }),
  );

  for (const field of ['BASE_URL', 'ISSUER_BASE_URL'] as const) {
    for (const rawOrigin of [
      'https://app.example:',
      'https://app.example:/',
      'https://localhost:',
      'https://localhost:/',
      'https://127.0.0.1:',
      'https://127.0.0.1:/',
      'https://[::1]:',
      'https://[::1]:/',
      'https://app.example/.',
      'https://app.example/..',
      'https://app.example/a/..',
      'https://app.example/%2e',
      'https://app.example/%2E%2e',
      'https://app.example/.%2e',
      'https://app.example/%2e.',
      'https://app.example/a/%2e%2e',
      'https://app.example?',
      'https://app.example#',
      'https://app.example/?',
      'https://app.example/#',
      String.raw`https:\\app.example`,
      'https://app.example\\',
      String.raw`https://app.example\ignored\..`,
      'https:app.example',
      'https:/app.example',
      'https:///app.example',
      'https://app.exa\tmple',
      'https://app.exa\nmple',
      'https://@app.example',
    ]) {
      it.effect(
        `rejects normalized-away syntax in ${field}: ${JSON.stringify(rawOrigin)}`,
        () =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              authConfig.parse(providerFromEnvironment({ [field]: rawOrigin })),
            );
            expect(error).toBeInstanceOf(Config.ConfigError);
            expect(error.message).toContain(
              `Expected ${field} to be an absolute http(s) origin without credentials, path, query, or fragment`,
            );
          }),
      );
    }
  }

  it.effect.each([
    'http://localhost:',
    'http://localhost:/',
    'http://127.0.0.1:',
    'http://127.0.0.1:/',
    'http://[::1]:',
    'http://[::1]:/',
  ])('rejects an empty local BASE_URL port: %s', (baseUrl) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        authConfig.parse(
          providerFromEnvironment({
            APP_ENVIRONMENT: 'local',
            BASE_URL: baseUrl,
          }),
        ),
      );
      expect(error).toBeInstanceOf(Config.ConfigError);
      expect(error.message).toContain(
        'Expected BASE_URL to be an absolute http(s) origin',
      );
    }),
  );

  it.effect(
    'retains IPv6, default-port, and trailing-slash normalization',
    () =>
      Effect.gen(function* () {
        for (const [baseUrl, expectedBaseUrl, issuerUrl, expectedIssuerUrl] of [
          [
            'https://APP.EXAMPLE:443/',
            'https://app.example',
            'https://ISSUER.EXAMPLE:443/',
            'https://issuer.example',
          ],
          [
            'https://[::1]:443/',
            'https://[::1]',
            'https://[::1]:443/',
            'https://[::1]',
          ],
          [
            'https://app.example:8443/',
            'https://app.example:8443',
            'https://issuer.example/',
            'https://issuer.example',
          ],
        ] as const) {
          const configured = yield* authConfig.parse(
            providerFromEnvironment({
              BASE_URL: baseUrl,
              ISSUER_BASE_URL: issuerUrl,
            }),
          );
          expect(configured.BASE_URL).toBe(expectedBaseUrl);
          expect(configured.ISSUER_BASE_URL).toBe(expectedIssuerUrl);
        }
        for (const [origin, expectedOrigin] of [
          ['http://127.0.0.1:80/', 'http://127.0.0.1'],
          ['http://localhost:80/', 'http://localhost'],
          ['http://[::1]:80/', 'http://[::1]'],
          ['http://[::1]:4200/', 'http://[::1]:4200'],
        ] as const) {
          const configured = yield* authConfig.parse(
            providerFromEnvironment({
              APP_ENVIRONMENT: 'local',
              BASE_URL: origin,
            }),
          );
          expect(configured.BASE_URL).toBe(expectedOrigin);
        }
      }),
  );

  it.effect('requires HTTPS for every hosted auth origin', () =>
    Effect.gen(function* () {
      for (const field of ['BASE_URL', 'ISSUER_BASE_URL'] as const) {
        const error = yield* Effect.flip(
          readAuthConfig(
            providerFromEnvironment({
              APP_ENVIRONMENT: 'staging',
              [field]: 'http://hosted.example',
            }),
          ),
        );

        expect(error.message).toContain(
          field === 'ISSUER_BASE_URL'
            ? 'ISSUER_BASE_URL to use https on the default port'
            : 'BASE_URL to use https outside local loopback development',
        );
      }
    }),
  );

  it.effect(
    'requires an HTTPS issuer on the default port in every environment',
    () =>
      Effect.gen(function* () {
        for (const applicationEnvironment of [
          'local',
          'staging',
          'production',
        ]) {
          for (const invalidIssuer of [
            'http://127.0.0.1:4200',
            'http://[::1]:4200',
            'http://localhost:4200',
            'https://issuer.example:8443',
          ]) {
            const error = yield* Effect.flip(
              readAuthConfig(
                providerFromEnvironment({
                  APP_ENVIRONMENT: applicationEnvironment,
                  ISSUER_BASE_URL: invalidIssuer,
                }),
              ),
            );

            expect(error.message).toContain(
              'ISSUER_BASE_URL to use https on the default port',
            );
          }

          const configured = yield* readAuthConfig(
            providerFromEnvironment({
              APP_ENVIRONMENT: applicationEnvironment,
              ISSUER_BASE_URL: 'https://issuer.example:443',
            }),
          );
          expect(configured.ISSUER_BASE_URL).toBe('https://issuer.example');
        }
      }),
  );

  it.effect(
    'permits an HTTP base URL only for exact local loopback origins in local development',
    () =>
      Effect.gen(function* () {
        for (const loopbackOrigin of [
          'http://127.0.0.1:4200',
          'http://[::1]:4200',
          'http://localhost:4200',
        ]) {
          const configured = yield* readAuthConfig(
            providerFromEnvironment({
              APP_ENVIRONMENT: 'local',
              BASE_URL: loopbackOrigin,
            }),
          );

          expect(configured.BASE_URL).toBe(loopbackOrigin);
          expect(configured.ISSUER_BASE_URL).toBe('https://issuer.example');
        }

        for (const disallowedOrigin of [
          'http://127.0.0.2:4200',
          'http://localhost.:4200',
          'http://private-network.example:4200',
        ]) {
          const error = yield* Effect.flip(
            readAuthConfig(
              providerFromEnvironment({
                APP_ENVIRONMENT: 'local',
                BASE_URL: disallowedOrigin,
              }),
            ),
          );

          expect(error.message).toContain(
            disallowedOrigin.includes('localhost.')
              ? 'BASE_URL to be an absolute http(s) origin'
              : 'BASE_URL to use https outside local loopback development',
          );
        }
      }),
  );
});
