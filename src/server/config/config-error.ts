import { ConfigError } from 'effect';

const formatPath = (path: readonly string[]) =>
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

export const formatConfigError = (error: ConfigError.ConfigError) => {
  const lines = ConfigError.reduceWithContext(
    error,
    undefined,
    configErrorReducer,
  );

  return [...new Set(lines)].map((line) => `- ${line}`).join('\n');
};

export const missingFieldError = (name: string) =>
  ConfigError.MissingData([name], `Expected ${name} to be configured`);
