import { describe, expect, it } from '@effect/vitest';
import { ConfigError, ConfigProvider, Effect, Option } from 'effect';

import { authConfig } from './auth-config';
import { formatConfigError } from './config-error';

const readAuthConfig = (provider: ConfigProvider.ConfigProvider) =>
  authConfig.pipe(
    Effect.withConfigProvider(provider),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(`Invalid auth configuration:\n${formatConfigError(error)}`),
    ),
  );

describe('auth-config', () => {
  it.effect('keeps optional audience as Option.none when missing or blank', () =>
    Effect.gen(function* () {
    const missingAudienceProvider = ConfigProvider.fromMap(
      new Map([
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );
    const blankAudienceProvider = ConfigProvider.fromMap(
      new Map([
        ['AUDIENCE', '   '],
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    expect((yield* readAuthConfig(missingAudienceProvider)).AUDIENCE).toEqual(
      Option.none(),
    );
    expect((yield* readAuthConfig(blankAudienceProvider)).AUDIENCE).toEqual(
      Option.none(),
    );
    })
  );

  it.effect('trims and keeps optional audience as Option.some when provided', () =>
    Effect.gen(function* () {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['AUDIENCE', '  https://api.example  '],
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    expect((yield* readAuthConfig(provider)).AUDIENCE).toEqual(
      Option.some('https://api.example'),
    );
    })
  );

  it.effect('rejects whitespace-only required values after trimming', () =>
    Effect.gen(function* () {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['BASE_URL', '   '],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    const error = yield* Effect.flip(readAuthConfig(provider));
    expect(error.message).toMatch(/BASE_URL/);
    })
  );
});
