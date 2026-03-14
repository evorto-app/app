import { ConfigError, ConfigProvider, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { authConfig } from './auth-config';
import { formatConfigError } from './config-error';

const readAuthConfig = (provider: ConfigProvider.ConfigProvider) =>
  Effect.runSync(
    authConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        (error: ConfigError.ConfigError) =>
          new Error(`Invalid auth configuration:\n${formatConfigError(error)}`),
      ),
    ),
  );

describe('auth-config', () => {
  it('keeps optional audience as Option.none when missing or blank', () => {
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

    expect(readAuthConfig(missingAudienceProvider).AUDIENCE).toEqual(
      Option.none(),
    );
    expect(readAuthConfig(blankAudienceProvider).AUDIENCE).toEqual(
      Option.none(),
    );
  });

  it('trims and keeps optional audience as Option.some when provided', () => {
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

    expect(readAuthConfig(provider).AUDIENCE).toEqual(
      Option.some('https://api.example'),
    );
  });

  it('rejects whitespace-only required values after trimming', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['BASE_URL', '   '],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    expect(() => readAuthConfig(provider)).toThrow(/BASE_URL/);
  });
});
