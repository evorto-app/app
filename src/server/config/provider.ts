import { ConfigProvider, Effect } from 'effect';
import fs from 'node:fs';
import path from 'node:path';

export interface RuntimeConfigProviderOptions {
  cwd?: string;
}

const EMPTY_PROVIDER = ConfigProvider.fromUnknown({});

const resolveDotEnvironmentFiles = (
  _options: RuntimeConfigProviderOptions = {},
) => ['.env.dev.local', '.env.dev', '.env'];

const loadDotEnvironmentProvider = (filePath: string) =>
  Effect.try({
    catch: (error) =>
      new Error(`Failed to load config file ${filePath}: ${String(error)}`),
    try: () => {
      if (!fs.existsSync(filePath)) {
        return EMPTY_PROVIDER;
      }

      return ConfigProvider.fromDotEnvContents(
        fs.readFileSync(filePath, 'utf8'),
      );
    },
  });

export const resolveRuntimeConfigFilePaths = (
  options: RuntimeConfigProviderOptions = {},
) => {
  const cwd = options.cwd ?? process.cwd();
  return resolveDotEnvironmentFiles(options).map((file) =>
    path.resolve(cwd, file),
  );
};

export const makeRuntimeConfigProvider = (
  options: RuntimeConfigProviderOptions = {},
) =>
  Effect.gen(function* () {
    let provider = ConfigProvider.fromEnv();

    for (const filePath of resolveRuntimeConfigFilePaths(options)) {
      const dotEnvironmentProvider =
        yield* loadDotEnvironmentProvider(filePath);
      provider = ConfigProvider.orElse(provider, dotEnvironmentProvider);
    }

    return provider;
  });
