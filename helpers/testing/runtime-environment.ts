import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import {
  DEFAULT_E2E_NOW_ISO,
  DEFAULT_E2E_SEED_KEY,
} from '@shared/testing/deterministic-test-defaults';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Generates worktree-local runtime ports and names so parallel Docker/test
// runs do not collide with the main checkout or other Codex worktrees.
const DEFAULT_APP_HOST_PORT = 4200;
const DEFAULT_NEON_LOCAL_HOST_PORT = 55_432;
const DEFAULT_MINIO_HOST_PORT = 9000;
const DEFAULT_MINIO_CONSOLE_HOST_PORT = 9400;
const DEFAULT_PORT_SPAN = 400;
const OUTPUT_FILE_PATH = path.resolve(process.cwd(), '.env.dev');

const databaseName = process.env['NEON_DATABASE_NAME']?.trim() || 'appdb';
const e2eNowIso = process.env['E2E_NOW_ISO']?.trim() || DEFAULT_E2E_NOW_ISO;
const e2eSeedKey = process.env['E2E_SEED_KEY']?.trim() || DEFAULT_E2E_SEED_KEY;

const deriveSeed = (): string => {
  const runId = process.env['GITHUB_RUN_ID']?.trim();
  const runAttempt = process.env['GITHUB_RUN_ATTEMPT']?.trim();
  if (runId) {
    return `${runId}:${runAttempt || '1'}`;
  }

  return process.cwd();
};

const digestSeed = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex');
const seed = deriveSeed();
const digest = digestSeed(seed);

const parsePort = (value: string | undefined): number | undefined => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    return undefined;
  }
  return parsed;
};

const readHexChunk = (digest: string, start: number): number =>
  Number.parseInt(digest.slice(start, start + 8), 16);

const derivePort = (
  digest: string,
  base: number,
  span: number,
  chunkStart: number,
): number => base + (readHexChunk(digest, chunkStart) % span);

const resolvePort = (
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
  fallback: number,
): number => {
  for (const name of names) {
    const parsed = parsePort(environment[name]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return fallback;
};

export interface RuntimePorts {
  readonly appHostPort: number;
  readonly minioConsoleHostPort: number;
  readonly minioHostPort: number;
  readonly neonLocalHostPort: number;
}

export const resolveRuntimePorts = (
  seed: string,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimePorts => {
  const digest = digestSeed(seed);
  const ports = {
    appHostPort: resolvePort(
      environment,
      ['APP_HOST_PORT'],
      derivePort(digest, DEFAULT_APP_HOST_PORT, DEFAULT_PORT_SPAN, 0),
    ),
    minioConsoleHostPort: resolvePort(
      environment,
      ['MINIO_CONSOLE_HOST_PORT'],
      derivePort(
        digest,
        DEFAULT_MINIO_CONSOLE_HOST_PORT,
        DEFAULT_PORT_SPAN,
        24,
      ),
    ),
    minioHostPort: resolvePort(
      environment,
      ['MINIO_HOST_PORT'],
      derivePort(digest, DEFAULT_MINIO_HOST_PORT, DEFAULT_PORT_SPAN, 16),
    ),
    neonLocalHostPort: resolvePort(
      environment,
      ['NEON_LOCAL_HOST_PORT'],
      derivePort(digest, DEFAULT_NEON_LOCAL_HOST_PORT, DEFAULT_PORT_SPAN, 8),
    ),
  } satisfies RuntimePorts;
  const portsByNumber = new Map<number, string[]>();
  for (const [name, port] of Object.entries(ports)) {
    portsByNumber.set(port, [...(portsByNumber.get(port) ?? []), name]);
  }
  const conflicts = [...portsByNumber.entries()].filter(
    ([, names]) => names.length > 1,
  );
  if (conflicts.length > 0) {
    throw new Error(
      `Runtime ports must be unique: ${conflicts
        .map(([port, names]) => `${port} is assigned to ${names.join(', ')}`)
        .join('; ')}`,
    );
  }

  return ports;
};

const { appHostPort, minioConsoleHostPort, minioHostPort, neonLocalHostPort } =
  resolveRuntimePorts(seed);

const sanitizeProjectName = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 40);

const defaultProjectName = (digest: string): string => {
  const basename = path.basename(process.cwd());
  const safeBasename = sanitizeProjectName(basename || 'evorto');
  const suffix = digest.slice(0, 8);
  return `${safeBasename}-${suffix}`;
};

const composeProjectName =
  process.env['COMPOSE_PROJECT_NAME']?.trim() || defaultProjectName(digest);
const baseUrl = `http://localhost:${appHostPort}`;
const databaseUrl = `postgresql://neon:npg@localhost:${neonLocalHostPort}/${databaseName}?sslmode=require`;

const runtimeEnvironment = {
  APP_HOST_PORT: String(appHostPort),
  BASE_URL: baseUrl,
  COMPOSE_PROJECT_NAME: composeProjectName,
  DATABASE_URL: databaseUrl,
  DELETE_BRANCH: 'true',
  E2E_NOW_ISO: e2eNowIso,
  E2E_SEED_KEY: e2eSeedKey,
  MINIO_CONSOLE_HOST_PORT: String(minioConsoleHostPort),
  MINIO_HOST_PORT: String(minioHostPort),
  NEON_DATABASE_NAME: databaseName,
  NEON_LOCAL_BRANCH_TTL_HOURS: '24',
  NEON_LOCAL_HOST_PORT: String(neonLocalHostPort),
  NEON_LOCAL_PROXY: 'true',
  NODE_ENV: 'development',
  SSR_RPC_ORIGIN: baseUrl,
} as const;

const escapeEnvironmentValue = (value: string): string => JSON.stringify(value);

const outputLines = [
  '# THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
  '# Worktree-specific overrides for local runtime commands.',
  ...Object.entries(runtimeEnvironment).map(
    ([key, value]) => `${key}=${escapeEnvironmentValue(value)}`,
  ),
  '',
];

const main = Effect.gen(function* () {
  yield* Effect.tryPromise({
    catch: (cause) =>
      new Error(`Failed to write runtime env file at ${OUTPUT_FILE_PATH}`, {
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      }),
    try: () => Bun.write(OUTPUT_FILE_PATH, outputLines.join('\n')),
  });
  yield* Effect.logInfo(`Wrote ${OUTPUT_FILE_PATH}`);
});

if (import.meta.main) BunRuntime.runMain(main);
