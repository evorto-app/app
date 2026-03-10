import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem';
import * as PlatformConfigProvider from '@effect/platform/PlatformConfigProvider';
import { ConfigProvider, Effect } from 'effect';
import fs from 'node:fs';
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
  fs.existsSync(filePath)
    ? PlatformConfigProvider.fromDotEnv(filePath).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.mapError(
          (error) =>
            new Error(
              `Failed to load config file ${filePath}: ${String(error)}`,
            ),
        ),
      )
    : Effect.succeed(EMPTY_PROVIDER);

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
