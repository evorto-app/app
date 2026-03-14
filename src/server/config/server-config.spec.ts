import { ConfigError, ConfigProvider, Effect, Option } from 'effect';
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
});
