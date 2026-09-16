import {
  DEFAULT_E2E_NOW_ISO,
  DEFAULT_E2E_SEED_KEY,
} from '@shared/testing/deterministic-test-defaults';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveLocalDatabaseEnvironment } from '../local-database-preflight';

// Generates worktree-local runtime ports and names so parallel Docker/test
// runs do not collide with the main checkout or other Codex worktrees.
const DEFAULT_APP_HOST_PORT = 4200;
const DEFAULT_POSTGRES_HOST_PORT = 55_432;
const DEFAULT_MINIO_HOST_PORT = 9000;
const DEFAULT_MINIO_CONSOLE_HOST_PORT = 9400;
const MAILPIT_HOST_PORT_RANGE_START = 10_000;
const MAILPIT_HOST_PORT_RANGE_SPAN = 40_000;
const DEFAULT_PORT_SPAN = 400;
const runtimePortNames = [
  'APP_HOST_PORT',
  'MAILPIT_HOST_PORT',
  'MINIO_CONSOLE_HOST_PORT',
  'MINIO_HOST_PORT',
  'POSTGRES_HOST_PORT',
] as const;
const runtimeDatabaseNames = [
  'DOCKER_DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'POSTGRES_USER',
] as const;
const deriveSeed = (cwd: string, environment: NodeJS.ProcessEnv): string => {
  const runId = environment['GITHUB_RUN_ID']?.trim();
  const runAttempt = environment['GITHUB_RUN_ATTEMPT']?.trim();
  if (runId) {
    return `${runId}:${runAttempt || '1'}`;
  }

  return cwd;
};

const digestSeed = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex');

