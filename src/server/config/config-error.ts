import { ConfigError, type ConfigProvider, Effect } from 'effect';

import { makeRuntimeConfigProviderSync } from './provider';

const formatPath = (path: readonly string[]): string =>
  path.length > 0 ? path.join('.') : '<root>';

const configErrorReducer: ConfigError.ConfigErrorReducer<undefined, string[]> =
  {
    andCase: (_context, left, right) => [...left, ...right],
    invalidDataCase: (_context, path, message) => [
      `${formatPath(path)}: ${message}`,
    ],
    missingDataCase: (_context, path, message) => [
      `${formatPath(path)}: ${message}`,
    ],
    orCase: (_context, left, right) => [...left, ...right],
    sourceUnavailableCase: (_context, path, message) => [
      `${formatPath(path)}: ${message}`,
    ],
    unsupportedCase: (_context, path, message) => [
      `${formatPath(path)}: ${message}`,
    ],
  };

export const formatConfigError = (error: ConfigError.ConfigError): string => {
  const lines = ConfigError.reduceWithContext(
    error,
    undefined,
    configErrorReducer,
  );

  return [...new Set(lines)].map((line) => `- ${line}`).join('\n');
};

export const loadConfigSync = <A>(
  label: string,
  config: Effect.Effect<A, ConfigError.ConfigError>,
  provider?: ConfigProvider.ConfigProvider,
): A =>
  Effect.runSync(
    config.pipe(
      Effect.withConfigProvider(provider ?? makeRuntimeConfigProviderSync()),
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid ${label} configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );
