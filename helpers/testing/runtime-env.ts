import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import path from 'node:path';

const DEFAULT_APP_HOST_PORT = 4_200;
const DEFAULT_NEON_LOCAL_HOST_PORT = 55_432;
const DEFAULT_MINIO_CONSOLE_HOST_PORT = 9_001;
const DEFAULT_MINIO_HOST_PORT = 9_000;
const OUTPUT_FILE_PATH = path.resolve(process.cwd(), '.env.runtime');

const databaseName = process.env['NEON_DATABASE_NAME']?.trim() || 'appdb';

const deriveSeed = (): string => {
  const runId = process.env['GITHUB_RUN_ID']?.trim();
  const runAttempt = process.env['GITHUB_RUN_ATTEMPT']?.trim();
  if (runId) {
    return `${runId}:${runAttempt || '1'}`;
  }

  return process.cwd();
};

const seed = deriveSeed();
const digest = new Bun.CryptoHasher('sha256').update(seed).digest('hex');

const parsePort = (value: string | undefined): number | undefined => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    return undefined;
  }
  return parsed;
};

const readHexChunk = (start: number): number =>
  Number.parseInt(digest.slice(start, start + 8), 16);

const derivePort = (base: number, span: number, chunkStart: number): number =>
  base + (readHexChunk(chunkStart) % span);

const resolvePort = (names: readonly string[], fallback: number): number => {
  for (const name of names) {
    const parsed = parsePort(process.env[name]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return fallback;
};

const appHostPort = resolvePort(['APP_HOST_PORT'], DEFAULT_APP_HOST_PORT);
const neonLocalHostPort = resolvePort(
  ['NEON_LOCAL_HOST_PORT'],
  derivePort(DEFAULT_NEON_LOCAL_HOST_PORT, 400, 8),
);
const minioHostPort = resolvePort(
  ['MINIO_HOST_PORT'],
  derivePort(DEFAULT_MINIO_HOST_PORT, 400, 16),
);
const minioConsoleHostPort = resolvePort(
  ['MINIO_CONSOLE_HOST_PORT'],
  derivePort(DEFAULT_MINIO_CONSOLE_HOST_PORT, 400, 24),
);

const sanitizeProjectName = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 40);

const defaultProjectName = (): string => {
  const basename = path.basename(process.cwd());
  const safeBasename = sanitizeProjectName(basename || 'evorto');
  const suffix = digest.slice(0, 8);
  return `${safeBasename}-${suffix}`;
};

const composeProjectName =
  process.env['COMPOSE_PROJECT_NAME']?.trim() || defaultProjectName();
const gitHeadPath = (() => {
  // Linked worktrees expose `.git` as a file, so Neon Local needs the
  // resolved HEAD file path instead of assuming `./.git/HEAD` exists.
  const result = Bun.spawnSync({
    cmd: ['git', 'rev-parse', '--git-path', 'HEAD'],
    cwd: process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to resolve git HEAD path: ${result.stderr.toString().trim()}`,
    );
  }

  return path.resolve(process.cwd(), result.stdout.toString().trim());
})();
const baseUrl = `http://localhost:${appHostPort}`;
const databaseUrl = `postgresql://neon:npg@localhost:${neonLocalHostPort}/${databaseName}?sslmode=require`;

const runtimeEnvironment = {
  APP_HOST_PORT: String(appHostPort),
  BASE_URL: baseUrl,
  COMPOSE_PROJECT_NAME: composeProjectName,
  DATABASE_URL: databaseUrl,
  DELETE_BRANCH: 'false',
  MINIO_CONSOLE_HOST_PORT: String(minioConsoleHostPort),
  MINIO_HOST_PORT: String(minioHostPort),
  NEON_DATABASE_NAME: databaseName,
  NEON_LOCAL_GIT_HEAD_PATH: gitHeadPath,
  NEON_LOCAL_HOST_PORT: String(neonLocalHostPort),
  NEON_LOCAL_PROXY: 'true',
} as const;

const escapeEnvironmentValue = (value: string): string =>
  JSON.stringify(value);

const outputLines = [
  '# THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
  ...Object.entries(runtimeEnvironment).map(
    ([key, value]) => `${key}=${escapeEnvironmentValue(value)}`,
  ),
  '',
];

const main = Effect.gen(function* () {
  yield* Effect.tryPromise({
    catch: (cause) =>
      new Error(`Failed to write runtime env file at ${OUTPUT_FILE_PATH}`, {
        cause:
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    try: () => Bun.write(OUTPUT_FILE_PATH, outputLines.join('\n')),
  });
  yield* Effect.logInfo(`Wrote ${OUTPUT_FILE_PATH}`);
});

BunRuntime.runMain(main);