const parsePort = (
  name: string,
  value: string | undefined,
): number | undefined => {
  const input = value?.trim();
  if (!input) return undefined;
  const parsed = /^\d+$/.test(input) ? Number(input) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error(`${name} must be a decimal port between 1024 and 65535`);
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
    const parsed = parsePort(name, environment[name]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return fallback;
};

export interface RuntimePorts {
  readonly appHostPort: number;
  readonly mailpitHostPort: number;
  readonly minioConsoleHostPort: number;
  readonly minioHostPort: number;
  readonly postgresHostPort: number;
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
    mailpitHostPort: resolvePort(
      environment,
      ['MAILPIT_HOST_PORT'],
      derivePort(
        digest,
        MAILPIT_HOST_PORT_RANGE_START,
        MAILPIT_HOST_PORT_RANGE_SPAN,
        32,
      ),
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
    postgresHostPort: resolvePort(
      environment,
      ['POSTGRES_HOST_PORT'],
      derivePort(digest, DEFAULT_POSTGRES_HOST_PORT, DEFAULT_PORT_SPAN, 8),
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

const sanitizeProjectName = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^[^a-z0-9]+|-$/g, '')
    .slice(0, 40);

const defaultProjectName = (digest: string, cwd: string): string => {
  const basename = path.basename(cwd);
  const safeBasename = sanitizeProjectName(basename) || 'evorto';
  const suffix = digest.slice(0, 8);
  return `${safeBasename}-${suffix}`;
};

export const createRuntimeEnvironment = (
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => {
  const seed = deriveSeed(cwd, environment);
  const digest = digestSeed(seed);
  const {
    appHostPort,
    mailpitHostPort,
    minioConsoleHostPort,
    minioHostPort,
    postgresHostPort,
  } = resolveRuntimePorts(seed, environment);
  const databaseName = environment['POSTGRES_DB'] || 'appdb';
  const databaseUser = environment['POSTGRES_USER'] || 'evorto';
  const databasePassword = environment['POSTGRES_PASSWORD'] || 'evorto-local';
  const e2eNowIso = environment['E2E_NOW_ISO']?.trim() || DEFAULT_E2E_NOW_ISO;
  const e2eSeedKey =
    environment['E2E_SEED_KEY']?.trim() || DEFAULT_E2E_SEED_KEY;
  const composeProjectName =
    environment['COMPOSE_PROJECT_NAME']?.trim() ||
    defaultProjectName(digest, cwd);
  const baseUrl = `http://localhost:${appHostPort}`;
  const databaseUrl = `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@localhost:${postgresHostPort}/${encodeURIComponent(databaseName)}?sslmode=disable`;
  const dockerDatabaseUrl = `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@db:5432/${encodeURIComponent(databaseName)}?sslmode=disable`;
  const postgresIntegrationDatabaseUrl = `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@localhost:${postgresHostPort}/evorto_postgres_integration?sslmode=disable`;

  return {
    APP_HOST_PORT: String(appHostPort),
    BASE_URL: baseUrl,
    COMPOSE_PROJECT_NAME: composeProjectName,
    DATABASE_URL: databaseUrl,
    DOCKER_DATABASE_URL: dockerDatabaseUrl,
    E2E_USE_DOCKER_STACK: 'true',
    E2E_NOW_ISO: e2eNowIso,
    E2E_SEED_KEY: e2eSeedKey,
    LOCAL_DATABASE: 'true',
    MAILPIT_HOST_PORT: String(mailpitHostPort),
    MINIO_CONSOLE_HOST_PORT: String(minioConsoleHostPort),
    MINIO_HOST_PORT: String(minioHostPort),
    NODE_ENV: 'development',
    POSTGRES_DB: databaseName,
    POSTGRES_HOST_PORT: String(postgresHostPort),
    POSTGRES_INTEGRATION_DATABASE_URL: postgresIntegrationDatabaseUrl,
    POSTGRES_PASSWORD: databasePassword,
    POSTGRES_USER: databaseUser,
    SSR_RPC_ORIGIN: baseUrl,
  } as const;
};

const escapeEnvironmentValue = (value: string): string => JSON.stringify(value);

const serializeRuntimeEnvironment = (
  runtimeEnvironment: Record<string, string>,
) =>
  [
    '# THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
    '# Worktree-specific overrides for local runtime commands.',
    ...Object.entries(runtimeEnvironment).map(
      ([key, value]) => `${key}=${escapeEnvironmentValue(value)}`,
    ),
    '',
  ].join('\n');

const resolveRuntimeEnvironment = (
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => {
  const readEnvironment = (name: string): Record<string, string> => {
    try {
      return parse(fs.readFileSync(path.join(cwd, name)));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return {};
      throw error;
    }
  };
  // Empty port overrides are absent at each priority, so an empty caller value
  // can still use a shared setting before falling back to generated defaults.
  const withoutBlankPorts = (source: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(source).filter(
        ([name, value]) =>
          !runtimePortNames.some((port) => port === name) ||
          value.trim() !== '',
      ),
    );
  const inherited = withoutBlankPorts(
    Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
  const base = readEnvironment('.env');
  const shared = withoutBlankPorts(readEnvironment('.env.dev.local'));
  const expandEnvironment = (generated: Record<string, string>) => {
    const parsed = { ...base, ...generated, ...shared };
    expand({ parsed, processEnv: { ...parsed, ...inherited } });
    return { ...parsed, ...inherited };
  };
  const defaults = createRuntimeEnvironment(cwd, {
    GITHUB_RUN_ID: inherited['GITHUB_RUN_ID'],
    GITHUB_RUN_ATTEMPT: inherited['GITHUB_RUN_ATTEMPT'],
  });
  const inputs = expandEnvironment(defaults);
  const generated = createRuntimeEnvironment(cwd, inputs);
  resolveLocalDatabaseEnvironment({
    ...generated,
    DATABASE_URL: generated.DOCKER_DATABASE_URL,
  });
  // Expand file references again against the derived URLs, then retain the
  // canonical inputs used for those URLs rather than raw/empty override text.
  const resolved = {
    ...expandEnvironment(generated),
    ...Object.fromEntries(
      [...runtimePortNames, ...runtimeDatabaseNames].map(
        (name) => [name, generated[name]] as const,
      ),
    ),
  };
  return { generated, resolved };
};

export const resolveInvocationEnvironment = (
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => resolveRuntimeEnvironment(cwd, environment).resolved;

export const runRuntimeCommand = (
  command: readonly string[],
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): never => {
  const [program, ...arguments_] = command;
  if (!program) throw new Error('env:run requires a command');
  if (environment['EVORTO_DOCKER_PROJECT_LEASE_HELD'] === 'true') {
    throw new Error(
      'Run env:run before acquiring the Docker project lease, or use the supported package command. Native process replacement cannot retain the lease.',
    );
  }
  const resolved: Record<string, string> = {
    ...resolveInvocationEnvironment(cwd, environment),
    EVORTO_RUNTIME_ENV_READY: 'true',
  };
  const executable = Bun.which(program, { cwd, PATH: resolved['PATH'] });
  if (!executable) throw new Error(`Command not found: ${program}`);
  if (!process.execve) throw new Error('env:run requires process.execve');
  process.chdir(cwd);
  // Replace this process so signals and exit status remain native. Package
  // commands acquire their project lease afterward: execve closes extra FDs.
  return process.execve(executable, [program, ...arguments_], resolved);
};

export const writeRuntimeEnvironment = (
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const directory = fs.mkdtempSync(path.join(cwd, '.env.dev-'));
  fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, 'runtime.env');
  const destination = path.join(cwd, '.env.dev');
  try {
    fs.writeFileSync(
      temporary,
      serializeRuntimeEnvironment(
        resolveRuntimeEnvironment(cwd, environment).generated,
      ),
      { mode: 0o600 },
    );
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
  return destination;
};

if (import.meta.main) {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode === '--run') {
    const command = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    runRuntimeCommand(command);
  } else if (mode === undefined) {
    process.stdout.write(`Wrote ${writeRuntimeEnvironment()}\n`);
  } else {
    throw new Error(
      'Usage: runtime-environment.ts [--run -- <command> [arguments...]]',
    );
  }
}
