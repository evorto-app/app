import { ConfigError, ConfigProvider, Effect, LogLevel, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatConfigError } from './config-error';
import { serverConfig } from './server-config';

const readServerConfig = (provider: ConfigProvider.ConfigProvider) =>
  Effect.runSync(
    serverConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        (error: ConfigError.ConfigError) =>
          new Error(
            `Invalid server configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );

describe('server-config', () => {
  it('only reads PUBLIC_GOOGLE_MAPS_API_KEY', () => {
    const legacyProvider = ConfigProvider.fromMap(
      new Map([['GOOGLE_MAPS_API_KEY', 'legacy-key']]),
    );
    const canonicalProvider = ConfigProvider.fromMap(
      new Map([['PUBLIC_GOOGLE_MAPS_API_KEY', 'canonical-key']]),
    );

    expect(
      readServerConfig(legacyProvider).PUBLIC_GOOGLE_MAPS_API_KEY,
    ).toEqual(Option.none());
    expect(
      readServerConfig(canonicalProvider).PUBLIC_GOOGLE_MAPS_API_KEY,
    ).toEqual(Option.some('canonical-key'));
  });

  it('captures optional runtime-only server fields through the config boundary', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['E2E_NOW_ISO', '2026-03-01T12:00:00.000Z'],
        ['npm_package_version', '1.2.3'],
        ['SERVER_LOG_LEVEL', ' warning '],
      ]),
    );

    const config = readServerConfig(provider);

    expect(config.E2E_NOW_ISO).toEqual(
      Option.some('2026-03-01T12:00:00.000Z'),
    );
    expect(config.PACKAGE_VERSION).toEqual(Option.some('1.2.3'));
    expect(config.SERVER_LOG_LEVEL).toEqual(
      Option.some(LogLevel.fromLiteral('Warning')),
    );
  });

  it('rejects unsupported server log levels at the config boundary', () => {
    const provider = ConfigProvider.fromMap(
      new Map([['SERVER_LOG_LEVEL', 'warnng']]),
    );

    expect(() => readServerConfig(provider)).toThrow(
      /Expected SERVER_LOG_LEVEL to be one of/,
    );
  });
});
