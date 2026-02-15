import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_APP_HOST_PORT = 4_200;
const DEFAULT_NEON_LOCAL_HOST_PORT = 55_432;
const OUTPUT_FILE_PATH = path.resolve(process.cwd(), '.env.development');

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
const digest = crypto.createHash('sha256').update(seed).digest();

const parsePort = (value: string | undefined): number | undefined => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    return undefined;
  }
  return parsed;
};

const resolvePort = (name: string, fallback: number): number =>
  parsePort(process.env[name]) ?? fallback;

const appHostPort = resolvePort('APP_HOST_PORT', DEFAULT_APP_HOST_PORT);
const neonLocalHostPort = resolvePort(
  'NEON_LOCAL_HOST_PORT',
  DEFAULT_NEON_LOCAL_HOST_PORT,
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
  const suffix = digest.toString('hex').slice(0, 8);
  return `${safeBasename}-${suffix}`;
};

const composeProjectName =
  process.env['COMPOSE_PROJECT_NAME']?.trim() || defaultProjectName();
const baseUrl = `http://localhost:${appHostPort}`;
const databaseUrl = `postgresql://neon:npg@localhost:${neonLocalHostPort}/${databaseName}?sslmode=require`;

const runtimeEnvironment = {
  APP_HOST_PORT: String(appHostPort),
  BASE_URL: baseUrl,
  COMPOSE_PROJECT_NAME: composeProjectName,
  DATABASE_URL: databaseUrl,
  NEON_DATABASE_NAME: databaseName,
  NEON_LOCAL_HOST_PORT: String(neonLocalHostPort),
  NEON_LOCAL_PROXY: 'true',
  PLAYWRIGHT_TEST_BASE_URL: baseUrl,
} as const;

const outputLines = [
  '# THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
  ...Object.entries(runtimeEnvironment).map(([key, value]) => `${key}=${value}`),
  '',
];

fs.writeFileSync(OUTPUT_FILE_PATH, outputLines.join('\n'), 'utf8');
process.stdout.write(`Wrote ${OUTPUT_FILE_PATH}\n`);
