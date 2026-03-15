import * as FileSystem from '@effect/platform/FileSystem';
import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem';
import * as PlatformConfigProvider from '@effect/platform/PlatformConfigProvider';
import { ConfigProvider, Effect } from 'effect';
import path from 'node:path';

export interface RuntimeConfigProviderOptions {
  cwd?: string;
  includeCiDotEnv?: boolean;
}

const EMPTY_PROVIDER = ConfigProvider.fromMap(new Map());

const resolveDotEnvironmentFiles = (
  options: RuntimeConfigProviderOptions = {},
) => {
  const includeCiDotEnvironment =
    options.includeCiDotEnv ?? process.env['CI'] === 'true';

  return includeCiDotEnvironment
    ? ['.env.local', '.env', '.env.ci', '.env.runtime']
    : ['.env.local', '.env', '.env.runtime'];
};

const loadDotEnvironmentProvider = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(filePath);
    if (!exists) {
      return EMPTY_PROVIDER;
    }

    return yield* PlatformConfigProvider.fromDotEnv(filePath);
  }).pipe(
    Effect.provide(NodeFileSystem.layer),
    Effect.mapError(
      (error) =>
        new Error(`Failed to load config file ${filePath}: ${String(error)}`),
    ),
  );

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
      provider = ConfigProvider.orElse(provider, () => dotEnvironmentProvider);
    }

    return provider;
  });
